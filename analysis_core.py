"""Saved ST1221 numerical routines. Provenance: engine_provenance.json.

Independent of the web server; no file access or output at import time.
"""
import itertools
import numpy as np
from scipy.fft import fft2, fftshift, fftfreq
from scipy.ndimage import gaussian_filter, label
from scipy.spatial import cKDTree
from scipy.optimize import linear_sum_assignment

def canonical(q):
 q=np.array(q,copy=True);flip=(q[:,1]<-1e-8)|((abs(q[:,1])<1e-8)&(q[:,0]<0));q[flip]*=-1;return q

def peak_width(spectrum):
 # Older saved/cached spectra used the Hann-specific name.
 return spectrum.get('peak_width_nm_inv', spectrum.get('hann_power_fwhm_nm_inv', 1.44*spectrum['df']))

def spectrum(a,sx,sy,profile_fraction=.35,minimum_enrichment=3.,window='hann',remove_mean=True):
 if window not in ('hann','none') or not isinstance(remove_mean,bool):
  raise ValueError('Choose Hann or no window and a boolean mean-removal setting.')
 h,w=a.shape
 z=a.astype('float32')
 if remove_mean:z=z-float(z.mean())
 if window=='hann':z=z*np.hanning(h).astype('float32')[:,None]*np.hanning(w).astype('float32')[None,:]
 power=np.abs(fftshift(fft2(z,workers=2)))**2;fx=fftshift(fftfreq(w,sx));fy=-fftshift(fftfreq(h,sy));ix=np.where(abs(fx)<=10.5)[0];iy=np.where(abs(fy)<=10.5)[0];lg=np.log1p(power[np.ix_(iy,ix)]);xx,yy=np.meshgrid(fx[ix],fy[iy]);g=np.hypot(xx,yy);df=max(1/(w*sx),1/(h*sy));rb=np.floor(g/df).astype(int);bc=np.bincount(rb.ravel());bs=np.bincount(rb.ravel(),weights=lg.ravel());wh=gaussian_filter(lg-(bs/np.maximum(bc,1))[rb],.65);valid=(g>=3)&(g<=10)
 window_width=(1.44 if window=='hann' else .886)*df  # Approximate power FWHM of the window response.
 threshold=max(1.8,profile_fraction*float(np.max(wh[valid]))) if np.any(valid) else 1.8
 components,nc=label(valid&(wh>threshold));peaks=[]
 for ci in range(1,nc+1):
  ys,xs=np.where(components==ci)
  if not len(ys):continue
  j=int(np.argmax(wh[ys,xs]));y=int(ys[j]);x=int(xs[j]);en=float(wh[y,x])
  if en<minimum_enrichment:continue
  # One position per connected Fourier profile; shoulders remain in its footprint.
  dx=dy=0.
  if 0<x<lg.shape[1]-1 and 0<y<lg.shape[0]-1:
   for axis in [0,1]:
    f0=wh[y,x];fl=wh[y,x-1] if axis==0 else wh[y-1,x];fr=wh[y,x+1] if axis==0 else wh[y+1,x];den=fl-2*f0+fr;off=float(np.clip(.5*(fl-fr)/den,-.5,.5)) if den<0 else 0
    if axis==0:dx=off
    else:dy=off
  q=canonical(np.array([[float(xx[y,x]+dx*df),float(yy[y,x]-dy*df)]]))[0].tolist();weights=np.maximum(wh[ys,xs]-threshold,0);area=int(len(ys));width=float(np.sqrt(max(area,1)/np.pi)*2*df)
  peaks.append({'profile_id':0,'qx':q[0],'qy':q[1],'g_nm_inv':float(np.linalg.norm(q)),'log_radial_enrichment':en,'weight':float(np.clip(en-2,1,6)),'profile_area_bins':area,'equivalent_profile_diameter_nm_inv':width})
 peaks.sort(key=lambda p:p['log_radial_enrichment'],reverse=True)
 # Weak fragments within one window response cannot be counted independently.
 clean=[]
 for p in peaks:
  if any(np.hypot(p['qx']-v['qx'],p['qy']-v['qy'])<max(.12,window_width) for v in clean):continue
  p['profile_id']=len(clean)+1;clean.append(p)
  if len(clean)>=70:break
 return {'log':lg,'extent':[float(fx[ix[0]]),float(fx[ix[-1]]),float(fy[iy[-1]]),float(fy[iy[0]])],'peaks':clean,'df':df,'peak_width_nm_inv':window_width,'fft_window':window,'remove_mean':remove_mean,'profile_threshold':threshold,**({'hann_power_fwhm_nm_inv':window_width} if window=='hann' else {})}

def rotation(q,ang):
 c=np.cos(ang);s=np.sin(ang);return q@np.array([[c,s],[-s,c]])

def score_hypothesis(peaks,T,q,scale,ang,tol):
 O=np.array([[p['qx'],p['qy']] for p in peaks]);w=np.array([p['weight'] for p in peaks]);rawP=rotation(q*scale,ang);flip=(rawP[:,1]<-1e-8)|((abs(rawP[:,1])<1e-8)&(rawP[:,0]<0));P=canonical(rawP);hkl=T['hkl'].copy();hkl[flip]*=-1;g=np.linalg.norm(P,axis=1);keep=(g>=3)&(g<=10);P=P[keep];hi=hkl[keep]
 if len(P)<4:return None
 d=np.linalg.norm(O[:,None]-P[None,:],axis=2);d=np.minimum(d,np.linalg.norm(O[:,None]+P[None,:],axis=2));qual=np.exp(-.5*(d/(tol/2))**2);qual[d>tol]=0;cost=np.c_[-w[:,None]*qual,np.zeros((len(O),len(O)))];ii,jj=linear_sum_assignment(cost);matches=[]
 for i,j in zip(ii,jj):
  if j>=len(P) or qual[i,j]<=0:continue
  matches.append({'profile_id':peaks[i]['profile_id'],'hkl':hi[j].tolist(),'predicted_q':P[j].tolist(),'observed_q':O[i].tolist(),'residual_nm_inv':float(d[i,j]),'quality':float(qual[i,j]),'weight':float(w[i]),'node_index':int(j)})
 if not matches:return None
 coverage=sum(x['weight'] for x in matches)/w.sum();quality=sum(x['weight']*x['quality'] for x in matches)/w.sum();og=np.linalg.norm(O,axis=1);pg=np.linalg.norm(P,axis=1)
 # Angular chance support conditional on measured radii corrects node density without declaring absent reflections forbidden.
 chance=np.minimum(1,((abs(og[:,None]-pg[None,:])<tol)*(2*np.arcsin(np.minimum(tol/np.maximum(og[:,None],.1),1))/np.pi)).sum(axis=1));penalty=float(w@chance/w.sum());score=quality-penalty
 angles=np.array([np.arctan2(x['observed_q'][1],x['observed_q'][0]) for x in matches]);spread=float(np.max(abs(np.sin(angles[:,None]-angles[None,:])))) if len(angles)>1 else 0
 return {'template_id':T['id'],'phase':T['phase'],'zone_3index':T['zone_3index'],'mirror':T['mirror'],'rotation_deg':float(np.degrees(ang)%180),'shared_scale':scale,'score':float(score),'coverage':float(coverage),'quality_coverage':float(quality),'chance_density_penalty':penalty,'matched_profile_count':len(matches),'predicted_visible_band_node_count':len(P),'nonparallel_spread_sine':spread,'rms_nm_inv':float(np.sqrt(np.mean([x['residual_nm_inv']**2 for x in matches]))),'matches':matches,'predicted_nodes':[{'q':v.tolist(),'hkl':h.tolist()} for v,h in zip(P,hi)],'valid':bool(len(matches)>=4 and spread>.5 and score>.20 and coverage>.30)}

def search(peaks,templates,scale,tol,topn=5,bcc_a=.330,candidate_sink=None):
 if len(peaks)<4:return []
 O=np.array([[p['qx'],p['qy']] for p in peaks]);w=np.array([p['weight'] for p in peaks]);og=np.linalg.norm(O,axis=1);oa=np.arctan2(O[:,1],O[:,0]);tree=cKDTree(np.r_[O,-O]);candidates=[]
 for T in templates:
  qs=T['q']*(.330/bcc_a if T['phase']=='BCC' else 1);g=np.linalg.norm(qs,axis=1)*scale;ta=np.arctan2(qs[:,1],qs[:,0]);pairs=np.argwhere(abs(og[:min(16,len(og)),None]-g[None,:])<tol)
  if not len(pairs):continue
  angles=np.unique(np.round(((oa[pairs[:,0]]-ta[pairs[:,1]])%np.pi)/np.radians(.5))*np.radians(.5));cs=np.cos(angles);sn=np.sin(angles);P=np.empty((len(angles),len(qs),2));P[:,:,0]=scale*(cs[:,None]*qs[None,:,0]-sn[:,None]*qs[None,:,1]);P[:,:,1]=scale*(sn[:,None]*qs[None,:,0]+cs[:,None]*qs[None,:,1]);dist,ind=tree.query(P.reshape(-1,2));dist=dist.reshape(len(angles),-1);ind=ind.reshape(len(angles),-1)%len(O);vals=np.exp(-.5*(dist/(tol/2))**2);vals[dist>tol]=0;support=np.zeros((len(angles),len(O)));np.maximum.at(support,(np.repeat(np.arange(len(angles)),len(qs)),ind.ravel()),vals.ravel());quick=support@w/w.sum()
  for ai in np.argsort(quick)[-2:]:
   if quick[ai]<.2:continue
   ang=float(angles[ai]);r=score_hypothesis(peaks,T,qs,scale,ang,tol)
   if r:
    # Continuous in-plane rotation refinement at the SAME fixed shared scale.
    # No radial scale, affine distortion or phase-specific metric refinement is allowed.
    for iteration in range(2):
     num=0j
     for match in r['matches']:
      pv=np.array(match['predicted_q']);ov=np.array(match['observed_q']);ov=ov if ov@pv>=0 else -ov;num+=match['weight']*complex(*ov)*np.conj(complex(*pv))
     delta=float(np.angle(num)) if abs(num)>0 else 0
     if abs(delta)>np.radians(2):delta=float(np.clip(delta,-np.radians(2),np.radians(2)))
     rr=score_hypothesis(peaks,T,qs,scale,ang+delta,tol)
     if rr and rr['score']>=r['score']:r=rr;ang+=delta
     else:break
    r['nominal_a_nm']=bcc_a if T['phase']=='BCC' else .295;r['nominal_c_nm']=None if T['phase']=='BCC' else .468;candidates.append(r)
 if candidate_sink is not None:candidate_sink.extend(candidates)
 return retain(candidates,topn)

def retain(candidates,topn=5):
 # Keep distinct support/orientation hypotheses; symmetry copies cannot inflate evidence.
 out=[]
 for c in sorted(candidates,key=lambda x:x['score'],reverse=True):
  ids=set(x['profile_id'] for x in c['matches'])
  if any(c['phase']==v['phase'] and len(ids&set(x['profile_id'] for x in v['matches']))/max(len(ids|set(x['profile_id'] for x in v['matches'])),1)>.8 for v in out):continue
  if sum(v['phase']==c['phase'] for v in out)>=topn:continue
  out.append(c)
 return out

def classify(peaks,models,df):
 valid=[m for m in models if m['valid']];total=sum(p['weight'] for p in peaks);w={p['profile_id']:p['weight'] for p in peaks}
 base={'label':'insufficient' if len(peaks)<4 else 'unresolved','dominant_fraction':0.,'explained_weight_fraction':0.,'unique_secondary_support':0.,'competing_phase_unique_support':0.,'valid_pattern_phases':sorted(set(m['phase'] for m in valid)),'valid_pattern_count':len(valid),'model_specific_support':{},'flags':[],'primary_model':None,'secondary_model':None}
 if not valid:return base
 primary=valid[0];P={x['profile_id'] for x in primary['matches']};base['primary_model']=primary;secondary=None;best_unique=0
 for m in valid[1:]:
  Q={x['profile_id'] for x in m['matches']};U=Q-P;u=sum(w[x] for x in U)/total
  # A second pattern needs independent support beyond the shared short row: ≥3 unique profiles and ≥2 nonparallel directions.
  vec=[next(p for p in peaks if p['profile_id']==x) for x in U];ang=np.array([np.arctan2(p['qy'],p['qx']) for p in vec]);spread=np.max(abs(np.sin(ang[:,None]-ang[None,:]))) if len(ang)>1 else 0
  if len(U)>=3 and spread>.5 and u>.15 and u>best_unique:secondary=m;best_unique=u
 rivals=[m for m in valid[1:] if m['phase']!=primary['phase'] and primary['score']-m['score']<.08 and len(P&set(x['profile_id'] for x in m['matches']))/max(len(P),1)>.6]
 base['secondary_model']=secondary;base['unique_secondary_support']=best_unique;union=P|({x['profile_id'] for x in secondary['matches']} if secondary else set());base['explained_weight_fraction']=sum(w[x] for x in union)/total;base['dominant_fraction']=sum(w[x] for x in P)/sum(w[x] for x in union)
 if secondary and secondary['phase']==primary['phase']:base['dominant_fraction']=1.
 else:base['competing_phase_unique_support']=best_unique
 # A further competing phase cannot be hidden by an accepted second orientation of the primary phase.
 phase_union=union if secondary and secondary['phase']==primary['phase'] else P
 for m in valid[1:]:
  if m['phase']==primary['phase']:continue
  unique={x['profile_id'] for x in m['matches']}-phase_union
  if len(unique)>=3:base['competing_phase_unique_support']=max(base['competing_phase_unique_support'],sum(w[x] for x in unique)/total)
 if secondary:
  base['label']='coexisting_candidates' if secondary['phase']!=primary['phase'] else 'multiple_orientations';base['flags'].append('Separate unique frequency sets support two patterns; this is not proof of two phases.')
 elif rivals:
  base['label']='ambiguous';base['flags'].append('The same measured profiles admit competing HCP/BCC labels; do not call this mixed phase.')
 elif primary['coverage']>.45:
  base['label']='hcp_compatible' if primary['phase']=='HCP' else 'bcc_compatible'
 if df>.15:base['flags'].append('At ~5nm, Hann broadening is about0.286nm^-1; near-coincident template differences are resolution-limited.')
 return base

def gridfit(peaks,tol,min_profiles=4,exclude_ids=()):
 if len(peaks)<min_profiles:return None
 O=np.array([[p['qx'],p['qy']] for p in peaks]);w=np.array([p['weight'] for p in peaks]);order=np.argsort(w)[::-1][:16];total=w.sum();candidates=[]
 for i,j in itertools.combinations(order,2):
  B=np.array([O[i],O[j]]);gn=np.linalg.norm(B,axis=1);area=abs(np.linalg.det(B));sine=area/np.prod(gn)
  if max(gn)>8.3 or min(gn)<3 or area<10 or sine<.45:continue
  seed=[peaks[i]['profile_id'],peaks[j]['profile_id']]
  for iteration in range(3):
   if abs(np.linalg.det(B))<10:break
   coeff=np.rint(O@np.linalg.inv(B)).astype(int);P=coeff@B;dist=np.linalg.norm(O-P,axis=1);quality=np.exp(-.5*(dist/(tol/2))**2);candidate=np.where((dist<=tol)&(np.max(abs(coeff),axis=1)<=4)&(np.max(abs(coeff),axis=1)>0))[0];used=set();inds=[]
   for k in sorted(candidate,key=lambda k:w[k]*quality[k],reverse=True):
    h=tuple(coeff[k]);neg=tuple(-coeff[k]);key=min(h,neg)
    if key in used:continue
    used.add(key);inds.append(int(k))
   if len(inds)<min_profiles:break
   rr=np.array(inds);ww=np.sqrt(w[rr]*quality[rr]);BB=np.linalg.lstsq(coeff[rr]*ww[:,None],O[rr]*ww[:,None],rcond=None)[0]
   if abs(np.linalg.det(BB))<10 or max(np.linalg.norm(BB,axis=1))>9:break
   if iteration<2:B=BB;continue
   ang=np.arctan2(O[rr,1],O[rr,0]);spread=float(np.max(abs(np.sin(ang[:,None]-ang[None,:]))))
   if spread<.5:break
   # Predict a finite reciprocal grid from observed basis seeds; no missing half-basis is invented.
   cs=np.array(list(itertools.product(range(-4,5),repeat=2)));qp=cs@B;gg=np.linalg.norm(qp,axis=1);sel=(gg>=3)&(gg<=10)&((qp[:,1]>1e-8)|((abs(qp[:,1])<=1e-8)&(qp[:,0]>0)));cs=cs[sel];qp=qp[sel];gg=gg[sel]
   if len(qp)>32 or len(qp)<min_profiles:break
   og=np.linalg.norm(O,axis=1);chance=np.minimum(1,((abs(og[:,None]-gg[None,:])<tol)*(2*np.arcsin(np.minimum(tol/np.maximum(og[:,None],.1),1))/np.pi)).sum(axis=1));chance=float(w@chance/total);coverage=float(w[rr].sum()/total);qcoverage=float((w[rr]*quality[rr]).sum()/total);score=qcoverage-chance-.03
   matches=[{'profile_id':peaks[k]['profile_id'],'coefficients_mn':coeff[k].tolist(),'observed_q':O[k].tolist(),'predicted_q':P[k].tolist(),'residual_nm_inv':float(dist[k]),'weight':float(w[k])} for k in inds]
   coupled=bool(np.any(np.prod(coeff[rr],axis=1)!=0));unique=[k for k in inds if peaks[k]['profile_id'] not in exclude_ids];unique_weight=float(sum(w[k] for k in unique)/total);unique_quality=float(sum(w[k]*quality[k] for k in unique)/total);ua=np.arctan2(O[unique,1],O[unique,0]) if unique else np.array([]);us=float(np.max(abs(np.sin(ua[:,None]-ua[None,:])))) if len(ua)>1 else 0;valid=score>.25 and coverage>=.5 and coupled
   if exclude_ids:valid=score>.20 and coverage>=.3 and coupled and len(unique)>=3 and us>.5
   cand={'basis_vectors_nm_inv':B.tolist(),'observed_seed_profile_ids':seed,'matched_profile_count':len(inds),'matches':matches,'predicted_nodes':[{'q':q.tolist(),'coefficients_mn':c.tolist()} for q,c in zip(qp,cs)],'coverage':coverage,'score':score,'quality_coverage':qcoverage,'chance_density_penalty':chance,'rms_nm_inv':float(np.sqrt(np.mean(dist[rr]**2))),'cell_area_nm_inv_squared':float(abs(np.linalg.det(B))),'has_coupled_combination_node':coupled,'unique_profile_count':len(unique),'unique_weight_fraction':unique_weight,'unique_quality_coverage':unique_quality,'valid':bool(valid),'interpretation':'Geometry-only reciprocal lattice; no crystal structure, hkl or phase identity assigned.'};candidates.append(cand)
   break
 if not candidates:return None
 return max(candidates,key=lambda c:(c['valid'],c['unique_quality_coverage'] if exclude_ids else c['score'],c['coverage']))

def purity(peaks,tol):
 primary=gridfit(peaks,tol,4);total=sum(p['weight'] for p in peaks);out={'status':'unresolved_pattern','primary_lattice':primary,'secondary_lattice':None,'primary_weight_fraction':primary['coverage'] if primary else 0.,'secondary_unique_fraction':0.,'explained_fraction':primary['coverage'] if primary else 0.,'dominance':None,'substantial_second_pattern':False,'phase_independent':True,'unexplained_residual_fraction':1-primary['coverage'] if primary else 1.}
 if not primary or not primary['valid']:return out
 used={x['profile_id'] for x in primary['matches']}
 second=gridfit(peaks,tol,4,exclude_ids=used)
 # A failed residual fit can repeat the primary grid; it is not a second pattern.
 if second and not second['valid']:second=None
 unique=second['unique_weight_fraction'] if second else 0.;dominance=primary['coverage']/(primary['coverage']+unique);strong=[p for p in peaks if p.get('log_local_contrast',p.get('log_radial_enrichment',0))>=.5*max(q.get('log_local_contrast',q.get('log_radial_enrichment',0)) for q in peaks)];strongtotal=sum(p['weight'] for p in strong);strongcoverage=sum(p['weight'] for p in strong if p['profile_id'] in used)/strongtotal
 out.update({'secondary_lattice':second,'secondary_unique_fraction':unique,'explained_fraction':min(1,primary['coverage']+unique),'dominance':dominance,'strong_profile_weight_fraction':strongcoverage,'substantial_second_pattern':bool(second and second['valid'] and dominance<.80),'unexplained_residual_fraction':max(0,1-primary['coverage']-unique)})
 out['status']='multiple_periodic_patterns' if out['substantial_second_pattern'] else 'predominantly_one_periodic_pattern'
 return out

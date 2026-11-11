"""Saved ST1221 numerical routines. Provenance: engine_provenance.json.

Independent of the web server; no file access or output at import time.
"""
import itertools
from functools import lru_cache
from scipy.signal.windows import tukey
import spot_intensity
import region_masks
import numpy as np
from scipy.fft import fft2, fftshift, fftfreq
from scipy.ndimage import gaussian_filter, label
from scipy.spatial import cKDTree
from scipy.optimize import linear_sum_assignment

FFT_WORKERS = 2  # Grid processes use one FFT thread each.

def canonical(q):
 q=np.array(q,copy=True);flip=(q[:,1]<-1e-8)|((abs(q[:,1])<1e-8)&(q[:,0]<0));q[flip]*=-1;return q

def peak_width(spectrum):
 # Older saved/cached spectra used the Hann-specific name.
 return spectrum.get('peak_width_nm_inv', spectrum.get('hann_power_fwhm_nm_inv', 1.44*spectrum['df']))

@lru_cache(maxsize=128)
def tukey_power_width_bins(length,alpha):
 # Measure the selected 1D taper once per window size, not once per grid ROI.
 return region_masks.axis_response_width(tukey(length,alpha),1.)*length

def prepare_fft_input(a,window="hann",remove_mean=True,selection_mask=None,tukey_alpha=.2):
 """The real input transformed by both analysis and reciprocal filtering."""
 if window not in ('hann','tukey','none') or not isinstance(remove_mean,bool):
  raise ValueError('Choose Hann, Tukey or no window and a boolean mean-removal setting.')
 if not np.isfinite(tukey_alpha) or not 0<=tukey_alpha<=1:
  raise ValueError('Tukey taper must be between zero and one.')
 h,w=a.shape
 z=a.astype('float32')
 if selection_mask is not None:
  mask=np.asarray(selection_mask,dtype='float32')
  if mask.shape!=z.shape or not np.isfinite(mask).all() or mask.min()<0 or mask.max()>1 or mask.sum()<=0:
   raise ValueError('The selection mask must contain finite weights between zero and one.')
  if remove_mean:z=z-float(np.sum(z*mask,dtype='float64')/mask.sum(dtype='float64'))
  z=z*mask/np.sqrt(np.mean(mask*mask))
 elif window in ('hann','tukey'):
  if remove_mean:z=z-float(z.mean())
  wy=np.hanning(h) if window=='hann' else tukey(h,tukey_alpha)
  wx=np.hanning(w) if window=='hann' else tukey(w,tukey_alpha)
  z=z*wy.astype('float32')[:,None]*wx.astype('float32')[None,:]
 elif remove_mean:z=z-float(z.mean())
 return z

def processed_fft_signal(log_power,radius,bin_width,smoothing_sigma):
 """Radial-background subtraction followed by detector smoothing."""
 rb=np.floor(radius/bin_width).astype(int)
 bc=np.bincount(rb.ravel());bs=np.bincount(rb.ravel(),weights=log_power.ravel())
 return gaussian_filter(log_power-(bs/np.maximum(bc,1))[rb],smoothing_sigma)

def spectrum(a,sx,sy,profile_fraction=.35,minimum_enrichment=3.,window='hann',remove_mean=True,g_max=10.,g_min=3.,
             smoothing_sigma=.65,threshold_floor=1.8,minimum_separation=.5,max_peaks=70,selection_mask=None,tukey_alpha=.2):
 if not all(np.isfinite(v) for v in (smoothing_sigma,threshold_floor,minimum_enrichment,minimum_separation,max_peaks)) or not (0<=smoothing_sigma<=3 and 0<=threshold_floor<=20 and 0<=minimum_enrichment<=20 and 0<=minimum_separation<=3 and 4<=max_peaks<=200 and int(max_peaks)==max_peaks):
  raise ValueError('FFT detection settings are outside the supported range.')
 h,w=a.shape
 z=prepare_fft_input(a,window,remove_mean,selection_mask,tukey_alpha)
 mask_widths=region_masks.response_widths(np.asarray(selection_mask,dtype='float32'),sx,sy) if selection_mask is not None else None
 power=np.abs(fftshift(fft2(z,workers=FFT_WORKERS)))**2;fx=fftshift(fftfreq(w,sx));fy=-fftshift(fftfreq(h,sy));ix=np.where(abs(fx)<=g_max*1.05)[0];iy=np.where(abs(fy)<=g_max*1.05)[0];lg=np.log1p(power[np.ix_(iy,ix)]);xx,yy=np.meshgrid(fx[ix],fy[iy]);g=np.hypot(xx,yy);df=max(1/(w*sx),1/(h*sy));wh=processed_fft_signal(lg,g,df,smoothing_sigma);valid=(g>0)&(g>=g_min)&(g<=g_max)
 dfx,dfy=1/(w*sx),1/(h*sy)
 taper_widths=[tukey_power_width_bins(w,tukey_alpha)*dfx,tukey_power_width_bins(h,tukey_alpha)*dfy] if window=='tukey' and not mask_widths else None
 window_width=max(mask_widths or taper_widths) if mask_widths or taper_widths else (1.44 if window=='hann' else .886)*df  # Approximate power FWHM of the window response.
 fraction_threshold=profile_fraction*float(np.max(wh[valid])) if np.any(valid) else 0.
 threshold=max(threshold_floor,fraction_threshold)
 components,nc=label(valid&(wh>threshold));peaks=[]
 for ci in range(1,nc+1):
  ys,xs=np.where(components==ci)
  if not len(ys):continue
  j=int(np.argmax(wh[ys,xs]));y=int(ys[j]);x=int(xs[j]);en=float(wh[y,x])
  # One position per connected Fourier profile; shoulders remain in its footprint.
  dx=dy=0.
  if 0<x<lg.shape[1]-1 and 0<y<lg.shape[0]-1:
   for axis in [0,1]:
    f0=wh[y,x];fl=wh[y,x-1] if axis==0 else wh[y-1,x];fr=wh[y,x+1] if axis==0 else wh[y+1,x];den=fl-2*f0+fr;off=float(np.clip(.5*(fl-fr)/den,-.5,.5)) if den<0 else 0
    if axis==0:dx=off
    else:dy=off
  q=canonical(np.array([[float(xx[y,x]+dx*dfx),float(yy[y,x]-dy*dfy)]]))[0].tolist();weights=np.maximum(wh[ys,xs]-threshold,0);area=int(len(ys));width=float(np.sqrt(max(area,1)*dfx*dfy/np.pi)*2)
  if not g_min <= np.linalg.norm(q) <= g_max or np.linalg.norm(q)==0:continue
  peaks.append({'_fft_position_px':[float(ix[x]+dx),float(iy[y]+dy)],'profile_id':0,'qx':q[0],'qy':q[1],'g_nm_inv':float(np.linalg.norm(q)),'log_radial_enrichment':en,'weight':float(np.clip(en-2,1,6)),'profile_area_bins':area,'equivalent_profile_diameter_nm_inv':width,'radius_nm_inv':width/2,'intensity':float(np.expm1(lg[y,x]))})
 peaks.sort(key=lambda p:p['log_radial_enrichment'],reverse=True)
 # Weak fragments within one window response cannot be counted independently.
 # Profiles represent +/-q: neighbours can cross the canonical half-plane seam.
 clean=[]
 for p in peaks:
  if any(min(np.hypot(p['qx']-v['qx'],p['qy']-v['qy']),np.hypot(p['qx']+v['qx'],p['qy']+v['qy']))<max(minimum_separation,window_width) for v in clean):continue
  p['profile_id']=len(clean)+1;clean.append(p)
  if len(clean)>=max_peaks:break
 photometry=spot_intensity.measure_fft(power,fx,fy,clean,window_width/min(dfx,dfy) if mask_widths or taper_widths else (1.44 if window=='hann' else .886),neighbours=peaks)
 clean=[p for p in clean if p['log_radial_enrichment']>=minimum_enrichment]
 spot_intensity.number_profiles(clean)
 return {**({'selection_window':'polygon_cosine_fade','mask_power_normalization':'mean_square','window_fwhm_xy_nm_inv':mask_widths} if mask_widths else {}),'kind':'fft','photometry':photometry,'profile_numbering':'integrated_intensity_descending','g_min':float(g_min),'g_max':float(g_max),'log':lg,'detector_signal':wh,'extent':[float(fx[ix[0]]),float(fx[ix[-1]]),float(fy[iy[-1]]),float(fy[iy[0]])],'peaks':clean,'df':df,'peak_width_nm_inv':window_width,'fft_window':window,'fft_tukey_alpha':float(tukey_alpha),'remove_mean':remove_mean,'profile_threshold':threshold,'fraction_threshold':float(fraction_threshold),'detection_smoothing_sigma_bins':float(smoothing_sigma),'detection_threshold_floor':float(threshold_floor),'minimum_peak_enrichment':float(minimum_enrichment),'minimum_peak_separation_nm_inv':float(max(minimum_separation,window_width)),'max_peak_profiles':int(max_peaks),**({'hann_power_fwhm_nm_inv':window_width} if window=='hann' and not mask_widths else {})}

def rotation(q,ang):
 c=np.cos(ang);s=np.sin(ang);return q@np.array([[c,s],[-s,c]])

def matching_parameters(spectrum):
 """A common distance scale, fixed before comparing any crystal candidates.

 In direct diffraction, combine spot width in quadrature with 4% of the median
 measured reciprocal radius. This is a phase-neutral ranking allowance, not a
 measured strain or distortion model. Both terms follow coordinate rescaling.
 FFT retains its window-response scale: a broader neighbourhood can merge
 support from separate phases or admit noise in automatic-threshold searches.
 """
 width=float(peak_width(spectrum))
 radii=[np.hypot(p['qx'],p['qy']) for p in spectrum.get('peaks',[])]
 reference=float(np.median(radii)) if radii else 0.
 direct=spectrum.get('kind')=='diffraction'
 fraction=.04 if direct else 0.
 allowance=fraction*reference
 scale=float(np.hypot(width,allowance)) if direct else max(.10,width)
 return dict(method='soft-cauchy-v1',scale_rule='width-plus-relative-distortion-v1' if direct else 'fft-window-width-v1',
             peak_width_nm_inv=width,reference_radius_nm_inv=reference,
             relative_distortion_fraction=fraction,distortion_allowance_nm_inv=allowance,
             distance_scale_nm_inv=scale,search_radius_nm_inv=matching_radius(scale))

def matching_context(spectrum,context):
 # Preserve the physical footprint used to assess masks/borders and neighbours.
 # A positional allowance must not make unsupported sites unassessable.
 parameters=matching_parameters(spectrum)
 return {**context,'position_scale':parameters['distance_scale_nm_inv'],
         'position_matching':parameters}

def matching_radius(width):
 # Width controls loss of positional credit, not a hard acceptance boundary.
 return 4.*width

def positional_quality(distance,width):
 """Heavy-tailed positional agreement, tapering continuously to zero at 4 widths.

 The Cauchy tail admits displaced/distorted reflections with partial credit.
 Subtracting its boundary value avoids a jump at the finite search limit.
 This is a ranking kernel, not a measurement-error probability distribution.
 """
 x=np.asarray(distance)/width
 return np.maximum(0.,(1./(1.+x*x)-1./17.)/(16./17.))

def positional_chance(observed_radii,predicted_radii,width):
 """Mean of the SAME kernel under random relative angles, for +/- profiles.

 Integrate each prediction's support over the nearest half-circle analytically.
 Summing and capping is a conservative density allowance for overlapping nodes.
 A wider search must not get free credit from more chance coincidences.
 """
 r=np.asarray(observed_radii)[:,None];p=np.asarray(predicted_radii)[None,:]
 delta=width*width+(r-p)**2;total=width*width+(r+p)**2
 cosine=(r*r+p*p-matching_radius(width)**2)/np.maximum(2*r*p,1e-30)
 angle=np.arccos(np.clip(cosine,0.,1.))
 integral=2*width*width/np.sqrt(delta*total)*np.arctan(np.sqrt(total/delta)*np.tan(angle/2))
 chance=(2/np.pi)*(integral-angle/17.)/(16./17.)
 return np.clip(np.maximum(chance,0.).sum(axis=1),0.,1.)

def omega_node_scales(nodes, base, multiplier=1., phase=None):
 """Broaden omega-only positions; shared beta/omega positions keep base width."""
 def omega_only(node):
  if 'components' in node:
   owners=[c['component'] for c in node['components']]
   return bool(owners) and 0 not in owners and 'beta' not in owners
  return set(node.get('phases', [phase])) == {'OMEGA'}
 return np.array([base*(multiplier if omega_only(n) else 1.) for n in nodes])


def score_prediction_nodes(peaks,nodes,tol,node_scales=None):
 # Common assignment/score for independent lattices and constrained unions.
 if not peaks or not nodes:return None
 widths=tol if node_scales is None else np.asarray(node_scales,dtype=float)
 O=np.array([[p['qx'],p['qy']] for p in peaks]);w=np.array([p['weight'] for p in peaks]);P=np.array([n['q'] for n in nodes]);hi=np.array([n['hkl'] for n in nodes])
 d=np.linalg.norm(O[:,None]-P[None,:],axis=2);d=np.minimum(d,np.linalg.norm(O[:,None]+P[None,:],axis=2));qual=positional_quality(d,widths);cost=np.c_[-w[:,None]*qual,np.zeros((len(O),len(O)))];ii,jj=linear_sum_assignment(cost);matches=[]
 for i,j in zip(ii,jj):
  if j>=len(P) or qual[i,j]<=0:continue
  matches.append({'profile_id':peaks[i]['profile_id'],'hkl':hi[j].tolist(),'predicted_q':P[j].tolist(),'observed_q':O[i].tolist(),'residual_nm_inv':float(d[i,j]),'quality':float(qual[i,j]),'weight':float(w[i]),'node_index':int(j)})
 if not matches:return None
 coverage=sum(x['weight'] for x in matches)/w.sum();quality=sum(x['weight']*x['quality'] for x in matches)/w.sum();og=np.linalg.norm(O,axis=1);pg=np.linalg.norm(P,axis=1)
 # Angular chance support conditional on measured radii corrects node density without declaring absent reflections forbidden.
 chance=positional_chance(og,pg,widths);penalty=float(w@chance/w.sum());score=quality-penalty
 angles=np.array([np.arctan2(x['observed_q'][1],x['observed_q'][0]) for x in matches]);spread=float(np.max(abs(np.sin(angles[:,None]-angles[None,:])))) if len(angles)>1 else 0
 return {'score':float(score),'coverage':float(coverage),'quality_coverage':float(quality),'chance_density_penalty':penalty,'matched_profile_count':len(matches),'predicted_visible_band_node_count':len(P),'nonparallel_spread_sine':spread,'rms_nm_inv':float(np.sqrt(np.mean([x['residual_nm_inv']**2 for x in matches]))),'matches':matches,'predicted_nodes':nodes,'position_matching':dict(method='soft-cauchy-v1',distance_scale_nm_inv=float(tol),search_radius_nm_inv=float(matching_radius(tol)),**({'node_distance_scales_nm_inv':widths.tolist()} if node_scales is not None else {})),'valid':bool(len(matches)>=4 and spread>.5 and score>.20 and coverage>.30)}


def score_hypothesis(peaks,T,q,scale,ang,tol,g_max=10.,g_min=3.):
 rawP=rotation(q*scale,ang);flip=(rawP[:,1]<-1e-8)|((abs(rawP[:,1])<1e-8)&(rawP[:,0]<0));P=canonical(rawP);hkl=T['hkl'].copy();hkl[flip]*=-1;g=np.linalg.norm(P,axis=1);keep=(g>0)&(g>=g_min)&(g<=g_max)
 nodes=[{'q':v.tolist(),'hkl':h.tolist()} for v,h in zip(P[keep],hkl[keep])]
 if len(nodes)<4:return None
 result=score_prediction_nodes(peaks,nodes,tol)
 if result:result.update(template_id=T['id'],phase=T['phase'],zone_3index=T['zone_3index'],mirror=T['mirror'],rotation_deg=float(np.degrees(ang)%180),shared_scale=scale)
 return result

def additional_orientation_seeds(angles, scores, support, initial, limit=2):
 """Supplement existing seeds with distinct orientations AND measured support.

 Preserve all existing scale/angle starts. Prioritize positional support gained
 over those starts, so high-scoring subsets cannot crowd out a weaker pattern.
 Better agreement with already covered observations still counts as a gain.
 A >2 degree rotation (modulo pi) and <=80% support overlap avoids symmetry copies.
 This is a bounded search heuristic, not an orientation-resolution claim.
 """
 chosen=list(initial);extra=[];ids=[set(np.flatnonzero(row>0)) for row in support]
 values=np.asarray(support)
 covered=np.max(values[chosen],axis=0) if chosen else np.zeros(values.shape[1])
 gain=np.maximum(values-covered,0).sum(axis=1)/np.maximum(values.sum(axis=1),1e-12)
 for i in np.lexsort((scores,scores*gain))[::-1]:
  if scores[i]<.2 or gain[i]<=1e-12:continue
  if i in chosen:continue
  if any(abs(np.sin(angles[i]-angles[j]))<=np.sin(np.radians(2)) or
         len(ids[i]&ids[j])/max(len(ids[i]|ids[j]),1)>.8 for j in chosen):continue
  chosen.append(int(i));extra.append(int(i))
  if len(extra)>=limit:break
 return extra

def search(peaks,templates,scale,tol,topn=5,bcc_a=.330,candidate_sink=None,fcc_a=.417,g_max=10.,g_min=3.,omega_falloff_multiplier=1.):
 if len(peaks)<4:return []
 O=np.array([[p['qx'],p['qy']] for p in peaks]);w=np.array([p['weight'] for p in peaks]);og=np.linalg.norm(O,axis=1);oa=np.arctan2(O[:,1],O[:,0]);tree=cKDTree(np.r_[O,-O]);candidates=[]
 base_tol=tol
 for T in templates:
  tol=base_tol*(omega_falloff_multiplier if T['phase']=='OMEGA' else 1.)
  qs=T['q']*({'BCC':.330/bcc_a,'FCC':.417/fcc_a}.get(T['phase'],1));g=np.linalg.norm(qs,axis=1)*scale;ta=np.arctan2(qs[:,1],qs[:,0]);pairs=np.argwhere(abs(og[:min(16,len(og)),None]-g[None,:])<matching_radius(tol))
  if not len(pairs):continue
  angles=np.unique(np.round(((oa[pairs[:,0]]-ta[pairs[:,1]])%np.pi)/np.radians(.5))*np.radians(.5));cs=np.cos(angles);sn=np.sin(angles);P=np.empty((len(angles),len(qs),2));P[:,:,0]=scale*(cs[:,None]*qs[None,:,0]-sn[:,None]*qs[None,:,1]);P[:,:,1]=scale*(sn[:,None]*qs[None,:,0]+cs[:,None]*qs[None,:,1]);dist,ind=tree.query(P.reshape(-1,2));dist=dist.reshape(len(angles),-1);ind=ind.reshape(len(angles),-1)%len(O);vals=positional_quality(dist,tol);vals[:,(g<g_min)|(g>g_max)]=0;support=np.zeros((len(angles),len(O)));np.maximum.at(support,(np.repeat(np.arange(len(angles)),len(qs)),ind.ravel()),vals.ravel());quick=support@w/w.sum()
  initial=list(np.argsort(quick)[-2:])
  for ai in initial+additional_orientation_seeds(angles,quick,support,initial):
   if quick[ai]<.2:continue
   ang=float(angles[ai]);r=score_hypothesis(peaks,T,qs,scale,ang,tol,g_max,g_min)
   if r:
    # Continuous in-plane rotation refinement at the SAME fixed shared scale.
    # No radial scale, affine distortion or phase-specific metric refinement is allowed.
    for iteration in range(2):
     num=0j
     for match in r['matches']:
      pv=np.array(match['predicted_q']);ov=np.array(match['observed_q']);ov=ov if ov@pv>=0 else -ov;num+=match['weight']*match['quality']*complex(*ov)*np.conj(complex(*pv))
     delta=float(np.angle(num)) if abs(num)>0 else 0
     if abs(delta)>np.radians(2):delta=float(np.clip(delta,-np.radians(2),np.radians(2)))
     rr=score_hypothesis(peaks,T,qs,scale,ang+delta,tol,g_max,g_min)
     if rr and rr['score']>=r['score']:r=rr;ang+=delta
     else:break
    r['nominal_a_nm']={'BCC':bcc_a,'FCC':fcc_a,'HCP':T.get('reference_a_nm',.295),'OMEGA':T.get('reference_a_nm',.4614),'ORT':T.get('reference_a_nm',.3)}[T['phase']];r['nominal_c_nm']=T.get('reference_c_nm',.468) if T['phase'] in ('HCP','OMEGA','ORT') else None;r['nominal_b_nm']=T.get('reference_b_nm');candidates.append(r)
 if candidate_sink is not None:candidate_sink.extend(candidates)
 return retain(candidates,topn)

def retain(candidates,topn=5):
 # Keep distinct support/orientation hypotheses; symmetry copies cannot inflate evidence.
 out=[]
 for c in sorted(candidates,key=lambda x:x['score'],reverse=True):
  ids=set(x['profile_id'] for x in c['matches'])
  if any(c['phase']==v['phase'] and c['zone_3index']==v['zone_3index'] and len(ids&set(x['profile_id'] for x in v['matches']))/max(len(ids|set(x['profile_id'] for x in v['matches'])),1)>.8 for v in out):continue
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
  base['label']='ambiguous';base['flags'].append('The same measured profiles admit competing structure labels; do not call this mixed phase.')
 elif primary['coverage']>.45:
  base['label']=primary['phase'].lower()+'_compatible'
 if df>.15:base['flags'].append('At ~5nm, Hann broadening is about0.286nm^-1; near-coincident template differences are resolution-limited.')
 return base

def gridfit(peaks,tol,min_profiles=4,exclude_ids=(),g_max=10.,g_min=3.):
 if len(peaks)<min_profiles:return None
 O=np.array([[p['qx'],p['qy']] for p in peaks]);w=np.array([p['weight'] for p in peaks]);order=np.argsort(w)[::-1][:16];total=w.sum();candidates=[]
 for i,j in itertools.combinations(order,2):
  B=np.array([O[i],O[j]]);gn=np.linalg.norm(B,axis=1);area=abs(np.linalg.det(B));sine=area/np.prod(gn)
  if max(gn)>8.3 or min(gn)<max(g_min,tol) or area<10 or sine<.45:continue
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
   cs=np.array(list(itertools.product(range(-4,5),repeat=2)));qp=cs@B;gg=np.linalg.norm(qp,axis=1);sel=(gg>0)&(gg>=g_min)&(gg<=g_max)&((qp[:,1]>1e-8)|((abs(qp[:,1])<=1e-8)&(qp[:,0]>0)));cs=cs[sel];qp=qp[sel];gg=gg[sel]
   if len(qp)>32 or len(qp)<min_profiles:break
   og=np.linalg.norm(O,axis=1);chance=np.minimum(1,((abs(og[:,None]-gg[None,:])<tol)*(2*np.arcsin(np.minimum(tol/np.maximum(og[:,None],1e-12),1))/np.pi)).sum(axis=1));chance=float(w@chance/total);coverage=float(w[rr].sum()/total);qcoverage=float((w[rr]*quality[rr]).sum()/total);score=qcoverage-chance-.03
   matches=[{'profile_id':peaks[k]['profile_id'],'coefficients_mn':coeff[k].tolist(),'observed_q':O[k].tolist(),'predicted_q':P[k].tolist(),'residual_nm_inv':float(dist[k]),'weight':float(w[k])} for k in inds]
   coupled=bool(np.any(np.prod(coeff[rr],axis=1)!=0));unique=[k for k in inds if peaks[k]['profile_id'] not in exclude_ids];unique_weight=float(sum(w[k] for k in unique)/total);unique_quality=float(sum(w[k]*quality[k] for k in unique)/total);ua=np.arctan2(O[unique,1],O[unique,0]) if unique else np.array([]);us=float(np.max(abs(np.sin(ua[:,None]-ua[None,:])))) if len(ua)>1 else 0;valid=score>.25 and coverage>=.5 and coupled
   if exclude_ids:valid=score>.20 and coverage>=.3 and coupled and len(unique)>=3 and us>.5
   cand={'basis_vectors_nm_inv':B.tolist(),'observed_seed_profile_ids':seed,'matched_profile_count':len(inds),'matches':matches,'predicted_nodes':[{'q':q.tolist(),'coefficients_mn':c.tolist()} for q,c in zip(qp,cs)],'coverage':coverage,'score':score,'quality_coverage':qcoverage,'chance_density_penalty':chance,'rms_nm_inv':float(np.sqrt(np.mean(dist[rr]**2))),'cell_area_nm_inv_squared':float(abs(np.linalg.det(B))),'has_coupled_combination_node':coupled,'unique_profile_count':len(unique),'unique_weight_fraction':unique_weight,'unique_quality_coverage':unique_quality,'valid':bool(valid),'interpretation':'Geometry-only reciprocal lattice; no crystal structure, hkl or phase identity assigned.'};candidates.append(cand)
   break
 if not candidates:return None
 return max(candidates,key=lambda c:(c['valid'],c['unique_quality_coverage'] if exclude_ids else c['score'],c['coverage']))

def purity(peaks,tol,g_max=10.,g_min=3.):
 primary=gridfit(peaks,tol,4,g_max=g_max,g_min=g_min);total=sum(p['weight'] for p in peaks);out={'status':'unresolved_pattern','primary_lattice':primary,'secondary_lattice':None,'primary_weight_fraction':primary['coverage'] if primary else 0.,'secondary_unique_fraction':0.,'explained_fraction':primary['coverage'] if primary else 0.,'dominance':None,'substantial_second_pattern':False,'phase_independent':True,'unexplained_residual_fraction':1-primary['coverage'] if primary else 1.}
 if not primary or not primary['valid']:return out
 used={x['profile_id'] for x in primary['matches']}
 second=gridfit(peaks,tol,4,exclude_ids=used,g_max=g_max,g_min=g_min)
 # A failed residual fit can repeat the primary grid; it is not a second pattern.
 if second and not second['valid']:second=None
 unique=second['unique_weight_fraction'] if second else 0.;dominance=primary['coverage']/(primary['coverage']+unique);strong=[p for p in peaks if p.get('log_local_contrast',p.get('log_radial_enrichment',0))>=.5*max(q.get('log_local_contrast',q.get('log_radial_enrichment',0)) for q in peaks)];strongtotal=sum(p['weight'] for p in strong);strongcoverage=sum(p['weight'] for p in strong if p['profile_id'] in used)/strongtotal
 out.update({'secondary_lattice':second,'secondary_unique_fraction':unique,'explained_fraction':min(1,primary['coverage']+unique),'dominance':dominance,'strong_profile_weight_fraction':strongcoverage,'substantial_second_pattern':bool(second and second['valid'] and dominance<.80),'unexplained_residual_fraction':max(0,1-primary['coverage']-unique)})
 out['status']='multiple_periodic_patterns' if out['substantial_second_pattern'] else 'predominantly_one_periodic_pattern'
 return out


def geometry_strength_score(peaks, geometry, pool_weight, tol):
 """Fixed-pool positional evidence, with chance and per-grid complexity costs.

 Shared profiles contribute at most once. Only an independently screened
 secondary grid may be added, and only when it improves the union score.
 This is an exploratory selection objective, not a phase probability.
 """
 primary=geometry.get('primary_lattice')
 if not primary or not primary['valid']:
  return {'score':0.,'pattern_count':0,'explained_profiles':0}
 total=sum(p['weight'] for p in peaks)
 weights={p['profile_id']:p['weight'] for p in peaks}
 denominator=max(pool_weight,1e-12)
 def evaluate(grids):
  quality={}
  for grid in grids:
   for match in grid['matches']:
    ident=match['profile_id']
    q=float(np.exp(-.5*(match['residual_nm_inv']/(tol/2))**2))
    quality[ident]=max(quality.get(ident,0.),q)
  evidence=sum(weights[i]*q for i,q in quality.items())/denominator
  chance=sum(g['chance_density_penalty'] for g in grids)*total/denominator
  return {'score':evidence-chance-.03*len(grids),'pattern_count':len(grids),
          'explained_profiles':len(quality),'positional_evidence':evidence,
          'chance_cost':chance,'grid_cost':.03*len(grids)}
 best=evaluate([primary])
 secondary=geometry.get('secondary_lattice')
 if secondary and secondary['valid']:
  pair=evaluate([primary,secondary])
  if pair['score']>best['score']:best=pair
 return best

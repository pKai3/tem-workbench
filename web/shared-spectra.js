/* Source-bound exploratory PCA/NMF; component activity is not phase abundance. */
const PcaView={
 mergeLive(previous,update){
  if(!update)return null;
  const offset=update.window_offset??0,prior=previous?.generation===update.generation?previous.windows:[];
  if(offset>prior.length)throw new Error('Live map update is missing earlier windows.');
  return {...update,windows:[...prior.slice(0,offset),...update.windows]};
 },
 sourceLabel(model){
  const sources=[...(model.sources?.length?model.sources:[model])];
  if(sources.every(s=>s.kind!=='combination')){
   sources.sort((a,b)=>a.component-b.component||a.side.localeCompare(b.side));
   return 'PC '+[...new Set(sources.map(s=>`${s.component+1}${s.side==='positive'?'+':'−'}`))].join(', ');
  }
  const labels=[...new Set(sources.map(s=>s.kind==='combination'?`PC ${s.components.map(i=>i+1).join('+')}`:`PC ${s.component+1}${s.side==='positive'?'+':'−'}`))];
  return labels.slice(0,3).join(' / ')+(labels.length>3?` / ${labels.length-3} more sources`:'');
 },
 topHypotheses(maps,n){
  return [...maps.models].sort((a,b)=>(maps.model_passing_counts[b.id]||0)-(maps.model_passing_counts[a.id]||0)||(maps.model_mean_support?.[b.id]||0)-(maps.model_mean_support?.[a.id]||0)||a.id-b.id).slice(0,Math.max(1,Math.floor(n)||1));
 },
 orderedHypotheses(maps,mode='benefit'){
  const remaining=this.topHypotheses(maps,maps.models.length);
  if(mode==='passing')return remaining;
  const scores=new Map(remaining.map(m=>[m.id,new Map()])),best=new Map(),ordered=[];
  maps.windows.forEach((window,i)=>{
   for(const c of window.candidates)if(c.valid&&Number.isFinite(c.score)&&scores.has(c.model)){
    const values=scores.get(c.model);values.set(i,Math.max(values.get(i)??-Infinity,c.score));
   }
  });
  while(remaining.length){
   let winner=0,winnerKey=null;
   remaining.forEach((model,i)=>{
    let added=0,improved=0,gain=0;
    for(const [wi,score] of scores.get(model.id)){
     const previous=best.get(wi);if(previous!==undefined&&score<=previous)continue;
     if(previous===undefined)added++;else improved++;
     gain+=score-(previous??0);
    }
    const key=mode==='better'?[improved,added,gain]:[added+improved,added,gain];
    // Equal benefit keeps the passing-count/mean-score/id order.
    const firstDifference=winnerKey?key.findIndex((value,j)=>value!==winnerKey[j]):-1;
    if(!winnerKey||(firstDifference>=0&&key[firstDifference]>winnerKey[firstDifference])){winner=i;winnerKey=key}
   });
   const [model]=remaining.splice(winner,1);ordered.push(model);
   for(const [wi,score] of scores.get(model.id))best.set(wi,Math.max(best.get(wi)??-Infinity,score));
  }
  return ordered;
 },
 hypothesisPools(maps,ranked=this.topHypotheses(maps,maps.models.length)){
  const added=ranked.map(()=>0),improved=ranked.map(()=>0);
  for(const window of maps.windows){
   const passing=new Map();
   for(const c of window.candidates)if(c.valid&&Number.isFinite(c.score))passing.set(c.model,Math.max(passing.get(c.model)??-Infinity,c.score));
   let best=-Infinity;
   ranked.forEach((model,i)=>{
    const score=passing.get(model.id);if(score==null||score<=best)return;
    if(best===-Infinity)added[i]++;else improved[i]++;
    best=score;
   });
  }
  let supported=0;
  return added.map((count,i)=>({count:i+1,supported:supported+=count,newlySupported:count,improved:improved[i]}));
 },
 supportPercent(count,total){return `${(total?100*count/total:0).toFixed(1)}%`},
 winningSolutions(maps,local,palette,registry){
  const counts=new Map();
  for(const state of local)if(state.winner)counts.set(state.winner.model,(counts.get(state.winner.model)||0)+1);
  return this.topHypotheses(maps,maps.models.length).filter(m=>counts.has(m.id)).map(model=>{
   if(!registry.has(model.id))registry.set(model.id,palette[registry.size]??`◌${registry.size+1}`);
   return {model,symbol:registry.get(model.id),count:counts.get(model.id)};
  });
 },
 localHypotheses(window,ids){
  const pool=new Set(ids),passing=window.candidates.filter(c=>pool.has(c.model)&&c.valid).sort((a,b)=>b.score-a.score||a.model-b.model);
  if(!passing.length)return {passing,winner:null,label:'unresolved',independent:[]};
  const angles=new Map((window.peak_positions||[]).map(([id,x,y])=>[id,Math.atan2(y,x)]));
  const independent=profiles=>{
   const a=[...profiles].map(id=>angles.get(id)).filter(Number.isFinite);
   return a.length>=3&&a.length/Math.max(window.peak_count,1)>.15&&a.some(x=>a.some(y=>Math.abs(Math.sin(x-y))>.5));
  };
  const chosen=[passing[0]];
  for(const candidate of passing.slice(1)){
   const trial=[...chosen,candidate];
   if(trial.every(c=>{const used=new Set(trial.filter(o=>o!==c).flatMap(o=>o.profiles));return independent(new Set(c.profiles.filter(id=>!used.has(id))))}))chosen.push(candidate);
  }
  const base=new Set(passing[0].profiles),rivals=passing.slice(1).filter(c=>passing[0].score-c.score<.08&&c.profiles.filter(id=>base.has(id)).length/Math.max(base.size,1)>.6);
  return {passing,winner:passing[0],label:chosen.length>1?'multiple':rivals.length?'ambiguous':'single',independent:chosen.map(c=>c.model)};
 },
 hypothesisColour(model,mode='phase'){
  if(mode==='phase')return this.phaseColours[model.phase]||[210,210,210];
  const h=(model.id*137.508+205)%360,s=.65,l=.65,c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs(h/60%2-1)),m=l-c/2;
  const rgb=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
  return rgb.map(v=>Math.round((v+m)*255));
 },
 phaseColours:{BCC:[54,255,88],HCP:[121,188,255],OMEGA:[255,181,74],FCC:[255,121,198],ORT:[102,223,188]},
 supportColour(window,phase='all'){
  if(phase!=='all')return window.candidates.some(c=>c.phase===phase&&c.valid)?(this.phaseColours[phase]||[210,210,210]):[65,72,80];
  if(window.label==='ambiguous')return [230,155,170];
  if(!window.phases.length)return [110,120,130];
  const colours=window.phases.map(p=>this.phaseColours[p]||[210,210,210]);
  return [0,1,2].map(i=>Math.round(colours.reduce((sum,c)=>sum+c[i],0)/colours.length));
 },
 values(data,mode,component,selected){
  if(mode==='residual')return data.residual;
  if(mode==='component')return data.components[component].scores;
  if(data.decomposition==='nmf')return data.components[0].scores.map((row,y)=>row.map((_,x)=>selected.reduce((sum,i)=>sum+data.components[i].scores[y][x],0)));
  return data.components[0].scores.map((row,y)=>row.map((_,x)=>Math.sqrt(selected.reduce((sum,i)=>sum+data.components[i].scores[y][x]**2,0))));
 },
 colour(value,scale,signed){
  const t=Math.max(-1,Math.min(1,value/Math.max(scale,1e-20)));
  return signed?[Math.round(30+225*Math.max(t,0)),Math.round(30+115*Math.abs(t)),Math.round(30+225*Math.max(-t,0))]:[Math.round(255*Math.max(t,0)),Math.round(215*Math.sqrt(Math.max(t,0))),Math.round(165*t*t)];
 },
 mapRange(values,enhanced){
  const sorted=values.flat().filter(Number.isFinite).sort((a,b)=>a-b),max=sorted.at(-1)||0;
  const percentile=q=>{const x=(sorted.length-1)*q,i=Math.floor(x);return sorted[i]+(sorted[Math.min(i+1,sorted.length-1)]-sorted[i])*(x-i)};
  const low=percentile(.02),high=percentile(.98),uniform=max-(sorted[0]||0)<=Math.max(Math.abs(max)*1e-6,1e-20);
  return {low:enhanced&&!uniform?low:0,high:enhanced&&!uniform&&high>low?high:max,uniform};
 },
 mapColour(value,low,high){
  const t=Math.max(0,Math.min(1,(value-low)/Math.max(high-low,1e-20)));
  const stops=[[25,20,85],[35,90,180],[15,185,195],[150,220,90],[255,240,90]],x=t*4,i=Math.min(3,Math.floor(x));
  return stops[i].map((v,c)=>Math.round(v+(stops[i+1][c]-v)*(x-i)));
 },
 palette(t,name){
  const sequential=typeof SPECTRUM_PALETTES==='undefined'?null:SPECTRUM_PALETTES[name==='grey'?'gray':name];
  if(sequential)return sequential[Math.round(Math.max(0,Math.min(1,t))*255)];
  const divergent={rdbu:[[33,102,172],[146,197,222],[247,247,247],[244,165,130],[178,24,43]],purplegreen:[[118,42,131],[194,165,207],[247,247,247],[166,219,160],[27,120,55]]};
  const stops=divergent[name]||[[0,0,0],[255,255,255]],x=Math.max(0,Math.min(1,t))*(stops.length-1),i=Math.min(stops.length-2,Math.floor(x));
  return stops[i].map((v,c)=>Math.round(v+(stops[i+1][c]-v)*(x-i)));
 },
 signedRange(values){
  const high=Math.max(1e-20,...values.flat().filter(Number.isFinite).map(Math.abs));
  return {low:-high,high};
 },
 scoreRms(component){
  const scores=component.scores.flat();
  return Math.sqrt(scores.reduce((sum,v)=>sum+v*v,0)/Math.max(1,scores.length));
 },
 sharedPcaRanges(data){
  // Scores carry PCA amplitude; unit-length eigenvectors alone do not.
  return {map:this.signedRange(data.components.flatMap(c=>c.scores)),
   spectrum:this.signedRange(data.components.map(c=>c.spectrum.limits.map(v=>v*this.scoreRms(c))))};
 },
 spectrumLevel(code,limits,multiplier,range){
  const value=(limits[0]+code/254*(limits[1]-limits[0]))*multiplier;
  return Math.max(0,Math.min(1,(value-range.low)/Math.max(range.high-range.low,1e-20)));
 },
 topCount(value,total){return Math.max(1,Math.min(total,Math.floor(Number(value)||1)))},
 nearest(plan,x,y){
  const [w,h]=plan.window_pixels;
  const closest=(values,v)=>values.reduce((best,a,i)=>Math.abs(a-v)<Math.abs(values[best]-v)?i:best,0);
  return closest(plan.ys,y-h/2)*plan.xs.length+closest(plan.xs,x-w/2);
 }
};
// Adapt the sampled spectrum's scalar raster to the main FFT contrast renderer.
const sampledSpectrumCache=new WeakMap();
function sampledSpectrumRaster(spec){
 if(sampledSpectrumCache.has(spec))return sampledSpectrumCache.get(spec);
 const canvas=document.createElement('canvas');canvas.width=canvas.height=spec.size;
 const pixels=canvas.getContext('2d').createImageData(spec.size,spec.size),bytes=atob(spec.raster),histogram=new Uint32Array(255),mask=new Uint8Array(bytes.length);
 let sampleCount=0;
 for(let i=0;i<bytes.length;i++){
  const code=bytes.charCodeAt(i);pixels.data.set([code,code,code,255],i*4);
  if(code<255){histogram[code]++;mask[i]=1;sampleCount++}
 }
 const raw={canvas,pixels,histogram,mask,sampleCount,maximum:254,precise:false,limits:spec.limits};
 sampledSpectrumCache.set(spec,raw);return raw;
}
function sampledSpectrumUrl(spec,reference=null){
 if(!spec.raster)return spec.image;
 const raw=sampledSpectrumRaster(spec),basis=reference?.raster?sampledSpectrumRaster(reference):raw;
 return colourSpectrum({...raw,histogram:basis.histogram,sampleCount:basis.sampleCount},'fft');
}
function drawComponentFitOverlay(overlay,detail,chosen){
 overlay.replaceChildren();
 if($('show-spectrum-overlays').getAttribute('aria-pressed')==='false')return;
 const qp=(x,y)=>[(x/detail.g_max+1)*210,(1-y/detail.g_max)*210];
 const fits=[...chosen].map(i=>({model:detail.candidates[i],...independentFitStyle(detail.candidates[i],{models:detail.candidates})}));
 drawFitPredictions(fits,qp,overlay);
 for(const peak of detail.peaks)for(const sign of [1,-1]){
  const [x,y]=qp(sign*peak.qx,sign*peak.qy),mark=peakMarker(x,y,$('peak-marker').value,{'data-profile-id':peak.profile_id});
  if(mark){overlay.append(mark);const number=peakNumberLabel(x,y,peak.profile_id+1);if(number)overlay.append(number)}
 }
}
if(typeof module!=='undefined')module.exports=PcaView;
if(typeof document!=='undefined'){
 const initPca=()=>{
  let snapshot=null,context='',job=null,data=null,selected=new Set(),index=0,epoch=0,sampleEpoch=0,pollTimer=null,sourceImage=null,exporting=false,groupEpoch=0,showAllSignals=true,pipeline=null,cancelRequested=false,liveRevision=0;
  let inspectorRender=null,sampleImages=null;
  let restoreEpoch=0,pendingView=null;
  const dialog=$('pca-dialog'),form=$('pca-form');
  let section='signals';
  const solutionSymbols=new Map();let symbolModels=null,poolSummaries=[],hypothesisOrder=[],manualPool=false;
  const selectedHypotheses=new Set();
  const expandedSignals=new Set();
  const isPca=()=>data?.decomposition==='pca';
  const sourceLabel=g=>isPca()?PcaView.sourceLabel(g):`NMF ${g.components.map(i=>i+1).join(' + ')}`;
  const hypothesisIdentity=(m,rotation=m.rotation_deg)=>`${m.phase==='OMEGA'?'ω':m.phase} ${zoneLabel(m)} · ${rotation.toFixed(1)}°`;
  const hypothesisLabel=m=>`${hypothesisIdentity(m)} · ${m.sources?.length>2?m.sources.length+' sources':sourceLabel(m)}`;
  function showSection(next,scroll=false){
   section=next;
   for(const panel of dialog.querySelectorAll('[data-pca-panel]'))panel.hidden=panel.dataset.pcaPanel!==section;
   for(const button of dialog.querySelectorAll('[data-pca-tab]')){const active=button.dataset.pcaTab===section;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1}
   const mapAvailable=Boolean(data&&section==='signals');
   $('pca-inspect').hidden=!mapAvailable;$('pca-reference').hidden=!data||section!=='signals';
   if(mapAvailable)inspect();
   if(scroll)dialog.scrollTop=0;
  }
  for(const button of dialog.querySelectorAll('[data-pca-tab]'))button.onclick=()=>showSection(button.dataset.pcaTab,true);
  $('pca-navigation').onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const tabs=[...dialog.querySelectorAll('[data-pca-tab]')].filter(b=>!b.hidden),current=tabs.indexOf(document.activeElement);if(current<0)return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(current+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;showSection(tabs[next].dataset.pcaTab);tabs[next].focus()};
  $('pca-window-preview').onclick=()=>{$('pca-inspect').open=!$('pca-inspect').open;if($('pca-inspect').open)$('pca-inspect').scrollIntoView({block:'nearest'})};
  $('pca-inspect').ontoggle=()=>$('pca-window-preview').setAttribute('aria-expanded',String($('pca-inspect').open));
  const sourceContext=()=>JSON.stringify([fileId,meta?.sha256_pixels,meta?.pixel_x_nm,meta?.pixel_y_nm,settings()]);
  const notify=(message,error=false)=>{$('pca-status').textContent=message;$('pca-status').classList.toggle('error',error)};
  const running=()=>job?.state==='running'||pipeline!==null;
  const canInspect=()=>Boolean(data&&(!running()||['fit','support'].includes(pipeline?.stage||job?.operation)));
  const inspector=$('nmf-group-detail');
  function closeInspector(){groupEpoch++;inspectorRender=null;if(inspector.open)inspector.close()}
  inspector.addEventListener('close',()=>{groupEpoch++});
  function controls(){
   for(const field of form.querySelectorAll('input,select'))field.disabled=running()||exporting;
   $('pca-run').disabled=running()||exporting||!snapshot;
   $('pca-progress').hidden=!running();
   $('nmf-build-map').disabled=!data?.fits||data.fits.completed!==data.fits.total||running()||exporting;
   $('nmf-fit').disabled=!data||running()||exporting;$('nmf-cutoff').disabled=running()||exporting;
   $('pca-cancel').disabled=!running();$('pca-export').disabled=!data||running()||exporting;
   const pca=$('pca-method').value==='pca';for(const id of ['pca-combination-scope','pca-combination-help'])$(id).hidden=!pca;
   $('pca-combination-selection').hidden=!pca||$('pca-combination-mode').value==='none';
  }
  function combinationOptions(){
   const text=$('pca-combination-mode').value==='none'?'':$('pca-combination-components').value.trim(),k=data?.components.length||Number($('pca-count').value);
   if(text&&!/^\d+(?:\s*,\s*\d+)*$/.test(text))throw new Error('Enter PCA component numbers separated by commas, for example 1,2,3.');
   const ids=text?[...new Set(text.split(',').map(v=>Number(v)-1))]:Array.from({length:k},(_,i)=>i);
   if(ids.some(i=>i<0||i>=k))throw new Error(`Choose computed PCs 1–${k}.`);
   return {combination_mode:$('pca-combination-mode').value,combination_components:ids};
  }
  function clearResults(){closeInspector();liveRevision=0;spectrumEpoch++;groupPreviews.clear();data=null;selected.clear();$('pca-results').hidden=true;$('pca-navigation').hidden=true;$('pca-setup').open=true;sampleEpoch++;groupEpoch++;sourceImage=null;controls()}
  function options(){return {method:$('pca-method').value,window_nm:Number($('pca-window').value),spacing_nm:Number($('pca-spacing').value),components:Number($('pca-count').value),angular_sigma_deg:Number($('pca-angle').value),spacing_sigma_percent:Number($('pca-scale').value),normalization:$('pca-normalization').value}}
  const palette=signed=>$('pca-palette').value==='auto'?(signed?'rdbu':$('palette').value):$('pca-palette').value;
  const sharedPca=()=>data?.decomposition!=='nmf'&&$('pca-scale-shared').getAttribute('aria-pressed')==='true';
  let sharedRanges=null;
  function spectrumDisplay(component){
   const signed=data.decomposition!=='nmf',limits=component.spectrum.limits;
   return sharedPca()?{multiplier:PcaView.scoreRms(component),range:sharedRanges.spectrum,signed}:
    {multiplier:1,range:{low:limits[0],high:limits[1]},signed};
  }
  function spectrumCanvas(canvas,component){
   const spec=component.spectrum,ctx=canvas.getContext('2d');
   if(!spec.raster){const img=new Image();img.onload=()=>ctx.drawImage(img,0,0,canvas.width,canvas.height);img.src=spec.image;return}
   canvas.width=canvas.height=spec.size;
   const display=spectrumDisplay(component),bytes=atob(spec.raster),pixels=ctx.createImageData(spec.size,spec.size),lut=Array.from({length:255},(_,i)=>PcaView.palette(PcaView.spectrumLevel(i,spec.limits,display.multiplier,display.range),palette(display.signed)));
   for(let i=0;i<bytes.length;i++){const v=bytes.charCodeAt(i),c=v===255?[5,10,15]:lut[v];pixels.data.set([...c,255],i*4)}
   ctx.putImageData(pixels,0,0);
  }
  function paintMap(canvas,values,signed,outline=false){
   const p=data.plan,[height,width]=p.image_shape,ctx=canvas.getContext('2d'),scale=Math.min(canvas.width/width,canvas.height/height),ox=(canvas.width-width*scale)/2,oy=(canvas.height-height*scale)/2;
   ctx.fillStyle='#050a0f';ctx.fillRect(0,0,canvas.width,canvas.height);
   if(sourceImage?.complete&&sourceImage.naturalWidth)ctx.drawImage(sourceImage,ox,oy,width*scale,height*scale);
   const range=signed?(sharedPca()?sharedRanges.map:PcaView.signedRange(values)):PcaView.mapRange(values,$('pca-contrast').value==='variation'),[w,h]=p.window_pixels,[dx,dy]=[p.spacing_nm[0]/p.pixel_nm[0],p.spacing_nm[1]/p.pixel_nm[1]];
   ctx.globalAlpha=Number($('pca-opacity').value);
   for(let y=0;y<p.ys.length;y++)for(let x=0;x<p.xs.length;x++){
    const colour=PcaView.palette((values[y][x]-range.low)/Math.max(range.high-range.low,1e-20),palette(signed)),cx=p.xs[x]+w/2,cy=p.ys[y]+h/2;
    const left=Math.max(0,cx-dx/2),top=Math.max(0,cy-dy/2),right=Math.min(width,cx+dx/2),bottom=Math.min(height,cy+dy/2);
    ctx.fillStyle=`rgb(${colour.join(',')})`;ctx.fillRect(ox+left*scale,oy+top*scale,(right-left)*scale+.2,(bottom-top)*scale+.2);
   }
   ctx.globalAlpha=1;
   if(outline){const iy=Math.floor(index/p.xs.length),ix=index%p.xs.length;ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.strokeRect(ox+p.xs[ix]*scale,oy+p.ys[iy]*scale,w*scale,h*scale)}
   return range;
  }
  function rangeKey(container,range,signed){
   const bar=document.createElement('span');bar.className='pca-colourbar';bar.style.background=`linear-gradient(to right,${Array.from({length:9},(_,i)=>`rgb(${PcaView.palette(i/8,palette(signed)).join(',')})`).join(',')})`;
   const text=document.createElement('span');text.textContent=`${range.low.toPrecision(3)}${signed?' · 0 ·':' →'} ${range.high.toPrecision(3)}${range.uniform?' · uniform':''}`;
   container.replaceChildren(bar,text);
  }
  function drawOverview(){
   const box=$('pca-overview');box.replaceChildren();
   const count=PcaView.topCount($('pca-top').value,data.components.length),signed=data.decomposition!=='nmf';
   for(const c of data.components.slice(0,count)){
    const card=document.createElement('article');card.className='pca-signal';card.classList.toggle('expanded',expandedSignals.has(c.index));
    const title=document.createElement('button');title.type='button';title.className='pca-signal-heading';title.dataset.signal=String(c.index);title.textContent=`${signed?'PC':'NMF'} ${c.index+1} · ${(100*c.variance).toFixed(1)}% ${signed?'variance':'signal share'}`;
    title.style.setProperty('--signal-share',`${Math.max(0,Math.min(1,c.variance))*100}%`);title.setAttribute('aria-expanded',String(expandedSignals.has(c.index)));
    title.title=(signed?'Share of total variance after mean subtraction.':'Share of reconstructed area-weighted log-power signal across sampled windows; spectra may be unit-normalized. Includes shared background. Not explained variance, distinct-peak importance, area or phase fraction.')+' Header fill uses the full 0–100% scale. Click to enlarge or restore this card.';
    title.onclick=()=>{if(expandedSignals.has(c.index))expandedSignals.delete(c.index);else expandedSignals.add(c.index);drawOverview();box.querySelector(`[data-signal="${c.index}"]`).focus({preventScroll:true})};
    const map=document.createElement('canvas');map.width=map.height=350;map.setAttribute('aria-label',title.textContent+' spatial map');map.setAttribute('role','img');map.className='pca-mini-map';map.dataset.component=String(c.index);map.tabIndex=0;map.title='Click a location to inspect its spectrum; arrow keys move between windows';map.onclick=selectMapWindow;map.onkeydown=stepMapWindow;
    const key=document.createElement('div');key.className='pca-mini-key';const range=paintMap(map,c.scores,signed,true);rangeKey(key,range,signed);
    const label=document.createElement('div');label.className='hint';label.textContent=`${sharedPca()?'RMS contribution':'Spectrum'} · ±${data.plan.g_max} nm⁻¹`;
    label.classList.add('pca-spectrum-heading');
    for(const side of signed?['positive','negative']:[null]){const fits=document.createElement('button');fits.type='button';fits.className='pca-card-fits';fits.textContent=side?'Fit '+(side==='positive'?'+':'−'):'Fits';fits.setAttribute('aria-label',side?`Inspect ${side} features of PC ${c.index+1}`:`Inspect crystal fits for NMF ${c.index+1}`);fits.onclick=()=>side?inspectLobe(c.index,side):inspectComponent(c.index);label.append(fits)}
    const spectrum=document.createElement('canvas');spectrum.setAttribute('role','img');spectrum.setAttribute('aria-label',title.textContent+' spectrum');spectrumCanvas(spectrum,c);if(!signed)componentAction(spectrum,c.index);
    card.append(title,map,key,label,spectrum);
    if(signed){const spectralKey=document.createElement('div');spectralKey.className='pca-mini-key';rangeKey(spectralKey,spectrumDisplay(c).range,true);card.append(spectralKey)}
    box.append(card);
   }
  }
  let spectrumEpoch=0;
  const groupPreviews=new Map();
  function selectedSpectrumGroup(){return [...selected].sort((a,b)=>a-b)}
  function inspectSelectedSpectrum(){
   inspectGroup({components:selectedSpectrumGroup()});
  }
  function drawSelectedSpectrum(mode,overview){
   const serial=++spectrumEpoch,canvas=$('pca-spectrum'),label=$('pca-spectrum-label');
   const group=mode==='group',nmf=data.decomposition==='nmf';
   $('pca-spectrum-key').hidden=true;
   canvas.closest('figure').hidden=mode==='residual'||(group&&!nmf);
   $('nmf-inspect-component').hidden=!nmf;
   if(overview||canvas.closest('figure').hidden)return;
   const ids=selectedSpectrumGroup(),name=`NMF ${ids.map(i=>i+1).join(' + ')} combined spectrum`,key=job.id+':'+ids.join(',');
   canvas.setAttribute('role','button');canvas.tabIndex=0;canvas.title='Inspect this group’s detected peaks and crystal fits';
   canvas.onclick=inspectSelectedSpectrum;
   canvas.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();inspectSelectedSpectrum()}};
   canvas.setAttribute('aria-label',name);label.textContent=name+' · loading…';
   canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
   if(!groupPreviews.has(key)){
    if(groupPreviews.size>64)groupPreviews.clear();
    groupPreviews.set(key,api('pca/group-preview',{id:job.id,components:ids}).catch(error=>{groupPreviews.delete(key);throw error}));
   }
   groupPreviews.get(key).then(result=>{
    if(serial!==spectrumEpoch)return;
    spectrumCanvas(canvas,result);label.textContent=name+(result.cooccurring_windows?'':' · no co-occurring windows');
   }).catch(error=>{if(serial===spectrumEpoch)label.textContent=name+' · '+error.message});
  }
  function drawMap(){
   if(!data)return;
   sharedRanges=data.decomposition==='nmf'?null:PcaView.sharedPcaRanges(data);
   const overview=$('pca-layout').value==='overview';
   $('pca-signal-scale-label').hidden=data.decomposition==='nmf'||!overview;
   $('pca-overview').hidden=!overview;$('pca-summary-view').hidden=overview;$('pca-top-label').hidden=!overview;
   const mode=$('pca-layout').value;
   $('pca-map-group-label').hidden=mode!=='group';
   $('pca-map-contrast-label').hidden=overview&&data.decomposition!=='nmf';
   if(!overview){const values=PcaView.values(data,mode,0,[...selected]);const range=paintMap($('pca-map'),values,false,true);rangeKey($('pca-map-key'),range,false);$('pca-map-label').textContent=mode==='group'?'Group activity':'Unexplained variation'}
   drawSelectedSpectrum(mode,overview);
   if(overview)drawOverview();drawPhaseMap();
  }
  async function inspect(){
   if(!canInspect()||!selected.size||$('pca-inspect').hidden)return;
   const serial=++sampleEpoch,jobId=job.id;
   $('pca-sample-label').textContent=`Window ${index+1} of ${data.plan.count} · loading spectra…`;
   try{
    const r=await api('pca/sample',{id:jobId,index,components:[...selected].sort((a,b)=>a-b)});
    if(serial!==sampleEpoch||job?.id!==jobId)return;
    sampleImages=r;renderSpectrumPreviews();
    $('pca-sample-label').textContent=`Window ${index+1} of ${data.plan.count} · X ${r.roi[0]}, Y ${r.roi[1]} · ${r.roi[2]} × ${r.roi[3]} px`;
    $('pca-sample-note').textContent=`These views use the same intensity range. Reconstruction uses ${r.selected.length} selected component(s)${data.decomposition==='nmf'?'':' plus the mean'}. ${(100*r.negative_fraction).toFixed(1)}% of reconstructed bins are negative and displayed black.`;
   }catch(e){if(serial===sampleEpoch)notify(e.message,true)}
  }
  function showResult(r,{keepInspector=false}={}){
   const first=!data;
   if(first){$('pca-setup').open=false;section='signals';expandedSignals.clear();$('pca-layout').value='overview'}
   data=r;$('pca-top').max=String(r.components.length);$('pca-top').value=String(showAllSignals?r.components.length:PcaView.topCount($('pca-top').value,r.components.length));$('pca-available').textContent=`of ${r.components.length} computed`;
   if(first||!keepInspector)closeInspector();if(first){selected=new Set(r.components.map(c=>c.index));index=Math.floor(r.plan.count/2)}
   $('pca-results').hidden=false;$('pca-navigation').hidden=false;$('pca-group').replaceChildren();$('pca-map-group').replaceChildren();
   const pca=r.decomposition==='pca';
   $('pca-smoothed-input').hidden=!(r.plan.angular_sigma_deg>0||r.plan.spacing_sigma_percent>0);
   $('pca-tab-support').textContent=pca?'Window checks':'Phase support';
   $('nmf-support-heading').textContent=pca?'Original-window checks':'Phase support';
   $('nmf-fit').textContent=pca?'Fit selected scope':'Fit all combinations';
   $('nmf-build-map').textContent=pca?'Check original windows':'Build phase maps';
   $('nmf-cutoff-label').textContent='Peak cutoff';
   $('nmf-fit-help').textContent=pca?'Individual positive/negative features are fitted separately. Selected combinations reconstruct the mean plus actual signed scores times loadings at each sampled window. Up to five distinct candidates per phase per source/subset are retained, with an exact source window. Open Analysis settings to change the selected PCs or scope. Original-window support is checked separately.':'Every nonempty NMF subset is fitted with captured phase and scale settings. Weighted sums use mean coefficients in co-occurring windows, or global means if none. Ranks use position minus scale cost, without main-analysis photometric penalties.';
   $('nmf-fit-help').textContent+=' Peak cutoff is the fraction of the strongest maximum above the median at the same reciprocal radius: default 0.35. Higher values reject more weak/background maxima. The saved cutoff applies to features, combinations and original-window checks; it is not a distance or an absolute brightness threshold. Matching uses the same native FFT taper-response width as ordinary FFT fits; optional decomposition smoothing does not widen it.';
   $('nmf-map-phase-label').textContent='Phase';
   $('nmf-map-help').textContent=pca?'The ticked hypotheses form the map pool. Best local match colours each square by its highest-support passing member; all locally supported shows every passing pool member. No passing member means unresolved. A white corner marks close competing explanations of shared peaks. Multiple patterns require at least three unique nonparallel profiles and over 15% of detected profiles per pattern. Passing overlays alone are not proof of coexistence or phase fractions. All hypotheses are checked against every original unbroadened window with ±3°/±3% refinement (rotation only for fixed scale), regardless of PCA score.':'Group fits are checked in eligible original windows with bounded local rotation and scale refinement. One best passing model per phase. Blended cells require separate nonparallel evidence. Pink marks competing explanations; colours are not phase fractions.';
   showSection(section);
   r.components.forEach(c=>{
    for(const host of ['pca-group','pca-map-group']){
     const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=selected.has(c.index);check.value=String(c.index);check.setAttribute('aria-label',`${host==='pca-group'?'Reconstruct with':'Group map component'} ${c.index+1}`);label.append(check,document.createTextNode(String(c.index+1)));$(host).append(label);
     check.onchange=()=>{if(check.checked)selected.add(c.index);else if(selected.size>1)selected.delete(c.index);else{check.checked=true;return}for(const other of dialog.querySelectorAll('#pca-group input,#pca-map-group input'))other.checked=selected.has(Number(other.value));drawMap();inspect()};
    }
   });
   sampleImages=null;renderSpectrumPreviews();
   $('pca-mean-label').textContent=r.decomposition==='nmf'?'Mean NMF reconstruction':'PCA baseline';
   $('pca-mean-help').textContent=pca?'Average of the inputs after optional smoothing and per-window normalization. PCA subtracts this baseline before finding components and adds it back during reconstruction. It can differ from the original average even when smoothing is zero. The display reverses reciprocal-area weighting, but does not restore each window’s original brightness. The two mean images use independent display ranges.':'Average spectrum reconstructed by all NMF factors, in the normalized input representation. NMF does not subtract a mean. This can differ from the original average because of normalization, optional smoothing and reconstruction error. The two images use independent display ranges.';
   $('pca-band').textContent=`${r.plan.g_min}–${r.plan.g_max} nm⁻¹ · +qx right, +qy up · centre excluded`;
   notify(r.decomposition==='nmf'?`${r.plan.count} windows · NMF ${r.iterations} iterations · relative reconstruction error ${(100*r.relative_reconstruction_error).toFixed(1)}%${r.converged?'':' · iteration limit reached'}. Bars show signal shares, not phase fractions.`:`${r.plan.count} windows · ${(r.explained*100).toFixed(1)}% of variance retained. Components are not phases.`);
   $('nmf-fitting').hidden=false;showFits();showPhaseMaps();
   sourceImage=new Image();sourceImage.onload=drawMap;sourceImage.src='/api/file-preview?id='+encodeURIComponent(snapshot.file_id);
   controls();drawMap();
  }
  function applyLive(update){
   if(!data||!update.changed)return;
   liveRevision=update.revision;
   const fitsChanged=update.fit_status!==data.fit_status||update.fits?.completed!==data.fits?.completed;
   data.fit_status=update.fit_status;data.fits=update.fits;
   data.phase_support_status=update.phase_support_status;
   data.phase_support=PcaView.mergeLive(data.phase_support,update.phase_support);
   if(fitsChanged)showFits();
   showPhaseMaps();drawPhaseMap();
   $('pca-inspect').hidden=section!=='signals';
  }
  async function poll(serial){
   try{
    const next=await api('pca?id='+encodeURIComponent(job.id));if(serial!==epoch)return;job=next;
    if(job.automatic)pipeline=job.state==='running'?{stage:job.operation}:null;
    controls();
    if(!data&&job.has_result){const result=await api('pca/result?id='+encodeURIComponent(job.id));if(serial!==epoch)return;showResult(result);restoreView()}
    $('pca-progress').max=Math.max(1,job.total);$('pca-progress').value=job.completed;
    notify(`${job.stage} · ${job.completed}/${job.total} · ${job.elapsed_seconds}s${job.state==='running'&&job.operation==='support'?' · crystal fits ready to inspect':''}`);
    if(job.state==='running'){
     if(data&&job.result_revision!==undefined&&job.result_revision!==liveRevision){
      const maps=data.phase_support;
      const update=await api('pca/live?id='+encodeURIComponent(job.id)+'&revision='+liveRevision+'&windows='+(maps?.windows.length||0)+'&generation='+encodeURIComponent(maps?.generation||''));
      if(serial!==epoch)return;applyLive(update);restoreView();
     }
     pollTimer=setTimeout(()=>poll(serial),600);
    }
    else if(job.state==='complete'){
     const result=await api('pca/result?id='+encodeURIComponent(job.id));if(serial!==epoch)return;
     const stage=pipeline?.stage||job.operation;
     const failure=stage==='fit'&&result.fit_status!=='complete'?result.fit_status||'incomplete':stage==='support'&&result.phase_support_status!=='complete'?result.phase_support_status||'incomplete':null;
     if(failure||stage==='support')pipeline=null;
     showResult(result,{keepInspector:['fit','support'].includes(stage)});
     restoreView();rememberViewer();
     if(failure){notify(`Analysis stopped: ${failure}. Completed results are retained.`,failure!=='cancelled');return}
     if(stage==='decomposition'&&pipeline)await startStage('fit',serial);
     else if(stage==='fit'&&pipeline)await startStage('support',serial);
     else if(stage==='support')notify(`${isPca()?'PCA':'NMF'} analysis complete · signals, crystal fits and ${isPca()?'original-window checks':'phase maps'} ready.`);
    }else{pipeline=null;controls();notify(job.state==='error'?job.error:'Analysis cancelled.',job.state==='error')}
   }catch(e){if(serial===epoch){
    if(!e.status||e.status>=500){notify('Connection interrupted · reconnecting to the analysis…',true);pollTimer=setTimeout(()=>poll(serial),1500)}
    else{pipeline=null;job={...job,state:'error'};controls();notify(e.message,true)}
   }}
  }
  async function startStage(stage,serial){
   const body={id:job.id};if(stage==='fit')body.options={peak_fraction:pipeline?.cutoff??Number($('nmf-cutoff').value),...(isPca()?combinationOptions():{})};
   if(pipeline)pipeline.stage=stage;
   if(stage==='fit'){closeInspector();sampleEpoch++;data.fits=null;data.fit_status='running';showFits()}
   data.phase_support=null;data.phase_support_status=stage==='support'?'running':null;symbolModels=null;showPhaseMaps();
   job={...job,state:'running',operation:stage};controls();$('pca-progress').value=0;
   notify(stage==='fit'?(isPca()?'Stage 2/3 · fitting PCA features and selected combinations…':'Stage 2/3 · fitting all crystal combinations…'):'Stage 3/3 · checking original windows · crystal fits are ready to inspect');
   const response=await api('pca/'+stage,body);if(serial!==epoch)return;job=response;
   if(cancelRequested)await api('pca/cancel',{id:job.id});
   poll(serial);
  }
  const viewerKey=()=>`tem-pca-viewer:${config?.state_namespace||'default'}`;
  const viewControlIds=['pca-layout','pca-top','pca-palette','pca-opacity','pca-contrast','pca-map-mode','pca-map-colour','pca-map-sort','pca-map-top','nmf-map-phase','nmf-map-opacity'];
  function savedViewer(){try{const saved=readPreference(viewerKey(),null);return typeof saved==='string'?JSON.parse(saved):saved}catch{return null}}
  function rememberViewer(){
   if(!job?.id||!snapshot||pendingView)return;
   writePreference(viewerKey(),{id:job.id,file_id:snapshot.file_id,open:dialog.open,section,index,
    selected:[...selected],hypotheses:[...selectedHypotheses],manualPool,showAllSignals,shared:sharedPca(),
    controls:Object.fromEntries(viewControlIds.map(id=>[id,$(id).value]))});
  }
  function restoreView(){
   if(!pendingView||!data)return;
   const view=pendingView;
   for(const [id,value] of Object.entries(view.controls||{}))if(viewControlIds.includes(id)&&$(id).value!==String(value))$(id).value=String(value);
   index=Math.max(0,Math.min(data.plan.count-1,Number(view.index)||0));showAllSignals=view.showAllSignals!==false;
   const ids=(view.selected||[]).filter(i=>data.components.some(c=>c.index===i));if(ids.length)selected=new Set(ids);
   for(const check of dialog.querySelectorAll('#pca-group input,#pca-map-group input'))check.checked=selected.has(Number(check.value));
   $('pca-scale-shared').setAttribute('aria-pressed',String(!!view.shared));$('pca-scale-individual').setAttribute('aria-pressed',String(!view.shared));
   showSection(['signals','fits','support'].includes(view.section)?view.section:'signals');
   if(data.phase_support){
    if(view.manualPool){manualPool=true;selectedHypotheses.clear();for(const id of view.hypotheses||[])if(data.phase_support.models.some(m=>m.id===id))selectedHypotheses.add(id)}
    else selectTopHypotheses(Number(view.controls?.['pca-map-top'])||3);
   }
   drawMap();
   // A saved map selection is applied after the first map snapshot arrives.
   if(data.phase_support||view.section!=='support'||!running())pendingView=null;
  }
  async function reconnect({reopen=false}={}){
   const source=fileId,serial=++restoreEpoch;
   if(!meta||isDiffraction()||!config?.shared_spectra_pca)return false;
   try{
    const retained=await api('pca/current');
    if(serial!==restoreEpoch||source!==fileId)return true;
    if(!retained?.viewer||retained.viewer.file_id!==source)return false;
    if(retained.job.id===job?.id&&data){controls();rememberViewer();return true}
    const saved=savedViewer(),view=saved?.id===retained.job.id?saved:null;
    clearTimeout(pollTimer);const pollEpoch=++epoch;pipeline=null;clearResults();
    job=retained.job;snapshot=retained.viewer;context=sourceContext();cancelRequested=false;
    pipeline=job.automatic&&job.state==='running'?{stage:job.operation}:null;
    pendingView=view;
    const fields={method:'pca-method',window_nm:'pca-window',spacing_nm:'pca-spacing',components:'pca-count',angular_sigma_deg:'pca-angle',spacing_sigma_percent:'pca-scale',normalization:'pca-normalization'};
    for(const [key,id] of Object.entries(fields))if(snapshot.options[key]!==undefined)$(id).value=snapshot.options[key];
    $('nmf-cutoff').value=snapshot.fit_options.peak_fraction??.35;
    $('pca-combination-mode').value=snapshot.fit_options.combination_mode??'together';
    $('pca-combination-components').value=(snapshot.fit_options.combination_components||[]).map(i=>i+1).join(',');
    $('pca-run').textContent='Run '+$('pca-method').value.toUpperCase();
    $('pca-source').textContent=`${meta.name} · retained run · ${snapshot.settings.g_min}–${snapshot.settings.g_max} nm⁻¹ · ${snapshot.settings.fft_window} window`;
    if(reopen&&view?.open&&!dialog.open){dialog.showModal();document.documentElement.classList.add('pca-open')}
    controls();notify('Reconnecting to retained analysis…');
    await poll(pollEpoch);return true;
   }catch(e){
    if(serial!==restoreEpoch)return true;
    if(!e.status||e.status>=500){notify('Connection interrupted · reconnecting to the analysis…',true);clearTimeout(pollTimer);pollTimer=setTimeout(()=>reconnect({reopen}),1500);return true}
    notify(e.message,true);return false;
   }
  }
  document.addEventListener('tem-image-opened',()=>{
   if(snapshot&&snapshot.file_id!==fileId){++epoch;clearTimeout(pollTimer);pipeline=null;job=null;snapshot=null;pendingView=null;clearResults();if(dialog.open)dialog.close()}
   reconnect({reopen:true});
  });
  window.addEventListener('pagehide',rememberViewer);
  // Save after the control's own handler updates the selection.
  for(const name of ['click','change','input'])dialog.addEventListener(name,()=>{pendingView=null;queueMicrotask(rememberViewer)});
  dialog.addEventListener('close',rememberViewer);
  $('open-pca').onclick=async()=>{
   dialog.showModal();document.documentElement.classList.add('pca-open');
   if(await reconnect())return;
   if(!meta||isDiffraction()||!config?.shared_spectra_pca){snapshot=null;controls();notify(!config?.shared_spectra_pca?'Restart the feature-branch backend to enable this workspace.':'Select a calibrated real-space image for local FFT PCA / NMF.',true);return}
   if(!running()&&context!==sourceContext()){
    context=sourceContext();snapshot=JSON.parse(JSON.stringify(requestBody()));job=null;clearResults();
    const physical=Math.min(meta.width*meta.pixel_x_nm,meta.height*meta.pixel_y_nm);
    $('pca-window').value=(physical*.1).toFixed(3);$('pca-spacing').value=(physical*.05).toFixed(3);
    $('pca-source').textContent=`${meta.name} · whole image · ${snapshot.settings.g_min}–${snapshot.settings.g_max} nm⁻¹ · ${snapshot.settings.fft_window} window`;
    notify('Uses the current FFT window and fitting band. Run continues through crystal fitting and original-window checks.');
   }
   controls();
   rememberViewer();
  };
  form.onsubmit=async event=>{
   event.preventDefault();if(!snapshot||running())return;
   const serial=++epoch;clearTimeout(pollTimer);cancelRequested=false;pipeline={stage:'decomposition',cutoff:Number($('nmf-cutoff').value)};clearResults();job={state:'running'};controls();notify('Starting decomposition…');$('pca-progress').value=0;
   try{const response=await api('pca',{...snapshot,options:options(),automatic:true,fit_options:{peak_fraction:Number($('nmf-cutoff').value),...($('pca-method').value==='pca'?combinationOptions():{})}});if(serial!==epoch)return;job=response;pendingView=null;rememberViewer();if(cancelRequested)await api('pca/cancel',{id:job.id});poll(serial)}
   catch(e){if(serial===epoch){pipeline=null;job=null;controls();notify(e.message,true);if(!e.status||e.status>=500)reconnect()}}
  };
  $('pca-method').onchange=()=>{$('pca-run').textContent='Run '+$('pca-method').value.toUpperCase();controls()};
  $('pca-combination-mode').onchange=controls;
  $('pca-cancel').onclick=async()=>{cancelRequested=true;pipeline=null;if(!job?.id)return;try{await api('pca/cancel',{id:job.id});notify('Cancelling after the current FFT, matrix step or template fit…')}catch(e){notify(e.message,true)}};
  $('pca-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{closeInspector();document.documentElement.classList.remove('pca-open')});
  for(const id of ['pca-opacity','pca-contrast','pca-layout','pca-palette'])$(id).addEventListener('input',drawMap);
  $('pca-top').addEventListener('input',()=>{showAllSignals=false;drawMap()});
  $('pca-show-all').onclick=()=>{if(!data)return;showAllSignals=true;$('pca-top').value=String(data.components.length);drawMap()};
  function refreshWindowSelection(canvas){
   if(section==='signals')$('pca-inspect').open=true;
   const component=canvas.dataset.component;drawMap();
   const target=canvas.id==='nmf-phase-map'?canvas:component===undefined?$('pca-map'):$('pca-overview').querySelector(`[data-component="${component}"]`);target?.focus({preventScroll:true});inspect();
  }
  function selectMapWindow(event){
   if(!canInspect())return;const canvas=event.currentTarget,box=canvas.getBoundingClientRect(),p=data.plan,[h,w]=p.image_shape;
   const scale=Math.min(box.width/w,box.height/h),ox=(box.width-w*scale)/2,oy=(box.height-h*scale)/2;
   const x=(event.clientX-box.left-ox)/scale,y=(event.clientY-box.top-oy)/scale;
   if(x<0||y<0||x>w||y>h)return;
   index=PcaView.nearest(p,x,y);refreshWindowSelection(canvas);
  };
  function stepMapWindow(event){
   if(!canInspect())return;const dx={ArrowLeft:-1,ArrowRight:1,ArrowUp:-data.plan.xs.length,ArrowDown:data.plan.xs.length}[event.key];
   if(dx===undefined)return;event.preventDefault();index=Math.max(0,Math.min(data.plan.count-1,index+dx));refreshWindowSelection(event.currentTarget);
  };
  $('pca-map').onclick=selectMapWindow;$('pca-map').onkeydown=stepMapWindow;
  function componentFitColumns(original=false){
   const overrides={
    rank:[original?'Support ↓':'Rank ↓',`Position − scale cost${original?' (source fit + local refinement)':''}. Highest first; not a phase probability. Main-analysis weak-peak, missing-prediction, brightness and DD terms are not used here.`],
    peaks:['Matched\nprofiles','Assigned / detected profiles. Opposite spots count once. Original-window checks count only close assignments; feature search also admits displaced assignments with decreasing credit.'],
    coverage:['Coverage\nObserved | predicted','Assigned / detected profiles | assigned / predicted profiles. These are unweighted profile counts, not the main interface’s allowed / DD coverage.'],
    cost:['Scale\ncost',original?'Source-fit scale cost plus the local-refinement scale cost, subtracted from position.':'Scale cost subtracted from position.'],
   };
   return FIT_COLUMNS.map(([key,label,help])=>[key,...(overrides[key]||[label,help])]);
  }
  function componentFitHeader(table,{original=false,show=false,source=false}={}){
   table.className='model-table component-fit-table'+(show?' fit-table':'');
   const head=table.createTHead().insertRow();
   for(const [key,label,help] of [...(show?[['show','Show','Toggle this overlay']]:[]),...componentFitColumns(original)]){
    const cell=document.createElement('th');cell.scope='col';cell.className='col-'+key;cell.dataset.column=key;cell.textContent=key==='candidate'&&source?'Source / candidate\nZone axis':label;cell.title=help;
    if(key==='rank'){
     cell.setAttribute('aria-sort','descending');cell.title='';
     const host=document.createElement('span'),button=document.createElement('button'),popup=document.createElement('span');host.className='settings-help';button.type='button';button.className='settings-help-button';button.textContent='ⓘ';button.setAttribute('aria-label',original?'About window support score':'About component fit rank');popup.className='settings-help-popup';popup.setAttribute('role','tooltip');popup.textContent=help;host.append(button,popup);cell.append(host);
    }
    head.append(cell);
   }
  }
  function componentFitCells(row,m,peakCount,{original=false}={}){
   const assigned=m?(m.matches?new Set(m.matches.map(match=>match.node_index)).size:m.matched_profile_count):0;
   const total=m?.predicted_nodes?.length??m?.predicted_visible_band_node_count;
   const values={candidate:m?`${m.phase==='OMEGA'?'ω':m.phase} ${zoneLabel(m)}\n${m.rotation_deg.toFixed(1)}°`:'No fit',rank:m?.score?.toFixed(3)??'—',screen:m?(m.valid?'Pass':'Below'):'—',
    peaks:m?`${m.matched_profile_count}/${peakCount}`:`0/${peakCount}`,coverage:m?`${(100*m.coverage).toFixed(0)}% | ${total?(100*assigned/total).toFixed(0)+'%':'—'}`:'—',rms:m?.rms_nm_inv?.toFixed(3)??'—',
    position:m?(m.position_score??m.score).toFixed(3):'—',cost:m?((m.scale_penalty??0)+(original?(m.local_scale_penalty??0):0)).toFixed(3):'—',
    dimensions:m?fittedDimensions(m).replaceAll(' / ','\n'):'—',scale:m?scalePercentages(m).replaceAll(' / ','\n'):'—'};
   for(const [key,label,help] of componentFitColumns(original)){
    const cell=row.insertCell();cell.className='col-'+key;cell.dataset.column=key;cell.dataset.label=label.replaceAll('\n',' ');cell.textContent=values[key];cell.title=help;
    if(!m)continue;
    if(key==='candidate')cell.style.color=phaseColors[m.phase]||'#ddd';
    if(key==='screen')cell.title=m.valid?'Passes the screen':m.rejection_reasons?.join('; ')||'Below screen';
    if(key==='coverage')cell.title=`Observed-profile coverage | ${assigned} of ${total??'unknown'} predicted profiles assigned. Opposite spots count once.${original?' Only close assignments are counted.':' Unassigned predictions do not incur a missing-peak cost in this screen.'}`;
    if(key==='peaks'&&m.position_matching?.distance_scale_nm_inv)cell.title+=` Match ${original?'≤':'<'} ${(m.position_matching.distance_scale_nm_inv*(original?1:4)).toFixed(3)} nm⁻¹.`;
    if(key==='cost')cell.title+=` Source ${(m.scale_penalty??0).toFixed(4)}${original?' + local '+(m.local_scale_penalty??0).toFixed(4):''}.`;
    if(key==='dimensions'||key==='scale')cell.title=scaleDetails(m)+(m.scale_note?' · '+m.scale_note:'')+' · '+help;
   }
  }
  function showFits(){
   const box=$('nmf-fit-results');box.replaceChildren();
   const fits=data?.fits;
   $('nmf-fit-count').textContent=isPca()?(fits?.combination_count?`${2*data.components.length} sides + ${fits.combination_count} combinations × ${fits.combination_windows} windows`:`${2*(data?.components.length||0)} signed sides`):`${2**(data?.components.length||0)-1} combinations`;
   $('nmf-fit-note').textContent=fits?`${fits.completed}/${fits.total} ${isPca()?'source fits':'combinations'} · ${data.fit_status||'complete'}. ${isPca()?'Feature and reconstruction fits are hypotheses; see Window checks for original-data support.':'Position − scale ranks; main-analysis photometric penalties are not used.'}`:isPca()?'Individual features and the selected combination scope will be fitted.':'Every nonempty combination will be fitted. Results remain experimental.';
   if(!fits)return;
   const sorted=fits.groups.filter(g=>g.completed_windows!==0||g.candidates.length).sort((a,b)=>(b.candidates[0]?.score??-Infinity)-(a.candidates[0]?.score??-Infinity));
   const table=document.createElement('table');componentFitHeader(table,{source:true});
   const body=table.createTBody();
   function appendRows(records){for(const group of records){
    const row=body.insertRow(),model=group.candidates[0];
    componentFitCells(row,model,group.peak_count);
    const cell=row.querySelector('.col-candidate'),actions=document.createElement('div'),button=document.createElement('button');actions.className='component-fit-source';button.type='button';button.textContent=isPca()?sourceLabel(group):'NMF '+group.components.map(i=>i+1).join(' + ');actions.append(button);cell.prepend(actions);button.title=isPca()?(group.kind==='combination'?`Inspect the score-weighted reconstruction from window ${group.window+1}`:'Inspect this signed feature’s crystal hypotheses'):'Show this group’s activity map and combined spectrum';button.onclick=()=>isPca()?inspectGroup(group):selectGroupMap(group);
    if(group.kind==='combination'&&group.completed_windows<group.total_windows){const note=document.createElement('span');note.className='hint';note.textContent=`${group.completed_windows}/${group.total_windows} windows · provisional`;actions.append(note)}
    if(!isPca()){const inspectButton=document.createElement('button');inspectButton.type='button';inspectButton.textContent='Fits';inspectButton.title='Inspect crystal fits for this group';inspectButton.onclick=()=>inspectGroup(group);actions.append(inspectButton);const count=document.createElement('span');count.className='hint';count.textContent=`${group.cooccurring_windows} co-occurring windows`;count.title='Windows where all selected factors exceed 20% of their own maximum; not proof of coexisting phases.';actions.append(count)}
   }}
   let shown=0;const more=document.createElement('button');more.type='button';
   const page=()=>{appendRows(sorted.slice(shown,shown+100));shown+=100;more.hidden=shown>=sorted.length;more.textContent=`Show next ${Math.min(100,sorted.length-shown)} combinations`};
   more.onclick=page;page();box.append(table,more);
  }
  function selectGroupMap(group){
   selected=new Set(group.components);
   for(const input of dialog.querySelectorAll('#pca-group input,#pca-map-group input'))input.checked=selected.has(Number(input.value));
   $('pca-layout').value='group';
   showSection('signals',true);drawMap();inspect();
  }
  function renderSpectrumPreviews(){
   if(data){$('pca-mean').src=sampledSpectrumUrl(data.mean);$('pca-raw-mean').src=sampledSpectrumUrl(data.raw_mean)}
   if(sampleImages){
    $('pca-original').src=sampledSpectrumUrl(sampleImages.raw);
    $('pca-processed').src=sampledSpectrumUrl(sampleImages.processed,sampleImages.raw);
    $('pca-reconstruction').src=sampledSpectrumUrl(sampleImages.reconstruction,sampleImages.raw);
   }
  }
  function sharedDisplayControl(id,label,host){
   const source=$(id),input=source.cloneNode(true);input.id='pca-shared-'+id;input.removeAttribute('aria-label');input.removeAttribute('aria-describedby');
   if(source.tagName==='BUTTON'){
    input.onclick=()=>source.click();host.append(input);return;
   }
   input.value=source.value;if(source.type==='checkbox')input.checked=source.checked;
   const field=document.createElement('label');field.textContent=label;
   if(source.type==='checkbox')field.className='check';field.append(input);host.append(field);
   const event=['range','number'].includes(source.type)?'input':'change';
   input.addEventListener(event,()=>{source.value=input.value;if(source.type==='checkbox')source.checked=input.checked;source.dispatchEvent(new Event(event,{bubbles:true}))});
  }
  function inspectorControls(phases){
   const display=$('nmf-group-display'),markers=$('nmf-group-marker-controls');display.replaceChildren();markers.replaceChildren();
   for(const [id,label]of [['palette','Intensity'],['contrast','Background, %'],['fft-white','White point, %'],['show-spectrum-overlays','Overlays']])sharedDisplayControl(id,label,display);
   for(const [id,label]of [['peak-marker','Peaks'],...phases.map(p=>[p.toLowerCase()+'-marker',phaseLabel(p)]),['show-peak-numbers','Peak numbers'],['marker-motion','Motion']])sharedDisplayControl(id,label,markers);
  }
  function syncInspectorControls(){
   for(const input of $('nmf-group-detail').querySelectorAll('[id^="pca-shared-"]')){
    const source=$(input.id.slice('pca-shared-'.length));input.value=source.value;
    if(source.type==='checkbox')input.checked=source.checked;
    if(source.hasAttribute('aria-pressed'))input.setAttribute('aria-pressed',source.getAttribute('aria-pressed'));
   }
  }
  for(const id of ['palette','contrast','fft-white','show-spectrum-overlays','peak-marker','show-peak-numbers','marker-motion','omega-color-by',...PHASES.map(p=>p.toLowerCase()+'-marker')]){
   const source=$(id),event=source.tagName==='BUTTON'?'click':['range','number'].includes(source.type)?'input':'change';
   source.addEventListener(event,()=>{syncInspectorControls();inspectorRender?.();if(['palette','contrast','fft-white'].includes(id)){renderSpectrumPreviews();if(id==='palette')drawMap()}});
  }
  for(const mode of ['individual','shared'])$('pca-scale-'+mode).onclick=()=>{
   for(const choice of ['individual','shared'])$('pca-scale-'+choice).setAttribute('aria-pressed',String(choice===mode));drawMap();
  };
  // Keep signed contrast options, and reuse every sequential palette from the main image.
  $('pca-palette').replaceChildren(new Option('Automatic','auto'),new Option('Red–blue','rdbu'),new Option('Purple–green','purplegreen'),...Array.from($('palette').options,o=>new Option(o.text,o.value)));
  function componentAction(canvas,component){
   const enabled=data?.decomposition==='nmf';canvas.setAttribute('role',enabled?'button':'img');canvas.tabIndex=enabled?0:-1;
   canvas.title=enabled?'Inspect detected peaks and crystal fits':'';
   canvas.onclick=enabled?()=>inspectComponent(component):null;
   canvas.onkeydown=enabled?event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();inspectComponent(component)}}:null;
  }
  function inspectComponent(component){
   const group=data?.fits?.groups.find(g=>g.components.length===1&&g.components[0]===component);
   inspectGroup(group||{components:[component],support_checks:[]});
  }
  function inspectLobe(component,side){
   inspectGroup(data?.fits?.groups.find(g=>g.component===component&&g.side===side)||{component,side,components:[component]});
  }
  $('nmf-inspect-component').onclick=inspectSelectedSpectrum;
  $('nmf-group-close').onclick=closeInspector;
  async function inspectGroup(group,windowModel=null){
   if(!canInspect()||(windowModel!==null&&!data.phase_support?.windows[index]))return;const serial=++groupEpoch,jobId=job.id;
   const pane=inspector,status=$('nmf-group-status');$('nmf-group-content').hidden=true;$('nmf-group-toolbar').replaceChildren();
   const original=windowModel!==null,windowIndex=index,combination=group.kind==='combination';
   const hypothesis=original?data.phase_support.models[windowModel]:null;
   $('nmf-group-label').textContent=original?`Window ${windowIndex+1} · ${hypothesisIdentity(hypothesis)} · original-window fit`:`${sourceLabel(group)} · crystal fits`;
   $('nmf-group-source-help').hidden=!original;
   if(original)$('nmf-group-source-note').textContent=`Hypothesis sources: ${sourceLabel(hypothesis)}. These sources produced matching crystal geometry and were merged into one hypothesis. PC numbers joined by + identify a mean-plus-score-weighted reconstruction; a trailing + or − identifies one signed feature of a component. This view tests the retained crystal hypothesis against window ${windowIndex+1}’s original spectrum, with bounded local refinement. It does not add these source spectra together.`;
   $('nmf-group-spectrum').setAttribute('aria-label',$('nmf-group-label').textContent+' spectrum with detected peaks and predictions');
   status.textContent='Detecting peaks and fitting candidates…';status.classList.remove('error');if(!pane.open){pane.showModal();$('nmf-group-close').focus()}$('nmf-group-body').scrollTop=0;
   try{
    const detail=await api(original?'pca/window-fit':combination?'pca/combination':isPca()?'pca/lobe':'pca/group',original?{id:jobId,index:windowIndex,model:windowModel}:{id:jobId,components:group.components,component:group.component,side:group.side,index:group.window,options:{peak_fraction:Number($('nmf-cutoff').value)}});
    if(serial!==groupEpoch||job?.id!==jobId)return;
    if(original&&detail.candidates[0]){
     $('nmf-group-label').textContent=`Window ${windowIndex+1} · ${hypothesisIdentity(detail.candidates[0])} · original-window fit`;
     $('nmf-group-spectrum').setAttribute('aria-label',$('nmf-group-label').textContent+' spectrum with detected peaks and predictions');
    }
    status.textContent=`${detail.peaks.length} detected profiles · peak cutoff ${detail.peak_fraction} · ${detail.phases.join(' + ')||'no phases'}${isPca()?(original?' · original unbroadened spectrum'+(detail.component_score==null?'':` · PC ${detail.component+1} score `+detail.component_score.toPrecision(3)):combination?` · mean + score-weighted PCs · source window ${detail.window+1}`:' · '+group.side+' deviations from the mean'):' · '+detail.cooccurring_windows+' co-occurring windows'}`;
    $('nmf-group-content').hidden=false;
    const support=$('nmf-support');support.replaceChildren();
    const note=document.createElement('p');note.className='hint settings-heading-label';note.textContent=original?'Original-window support':'Partial-match screen';
    const help=document.createElement('span'),helpButton=document.createElement('button'),helpText=document.createElement('span');help.className='settings-help';helpButton.type='button';helpButton.className='settings-help-button';helpButton.textContent='ⓘ';helpButton.setAttribute('aria-label','About the partial-match screen');helpText.className='settings-help-popup';helpText.setAttribute('role','tooltip');
    helpText.textContent='Pass requires at least four assigned profiles, directional spread, over 30% observed-profile coverage and rank above 0.20. It does not require every prediction to have a peak. NMF uses position minus scale cost, with no missing-prediction, weak-peak, brightness or double-diffraction terms. Solid outlines are assigned; faint dotted outlines are unassigned. Assignments can be displaced and lose positional credit. Neither components nor co-occurrence establish phases.';help.append(helpButton,helpText);note.append(help);$('nmf-group-toolbar').append(note);
    if(isPca())helpText.textContent=original?'Original-window support requires four close profiles, directional spread, more than 30% prediction coverage and support above 0.20 after chance and scale costs. Refinement is limited to ±3° and ±3% scale (rotation only in fixed mode). Solid predictions have close assignments; others are dotted. PCA scores do not gate these checks.':'This is a fit to one side of a signed deviation from the mean, not to an absolute diffraction pattern. Pass is a partial observed-profile screen; original-window support is checked separately. PCA sign is arbitrary: reversing both loading and scores swaps the labels. Same-phase orientations remain separate.';
    if(!original)helpText.textContent+=' Near-duplicate fits of the same phase and zone keep only the higher rank: interior predictions must pair within one matching width, allowing reflections to cross a fitting-limit boundary. Different matched-peak subsets alone do not create a new solution.';
    if(original)helpText.textContent+=' Repeated orientations across PCA components/signs use one best representative and retain every feature source. Support counts are not added. The displayed PC score belongs to the representative source.';
    if(combination&&!original)helpText.textContent='This spectrum is the PCA mean plus selected signed score-weighted loadings for the named source window, with area weighting and normalization reversed. It is a partial reconstruction, not the original spectrum. Candidate support is checked separately in every original window. Scores: '+detail.components.map((c,i)=>`PC ${c+1}: ${detail.coefficients[i].toPrecision(4)}`).join('; ')+`. Negative reconstructed pixels: ${(100*detail.negative_fraction).toFixed(1)}%.`;
    if(detail.tolerance_nm_inv)helpText.textContent+=original?` Counted matches must lie within ${detail.tolerance_nm_inv.toFixed(3)} nm⁻¹ (one native FFT taper-response width, including any omega multiplier). Farther assignments contribute decreasing positional credit out to ${(4*detail.tolerance_nm_inv).toFixed(3)} nm⁻¹ but do not count toward the four-profile minimum. Opposite spots count as one profile.`:` The base matching width is ${detail.tolerance_nm_inv.toFixed(3)} nm⁻¹, from the native FFT taper response. Search assignments extend to four widths with decreasing positional credit; omega uses its configured multiplier. Original-window match counts require one width. Opposite spots count as one profile.`;
    if(!isPca()&&!detail.cooccurring_windows){const warning=document.createElement('p');warning.textContent='No co-occurring windows: this sum uses global means and is hypothetical.';$('nmf-group-toolbar').append(warning)}
    const chosen=new Set(detail.candidates.length?[0]:[]),svg=$('nmf-group-spectrum');svg.replaceChildren();
    const background=el('image',{width:420,height:420}),overlay=el('g',{});svg.append(background,overlay);
    function draw(){if(serial===groupEpoch&&pane.open)drawComponentFitOverlay(overlay,detail,chosen)}
    inspectorRender=()=>{if(serial!==groupEpoch||!pane.open)return;background.setAttribute('href',sampledSpectrumUrl(detail.spectrum));draw()};
    inspectorControls(detail.phases);inspectorRender();
    const buttons=document.createElement('div'),checks=[];
    for(const [text,select] of [['Best fit',()=>detail.candidates.length?[0]:[]],['All passing',()=>detail.candidates.flatMap((m,i)=>m.valid?[i]:[])],['Peaks only',()=>[]]]){const button=document.createElement('button');button.type='button';button.textContent=text;button.onclick=()=>{chosen.clear();select().forEach(i=>chosen.add(i));checks.forEach((c,i)=>c.checked=chosen.has(i));draw()};buttons.append(button)}
    $('nmf-group-toolbar').append(buttons);
    if(!detail.candidates.length){const empty=document.createElement('p');empty.textContent='No candidate survived the search gates. This does not establish that the phase is absent.';empty.title='The search seeds from the strongest 16 profiles, rejects initial coverage below 20%, and needs enough compatible reflections. Diffuse maxima can crowd out useful seeds.';support.append(empty)}
    else{
     const wrap=document.createElement('div');wrap.className='nmf-fit-results';const table=document.createElement('table');componentFitHeader(table,{original,show:true});
     const body=table.createTBody();
     detail.candidates.forEach((m,i)=>{const row=body.insertRow(),check=document.createElement('input');check.type='checkbox';check.checked=chosen.has(i);check.setAttribute('aria-label',`Overlay ${m.phase} [${m.zone_3index.join(' ')}] ${m.rotation_deg.toFixed(1)} degrees`);check.onchange=()=>{if(check.checked)chosen.add(i);else chosen.delete(i);draw()};const toggle=row.insertCell();toggle.className='col-show';toggle.dataset.column='show';toggle.append(check);checks.push(check);
      componentFitCells(row,m,detail.peaks.length,{original});
     });wrap.append(table);support.append(wrap);
    }
    for(const check of group.support_checks||[]){const b=document.createElement('button');b.type='button';b.textContent=`Window ${check.window+1}: ${check.matched}/${check.peak_count} matched`;b.title='Check of the best combination model against the original window, without refitting';b.onclick=()=>{closeInspector();index=check.window;selectGroupMap(group)};support.append(b)}
   }catch(e){if(serial===groupEpoch){status.textContent=e.message;status.classList.add('error')}}
  }
  function selectTopHypotheses(count){
   manualPool=false;selectedHypotheses.clear();hypothesisOrder.slice(0,count).forEach(m=>selectedHypotheses.add(m.id));
   $('pca-map-top').value=String(Math.min(count,hypothesisOrder.length));
  }
  function renderHypothesisList(maps){
   const box=$('pca-hypothesis-list'),scroll=box.scrollTop,focused=box.contains(document.activeElement)?{id:document.activeElement.closest('tr')?.dataset.hypothesis,tag:document.activeElement.tagName.toLowerCase()}:null;box.replaceChildren();
   const table=document.createElement('table'),head=table.createTHead().insertRow();
   for(const [label,help] of [['Show','Include this hypothesis in the map'],['Hypothesis / rotation','Click the name to show only this hypothesis'],['Passing','Percentage of all checked windows where this hypothesis passes'],['Cumulative\npassing','Unique windows supported by this row and every row above it, irrespective of ticks. Shared passing windows count once. The map summary reports the actual checked pool.'],['New','Newly supported windows when added after every hypothesis above it'],['Better','Already-supported windows whose best passing local score increases when added after every hypothesis above it']]){
    const cell=document.createElement('th');cell.textContent=label;cell.title=help;cell.scope='col';head.append(cell);
   }
   const body=table.createTBody();
   hypothesisOrder.forEach((model,i)=>{
    const row=body.insertRow();row.dataset.hypothesis=String(model.id);
    const check=document.createElement('input');check.type='checkbox';check.dataset.hypothesis=String(model.id);check.setAttribute('aria-label','Show '+hypothesisLabel(model));
    check.onchange=()=>{manualPool=true;if(check.checked)selectedHypotheses.add(model.id);else selectedHypotheses.delete(model.id);drawPhaseMap()};row.insertCell().append(check);
    const cell=row.insertCell(),button=document.createElement('button');button.type='button';button.className='pca-hypothesis-name';button.title='Show only this hypothesis · '+sourceLabel(model);button.setAttribute('aria-label','Show only '+hypothesisLabel(model));
    const symbol=document.createElement('span');symbol.className='pca-hypothesis-symbol';button.append(symbol,document.createTextNode(`${i+1}. ${model.phase==='OMEGA'?'ω':model.phase} ${zoneLabel(model)}\n${model.rotation_deg.toFixed(1)}°`));cell.append(button);
    button.onclick=()=>{manualPool=true;selectedHypotheses.clear();selectedHypotheses.add(model.id);drawPhaseMap()};
    const gain=poolSummaries[i];for(const value of [maps.model_passing_counts[model.id]||0,gain.supported,gain.newlySupported,gain.improved])row.insertCell().textContent=PcaView.supportPercent(value,maps.windows.length);
   });box.append(table);box.scrollTop=scroll;if(focused?.id)box.querySelector(`tr[data-hypothesis="${focused.id}"] ${focused.tag}`)?.focus({preventScroll:true});
   if(!hypothesisOrder.length){const empty=document.createElement('p');empty.className='hint';empty.textContent='No retained hypotheses.';box.append(empty)}
  }
  function orderHypotheses(maps,reset=false){
   const top=$('pca-map-top'),count=reset?3:manualPool?selectedHypotheses.size:Number(top.value);
   hypothesisOrder=PcaView.orderedHypotheses(maps,$('pca-map-sort').value);poolSummaries=PcaView.hypothesisPools(maps,hypothesisOrder);
   const custom=new Option('Custom selection','custom');custom.disabled=true;
   if(top.options.length!==poolSummaries.length+2)top.replaceChildren(custom,new Option('None','0'),...poolSummaries.map(pool=>new Option(String(pool.count),String(pool.count))));
   top.disabled=!maps.models.length;$('pca-map-sort').disabled=!maps.models.length;
   if(reset||!manualPool)selectTopHypotheses(count);else{const available=new Set(hypothesisOrder.map(m=>m.id));for(const id of selectedHypotheses)if(!available.has(id))selectedHypotheses.delete(id)}
   renderHypothesisList(maps);
  }
  function showPhaseMaps(){
   const maps=data?.phase_support;
   $('nmf-phase-panel').hidden=!maps;
   $('nmf-map-status').textContent=data?.phase_support_status?`${isPca()?'Window checks':'Phase mapping'}: ${data.phase_support_status}${maps?' · '+maps.windows.length+'/'+(maps.total??data.plan.count)+' windows checked':''}`:'';
   $('nmf-map-status').classList.toggle('error',String(data?.phase_support_status).startsWith('error'));
   const select=$('nmf-map-phase'),previous=select.value;
   if(!maps)return;
   if(isPca()){
    const identity=maps.generation||maps.models;const reset=symbolModels!==identity;if(reset){solutionSymbols.clear();symbolModels=identity}
    orderHypotheses(maps,reset);
    $('nmf-map-counts').textContent=`${maps.windows.length} original windows checked · ${maps.models.length} retained hypotheses`;
    return;
   }
   select.disabled=false;
   if([...select.options].map(o=>o.value).join(',')!==['all',...maps.phases].join(','))select.replaceChildren(new Option('All phases','all'),...maps.phases.map(p=>new Option(p,p)));select.value=[...select.options].some(o=>o.value===previous)?previous:'all';
   $('nmf-map-counts').textContent=`${maps.windows.length}/${maps.total??data.plan.count} windows checked · ${maps.counts.single} single · ${maps.counts.multiple} separately supported multiple · ${maps.counts.ambiguous} ambiguous · ${maps.counts.unresolved} unresolved${maps.nmf_converged===false?' · NMF reached iteration limit':''}`;
  }
  function drawPhaseMap(){
   const maps=data?.phase_support;if(!maps)return;
   for(const [phase,hex]of Object.entries(phaseColors))PcaView.phaseColours[phase]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
   const canvas=$('nmf-phase-map'),ctx=canvas.getContext('2d'),p=data.plan,[height,width]=p.image_shape;
   const scale=Math.min(canvas.width/width,canvas.height/height),ox=(canvas.width-width*scale)/2,oy=(canvas.height-height*scale)/2;
   ctx.fillStyle='#050a0f';ctx.fillRect(0,0,canvas.width,canvas.height);
   if(sourceImage?.complete&&sourceImage.naturalWidth)ctx.drawImage(sourceImage,ox,oy,width*scale,height*scale);
   const pca=isPca(),mode=$('pca-map-mode').value,colourBy=$('pca-map-colour').value;
   for(const id of ['pca-map-mode-label','pca-map-colour-label','pca-map-symbols-label'])$(id).hidden=!pca;
   $('pca-hypotheses').hidden=!pca;$('nmf-map-select-label').hidden=pca;$('nmf-phase-content').classList.toggle('pca-hypotheses-layout',pca);
   const [w,h]=p.window_pixels,[dx,dy]=[p.spacing_nm[0]/p.pixel_nm[0],p.spacing_nm[1]/p.pixel_nm[1]],phase=$('nmf-map-phase').value;
   const pool=pca?hypothesisOrder.filter(m=>selectedHypotheses.has(m.id)):[],ids=pool.map(m=>m.id),single=pca&&pool.length===1,model=single?pool[0]:null;
   const local=pca?maps.windows.map(win=>PcaView.localHypotheses(win,ids)):[];
   const winning=pca?PcaView.winningSolutions(maps,local,ZONE_SYMBOLS,solutionSymbols):[],showSymbols=pca&&$('pca-map-symbols').checked;
   if(pca){
    const top=$('pca-map-top');top.value=manualPool?'custom':String(pool.length);top.querySelector('[value="custom"]').textContent=`Custom (${pool.length})`;
    const winners=new Set(winning.map(entry=>entry.model.id));
    for(const row of $('pca-hypothesis-list').querySelectorAll('[data-hypothesis]')){
     const id=Number(row.dataset.hypothesis);if(row.tagName==='INPUT'){row.checked=selectedHypotheses.has(id);continue}
     row.classList.toggle('selected',selectedHypotheses.has(id));row.querySelector('button').style.color=`rgb(${PcaView.hypothesisColour(maps.models[id],colourBy)})`;
     row.querySelector('.pca-hypothesis-symbol').textContent=showSymbols&&winners.has(id)?solutionSymbols.get(id)+' ':'';
    }
   }
   ctx.globalAlpha=Number($('nmf-map-opacity').value);
   for(const win of maps.windows){
    const ix=win.index%p.xs.length,iy=Math.floor(win.index/p.xs.length),cx=p.xs[ix]+w/2,cy=p.ys[iy]+h/2;
    const left=Math.max(0,cx-dx/2),top=Math.max(0,cy-dy/2),right=Math.min(width,cx+dx/2),bottom=Math.min(height,cy+dy/2);
    const state=local[win.index],shown=pca?(mode==='best'?(state.winner?[state.winner]:[]):state.passing):[];
    const colours=pca?[...new Map(shown.map(c=>[colourBy==='phase'?c.phase:c.model,PcaView.hypothesisColour(maps.models[c.model],colourBy)])).values()]:[PcaView.supportColour(win,phase)];
    if(!colours.length)colours.push([65,72,80]);
    colours.forEach((colour,j)=>{ctx.fillStyle=`rgb(${colour.join(',')})`;ctx.fillRect(ox+(left+(right-left)*j/colours.length)*scale,oy+top*scale,(right-left)*scale/colours.length+.2,(bottom-top)*scale+.2)});
    if(pca&&!single&&state.label==='ambiguous'){
     const x=ox+left*scale,y=oy+top*scale,s=Math.min(6,(right-left)*scale/3,(bottom-top)*scale/3);ctx.fillStyle='#fff';ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+s,y);ctx.lineTo(x,y+s);ctx.closePath();ctx.fill();
    }
    if(showSymbols&&state.winner){
     const size=Math.min(16,Math.min(right-left,bottom-top)*scale*.6),symbol=solutionSymbols.get(state.winner.model);
     ctx.save();ctx.globalAlpha=1;ctx.font=`${size}px "Arial Unicode MS","Segoe UI Symbol",sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';ctx.lineWidth=size*.15;ctx.strokeStyle='#07101b';ctx.fillStyle=`rgb(${PcaView.hypothesisColour(maps.models[state.winner.model],colourBy)})`;
     const x=ox+cx*scale,y=oy+cy*scale;ctx.strokeText(symbol,x,y,size*1.4);ctx.fillText(symbol,x,y,size*1.4);ctx.restore();
    }
   }
   ctx.globalAlpha=1;const iy=Math.floor(index/p.xs.length),ix=index%p.xs.length;
   ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.strokeRect(ox+p.xs[ix]*scale,oy+p.ys[iy]*scale,w*scale,h*scale);
   const key=$('nmf-map-key');key.replaceChildren();
   const legend=pca?[...new Map(pool.map(m=>[colourBy==='phase'?m.phase:m.id,{label:colourBy==='phase'?(m.phase==='OMEGA'?'ω':m.phase):hypothesisIdentity(m),colour:PcaView.hypothesisColour(m,colourBy)}])).values()]:
    (phase==='all'?[...maps.phases,'Ambiguous','Unresolved']:[phase,'Below / inactive']).map(name=>({label:name,colour:PcaView.phaseColours[name]||(name==='Ambiguous'?[230,155,170]:[140,150,160])}));
   if(pca)legend.push({label:'Unresolved',colour:[140,150,160]});
   if(maps.windows.length<(maps.total??p.count))key.append(document.createTextNode('Uncoloured: not checked yet · '));
   for(const entry of legend){const item=document.createElement('span');item.textContent='● '+entry.label+'  ';item.style.color=`rgb(${entry.colour})`;key.append(item)}
   function legendHelp(host,label,text,id,iconOnly=false){
    const help=document.createElement('span'),button=document.createElement('button'),popup=document.createElement('span');help.className='settings-help';button.type='button';button.className=iconOnly?'settings-help-button':'pca-legend-help pca-ambiguity-key';button.textContent=iconOnly?'ⓘ':label;button.setAttribute('aria-label','About '+label.toLowerCase());button.setAttribute('aria-describedby',id);popup.className='settings-help-popup';popup.id=id;popup.setAttribute('role','tooltip');popup.textContent=text;help.append(button,popup);host.append(help);
   }
   if(pca&&!single)legendHelp(key,'Competing explanations','Small white corner triangles flag competing explanations: multiple hypotheses in the selected pool pass in that window, explain mostly the same peaks, and have similar support scores. In Best local match, the square colour and symbol still show the highest-support passing fit. The interpretation is ambiguous; this does not establish that the phases coexist.','pca-map-ambiguity-help');
   if(!pca&&phase==='all')key.append(document.createTextNode('Blended: separate evidence for multiple phases'));
   if(showSymbols&&winning.length){
    const group=document.createElement('div');group.className='zone-legend-group pca-solution-key';
    for(const entry of winning){
     const item=document.createElement('span'),symbol=document.createElement('b'),count=document.createElement('small');item.className='zone-key';item.style.color=`rgb(${PcaView.hypothesisColour(entry.model,colourBy)})`;symbol.textContent=entry.symbol;count.textContent='×'+entry.count;
     item.append(symbol,document.createTextNode(hypothesisIdentity(entry.model)),count);group.append(item);
    }
    legendHelp(group,'Solution symbols','Each symbol identifies one retained phase, zone and orientation solution. Only the highest-support passing member of the selected pool receives a symbol in each square, including in All locally supported view. Separate orientations of the same phase and zone have different symbols. Counts are locally winning windows, not all passing windows or image area. Only solutions that win somewhere in this view appear here. Symbols stay stable while changing the pool, view or colour setting.','pca-map-symbols-help',true);key.append(group);
   }
   const win=maps.windows[index];
   const selectedCandidate=model?win?.candidates.find(c=>c.model===model.id):null;
   const state=local[index],descriptions={unresolved:'unresolved',single:'one supported pattern',multiple:'separate patterns supported',ambiguous:'competing explanations'};

   if(pca){
    const supported=local.filter(s=>s.winner).length,summary=`${supported}/${maps.windows.length} windows (${PcaView.supportPercent(supported,maps.windows.length)})`;
    $('nmf-map-counts').textContent=`${manualPool?'Selected':'Top'} ${pool.length} of ${maps.models.length} hypotheses · ${summary} supported by this pool${maps.windows.length<(maps.total??p.count)?' · '+(maps.total??p.count)+' total · provisional':''}`;
    if(!manualPool&&pool.length>1){const gain=poolSummaries[pool.length-1];$('nmf-map-counts').textContent+=` · Last addition: +${PcaView.supportPercent(gain.newlySupported,maps.windows.length)} newly supported · ${PcaView.supportPercent(gain.improved,maps.windows.length)} better fit`}
   }
   const box=$('nmf-map-evidence');box.replaceChildren();
   if(!win){$('nmf-map-window').textContent=`Window ${index+1} · not checked yet`;return}
   $('nmf-map-window').textContent=pca?`Window ${index+1} · ${single?(selectedCandidate?.valid?'supported':'below support'):descriptions[state.label]} · ${win.peak_count} profiles${selectedCandidate?.component_score!=null?` · PC ${selectedCandidate.component+1} score `+selectedCandidate.component_score.toPrecision(3):''}`:`Window ${index+1} · ${win.label}${win.phases.length?' · '+win.phases.join(' + '):''} · ${win.peak_count} profiles · ${win.tested_models} eligible fits`;
   const table=document.createElement('table'),head=table.createTHead().insertRow();
   [isPca()?'Fit at this window':'Phase / group','Window score','Screen','Matched predictions','Prediction coverage'].forEach(t=>{const th=document.createElement('th');th.textContent=t;head.append(th);if(t==='Window score')legendHelp(th,'Window score','How well this hypothesis fits the selected original spectrum after bounded rotation/scale refinement. Higher is better; failed fits remain listed for comparison. The star marks the best passing member of the selected map pool. This is not a PCA component weight, intensity fraction or phase percentage.','pca-window-score-help',true)});
   const displayed=pca?(single?(selectedCandidate?[selectedCandidate]:[]):win.candidates.filter(c=>ids.includes(c.model)).sort((a,b)=>Number(b.valid)-Number(a.valid)||b.score-a.score)):win.candidates;
   for(const c of displayed){const row=table.insertRow(),model=maps.models[c.model],button=document.createElement('button');button.type='button';button.textContent=pca?`${c.model===state.winner?.model&&!single?'★ ':''}${hypothesisIdentity(model,c.rotation_deg??model.rotation_deg)}`:`${c.phase} · ${model.components.map(i=>i+1).join(' + ')}`;button.onclick=()=>inspectGroup(data.fits.groups[model.group],pca?model.id:null);button.title=(pca?'Inspect original-window predictions · ':'Inspect component-group fit · ')+sourceLabel(model);row.insertCell().append(button);
    [c.score.toFixed(3),c.valid?'Pass':'Below',`${c.profiles.length}/${c.predicted_count??win.peak_count}`,`${Math.round((c.predicted_coverage??c.coverage)*100)}%`].forEach(t=>row.insertCell().textContent=t);
    row.title=`[${model.zone_3index.join(' ')}] at ${(c.rotation_deg??model.rotation_deg).toFixed(1)}°; local rotation ${(c.rotation_adjustment_deg??0).toFixed(2)}°, reciprocal scale ×${(c.local_scale??1).toFixed(4)}; RMS ${c.rms_nm_inv.toFixed(3)} nm⁻¹.${isPca()?'':' Distinct profiles: '+(win.unique_profiles[c.phase]||[]).length+'.'}`;
   }
   box.append(table);
   if(pca&&model?.sources?.length){
    const sources=document.createElement('div');sources.className='pca-controls pca-source-links';sources.append(document.createTextNode('Feature sources'));
    for(const source of model.sources){const group={...data.fits.groups[source.group],window:source.window??data.fits.groups[source.group].window},button=document.createElement('button');button.type='button';button.textContent=sourceLabel(group)+(group.kind==='combination'?` · W${group.window+1}`:'');button.onclick=()=>inspectGroup(group);sources.append(button)}
    box.append(sources);
   }
   if(!win.candidates.length){const note=document.createElement('p');note.textContent='No eligible group fit matched this window.';box.append(note)}
  }
  $('nmf-map-phase').onchange=drawPhaseMap;
  $('pca-map-mode').onchange=drawPhaseMap;
  $('pca-map-top').onchange=()=>{selectTopHypotheses(Number($('pca-map-top').value));drawPhaseMap()};
  $('pca-map-sort').onchange=()=>{if(!data?.phase_support)return;orderHypotheses(data.phase_support);drawPhaseMap()};
  $('pca-map-colour').onchange=drawPhaseMap;
  $('pca-map-symbols').onchange=drawPhaseMap;
  $('nmf-map-opacity').oninput=drawPhaseMap;
  $('nmf-phase-map').onclick=selectMapWindow;$('nmf-phase-map').onkeydown=stepMapWindow;
  for(const [id,stage] of [['nmf-build-map','support'],['nmf-fit','fit']])$(id).onclick=async()=>{
   if(!data||running())return;const serial=++epoch;cancelRequested=false;
   try{await startStage(stage,serial)}
   catch(e){if(serial===epoch){pipeline=null;job={...job,state:'complete'};controls();notify(e.message,true)}}
  };
  $('pca-export').onclick=async()=>{
   if(!data||exporting)return;exporting=true;controls();notify('Exporting spectra, fits and provenance…');
   try{const r=await api('pca/export',{id:job.id});notify((r.warning?r.warning+' ':'Export complete: ')+r.files.join(' · '),Boolean(r.warning))}catch(e){notify(e.message,true)}finally{exporting=false;controls()}
  };
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initPca);else initPca();
}

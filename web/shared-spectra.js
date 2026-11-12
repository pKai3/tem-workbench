/* Source-bound exploratory PCA/NMF; component activity is not phase abundance. */
const PcaView={
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
  const palettes={rdbu:[[33,102,172],[146,197,222],[247,247,247],[244,165,130],[178,24,43]],purplegreen:[[118,42,131],[194,165,207],[247,247,247],[166,219,160],[27,120,55]],viridis:[[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],magma:[[0,0,4],[81,18,124],[183,55,121],[252,137,97],[252,253,191]],grey:[[0,0,0],[255,255,255]]};
  const stops=palettes[name]||palettes.viridis,x=Math.max(0,Math.min(1,t))*(stops.length-1),i=Math.min(stops.length-2,Math.floor(x));
  return stops[i].map((v,c)=>Math.round(v+(stops[i+1][c]-v)*(x-i)));
 },
 topCount(value,total){return Math.max(1,Math.min(total,Math.floor(Number(value)||1)))},
 nearest(plan,x,y){
  const [w,h]=plan.window_pixels;
  const closest=(values,v)=>values.reduce((best,a,i)=>Math.abs(a-v)<Math.abs(values[best]-v)?i:best,0);
  return closest(plan.ys,y-h/2)*plan.xs.length+closest(plan.xs,x-w/2);
 }
};
if(typeof module!=='undefined')module.exports=PcaView;
if(typeof document!=='undefined'){
 const initPca=()=>{
  let snapshot=null,context='',job=null,data=null,selected=new Set(),index=0,epoch=0,sampleEpoch=0,pollTimer=null,sourceImage=null,exporting=false,groupEpoch=0,showAllSignals=true,pipeline=null,cancelRequested=false;
  const dialog=$('pca-dialog'),form=$('pca-form');
  const sourceContext=()=>JSON.stringify([fileId,meta?.sha256_pixels,meta?.pixel_x_nm,meta?.pixel_y_nm,settings()]);
  const notify=(message,error=false)=>{$('pca-status').textContent=message;$('pca-status').classList.toggle('error',error)};
  const running=()=>job?.state==='running'||pipeline!==null;
  function controls(){
   for(const field of form.querySelectorAll('input,select'))field.disabled=running()||exporting;
   $('pca-run').disabled=running()||exporting||!snapshot;
   $('pca-progress').hidden=!running();
   $('nmf-build-map').disabled=!data?.fits||data.fits.completed!==data.fits.total||running()||exporting;
   $('nmf-fit').disabled=!data||running()||exporting;$('nmf-cutoff').disabled=running()||exporting;
   $('pca-cancel').disabled=!running();$('pca-export').disabled=!data||running()||exporting;
  }
  function clearResults(){spectrumEpoch++;groupPreviews.clear();data=null;selected.clear();$('pca-results').hidden=true;sampleEpoch++;groupEpoch++;sourceImage=null;controls()}
  function options(){return {method:$('pca-method').value,window_nm:Number($('pca-window').value),spacing_nm:Number($('pca-spacing').value),components:Number($('pca-count').value),angular_sigma_deg:Number($('pca-angle').value),spacing_sigma_percent:Number($('pca-scale').value),normalization:$('pca-normalization').value}}
  const palette=signed=>$('pca-palette').value==='auto'?(signed?'rdbu':'viridis'):$('pca-palette').value;
  function spectrumCanvas(canvas,component){
   const spec=component.spectrum,ctx=canvas.getContext('2d');
   if(!spec.raster){const img=new Image();img.onload=()=>ctx.drawImage(img,0,0,canvas.width,canvas.height);img.src=spec.image;return}
   canvas.width=canvas.height=spec.size;
   const bytes=atob(spec.raster),pixels=ctx.createImageData(spec.size,spec.size),lut=Array.from({length:255},(_,i)=>PcaView.palette(i/254,palette(data.decomposition!=='nmf')));
   for(let i=0;i<bytes.length;i++){const v=bytes.charCodeAt(i),c=v===255?[5,10,15]:lut[v];pixels.data.set([...c,255],i*4)}
   ctx.putImageData(pixels,0,0);
  }
  function paintMap(canvas,values,signed,outline=false){
   const p=data.plan,[height,width]=p.image_shape,ctx=canvas.getContext('2d'),scale=Math.min(canvas.width/width,canvas.height/height),ox=(canvas.width-width*scale)/2,oy=(canvas.height-height*scale)/2;
   ctx.fillStyle='#050a0f';ctx.fillRect(0,0,canvas.width,canvas.height);
   if(sourceImage?.complete&&sourceImage.naturalWidth)ctx.drawImage(sourceImage,ox,oy,width*scale,height*scale);
   const high=Math.max(...values.flat().map(Math.abs),1e-20),range=signed?{low:-high,high}:PcaView.mapRange(values,$('pca-contrast').value==='variation'),[w,h]=p.window_pixels,[dx,dy]=[p.spacing_nm[0]/p.pixel_nm[0],p.spacing_nm[1]/p.pixel_nm[1]];
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
    const card=document.createElement('article');card.className='pca-signal';
    const title=document.createElement('button');title.type='button';title.textContent=`${signed?'PC':'NMF'} ${c.index+1} · ${(100*c.variance).toFixed(1)}% ${signed?'variance':'contribution'}`;
    title.onclick=()=>{if(!signed){inspectComponent(c.index);return}$('pca-component').value=String(c.index);$('pca-map-mode').value='component';$('pca-layout').value='single';drawMap()};
    const map=document.createElement('canvas');map.width=map.height=350;map.setAttribute('aria-label',title.textContent+' spatial map');map.setAttribute('role','img');map.className='pca-mini-map';map.dataset.component=String(c.index);map.tabIndex=0;map.title='Click a location to inspect its spectrum; arrow keys move between windows';map.onclick=selectMapWindow;map.onkeydown=stepMapWindow;
    const key=document.createElement('div');key.className='pca-mini-key';const range=paintMap(map,c.scores,signed,true);rangeKey(key,range,signed);
    const label=document.createElement('div');label.className='hint';label.textContent=`Spectrum · ±${data.plan.g_max} nm⁻¹`;
    const spectrum=document.createElement('canvas');spectrum.setAttribute('role','img');spectrum.setAttribute('aria-label',title.textContent+' spectrum');spectrumCanvas(spectrum,c);if(!signed)componentAction(spectrum,c.index);
    card.append(title,map,key,label,spectrum);box.append(card);
   }
  }
  let spectrumEpoch=0;
  const groupPreviews=new Map();
  function selectedSpectrumGroup(){return [...selected].sort((a,b)=>a-b)}
  function inspectSelectedSpectrum(){
   if($('pca-map-mode').value==='group')inspectGroup({components:selectedSpectrumGroup()});
   else inspectComponent(Number($('pca-component').value));
  }
  function drawSelectedSpectrum(mode,component,overview){
   const serial=++spectrumEpoch,canvas=$('pca-spectrum'),label=$('pca-spectrum-label');
   const group=mode==='group',nmf=data.decomposition==='nmf';
   canvas.closest('figure').hidden=mode==='residual'||(group&&!nmf);
   $('nmf-inspect-component').hidden=!nmf;
   if(overview||canvas.closest('figure').hidden)return;
   if(!group){
    spectrumCanvas(canvas,data.components[component]);componentAction(canvas,component);canvas.setAttribute('aria-label','Selected component spectrum');
    label.textContent=nmf?`NMF ${component+1} spectrum · nonnegative`:`PC ${component+1} spectrum · signed, zero at colour midpoint`;
    return;
   }
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
   const overview=$('pca-layout').value==='overview';
   $('pca-overview').hidden=!overview;$('pca-single').hidden=overview;$('pca-top-label').hidden=!overview;
   const mode=$('pca-map-mode').value,component=Number($('pca-component').value),values=PcaView.values(data,mode,component,[...selected]),signed=mode==='component'&&data.decomposition!=='nmf';
   $('pca-component-label').hidden=!overview&&mode!=='component';
   $('pca-group-summary').hidden=overview||mode!=='group';
   $('pca-group-summary').textContent='Group: '+[...selected].sort((a,b)=>a-b).map(i=>i+1).join(' + ')+' · choose below';
   const range=paintMap($('pca-map'),values,signed,true);rangeKey($('pca-map-key'),range,signed);
   $('pca-contrast').disabled=overview?data.decomposition!=='nmf':signed;
   drawSelectedSpectrum(mode,component,overview);
   if(overview)drawOverview();drawPhaseMap();
   for(const b of $('pca-scree').children)b.setAttribute('aria-pressed',String(Number(b.dataset.index)===component));
  }
  async function inspect(){
   if(!data||!selected.size||running())return;
   const serial=++sampleEpoch,jobId=job.id;
   $('pca-sample-label').textContent=`Window ${index+1} of ${data.plan.count} · loading spectra…`;
   try{
    const r=await api('pca/sample',{id:jobId,index,components:[...selected].sort((a,b)=>a-b)});
    if(serial!==sampleEpoch||job?.id!==jobId)return;
    $('pca-original').src=r.raw.image;$('pca-processed').src=r.processed.image;$('pca-reconstruction').src=r.reconstruction.image;
    $('pca-sample-label').textContent=`Window ${index+1} of ${data.plan.count} · X ${r.roi[0]}, Y ${r.roi[1]} · ${r.roi[2]} × ${r.roi[3]} px`;
    $('pca-sample-note').textContent=`All three use the same intensity range. Reconstruction uses ${r.selected.length} selected component(s)${data.decomposition==='nmf'?'':' plus the mean'}. ${(100*r.negative_fraction).toFixed(1)}% of reconstructed bins are negative and displayed black.`;
   }catch(e){if(serial===sampleEpoch)notify(e.message,true)}
  }
  function showResult(r){
   const first=!data,component=$('pca-component').value;
   data=r;$('pca-top').max=String(r.components.length);$('pca-top').value=String(showAllSignals?r.components.length:PcaView.topCount($('pca-top').value,r.components.length));$('pca-available').textContent=`of ${r.components.length} computed`;groupEpoch++;$('nmf-group-detail').hidden=true;if(first){selected=new Set(r.components.map(c=>c.index));index=Math.floor(r.plan.count/2)}
   $('pca-results').hidden=false;$('pca-component').replaceChildren();$('pca-group').replaceChildren();$('pca-scree').replaceChildren();
   r.components.forEach(c=>{
    const opt=document.createElement('option');opt.value=String(c.index);opt.textContent=`${r.decomposition==='nmf'?'NMF':'PC'} ${c.index+1}`;$('pca-component').append(opt);
    const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=selected.has(c.index);check.value=String(c.index);label.append(check,document.createTextNode(String(c.index+1)));$('pca-group').append(label);
    check.onchange=()=>{if(check.checked)selected.add(c.index);else if(selected.size>1)selected.delete(c.index);else{check.checked=true;return}drawMap();inspect()};
    const button=document.createElement('button');button.type='button';button.dataset.index=String(c.index);button.style.setProperty('--bar',`${c.variance*100}%`);button.textContent=`${r.decomposition==='nmf'?'NMF':'PC'} ${c.index+1}\n${(100*c.variance).toFixed(2)}%`;button.onclick=()=>{$('pca-component').value=String(c.index);$('pca-map-mode').value='component';drawMap()};$('pca-scree').append(button);
   });
   if(!first)$('pca-component').value=component;
   $('pca-mean').src=r.mean.image;$('pca-raw-mean').src=r.raw_mean.image;
   $('pca-mean-label').textContent=r.decomposition==='nmf'?'Mean NMF reconstruction':'Mean PCA input';
   $('pca-scree').setAttribute('aria-label',r.decomposition==='nmf'?'Component contribution shares':'Explained variance by component');
   $('pca-band').textContent=`${r.plan.g_min}–${r.plan.g_max} nm⁻¹ · +qx right, +qy up · centre excluded`;
   notify(r.decomposition==='nmf'?`${r.plan.count} windows · NMF ${r.iterations} iterations · relative reconstruction error ${(100*r.relative_reconstruction_error).toFixed(1)}%${r.converged?'':' · iteration limit reached'}. Bars show contribution shares, not phase fractions.`:`${r.plan.count} windows · ${(r.explained*100).toFixed(1)}% of variance retained. Components are not phases.`);
   $('nmf-fitting').hidden=r.decomposition!=='nmf';$('nmf-fit-count').textContent=`${2**r.components.length-1} combinations`;showFits();showPhaseMaps();
   sourceImage=new Image();sourceImage.onload=drawMap;sourceImage.src='/api/file-preview?id='+encodeURIComponent(snapshot.file_id);
   controls();drawMap();inspect();
  }
  async function poll(serial){
   try{
    const next=await api('pca?id='+encodeURIComponent(job.id));if(serial!==epoch)return;job=next;controls();
    $('pca-progress').max=Math.max(1,job.total);$('pca-progress').value=job.completed;
    notify(`${job.stage} · ${job.completed}/${job.total} · ${job.elapsed_seconds}s`);
    if(job.state==='running')pollTimer=setTimeout(()=>poll(serial),600);
    else if(job.state==='complete'){
     const result=await api('pca/result?id='+encodeURIComponent(job.id));if(serial!==epoch)return;
     const stage=pipeline?.stage;
     const failure=stage==='fit'&&result.fit_status!=='complete'?result.fit_status||'incomplete':stage==='support'&&result.phase_support_status!=='complete'?result.phase_support_status||'incomplete':null;
     if(failure||stage==='support')pipeline=null;
     showResult(result);
     if(failure){notify(`Analysis stopped: ${failure}. Completed results are retained.`,failure!=='cancelled');return}
     if(stage==='decomposition'&&pipeline)await startStage('fit',serial);
     else if(stage==='fit'&&pipeline)await startStage('support',serial);
     else if(stage==='support')notify('NMF analysis complete · signals, crystal fits and phase maps ready.');
    }else{pipeline=null;controls();notify(job.state==='error'?job.error:'Analysis cancelled.',job.state==='error')}
   }catch(e){if(serial===epoch){pipeline=null;job={...job,state:'error'};controls();notify(e.message,true)}}
  }
  async function startStage(stage,serial){
   if(pipeline)pipeline.stage=stage;
   groupEpoch++;sampleEpoch++;job={...job,state:'running'};controls();$('pca-progress').value=0;
   notify(stage==='fit'?'Stage 2/3 · fitting all crystal combinations…':'Stage 3/3 · building phase maps…');
   const body={id:job.id};if(stage==='fit')body.options={peak_fraction:pipeline?.cutoff??Number($('nmf-cutoff').value)};
   const response=await api('pca/'+stage,body);if(serial!==epoch)return;job=response;
   if(cancelRequested)await api('pca/cancel',{id:job.id});
   poll(serial);
  }
  $('open-pca').onclick=()=>{
   dialog.showModal();document.documentElement.classList.add('pca-open');
   if(running()){controls();return}
   if(!meta||isDiffraction()||!config?.shared_spectra_pca){snapshot=null;controls();notify(!config?.shared_spectra_pca?'Restart the feature-branch backend to enable this workspace.':'Select a calibrated real-space image for local FFT PCA / NMF.',true);return}
   if(!running()&&context!==sourceContext()){
    context=sourceContext();snapshot=JSON.parse(JSON.stringify(requestBody()));job=null;clearResults();
    const physical=Math.min(meta.width*meta.pixel_x_nm,meta.height*meta.pixel_y_nm);
    $('pca-window').value=(physical*.1).toFixed(3);$('pca-spacing').value=(physical*.05).toFixed(3);
    $('pca-source').textContent=`${meta.name} · whole image · ${snapshot.settings.g_min}–${snapshot.settings.g_max} nm⁻¹ · ${snapshot.settings.fft_window} window`;
    notify('Uses the FFT window, taper, mean removal and fitting band captured when opened. Run NMF also fits all combinations and builds phase maps.');
   }
   controls();
  };
  form.onsubmit=async event=>{
   event.preventDefault();if(!snapshot||running())return;
   const serial=++epoch;clearTimeout(pollTimer);cancelRequested=false;pipeline=$('pca-method').value==='nmf'?{stage:'decomposition',cutoff:Number($('nmf-cutoff').value)}:null;clearResults();job={state:'running'};controls();notify('Starting decomposition…');$('pca-progress').value=0;
   try{const response=await api('pca',{...snapshot,options:options()});if(serial!==epoch)return;job=response;if(cancelRequested)await api('pca/cancel',{id:job.id});poll(serial)}
   catch(e){if(serial===epoch){pipeline=null;job=null;controls();notify(e.message,true)}}
  };
  $('pca-method').onchange=()=>{$('pca-run').textContent='Run '+$('pca-method').value.toUpperCase()};
  $('pca-cancel').onclick=async()=>{cancelRequested=true;pipeline=null;if(!job?.id)return;try{await api('pca/cancel',{id:job.id});notify('Cancelling after the current FFT, matrix step or template fit…')}catch(e){notify(e.message,true)}};
  $('pca-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>document.documentElement.classList.remove('pca-open'));
  $('pca-map-mode').addEventListener('input',()=>{$('pca-layout').value='single';drawMap()});
  $('pca-component').addEventListener('input',()=>{$('pca-map-mode').value='component';$('pca-layout').value='single';drawMap()});
  for(const id of ['pca-opacity','pca-contrast','pca-layout','pca-palette'])$(id).addEventListener('input',drawMap);
  $('pca-top').addEventListener('input',()=>{showAllSignals=false;drawMap()});
  $('pca-show-all').onclick=()=>{if(!data)return;showAllSignals=true;$('pca-top').value=String(data.components.length);drawMap()};
  function refreshWindowSelection(canvas){
   const component=canvas.dataset.component;drawMap();
   const target=canvas.id==='nmf-phase-map'?canvas:component===undefined?$('pca-map'):$('pca-overview').querySelector(`[data-component="${component}"]`);target?.focus({preventScroll:true});inspect();
  }
  function selectMapWindow(event){
   if(!data||running())return;const canvas=event.currentTarget,box=canvas.getBoundingClientRect(),p=data.plan,[h,w]=p.image_shape;
   const scale=Math.min(box.width/w,box.height/h),ox=(box.width-w*scale)/2,oy=(box.height-h*scale)/2;
   const x=(event.clientX-box.left-ox)/scale,y=(event.clientY-box.top-oy)/scale;
   if(x<0||y<0||x>w||y>h)return;
   index=PcaView.nearest(p,x,y);refreshWindowSelection(canvas);
  };
  function stepMapWindow(event){
   if(!data||running())return;const dx={ArrowLeft:-1,ArrowRight:1,ArrowUp:-data.plan.xs.length,ArrowDown:data.plan.xs.length}[event.key];
   if(dx===undefined)return;event.preventDefault();index=Math.max(0,Math.min(data.plan.count-1,index+dx));refreshWindowSelection(event.currentTarget);
  };
  $('pca-map').onclick=selectMapWindow;$('pca-map').onkeydown=stepMapWindow;
  function showFits(){
   const box=$('nmf-fit-results');box.replaceChildren();
   const fits=data?.fits;
   $('nmf-fit-note').textContent=fits?`${fits.completed}/${fits.total} combinations · ${data.fit_status||'complete'}. Position − scale ranks; main-analysis photometric penalties are not used.`:'Every nonempty combination will be fitted. Results remain experimental.';
   if(!fits)return;
   const sorted=[...fits.groups].sort((a,b)=>(b.candidates[0]?.score??-Infinity)-(a.candidates[0]?.score??-Infinity));
   const table=document.createElement('table'),head=table.createTHead().insertRow();
   ['Components','Best crystal / zone','Rank','Screen','Matched','Coverage','RMS, nm⁻¹','Cell, nm','Co-occurring windows'].forEach(t=>{const th=document.createElement('th');th.textContent=t;head.append(th)});
   const body=table.createTBody();
   function appendRows(records){for(const group of records){
    const row=body.insertRow(),model=group.candidates[0];
    const cell=row.insertCell(),button=document.createElement('button');button.type='button';button.textContent=group.components.map(i=>i+1).join(' + ');cell.append(button);button.onclick=()=>inspectGroup(group);
    const cells=[model?`${model.phase} [${model.zone_3index.join(' ')}]`:'No fit',model?.score?.toFixed(3)??'—',model?(model.valid?'Pass':'Below'):'—',model?`${model.matched_profile_count}/${group.peak_count}`:`0/${group.peak_count}`,model?`${(100*model.coverage).toFixed(0)}%`:'—',model?.rms_nm_inv?.toFixed(3)??'—',model?['a','b','c'].filter(a=>model['fitted_'+a+'_nm']!=null).map(a=>`${a} ${model['fitted_'+a+'_nm'].toFixed(4)}`).join(' · '):'—',String(group.cooccurring_windows)];
    cells.forEach(t=>row.insertCell().textContent=t);if(!group.cooccurring_windows)row.title='These factors never exceed 20% of their own maximum together. This is a mathematical combination, not an observed shared pattern.';
   }}
   let shown=0;const more=document.createElement('button');more.type='button';
   const page=()=>{appendRows(sorted.slice(shown,shown+100));shown+=100;more.hidden=shown>=sorted.length;more.textContent=`Show next ${Math.min(100,sorted.length-shown)} combinations`};
   more.onclick=page;page();box.append(table,more);
  }
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
  $('nmf-inspect-component').onclick=inspectSelectedSpectrum;
  $('nmf-group-close').onclick=()=>{groupEpoch++;$('nmf-group-detail').hidden=true};
  async function inspectGroup(group){
   if(!data||running())return;const serial=++groupEpoch,jobId=job.id;
   const pane=$('nmf-group-detail'),status=$('nmf-group-status');pane.hidden=false;$('nmf-group-content').hidden=true;
   $('nmf-group-label').textContent=`NMF ${group.components.map(i=>i+1).join(' + ')} · crystal fits`;
   status.textContent='Detecting peaks and fitting candidates…';status.classList.remove('error');pane.scrollIntoView({block:'nearest'});
   try{
    const detail=await api('pca/group',{id:jobId,components:group.components,options:{peak_fraction:Number($('nmf-cutoff').value)}});
    if(serial!==groupEpoch||job?.id!==jobId)return;
    status.textContent=`${detail.peaks.length} detected profiles · cutoff ${detail.peak_fraction} · searching ${detail.phases.join(' + ')||'no phases'} · ${detail.cooccurring_windows} co-occurring windows`;
    $('nmf-group-content').hidden=false;
    const support=$('nmf-support');support.replaceChildren();
    const note=document.createElement('p');note.className='hint';note.textContent='NMF position − scale scoring. Select individual fits below.';
    note.title='Uses the material and scale settings captured at Run, and the saved combination cutoff when available. Uniform peak weights; no weak/missing-peak, brightness or double-diffraction scoring. Up to five distinct fits per phase are retained. Neither components nor co-occurrence imply separate phases.';support.append(note);
    if(!detail.cooccurring_windows){const warning=document.createElement('p');warning.textContent='No co-occurring windows: this sum uses global means and is hypothetical.';support.append(warning)}
    const chosen=new Set(detail.candidates.length?[0]:[]),canvas=$('nmf-group-spectrum'),ctx=canvas.getContext('2d'),img=new Image();
    const colours={BCC:'#36ff58',HCP:'#79bcff',OMEGA:'#ffb54a',FCC:'#ff79c6',ORT:'#66dfbc'};
    const xy=q=>[(q[0]/detail.g_max+1)*canvas.width/2,(1-q[1]/detail.g_max)*canvas.height/2];
    function draw(){
     if(serial!==groupEpoch||!img.complete||!img.naturalWidth)return;
     ctx.drawImage(img,0,0,canvas.width,canvas.height);
     for(const i of chosen){const m=detail.candidates[i];ctx.strokeStyle=colours[m.phase]||'#ddd';ctx.lineWidth=1.8;ctx.setLineDash(m.valid?[]:[4,3]);
      for(const node of m.predicted_nodes)for(const sign of [1,-1]){const [x,y]=xy(node.q.map(v=>v*sign));ctx.beginPath();ctx.moveTo(x,y-7);ctx.lineTo(x+7,y);ctx.lineTo(x,y+7);ctx.lineTo(x-7,y);ctx.closePath();ctx.stroke()}}
     ctx.strokeStyle='#fff';ctx.lineWidth=1.3;ctx.setLineDash([]);
     for(const peak of detail.peaks)for(const sign of [1,-1]){const [x,y]=xy([sign*peak.qx,sign*peak.qy]);ctx.beginPath();ctx.moveTo(x-4,y);ctx.lineTo(x+4,y);ctx.moveTo(x,y-4);ctx.lineTo(x,y+4);ctx.stroke()}
    }
    img.onload=draw;img.src=detail.spectrum.image;
    const buttons=document.createElement('div'),checks=[];
    for(const [text,select] of [['Best fit',()=>detail.candidates.length?[0]:[]],['All passing',()=>detail.candidates.flatMap((m,i)=>m.valid?[i]:[])],['Peaks only',()=>[]]]){const button=document.createElement('button');button.type='button';button.textContent=text;button.onclick=()=>{chosen.clear();select().forEach(i=>chosen.add(i));checks.forEach((c,i)=>c.checked=chosen.has(i));draw()};buttons.append(button)}
    support.append(buttons);
    if(!detail.candidates.length){const empty=document.createElement('p');empty.textContent='No candidate survived the search gates. This does not establish that the phase is absent.';empty.title='The search seeds from the strongest 16 profiles, rejects initial coverage below 20%, and needs enough compatible reflections. Diffuse maxima can crowd out useful seeds.';support.append(empty)}
    else{
     const wrap=document.createElement('div');wrap.className='nmf-fit-results';const table=document.createElement('table'),head=table.createTHead().insertRow();
     ['Show','Candidate / rotation','Rank','Screen','Matched','Coverage','RMS, nm⁻¹','Cell, nm'].forEach(t=>{const th=document.createElement('th');th.textContent=t;head.append(th)});
     const body=table.createTBody();
     detail.candidates.forEach((m,i)=>{const row=body.insertRow(),check=document.createElement('input');check.type='checkbox';check.checked=chosen.has(i);check.setAttribute('aria-label',`Overlay ${m.phase} [${m.zone_3index.join(' ')}] ${m.rotation_deg.toFixed(1)} degrees`);check.onchange=()=>{if(check.checked)chosen.add(i);else chosen.delete(i);draw()};row.insertCell().append(check);checks.push(check);
      const name=row.insertCell();name.textContent=`${m.phase} [${m.zone_3index.join(' ')}] · ${m.rotation_deg.toFixed(1)}°`;name.style.color=colours[m.phase]||'#ddd';
      const rank=row.insertCell();rank.textContent=m.score.toFixed(4);rank.title=`Position ${(m.position_score??m.score).toFixed(4)} − scale ${(m.scale_penalty??0).toFixed(4)}`;
      row.insertCell().textContent=m.valid?'Pass':m.rejection_reasons.join('; ')||'Below screen';
      row.insertCell().textContent=`${m.matched_profile_count}/${detail.peaks.length}`;
      row.insertCell().textContent=`${(100*m.coverage).toFixed(0)}%`;row.insertCell().textContent=m.rms_nm_inv.toFixed(3);
      const cell=row.insertCell();cell.textContent=['a','b','c'].filter(a=>m['fitted_'+a+'_nm']!=null).map(a=>`${a} ${m['fitted_'+a+'_nm'].toFixed(4)}`).join(' · ')||'—';cell.title=m.scale_note||'';
     });wrap.append(table);support.append(wrap);
    }
    for(const check of group.support_checks||[]){const b=document.createElement('button');b.type='button';b.textContent=`Window ${check.window+1}: ${check.matched}/${check.peak_count} matched`;b.title='Check of the best combination model against the original window, without refitting';b.onclick=()=>{index=check.window;selected=new Set(group.components);for(const input of $('pca-group').querySelectorAll('input'))input.checked=selected.has(Number(input.value));$('pca-map-mode').value='group';drawMap();inspect()};support.append(b)}
   }catch(e){if(serial===groupEpoch){status.textContent=e.message;status.classList.add('error')}}
  }
  function showPhaseMaps(){
   const maps=data?.phase_support;
   $('nmf-phase-panel').hidden=!maps;
   $('nmf-map-status').textContent=data?.phase_support_status?`Phase mapping: ${data.phase_support_status}${maps&&data.phase_support_status!=='complete'?' · showing previous completed map':''}`:'';
   $('nmf-map-status').classList.toggle('error',String(data?.phase_support_status).startsWith('error'));
   const select=$('nmf-map-phase'),previous=select.value;select.replaceChildren(new Option('All phases','all'));
   if(!maps)return;
   maps.phases.forEach(p=>select.add(new Option(p,p)));select.value=[...select.options].some(o=>o.value===previous)?previous:'all';
   $('nmf-map-counts').textContent=`${maps.windows.length} windows · ${maps.counts.single} single · ${maps.counts.multiple} separately supported multiple · ${maps.counts.ambiguous} ambiguous · ${maps.counts.unresolved} unresolved${maps.nmf_converged===false?' · NMF reached iteration limit':''}`;
  }
  function drawPhaseMap(){
   const maps=data?.phase_support;if(!maps)return;
   const canvas=$('nmf-phase-map'),ctx=canvas.getContext('2d'),p=data.plan,[height,width]=p.image_shape;
   const scale=Math.min(canvas.width/width,canvas.height/height),ox=(canvas.width-width*scale)/2,oy=(canvas.height-height*scale)/2;
   ctx.fillStyle='#050a0f';ctx.fillRect(0,0,canvas.width,canvas.height);
   if(sourceImage?.complete&&sourceImage.naturalWidth)ctx.drawImage(sourceImage,ox,oy,width*scale,height*scale);
   const [w,h]=p.window_pixels,[dx,dy]=[p.spacing_nm[0]/p.pixel_nm[0],p.spacing_nm[1]/p.pixel_nm[1]],phase=$('nmf-map-phase').value;
   ctx.globalAlpha=Number($('pca-opacity').value);
   for(const win of maps.windows){
    const ix=win.index%p.xs.length,iy=Math.floor(win.index/p.xs.length),cx=p.xs[ix]+w/2,cy=p.ys[iy]+h/2;
    const left=Math.max(0,cx-dx/2),top=Math.max(0,cy-dy/2),right=Math.min(width,cx+dx/2),bottom=Math.min(height,cy+dy/2);
    ctx.fillStyle=`rgb(${PcaView.supportColour(win,phase).join(',')})`;ctx.fillRect(ox+left*scale,oy+top*scale,(right-left)*scale+.2,(bottom-top)*scale+.2);
   }
   ctx.globalAlpha=1;const iy=Math.floor(index/p.xs.length),ix=index%p.xs.length;
   ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.strokeRect(ox+p.xs[ix]*scale,oy+p.ys[iy]*scale,w*scale,h*scale);
   const key=$('nmf-map-key');key.replaceChildren();
   for(const name of phase==='all'?[...maps.phases,'Ambiguous','Unresolved']:[phase,'Below / inactive']){
    const item=document.createElement('span');item.textContent='● '+name+'  ';item.style.color=`rgb(${PcaView.phaseColours[name]||(name==='Ambiguous'?[230,155,170]:[140,150,160])})`;key.append(item);
   }
   if(phase==='all')key.append(document.createTextNode('Blended: separate evidence for multiple phases'));
   const win=maps.windows[index];
   $('nmf-map-window').textContent=`Window ${index+1} · ${win.label}${win.phases.length?' · '+win.phases.join(' + '):''} · ${win.peak_count} profiles · ${win.tested_models} eligible fits`;
   const box=$('nmf-map-evidence');box.replaceChildren();
   const table=document.createElement('table'),head=table.createTHead().insertRow();
   ['Phase / group','Rank','Screen','Matched','Coverage'].forEach(t=>{const th=document.createElement('th');th.textContent=t;head.append(th)});
   for(const c of win.candidates){const row=table.insertRow(),model=maps.models[c.model],button=document.createElement('button');button.type='button';button.textContent=`${c.phase} · ${model.components.map(i=>i+1).join(' + ')}`;button.onclick=()=>inspectGroup(data.fits.groups[model.group]);row.insertCell().append(button);
    [c.score.toFixed(3),c.valid?'Pass':'Below',`${c.profiles.length}/${win.peak_count}`,`${Math.round(c.coverage*100)}%`].forEach(t=>row.insertCell().textContent=t);
    row.title=`Fixed [${model.zone_3index.join(' ')}] at ${model.rotation_deg.toFixed(1)}°; RMS ${c.rms_nm_inv.toFixed(3)} nm⁻¹. Distinct profiles: ${(win.unique_profiles[c.phase]||[]).length}.`;
   }
   box.append(table);
   if(!win.candidates.length){const note=document.createElement('p');note.textContent='No eligible group fit matched this window.';box.append(note)}
  }
  $('nmf-map-phase').onchange=drawPhaseMap;
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

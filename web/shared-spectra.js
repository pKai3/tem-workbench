/* Source-bound exploratory PCA/NMF; component activity is not phase abundance. */
const PcaView={
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
 nearest(plan,x,y){
  const [w,h]=plan.window_pixels;
  const closest=(values,v)=>values.reduce((best,a,i)=>Math.abs(a-v)<Math.abs(values[best]-v)?i:best,0);
  return closest(plan.ys,y-h/2)*plan.xs.length+closest(plan.xs,x-w/2);
 }
};
if(typeof module!=='undefined')module.exports=PcaView;
if(typeof document!=='undefined'){
 const initPca=()=>{
  let snapshot=null,context='',job=null,data=null,selected=new Set(),index=0,epoch=0,sampleEpoch=0,pollTimer=null,sourceImage=null,exporting=false,groupEpoch=0;
  const dialog=$('pca-dialog'),form=$('pca-form');
  const sourceContext=()=>JSON.stringify([fileId,meta?.sha256_pixels,meta?.pixel_x_nm,meta?.pixel_y_nm,settings()]);
  const notify=(message,error=false)=>{$('pca-status').textContent=message;$('pca-status').classList.toggle('error',error)};
  const running=()=>job?.state==='running';
  function controls(){
   for(const field of form.querySelectorAll('input,select'))field.disabled=running()||exporting;
   $('pca-run').disabled=running()||exporting||!snapshot;
   $('pca-progress').hidden=!running();
   $('nmf-fit').disabled=!data||running()||exporting;$('nmf-cutoff').disabled=running()||exporting;
   $('pca-cancel').disabled=!running();$('pca-export').disabled=!data||running()||exporting;
  }
  function clearResults(){data=null;selected.clear();$('pca-results').hidden=true;sampleEpoch++;sourceImage=null;controls()}
  function options(){return {method:$('pca-method').value,window_nm:Number($('pca-window').value),spacing_nm:Number($('pca-spacing').value),components:Number($('pca-count').value),angular_sigma_deg:Number($('pca-angle').value),spacing_sigma_percent:Number($('pca-scale').value),normalization:$('pca-normalization').value}}
  function drawMap(){
   if(!data)return;
   const p=data.plan,[height,width]=p.image_shape,canvas=$('pca-map'),ctx=canvas.getContext('2d');
   const scale=Math.min(canvas.width/width,canvas.height/height),ox=(canvas.width-width*scale)/2,oy=(canvas.height-height*scale)/2;
   ctx.fillStyle='#050a0f';ctx.fillRect(0,0,canvas.width,canvas.height);
   if(sourceImage?.complete&&sourceImage.naturalWidth)ctx.drawImage(sourceImage,ox,oy,width*scale,height*scale);
   const mode=$('pca-map-mode').value,component=Number($('pca-component').value),ids=[...selected],values=PcaView.values(data,mode,component,ids),signed=mode==='component'&&data.decomposition!=='nmf';
   const high=Math.max(...values.flat().map(Math.abs),1e-20),[w,h]=p.window_pixels,[dx,dy]=[p.spacing_nm[0]/p.pixel_nm[0],p.spacing_nm[1]/p.pixel_nm[1]];
   ctx.globalAlpha=Number($('pca-opacity').value);
   for(let y=0;y<p.ys.length;y++)for(let x=0;x<p.xs.length;x++){
    const colour=PcaView.colour(values[y][x],high,signed),cx=p.xs[x]+w/2,cy=p.ys[y]+h/2;
    const left=Math.max(0,cx-dx/2),top=Math.max(0,cy-dy/2),right=Math.min(width,cx+dx/2),bottom=Math.min(height,cy+dy/2);
    ctx.fillStyle=`rgb(${colour.join(',')})`;ctx.fillRect(ox+left*scale,oy+top*scale,(right-left)*scale+.2,(bottom-top)*scale+.2);
   }
   ctx.globalAlpha=1;
   const iy=Math.floor(index/p.xs.length),ix=index%p.xs.length;
   ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.strokeRect(ox+p.xs[ix]*scale,oy+p.ys[iy]*scale,w*scale,h*scale);
   $('pca-map-key').textContent=signed?`Blue −${high.toPrecision(3)} · dark 0 · red +${high.toPrecision(3)} · score`:`Dark 0 → gold ${high.toPrecision(3)} · ${mode==='group'?'group activity':mode==='component'?'component contribution':'residual norm'}`;
   $('pca-spectrum').src=data.components[component].spectrum.image;
   $('pca-spectrum-label').textContent=data.decomposition==='nmf'?`NMF ${component+1} spectrum · nonnegative`:`PC ${component+1} spectrum · blue − / red +`;
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
   data=r;groupEpoch++;$('nmf-group-detail').hidden=true;selected=new Set(r.components.map(c=>c.index));index=Math.floor(r.plan.count/2);
   $('pca-results').hidden=false;$('pca-component').replaceChildren();$('pca-group').replaceChildren();$('pca-scree').replaceChildren();
   r.components.forEach(c=>{
    const opt=document.createElement('option');opt.value=String(c.index);opt.textContent=`${r.decomposition==='nmf'?'NMF':'PC'} ${c.index+1}`;$('pca-component').append(opt);
    const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=true;check.value=String(c.index);label.append(check,document.createTextNode(String(c.index+1)));$('pca-group').append(label);
    check.onchange=()=>{if(check.checked)selected.add(c.index);else if(selected.size>1)selected.delete(c.index);else{check.checked=true;return}drawMap();inspect()};
    const button=document.createElement('button');button.type='button';button.dataset.index=String(c.index);button.style.setProperty('--bar',`${c.variance*100}%`);button.textContent=`${r.decomposition==='nmf'?'NMF':'PC'} ${c.index+1}\n${(100*c.variance).toFixed(2)}%`;button.onclick=()=>{$('pca-component').value=String(c.index);$('pca-map-mode').value='component';drawMap()};$('pca-scree').append(button);
   });
   $('pca-mean').src=r.mean.image;$('pca-raw-mean').src=r.raw_mean.image;
   $('pca-mean-label').textContent=r.decomposition==='nmf'?'Mean NMF reconstruction':'Mean PCA input';
   $('pca-scree').setAttribute('aria-label',r.decomposition==='nmf'?'Component contribution shares':'Explained variance by component');
   $('pca-band').textContent=`${r.plan.g_min}–${r.plan.g_max} nm⁻¹ · +qx right, +qy up · centre excluded`;
   notify(r.decomposition==='nmf'?`${r.plan.count} windows · NMF ${r.iterations} iterations · relative reconstruction error ${(100*r.relative_reconstruction_error).toFixed(1)}%${r.converged?'':' · iteration limit reached'}. Bars show contribution shares, not phase fractions.`:`${r.plan.count} windows · ${(r.explained*100).toFixed(1)}% of variance retained. Components are not phases.`);
   $('nmf-fitting').hidden=r.decomposition!=='nmf';$('nmf-fit-count').textContent=`${2**r.components.length-1} combinations`;showFits();
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
     const result=await api('pca/result?id='+encodeURIComponent(job.id));if(serial===epoch)showResult(result);
    }else if(job.state==='error')notify(job.error,true);
   }catch(e){if(serial===epoch){job={...job,state:'error'};controls();notify(e.message,true)}}
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
    notify('Uses the FFT window, taper, mean removal and fitting band captured when opened. Optional crystal fitting is available after NMF.');
   }
   controls();
  };
  form.onsubmit=async event=>{
   event.preventDefault();if(!snapshot||running())return;
   const serial=++epoch;clearTimeout(pollTimer);clearResults();job={state:'running'};controls();notify('Starting decomposition…');$('pca-progress').value=0;
   try{const response=await api('pca',{...snapshot,options:options()});if(serial!==epoch)return;job=response;poll(serial)}
   catch(e){if(serial===epoch){job=null;controls();notify(e.message,true)}}
  };
  $('pca-method').onchange=()=>{$('pca-run').textContent='Run '+$('pca-method').value.toUpperCase()};
  $('pca-cancel').onclick=async()=>{if(!job?.id)return;try{await api('pca/cancel',{id:job.id});notify('Cancelling after the current FFT, matrix step or template fit…')}catch(e){notify(e.message,true)}};
  $('pca-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>document.documentElement.classList.remove('pca-open'));
  for(const id of ['pca-map-mode','pca-component','pca-opacity'])$(id).addEventListener('input',drawMap);
  $('pca-map').onclick=event=>{
   if(!data||running())return;const canvas=event.currentTarget,box=canvas.getBoundingClientRect(),p=data.plan,[h,w]=p.image_shape;
   const scale=Math.min(box.width/w,box.height/h),ox=(box.width-w*scale)/2,oy=(box.height-h*scale)/2;
   const x=(event.clientX-box.left-ox)/scale,y=(event.clientY-box.top-oy)/scale;
   if(x<0||y<0||x>w||y>h)return;
   index=PcaView.nearest(p,x,y);drawMap();inspect();
  };
  $('pca-map').onkeydown=event=>{
   if(!data||running())return;const dx={ArrowLeft:-1,ArrowRight:1,ArrowUp:-data.plan.xs.length,ArrowDown:data.plan.xs.length}[event.key];
   if(dx===undefined)return;event.preventDefault();index=Math.max(0,Math.min(data.plan.count-1,index+dx));drawMap();inspect();
  };
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
  async function inspectGroup(group){
   if(running())return;const serial=++groupEpoch;
   try{
    const detail=await api('pca/group',{id:job.id,components:group.components});if(serial!==groupEpoch)return;
    $('nmf-group-detail').hidden=false;$('nmf-group-spectrum').src=detail.spectrum.image;
    $('nmf-group-label').textContent=`Components ${group.components.map(i=>i+1).join(' + ')} · combined spectrum`;
    const support=$('nmf-support');support.replaceChildren();
    const note=document.createElement('p');note.textContent=detail.cooccurring_windows?`${detail.cooccurring_windows} co-occurring windows. Checks below reuse the original spectra without refitting.`:'No co-occurring windows: global mean coefficients used. Treat this fit as hypothetical.';support.append(note);
    for(const check of group.support_checks){const b=document.createElement('button');b.type='button';b.textContent=`Window ${check.window+1}: ${check.matched}/${check.peak_count} matched (${(100*check.coverage).toFixed(0)}%)`;b.onclick=()=>{index=check.window;selected=new Set(group.components);for(const input of $('pca-group').querySelectorAll('input'))input.checked=selected.has(Number(input.value));$('pca-map-mode').value='group';drawMap();inspect()};support.append(b)}
    for(const model of group.candidates){const line=document.createElement('p');line.textContent=`${model.phase} [${model.zone_3index.join(' ')}] · rank ${model.score.toFixed(3)} · ${model.valid?'passes':'below'} positional screen${model.scale_note?' · '+model.scale_note:''}`;support.append(line)}
   }catch(e){if(serial===groupEpoch)notify(e.message,true)}
  }
  $('nmf-fit').onclick=async()=>{
   if(!data||running())return;const serial=++epoch;groupEpoch++;sampleEpoch++;
   job={...job,state:'running'};controls();$('pca-progress').value=0;notify('Starting exhaustive crystal fitting…');$('pca-form').scrollIntoView({block:'start'});
   try{job=await api('pca/fit',{id:job.id,options:{peak_fraction:Number($('nmf-cutoff').value)}});poll(serial)}
   catch(e){job={...job,state:'complete'};controls();notify(e.message,true)}
  };
  $('pca-export').onclick=async()=>{
   if(!data||exporting)return;exporting=true;controls();notify('Exporting spectra, fits and provenance…');
   try{const r=await api('pca/export',{id:job.id});notify('Export complete: '+r.files.join(' · '))}catch(e){notify(e.message,true)}finally{exporting=false;controls()}
  };
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initPca);else initPca();
}

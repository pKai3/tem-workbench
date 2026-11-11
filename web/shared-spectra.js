/* PCA is a source-bound exploratory workspace, never a phase classifier. */
const PcaView={
 values(data,mode,component,selected){
  if(mode==='residual')return data.residual;
  if(mode==='component')return data.components[component].scores;
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
  let snapshot=null,context='',job=null,data=null,selected=new Set(),index=0,epoch=0,sampleEpoch=0,pollTimer=null,sourceImage=null,exporting=false;
  const dialog=$('pca-dialog'),form=$('pca-form');
  const sourceContext=()=>JSON.stringify([fileId,meta?.sha256_pixels,meta?.pixel_x_nm,meta?.pixel_y_nm,settings()]);
  const notify=(message,error=false)=>{$('pca-status').textContent=message;$('pca-status').classList.toggle('error',error)};
  const running=()=>job?.state==='running';
  function controls(){
   for(const field of form.querySelectorAll('input,select'))field.disabled=running()||exporting;
   $('pca-run').disabled=running()||exporting||!snapshot;
   $('pca-cancel').disabled=!running();$('pca-export').disabled=!data||running()||exporting;
  }
  function clearResults(){data=null;selected.clear();$('pca-results').hidden=true;sampleEpoch++;sourceImage=null;controls()}
  function options(){return {window_nm:Number($('pca-window').value),spacing_nm:Number($('pca-spacing').value),components:Number($('pca-count').value),angular_sigma_deg:Number($('pca-angle').value),spacing_sigma_percent:Number($('pca-scale').value),normalization:$('pca-normalization').value}}
  function drawMap(){
   if(!data)return;
   const p=data.plan,[height,width]=p.image_shape,canvas=$('pca-map'),ctx=canvas.getContext('2d');
   const scale=Math.min(canvas.width/width,canvas.height/height),ox=(canvas.width-width*scale)/2,oy=(canvas.height-height*scale)/2;
   ctx.fillStyle='#050a0f';ctx.fillRect(0,0,canvas.width,canvas.height);
   if(sourceImage?.complete&&sourceImage.naturalWidth)ctx.drawImage(sourceImage,ox,oy,width*scale,height*scale);
   const mode=$('pca-map-mode').value,component=Number($('pca-component').value),ids=[...selected],values=PcaView.values(data,mode,component,ids),signed=mode==='component';
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
   $('pca-map-key').textContent=signed?`Blue −${high.toPrecision(3)} · dark 0 · red +${high.toPrecision(3)} · score`:`Dark 0 → gold ${high.toPrecision(3)} · ${mode==='group'?'group activity':'residual norm'}`;
   $('pca-spectrum').src=data.components[component].spectrum.image;
   $('pca-spectrum-label').textContent=`PC ${component+1} spectrum · blue − / red +`;
   for(const b of $('pca-scree').children)b.setAttribute('aria-pressed',String(Number(b.dataset.index)===component));
  }
  async function inspect(){
   if(!data||!selected.size)return;
   const serial=++sampleEpoch,jobId=job.id;
   $('pca-sample-label').textContent=`Window ${index+1} of ${data.plan.count} · loading spectra…`;
   try{
    const r=await api('pca/sample',{id:jobId,index,components:[...selected].sort((a,b)=>a-b)});
    if(serial!==sampleEpoch||job?.id!==jobId)return;
    $('pca-original').src=r.raw.image;$('pca-processed').src=r.processed.image;$('pca-reconstruction').src=r.reconstruction.image;
    $('pca-sample-label').textContent=`Window ${index+1} of ${data.plan.count} · X ${r.roi[0]}, Y ${r.roi[1]} · ${r.roi[2]} × ${r.roi[3]} px`;
    $('pca-sample-note').textContent=`All three use the same intensity range. Reconstruction uses ${r.selected.length} selected component(s) plus the mean. ${(100*r.negative_fraction).toFixed(1)}% of reconstructed bins are negative and displayed black.`;
   }catch(e){if(serial===sampleEpoch)notify(e.message,true)}
  }
  function showResult(r){
   data=r;selected=new Set(r.components.map(c=>c.index));index=Math.floor(r.plan.count/2);
   $('pca-results').hidden=false;$('pca-component').replaceChildren();$('pca-group').replaceChildren();$('pca-scree').replaceChildren();
   r.components.forEach(c=>{
    const opt=document.createElement('option');opt.value=String(c.index);opt.textContent=`PC ${c.index+1}`;$('pca-component').append(opt);
    const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=true;check.value=String(c.index);label.append(check,document.createTextNode(String(c.index+1)));$('pca-group').append(label);
    check.onchange=()=>{if(check.checked)selected.add(c.index);else if(selected.size>1)selected.delete(c.index);else{check.checked=true;return}drawMap();inspect()};
    const button=document.createElement('button');button.type='button';button.dataset.index=String(c.index);button.style.setProperty('--bar',`${c.variance*100}%`);button.textContent=`PC ${c.index+1}\n${(100*c.variance).toFixed(2)}%`;button.onclick=()=>{$('pca-component').value=String(c.index);$('pca-map-mode').value='component';drawMap()};$('pca-scree').append(button);
   });
   $('pca-mean').src=r.mean.image;$('pca-raw-mean').src=r.raw_mean.image;
   $('pca-band').textContent=`${r.plan.g_min}–${r.plan.g_max} nm⁻¹ · +qx right, +qy up · centre excluded`;
   notify(`${r.plan.count} windows · ${(r.explained*100).toFixed(1)}% of variance retained · ${r.plan.window_nm.map(v=>v.toFixed(2)).join(' × ')} nm windows. Components are not phases.`);
   sourceImage=new Image();sourceImage.onload=drawMap;sourceImage.src='/api/file-preview?id='+encodeURIComponent(snapshot.file_id);
   controls();drawMap();inspect();
  }
  async function poll(serial){
   try{
    const next=await api('pca?id='+encodeURIComponent(job.id));if(serial!==epoch)return;job=next;controls();
    notify(`${job.stage} · ${job.completed}/${job.total} windows · ${job.elapsed_seconds}s`);
    if(job.state==='running')pollTimer=setTimeout(()=>poll(serial),600);
    else if(job.state==='complete'){
     const result=await api('pca/result?id='+encodeURIComponent(job.id));if(serial===epoch)showResult(result);
    }else if(job.state==='error')notify(job.error,true);
   }catch(e){if(serial===epoch){job={...job,state:'error'};controls();notify(e.message,true)}}
  }
  $('open-pca').onclick=()=>{
   dialog.showModal();document.documentElement.classList.add('pca-open');
   if(running()){controls();return}
   if(!meta||isDiffraction()||!config?.shared_spectra_pca){snapshot=null;controls();notify(!config?.shared_spectra_pca?'Restart the PCA branch backend to enable this workspace.':'Select a calibrated real-space image for local FFT PCA.',true);return}
   if(!running()&&context!==sourceContext()){
    context=sourceContext();snapshot=JSON.parse(JSON.stringify(requestBody()));job=null;clearResults();
    const physical=Math.min(meta.width*meta.pixel_x_nm,meta.height*meta.pixel_y_nm);
    $('pca-window').value=(physical*.1).toFixed(3);$('pca-spacing').value=(physical*.05).toFixed(3);
    $('pca-source').textContent=`${meta.name} · whole image · ${snapshot.settings.g_min}–${snapshot.settings.g_max} nm⁻¹ · ${snapshot.settings.fft_window} window`;
    notify('Uses the FFT window, taper, mean removal and fitting band captured when opened. No peak matching.');
   }
   controls();
  };
  form.onsubmit=async event=>{
   event.preventDefault();if(!snapshot||running())return;
   const serial=++epoch;clearTimeout(pollTimer);clearResults();job={state:'running'};controls();notify('Starting PCA…');
   try{const response=await api('pca',{...snapshot,options:options()});if(serial!==epoch)return;job=response;poll(serial)}
   catch(e){if(serial===epoch){job=null;controls();notify(e.message,true)}}
  };
  $('pca-cancel').onclick=async()=>{if(!job?.id)return;try{await api('pca/cancel',{id:job.id});notify('Cancelling after the current FFT or matrix step…')}catch(e){notify(e.message,true)}};
  $('pca-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>document.documentElement.classList.remove('pca-open'));
  for(const id of ['pca-map-mode','pca-component','pca-opacity'])$(id).addEventListener('input',drawMap);
  $('pca-map').onclick=event=>{
   if(!data)return;const canvas=event.currentTarget,box=canvas.getBoundingClientRect(),p=data.plan,[h,w]=p.image_shape;
   const scale=Math.min(box.width/w,box.height/h),ox=(box.width-w*scale)/2,oy=(box.height-h*scale)/2;
   const x=(event.clientX-box.left-ox)/scale,y=(event.clientY-box.top-oy)/scale;
   if(x<0||y<0||x>w||y>h)return;
   index=PcaView.nearest(p,x,y);drawMap();inspect();
  };
  $('pca-map').onkeydown=event=>{
   if(!data)return;const dx={ArrowLeft:-1,ArrowRight:1,ArrowUp:-data.plan.xs.length,ArrowDown:data.plan.xs.length}[event.key];
   if(dx===undefined)return;event.preventDefault();index=Math.max(0,Math.min(data.plan.count-1,index+dx));drawMap();inspect();
  };
  $('pca-export').onclick=async()=>{
   if(!data||exporting)return;exporting=true;controls();notify('Exporting PCA arrays and provenance…');
   try{const r=await api('pca/export',{id:job.id});notify('Export complete: '+r.files.join(' · '))}catch(e){notify(e.message,true)}finally{exporting=false;controls()}
  };
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initPca);else initPca();
}

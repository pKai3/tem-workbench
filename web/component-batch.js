/* Independent-image batch controls; numerical work stays in the backend. */
function createComponentBatch(getRequest, singleBusy, changed){
 let state={state:'idle'},files=[],selected=new Set(),pending=false,timer=null,epoch=0;
 const busy=()=>pending||state.state==='running';
 const note=(text,error=false)=>{$('pca-batch-status').textContent=text;$('pca-batch-status').classList.toggle('error',error)};
 const matches=()=>files.filter(f=>`${f.name} ${f.folder||''} ${f.sample||''}`.toLowerCase().includes($('pca-batch-search').value.toLowerCase()));
 function controls(){
  $('pca-batch-open').hidden=!config?.component_batch;
  for(const id of ['pca-batch-review','pca-batch-search','pca-batch-select','pca-batch-clear'])$(id).disabled=busy();
  $('pca-batch-start').disabled=busy()||singleBusy()||!selected.size;
  $('pca-batch-cancel').disabled=state.state!=='running';
  $('pca-batch-count').textContent=`${selected.size} selected`;
  for(const check of $('pca-batch-files').querySelectorAll('input'))check.disabled=busy();
 }
 function renderFiles(){
  const list=$('pca-batch-files');list.replaceChildren();
  for(const row of matches()){
   const label=document.createElement('label'),check=document.createElement('input'),text=document.createElement('span');
   check.type='checkbox';check.checked=selected.has(row.id);check.onchange=()=>{check.checked?selected.add(row.id):selected.delete(row.id);controls()};
   text.textContent=row.name;text.title=[row.folder,row.sample,row.id].filter(Boolean).join(' · ');
   label.append(check,text);list.append(label);
  }
  controls();
 }
 function show(value){
  state=value;const current=value.current_job,failures=(value.images||[]).filter(r=>r.state==='error').length;
  const detail=`${value.finished||0}/${value.total||0} images${failures?` · ${failures} failed`:''}`;
  const stage=current?` · ${current.stage} · ${current.completed}/${current.total}${current.execution?` · ${current.execution.workers} workers`:''}`:'';
  note(value.error||`${value.state==='idle'?'Review images to begin.':`${(value.options?.method||'PCA/NMF').toUpperCase()} · ${detail} · ${value.state}${value.current?' · '+value.current.name:''}${stage}`}`,Boolean(value.error));
  const results=$('pca-batch-results');results.replaceChildren();
  if(value.manifest){const p=document.createElement('p');p.textContent=`Manifest: ${value.manifest}`;results.append(p)}
  for(const image of value.images||[]){const p=document.createElement('p');p.textContent=`${image.name} · ${image.state}${image.error?' · '+image.error:''}${image.export?.warning?' · '+image.export.warning:''}${image.export?' · '+image.export.files.join(' · '):''}`;results.append(p)}
  setJobProgress('components',{id:value.id,state:value.state,title:`PCA/NMF batch · ${value.state}`,name:value.current?.name||'Independent images',detail:detail+(current?` · ${current.completed}/${current.total} ${current.operation==='support'?'windows':current.operation==='fit'?'fits':'samples'}`:''),
   fraction:value.total?value.finished/value.total:null,tooltip:'Independent runs; each image is exported before the next starts.',
   openHandler:open,cancelHandler:cancel});
  controls();changed();
 }
 async function refresh(){
  clearTimeout(timer);
  if(!config||pending){timer=setTimeout(refresh,1000);return}
  if(!config.component_batch){controls();return}
  const serial=++epoch;
  try{const value=await api('pca/batch');if(serial!==epoch)return;show(value);if(state.state==='running')timer=setTimeout(refresh,1000)}
  catch(e){if(serial!==epoch)return;note('Batch status unavailable; reconnecting…',true);reconnectJobProgress('components');timer=setTimeout(refresh,3000)}
 }
 async function review(){
  if(busy())return;
  pending=true;controls();
  try{files=(await api('pca/batch/preview',{})).files;selected=new Set((state.selected_file_ids||[fileId]).filter(id=>files.some(f=>f.id===id)));renderFiles();note('Select images. Calibration and sampling are checked when each image loads.')}
  catch(e){note(e.message,true)}finally{pending=false;controls()}
 }
 async function open(){
  if(!$('pca-dialog').open)await $('open-pca').onclick();
  $('pca-setup').open=false;$('pca-batch-panel').hidden=false;
  if(!files.length&&state.state!=='running')await review();
  await refresh();$('pca-batch-panel').scrollIntoView({block:'nearest'});
 }
 async function cancel(){
  if(state.state!=='running')return;
  ++epoch;clearTimeout(timer);
  show(await api('pca/batch/cancel',{id:state.id}));timer=setTimeout(refresh,250);
 }
 $('pca-batch-open').onclick=open;
 $('pca-batch-hide').onclick=()=>$('pca-batch-panel').hidden=true;
 $('pca-batch-review').onclick=review;
 $('pca-batch-search').oninput=renderFiles;
 $('pca-batch-select').onclick=()=>{for(const f of matches())selected.add(f.id);renderFiles()};
 $('pca-batch-clear').onclick=()=>{selected.clear();renderFiles()};
 $('pca-batch-start').onclick=async()=>{
  if(busy()||singleBusy()||!selected.size)return;
  ++epoch;clearTimeout(timer);pending=true;controls();changed();
  try{show(await api('pca/batch/start',{...getRequest(),file_ids:[...selected]}));timer=setTimeout(refresh,250)}
  catch(e){note(e.message,true)}finally{pending=false;controls();changed()}
 };
 $('pca-batch-cancel').onclick=()=>cancel().catch(e=>note(e.message,true));
 timer=setTimeout(refresh,1000);
 return {busy,refresh,controls};
}

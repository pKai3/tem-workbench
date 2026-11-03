/* Advisory size check. The result is bound to its source/settings snapshot. */
let windowSizeJob=null,windowSizeSignature='',windowSizeEpoch=0;
function windowSizeAnchor(){
 const overlap=overlapRequest();
 return overlap?overlapDimensions(overlap,meta).width:roi.w*meta.pixel_x_nm;
}
function windowSizeContext(){return meta?JSON.stringify([fileId,meta.sha256_pixels,settings(),windowSizeAnchor(),$('window-size-smoothing').value]):''}
function updateWindowSizeCheck(){
 const button=$('window-size-check');
 button.disabled=!meta||isDiffraction()||!config?.window_size_probe||windowSizeJob?.state==='running';
 button.title=config?.window_size_probe?'Compare four sizes at five locations without running a map':'Restart TEM Workbench and reload to enable window size checks';
}
function resetWindowSizeProbe(){
 windowSizeEpoch++;
 if(windowSizeJob?.state==='running')api('window-size/cancel',{id:windowSizeJob.id}).catch(()=>{});
 windowSizeJob=null;windowSizeSignature='';$('window-size-status').textContent='';$('window-size-results').hidden=true;$('window-size-cancel').hidden=true;
 updateWindowSizeCheck();
}
function renderWindowSizeJob(job){
 windowSizeJob=job;updateWindowSizeCheck();$('window-size-cancel').hidden=job.state!=='running';
 $('window-size-status').textContent=job.state==='running'?`Checking ${job.completed}/${job.total} windows · ${job.elapsed_seconds||0}s`:job.state==='complete'?'Size check complete':job.state==='cancelled'?'Size check cancelled':`Size check failed: ${job.error}`;
 if(job.state!=='complete')return;
 const details=$('window-size-results');details.hidden=false;details.open=true;
 $('window-size-recommendation').textContent=job.recommendation.message;
 const rows=$('window-size-rows');rows.replaceChildren();
 for(const r of job.rows){const tr=document.createElement('tr');
  const values=[`${r.width_nm.toFixed(2)} nm (${r.percent}%)`,r.skip||`${r.passing}/5`,r.skip?'—':`${r.dual}/5`,r.stable_sites===null?'—':`${r.stable_sites}/5`,r.median_rank?.toFixed(3)??'—',r.median_rms?.toFixed(3)??'—',r.sigma_bins.toFixed(3)];
  for(const value of values){const td=document.createElement('td');td.textContent=value;tr.append(td)}rows.append(tr);
 }
 const actions=$('window-size-actions');actions.replaceChildren();
 for(const [key,label] of [['small','Use smaller'],['large','Use larger']]){
  const index=job.recommendation[key];if(index===null||(key==='large'&&index===job.recommendation.small))continue;
  const row=job.rows[index],button=document.createElement('button');button.type='button';button.textContent=`${label} · ${row.width_nm.toFixed(2)} nm`;
  button.onclick=()=>{
   if(windowSizeContext()!==windowSizeSignature){$('window-size-status').textContent='Image or settings changed; run the size check again.';return}
   if(isGridRunning()||batchRunning){$('window-size-status').textContent='Finish or cancel the running grid or batch first.';return}
   $('grid-mode').value='overlap';$('map-size-mode').value='fixed_nm';$('map-window').value=String(row.width_nm);$('fft-smoothing').value=String(row.sigma_bins);
   rememberBasicControls();updateGridSizeNote();invalidateAnalysisSettings();
   $('window-size-status').textContent=`Applied ${row.width_nm.toFixed(2)} nm · smoothing ${row.sigma_bins.toFixed(3)} bins. Ready to run an overlapping map.`;
   for(const b of actions.querySelectorAll('button'))b.disabled=true;
  };actions.append(button);
 }
}
$('window-size-check').onclick=async()=>{
 if(!meta||isDiffraction())return;
 const epoch=++windowSizeEpoch,signature=windowSizeContext();$('window-size-check').disabled=true;$('window-size-results').hidden=true;$('window-size-status').textContent='Starting size check…';
 try{
  const job=await api('window-size',{...requestBody(),anchor_nm:windowSizeAnchor(),smoothing_mode:$('window-size-smoothing').value});
  if(epoch!==windowSizeEpoch){api('window-size/cancel',{id:job.id}).catch(()=>{});return}
  windowSizeSignature=signature;renderWindowSizeJob(job);
  async function pollSize(){
   if(epoch!==windowSizeEpoch)return;
   try{const state=await api('window-size?id='+encodeURIComponent(job.id));if(epoch!==windowSizeEpoch)return;renderWindowSizeJob(state);if(state.state==='running')setTimeout(pollSize,600)}
   catch(e){if(epoch===windowSizeEpoch){windowSizeJob=null;updateWindowSizeCheck();$('window-size-cancel').hidden=true;$('window-size-status').textContent=e.message}}
  }
  if(job.state==='running')setTimeout(pollSize,600);
 }catch(e){if(epoch===windowSizeEpoch){$('window-size-status').textContent=e.message;updateWindowSizeCheck()}}
};
$('window-size-cancel').onclick=async()=>{
 if(!windowSizeJob)return;
 try{await api('window-size/cancel',{id:windowSizeJob.id});$('window-size-status').textContent='Stopping after the current fit…'}catch(e){$('window-size-status').textContent=e.message}
};

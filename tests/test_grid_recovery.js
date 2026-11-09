// Reloads reconnect to the same server job; no fitting work is restarted.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('web/app.js','utf8');
const functions=source.slice(source.indexOf('function isGridRunning(){'),source.indexOf('const exportButtonTimers='));
const image={id:'running-image',sha256_pixels:'pixels',width:256,height:256,pixel_x_nm:.03,pixel_y_nm:.03};
function job(state='running'){
 return {id:'same-job',state,source:{...image},settings:{enabled_phases:['BCC'],g_min:3.1,missing_peak_weight:.25},
  grid:{count:4,adaptive:true,minimum_nm:1.5,check_passing:true},execution:{workers:4,requested_workers:0,elapsed_seconds:10},
  regions:[{id:'cell',leaf:true}],processed:1,pending:15,cancelling:false};
}
function setup(current=job(),remembered=null){
 const controls=new Map(),storage=new Map([['tem-grid-session:project',remembered],['last-image','other-image']]),timers=new Map(),calls=[];
 const $=id=>{if(!controls.has(id))controls.set(id,{value:'',checked:false,disabled:false,textContent:''});return controls.get(id)};
 $('source-filter').value='other-project';
 const context=vm.createContext({assert,$,config:{state_namespace:'project',files:[{id:'other-image'},image],grid_job:current},
  meta:null,fileId:null,grid:null,jobId:null,sourceRequest:0,rescoreRevision:0,rescorePending:false,rescoreTimer:null,
  readPreference:(key,fallback)=>storage.get(key)??fallback,writePreference:(key,value)=>storage.set(key,value),lastImageKey:()=> 'last-image',
  clearFileSearch(){ $('source-filter').value='';context.filtersCleared=true; },
  projectFiles:()=>context.config.files.filter(f=>!$('source-filter').value||f.id==='other-image'),
  async openFile(){context.sourceRequest++;context.fileId=$('file').value;context.meta={...image,id:context.fileId};context.jobId=null;context.grid=null;storage.set('tem-grid-session:project',null)},
  applyRegionSettings(settings){context.restored=settings},rememberBasicControls(){},updateGridSizeNote(){},
  schedule(){},message(text){context.notice=text},reportJobError(){},updatePenaltyControls(){},
  drawGrid(){context.drawn=context.grid},isDiffraction:()=>false,hideRegionPreview(){},
  setTimeout(callback,delay){const token={};timers.set(token,{callback,delay});return token},clearTimeout(token){timers.delete(token)},
  async api(path,body){calls.push({path,body});if(path.startsWith('job?'))return current;return {}},
 });
 vm.runInContext(functions,context);
 return {context,$,storage,timers,calls,run:code=>vm.runInContext(code,context)};
}
async function main(){
 // An active job is discoverable even if the refresh happened before its POST reply.
 const live=setup();await live.run('openInitialImage()');
 assert.equal(live.context.fileId,image.id);assert.equal(live.context.filtersCleared,true);
 assert.equal(live.context.jobId,'same-job');assert.equal(live.context.grid.processed,1);
 assert.equal(live.context.restored.g_min,3.1);assert.equal(live.$('grid-count').value,4);
 assert.equal(live.$('grid-mode').value,'standard');assert.equal(live.$('adaptive').checked,true);
 assert.equal(live.$('check-passing').checked,true);assert.equal(live.$('grid-workers').value,0);
 assert.equal(live.$('run-grid').disabled,true);assert.equal(live.$('cancel-grid').disabled,false);
 assert.match(live.$('grid-status').textContent,/1 regions analysed.*15 pending.*running/);
 assert.equal(live.storage.get('tem-grid-session:project'),'same-job');
 assert.equal(live.calls.length,1);assert.equal(live.calls[0].path,'job?id=same-job');
 await live.$('cancel-grid').onclick();
 assert.equal(live.calls.at(-1).body.job_id,'same-job');
 assert.equal(live.$('cancel-grid').disabled,true);

 // Keep terminal results if this page owned them, including completion during reload.
 for(const state of ['complete','cancelled','error']){
  const terminal=setup(job(state),'same-job');await terminal.run('openInitialImage()');
  assert.equal(terminal.context.grid.state,state);assert.equal(terminal.$('run-grid').disabled,false);
  assert.equal(terminal.$('cancel-grid').disabled,true);assert.equal(terminal.timers.size,0);
 }
 const finished=setup();finished.context.api=async()=>job('complete');await finished.run('openInitialImage()');
 assert.equal(finished.context.grid.state,'complete');assert.equal(finished.timers.size,0);
 for(const state of ['complete','cancelled']){
  const cleared=setup(job(state));await cleared.run('openInitialImage()');
  assert.equal(cleared.context.grid,null);assert.equal(cleared.context.fileId,'other-image');assert.equal(cleared.calls.length,0);
 }
 const restarted=setup(null,'old-job');await restarted.run('openInitialImage()');
 assert.equal(restarted.context.jobId,null);assert.equal(restarted.storage.get('tem-grid-session:project'),null);

 const overlapping=job();overlapping.grid={mode:'overlap',size_mode:'image_percent',window_percent:15,window_nm:1.152,
  spacing_mode:'window_percent',spacing_percent:50,spacing_nm:.576,layout:'square',passes:9};
 const overlap=setup(overlapping);await overlap.run('openInitialImage()');
 for(const [id,value]of [['grid-mode','overlap'],['map-size-mode','image_percent'],['map-window-percent',15],
  ['map-spacing-mode','window_percent'],['map-spacing-percent',50],['map-layout','square'],['map-passes',9]])assert.equal(overlap.$(id).value,value);

 // An older image-open reply must not reclaim the page after the user switches image.
 const switched=setup();let openReply;
 switched.context.openFile=()=>{switched.context.sourceRequest++;return new Promise(resolve=>{openReply=resolve})};
 const opening=switched.run('openInitialImage()');switched.context.sourceRequest++;switched.context.fileId='user-choice';openReply();await opening;
 assert.equal(switched.context.jobId,null);assert.equal(switched.context.fileId,'user-choice');assert.equal(switched.calls.length,0);

 // Temporary connectivity loss keeps control of the job and retries; it does not allow a second grid.
 let reply;
 live.context.api=path=>path.startsWith('job?')?new Promise(resolve=>{reply=resolve}):Promise.resolve({});
 const stale=live.run("poll('same-job')");live.$('clear-grid').onclick();reply(job());await stale;
 assert.equal(live.context.grid,null);assert.equal(live.storage.get('tem-grid-session:project'),null);
 const retry=setup();retry.context.api=async()=>{throw new Error('offline')};await retry.run('openInitialImage()');
 assert.equal(retry.context.jobId,'same-job');assert.equal(retry.$('run-grid').disabled,true);
 assert.equal(retry.$('cancel-grid').disabled,false);assert.match(retry.$('grid-status').textContent,/reconnecting/);
 assert.equal([...retry.timers.values()][0].delay,2000);
 retry.context.api=async()=>job('complete');await retry.run("poll('same-job')");
 assert.equal(retry.context.grid.state,'complete');assert.equal(retry.timers.size,0);

 const absent=setup();absent.context.api=async()=>{throw Object.assign(new Error('This grid is no longer in memory.'),{status:400})};
 await absent.run('openInitialImage()');assert.equal(absent.context.jobId,null);assert.equal(absent.$('run-grid').disabled,false);
 assert.equal(absent.$('cancel-grid').disabled,true);assert.equal(absent.timers.size,0);

 // A missing/changed source still has progress and Cancel, but never a misleading map.
 for(const missing of [false,true]){
  const changed=setup();
  if(missing)changed.context.config.files=[{id:'other-image'}];
  else changed.context.openFile=async()=>{changed.context.sourceRequest++;changed.context.fileId=image.id;changed.context.meta={...image,sha256_pixels:'different'}};
  await changed.run('openInitialImage()');
  assert.equal(changed.context.grid,null);assert.equal(changed.context.restored,undefined);
  assert.equal(changed.$('cancel-grid').disabled,false);assert.match(changed.$('grid-status').textContent,/map hidden/);
 }
 console.log('Grid refresh recovery, completion, cancellation, source isolation and reconnect retries passed');
}
main().catch(error=>{console.error(error);process.exitCode=1});

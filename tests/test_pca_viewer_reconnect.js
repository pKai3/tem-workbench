const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('web/shared-spectra.js','utf8');
const helpers=source.slice(source.indexOf('  const viewerKey='),source.indexOf("  document.addEventListener('tem-image-opened'"));
function setup(){
 const fields=new Map(),$=id=>{if(!fields.has(id))fields.set(id,{value:'',setAttribute(){}});return fields.get(id)};
 const retained={job:{id:'retained',state:'running',automatic:true,operation:'support'},viewer:{file_id:'source-a',options:{method:'pca',components:4},fit_options:{peak_fraction:.35,workers:8},settings:{g_min:2.5,g_max:10,fft_window:'hann'}}};
 let saved={id:'retained',file_id:'source-a',open:true,section:'support',index:7,controls:{'pca-map-top':'2'}};
 const c=vm.createContext({$,config:{shared_spectra_pca:true,state_namespace:'test'},meta:{name:'Test'},fileId:'source-a',restoreEpoch:0,epoch:0,job:null,data:null,snapshot:null,pendingView:null,pipeline:null,pollTimer:null,
  context:'',cancelRequested:false,dialog:{open:false,showModal(){this.open=true}},document:{documentElement:{classList:{add(){}}}},
  isDiffraction:()=>false,sourceContext:()=> 'context',clearTimeout(){},setTimeout(){},clearResults(){c.data=null},controls(){},notify(text){c.notice=text},
  readPreference:()=>saved,writePreference(key,value){saved=value},api:async()=>retained,poll:async serial=>{c.polled=serial}
 });vm.runInContext(helpers,c);return {c,retained,run:s=>vm.runInContext(s,c)};
}
(async()=>{
 const other=setup();other.c.fileId='source-b';assert.equal(await other.run('reconnect({reopen:true})'),false);assert.equal(other.c.job,null);assert.equal(other.c.dialog.open,false);
 const running=setup();assert.equal(await running.run('reconnect({reopen:true})'),true);
 assert.equal(running.c.job.id,'retained');assert.equal(running.c.pipeline.stage,'support');assert.equal(running.c.snapshot.file_id,'source-a');assert.equal(running.c.dialog.open,true);assert.equal(running.c.pendingView.controls['pca-map-top'],'2');assert.equal(running.c.polled,running.c.epoch);
 assert.equal(running.c.$('pca-workers').value,'8','restore the worker choice used by the retained fit/map job');
 const stale=setup();let reply;stale.c.api=()=>new Promise(resolve=>reply=resolve);const promise=stale.run('reconnect({reopen:true})');stale.c.fileId='source-b';reply(stale.retained);await promise;assert.equal(stale.c.job,null);assert.equal(stale.c.dialog.open,false);
 const completed=setup();completed.retained.job.state='complete';await completed.run('reconnect()');assert.equal(completed.c.pipeline,null);assert.equal(completed.c.dialog.open,false);
 console.log('PCA viewer recovery: retained running/completed runs, saved selection, source binding and stale-response guard passed.');
})().catch(e=>{console.error(e);process.exitCode=1});

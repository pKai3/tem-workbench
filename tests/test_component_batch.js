const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const nodes=new Map(),requests=[],cards=[];
const element=()=>({value:'',checked:false,open:true,children:[],classList:{toggle(){}},append(...items){this.children.push(...items)},replaceChildren(){this.children=[]},querySelectorAll(){return []},scrollIntoView(){}});
const $=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id)};
let job={state:'idle'},deferred=null,fail=false;
const context=vm.createContext({$,fileId:'a',config:{component_batch:true},document:{createElement:element},
 setTimeout(){return 1},clearTimeout(){},setJobProgress(kind,data){cards.push({kind,...data})},reconnectJobProgress(){},
 api:async(path,body)=>{
  requests.push({path,body});
  if(path==='pca/batch/preview')return {files:[{id:'a',name:'Alpha',folder:'first'},{id:'b',name:'Beta',folder:'second'}]};
  if(path==='pca/batch/start')return job={id:'batch',state:'running',finished:0,total:2};
  if(path==='pca/batch/cancel')return job={...job,state:'cancelled'};
  if(deferred)return new Promise(resolve=>{deferred.resolve=resolve});
  if(fail)throw new Error('Offline');return job;
 },request:()=>({settings:{g_min:2.5},options:{workers:4,method:'pca'},fit_options:{combination_mode:'together'}})});
vm.runInContext(fs.readFileSync('web/component-batch.js','utf8')+'\nvar ui=createComponentBatch(request,()=>false,()=>{});',context);
(async()=>{
 await $('pca-batch-open').onclick();
 assert.equal($('pca-batch-count').textContent,'1 selected');
 $('pca-batch-search').value='second';$('pca-batch-search').oninput();$('pca-batch-select').onclick();
 assert.equal($('pca-batch-count').textContent,'2 selected');
 // An older status response cannot erase a newly started batch.
 deferred={};const old=context.ui.refresh();
 await $('pca-batch-start').onclick();
 assert.equal(context.ui.busy(),true);
 assert.equal($('pca-batch-start').disabled,true);
 const start=requests.find(r=>r.path==='pca/batch/start');
 assert.deepEqual([...start.body.file_ids],['a','b']);assert.equal(start.body.options.workers,4);
 deferred.resolve({state:'idle'});deferred=null;await old;
 assert.equal(context.ui.busy(),true);
 assert.equal(cards.at(-1).kind,'components');assert.equal(typeof cards.at(-1).openHandler,'function');
 fail=true;await context.ui.refresh();assert.match($('pca-batch-status').textContent,/reconnecting/);assert.equal(context.ui.busy(),true);
 fail=false;await $('pca-batch-cancel').onclick();
 assert.equal(requests.at(-1).body.id,'batch');assert.equal(context.ui.busy(),false);
 job={id:'batch',state:'complete',finished:2,total:2,manifest:'/output/batch.json',images:[{name:'Beta',state:'error',error:'No calibration'}]};
 await context.ui.refresh();
 assert.match($('pca-batch-status').textContent,/1 failed/);assert.equal($('pca-batch-cancel').disabled,true);
 assert.match($('pca-batch-results').children[0].textContent,/batch.json/);
 console.log('Component batches: selection, captured request, stale polling, reconnect, cancellation and failure reporting passed.');
})().catch(e=>{console.error(e);process.exitCode=1});

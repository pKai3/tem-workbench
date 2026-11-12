// Completed crystal fits remain inspectable during original-window validation.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('web/shared-spectra.js','utf8');
const slice=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to));
function setup(){
 const nodes=new Map(),requests=[],timers=[],pending=[];
 const element=()=>({hidden:false,value:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},replaceChildren(){},append(){},scrollIntoView(){},getContext(){return {}}});
 const $=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id)};
 const result={decomposition:'pca',components:[],plan:{count:4,g_min:2.5,g_max:10},mean:{image:'mean'},raw_mean:{image:'raw'},explained:.8,fit_status:'complete',fits:{completed:4,total:4,groups:[]}};
 const context=vm.createContext({assert,$,job:{id:'job',state:'running',operation:'support'},pipeline:{stage:'support'},data:result,
  selected:new Set(),section:'fits',index:0,epoch:1,groupEpoch:2,sampleEpoch:0,showAllSignals:true,snapshot:{file_id:'image'},sourceImage:null,
  PcaView:require('../web/shared-spectra.js'),Image:class{},document:{createElement:element},phaseColors:{},
  isPca:()=>true,sourceLabel:()=> 'PC 1+',showSection(section){context.section=section},controls(){},drawMap(){},showFits(){},showPhaseMaps(){},
  notify(message){context.notice=message},setTimeout(fn){timers.push(fn)},pollTimer:null,
  async api(path,body){requests.push({path,body});if(path==='pca/lobe')return new Promise(resolve=>pending.push(resolve));if(path.startsWith('pca/result'))return {...result,phase_support_status:'complete'};return context.nextJob},
 });
 vm.runInContext(slice('  const running=','  function controls()'),context);
 vm.runInContext(slice('  function showResult(','  async function startStage('),context);
 vm.runInContext(slice('  async function inspectGroup(','  function selectTopHypotheses('),context);
 return {context,$,requests,timers,pending,run:s=>vm.runInContext(s,context)};
}
async function main(){
 const live=setup();
 const opened=live.run("inspectGroup({component:0,side:'positive',components:[0]})");
 assert.equal(live.requests[0].path,'pca/lobe');assert.equal(live.$('nmf-group-detail').hidden,false);
 assert.equal(live.$('nmf-group-content').hidden,true);
 live.context.nextJob={id:'job',state:'running',operation:'support',stage:'Checking original windows',completed:2,total:4,elapsed_seconds:1};
 await live.run('poll(1)');assert.match(live.context.notice,/crystal fits ready/);assert.equal(live.timers.length,1);
 // The support result arrives while a source-detail request is still in flight.
 live.context.nextJob={...live.context.nextJob,state:'complete',completed:4};
 await live.run('poll(1)');
 assert.equal(live.context.pipeline,null);assert.equal(live.$('nmf-group-detail').hidden,false);
 live.pending[0]({peaks:[],phases:['BCC'],candidates:[],peak_fraction:.35,spectrum:{image:'spectrum'},g_max:10});await opened;
 assert.equal(live.$('nmf-group-content').hidden,false);
 assert.match(live.$('nmf-group-status').textContent,/0 detected profiles/);
 // Manual window checks and cancellation also keep source access available.
 for(const pipeline of [null,{stage:'support'}]){
  const c=setup();c.context.pipeline=pipeline;
  assert.equal(c.run('canInspect()'),true);
  await c.run('inspectGroup({},0)');assert.equal(c.requests.length,0,'unfinished original-window overlays remain gated');
 }
 for(const stage of ['fit','decomposition']){
  const c=setup();c.context.pipeline={stage};c.context.job.operation=stage;
  await c.run("inspectGroup({component:0,side:'positive'})");assert.equal(c.requests.length,0);
 }
 const replaced=setup();const old=replaced.run("inspectGroup({component:0,side:'positive'})");
 replaced.context.job={id:'new-job',state:'running'};replaced.context.groupEpoch++;
 replaced.pending[0]({});await old;assert.equal(replaced.$('nmf-group-content').hidden,true,'stale source replies cannot replace a new run');
 const refreshed=setup();refreshed.run('showResult(data)');assert.equal(refreshed.$('nmf-group-detail').hidden,true,'new fit results invalidate the old inspector');
 console.log('PCA stage access: early source inspection, live progress, completion preservation, mutation guards and stale replies passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1});

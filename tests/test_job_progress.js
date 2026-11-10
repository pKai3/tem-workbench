// Persistent, separately tracked grid/batch cards and navigation through the actual handlers.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {element}=require('./svg_fixture');
const source=fs.readFileSync('web/app.js','utf8'),controls=new Map(),timers=new Map();
function node(tag){const n=element(tag);n.dataset={};n.scrollIntoView=()=>{n.scrolled=true};return n}
const $=id=>{if(!controls.has(id))controls.set(id,node('div'));return controls.get(id)};
const body=node('body');body.append($('job-progress'));$('batch-live').hidden=false;
const context={$ ,document:{body,documentElement:{style:{setProperty(){}}},querySelectorAll:()=>[],createElement:node,addEventListener(){}},
 config:{files:[{id:'grid-image'},{id:'batch-a'},{id:'batch-b'}]},meta:{},fileId:'another-image',
 clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),ResizeObserver:class{observe(){}},
 setTimeout(fn,delay){const id={};timers.set(id,{fn,delay});return id},clearTimeout:id=>timers.delete(id),
 clearFileSearch(){context.searchCleared=true},async openFile(){context.fileId=$('file').value;context.opened=(context.opened||0)+1},
 reconnectGridToImage(){context.reconnected=true},message(text){context.message=text}};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('const jobProgressCards='),source.indexOf('function beginExport(')),context);
const run=s=>vm.runInContext(s,context);
const grid={id:'grid-1',state:'running',source:{id:'grid-image',name:'Grid source'},processed:2,pending:8};
context.updateGridProgress(grid);
assert.equal($('job-progress').hidden,false);assert.equal(timers.size,0,'Running progress never auto-clears');
assert.equal(run("jobProgressCards.get('grid').progress.value"),.2);
context.updateGridProgress({...grid,processed:3,pending:7});
assert.equal(run('jobProgressCards.size'),1,'Updates reuse the same clickable card');
const batch={state:'running',started_at:'batch-1',finished:1,total:3,selected_file_ids:['batch-a','batch-b','grid-image'],current:'Batch B',
 current_grid:{state:'running',processed:2,pending:2},live_grid:{source:{id:'batch-b',name:'Batch B'}}};
context.updateBatchProgress(batch);
assert.equal(run('jobProgressCards.size'),2);assert.equal(run("jobProgressCards.get('batch').progress.value"),.5);
context.reconnectJobProgress('batch');assert.equal(run("jobProgressCards.get('batch').detail.textContent"),'Reconnecting…');
assert.equal(timers.size,0);
(async()=>{
 await run("returnToJob('grid')");assert.equal(context.fileId,'grid-image');assert.equal(context.reconnected,true);assert.equal($('overview').scrolled,true);
 await run("returnToJob('batch')");assert.equal(context.fileId,'batch-b');assert.equal($('batch-panel').open,true);assert.equal($('batch-live').scrolled,true);
 context.updateBatchProgress({...batch,finished:2,current:'Next image',current_grid:null,live_grid:null});
 assert.equal(run("jobProgressCards.get('batch').data.sourceId"),'grid-image','A batch can be opened while its next image is loading');
 // Cancellation is separate from navigation and requires a second click.
 const calls=[];context.jobId='different-job';context.api=async(path,body)=>{calls.push({path,body});return batch};
 context.renderBatch=data=>context.updateBatchProgress(data);
 const opened=context.opened;await run("jobProgressCards.get('grid').cancel.onclick()");
 assert.equal(calls.length,0);assert.equal(run("jobProgressCards.get('grid').cancel.textContent"),'Confirm cancel');
 context.updateGridProgress({...grid,processed:4,pending:6});
 assert.equal(run("jobProgressCards.get('grid').cancel.textContent"),'Confirm cancel','Polling preserves an armed confirmation');
 await run("jobProgressCards.get('grid').cancel.onclick()");
 assert.deepEqual(calls.map(c=>[c.path,c.body.job_id]),[['cancel','grid-1']],'Cancel targets the card job, even while another image is open');
 assert.equal(context.opened,opened,'Cancel never navigates');assert.equal(run("jobProgressCards.get('grid').cancel.disabled"),true);
 await run("jobProgressCards.get('grid').cancel.onclick()");assert.equal(calls.length,1,'Pending cancellation cannot be submitted twice');
 await context.cancelProgressJob('batch');const confirmation=[...timers.entries()].find(([,t])=>t.delay===5000);
 timers.delete(confirmation[0]);confirmation[1].fn();
 assert.equal(run("jobProgressCards.get('batch').cancel.textContent"),'Cancel','Confirmation expires after five seconds');
 await context.cancelProgressJob('batch');await context.cancelProgressJob('batch');assert.equal(calls[1].path,'batch/cancel');
 context.updateGridProgress({...grid,state:'complete',processed:10,pending:0});
 assert.equal(timers.size,1);assert.equal([...timers.values()][0].delay,5000);
 context.updateGridProgress({...grid,state:'complete',processed:10,pending:0});assert.equal(timers.size,1);
 [...timers.values()][0].fn();assert.equal(run("jobProgressCards.has('grid')"),false);assert.equal($('job-progress').hidden,false);
 context.clearJobProgress('batch');assert.equal($('job-progress').hidden,true);
 context.updateGridProgress({...grid,state:'complete'});assert.equal(run('jobProgressCards.size'),0,'Reloading a finished map does not resurrect a notification');
 context.updateGridProgress({...grid,source:{id:'missing'}});await run("returnToJob('grid')");assert.match(context.message,/unavailable/);
 // HTTP failures must retry just like network failures, retaining the active card.
 context.batchPollTimer=null;context.batchRunning=true;context.isGridRunning=()=>false;context.isDiffraction=()=>false;context.syncBatchSelection=()=>{};
 context.fetch=async()=>({ok:false});context.renderBatch=data=>{context.batchRendered=data};
 vm.runInContext(source.slice(source.indexOf('async function pollBatch(){'),source.indexOf("$('batch-start').onclick=")),context);
 context.updateBatchProgress(batch);await context.pollBatch();
 assert.equal(context.batchRunning,true);assert.equal(run("jobProgressCards.has('batch')"),true);
 assert.equal([...timers.values()].some(t=>t.delay===3000),true);
 context.fetch=async()=>({ok:true,json:async()=>({state:'idle'})});await context.pollBatch();
 assert.equal(context.batchRunning,false);assert.equal(run("jobProgressCards.has('batch')"),false);assert.equal($('run-grid').disabled,false);
 console.log('Background progress: persistent runs, independent cards, live batch targets, navigation, retries and terminal cleanup passed.');
})().catch(error=>{console.error(error);process.exitCode=1});

/* Hover work must never restore, save or replace the current comparison. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/aztec-analysis.js','utf8');
const context={window:{},structuredClone,Date,console};vm.createContext(context);
vm.runInContext(source.slice(0,source.indexOf('window.createAztecAnalysis=')),context);
const entry={table:'KamMapImages',item:{name:'AB / ST',ids:['["/project.oipx","a"]'],signals:['KAM'],options:{mode:'signal',brightness:1,transpose:true,kam_sources:{}},aliases:{'["/project.oipx","a"]':'AB'},labelColours:{'["/project.oipx","a"]':'#aa5500'},crops:{'["/project.oipx","a"]':[.2,.7]}}};
const pending=[],calls=[];
const preview=context.window.aztecComparisonPreviews.create(snapshot=>{calls.push(snapshot);return new Promise((resolve,reject)=>pending.push({resolve,reject}))});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 const original=structuredClone(entry),first=preview(entry);entry.item.options.brightness=2;await tick();
 assert.equal(calls[0].item.options.brightness,1,'Queued work holds an independent snapshot');
 let wanted=true;const skipped=preview(entry,()=>wanted),latest=preview({...entry,table:'XrayMapImages'});wanted=false;await tick();assert.equal(calls.length,1,'Only one render runs at a time');
 pending.shift().resolve('first');assert.equal(await first,'first');assert.equal(await skipped,null);await tick();assert.equal(calls.length,2,'Obsolete queued hovers do not process data');
 pending.shift().resolve('latest');assert.equal(await latest,'latest');assert.equal(await preview(original),'first','Identical saved settings reuse their thumbnail');
 const changed=preview(entry);await tick();assert.equal(calls.length,3,'Changed settings invalidate the thumbnail');pending.shift().reject(new Error('Source unavailable'));await assert.rejects(changed,/Source unavailable/);
 const retry=preview(entry);await tick();pending.shift().resolve('retried');assert.equal(await retry,'retried','Failures neither cache nor block following requests');
 let renders=0;const bounded=context.window.aztecComparisonPreviews.create(async()=>String(++renders));for(let i=0;i<9;i++)await bounded({...entry,table:String(i)});await bounded({...entry,table:'0'});assert.equal(renders,10,'Old previews are evicted');

 const requests=[],exports=[],before=JSON.stringify(entry),id=entry.item.ids[0];
 Object.assign(context,{comparisonState:context.window.aztecComparisonState,api:async(action,body)=>{requests.push({action,body});return {rows:[{acquisition:id,sample_name:'fallback'}]}}});
 context.window.aztecExport={png:async settings=>{exports.push(settings);return 'map preview'}};
 vm.runInContext(source.slice(source.indexOf(' async function renderSavedComparison('),source.indexOf(' async function linePreview(')),context);
 assert.equal(await context.renderSavedComparison(entry),'map preview');
 assert.equal(requests[0].action,'process');assert.equal(requests[0].body.targets[0].source,'/project.oipx');assert.equal(requests[0].body.targets[0].acquisition,'a');assert.equal(requests[0].body.map_distributions,false);
 assert.equal(exports[0].names[id],'AB');assert.equal(exports[0].colours[id],'#aa5500');assert.deepEqual(exports[0].crops[id],[.2,.7]);assert.equal(exports[0].options.transpose,true);assert.equal(exports[0].maxSize,1000);assert.equal(JSON.stringify(entry),before);
 const ratio=structuredClone(entry);ratio.table='XrayMapImages';ratio.item.signals=['Ti K','V K'];Object.assign(ratio.item.options,{mode:'ratio',denominator:'Ti K',show_denominator:false});await context.renderSavedComparison(ratio);assert.deepEqual(Array.from(requests.at(-1).body.signals),['V K']);
 ratio.item.options.show_denominator=true;await context.renderSavedComparison(ratio);assert.deepEqual(Array.from(requests.at(-1).body.signals),['Ti K','V K']);
 context.api=async()=>({rows:[{error:'Moved source missing'}]});await assert.rejects(context.renderSavedComparison(entry),/Moved source missing/);
 await assert.rejects(context.renderSavedComparison({...entry,item:{ids:[],signals:[]}}),/No acquisitions/);

 // A preview renderer must not access the live workspace or install save hooks.
 context.window.addEventListener=()=>{throw new Error('Preview installed a save hook')};context.WorkbenchWorkspace={readRaw(){throw new Error('Preview read live settings')},writeRaw(){throw new Error('Preview wrote live settings')}};
 vm.runInContext(source.slice(source.indexOf('window.createAztecAnalysis=')),context);
 const isolated=context.window.createAztecAnalysis({previewOnly:true,state:{},$:()=>null});assert.equal(typeof isolated.linePreview,'function');
 console.log('Comparison previews isolate settings, serialize work, skip stale hovers, cache bounded thumbnails and preserve saved rendering choices.');
})().catch(error=>{console.error(error);process.exitCode=1});

// Live updates retain the displayed map, but never borrow another pool/run's map.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/shared-spectra.js','utf8');
const pending=[];
const context=vm.createContext({job:{id:'run'},aggregateView:null,aggregateKey:'',aggregateFamily:'',aggregatePending:'',aggregateError:'',aggregateEpoch:0,
 api(path,body){return new Promise((resolve,reject)=>pending.push({path,body,resolve,reject}))},drawPhaseMap(){}});
vm.runInContext(source.slice(source.indexOf('  function requestAggregate('),source.indexOf('  function aggregateCell(')),context);
const request=(count,ids=[0],generation='a')=>context.requestAggregate({generation,windows:Array(count)},ids,'phase');
const settle=async(record,value)=>{record.resolve(value);await Promise.resolve();await Promise.resolve()};
async function main(){
 assert.equal(request(1),null);
 const first={checked:1};await settle(pending.shift(),first);
 assert.equal(request(1),first);
 assert.equal(request(2),first,'keep the map visible while more windows are aggregated');
 const older=pending.shift();assert.equal(request(3),first);const newer=pending.shift();
 await settle(older,{checked:2});assert.equal(context.aggregateView,first,'late older updates cannot replace the current view');
 const third={checked:3};await settle(newer,third);assert.equal(request(3),third);
 assert.equal(request(3,[1]),null,'another hypothesis pool must not show old colours/support');
 const other=pending.shift();assert.equal(request(3),third,'returning to the current map cancels an obsolete request');
 assert.equal(context.aggregatePending,'');await settle(other,{checked:3,pool:1});assert.equal(context.aggregateView,third);
 assert.equal(request(4),third);pending.shift().reject(new Error('Connection interrupted'));await Promise.resolve();await Promise.resolve();
 assert.equal(context.aggregateError,'Connection interrupted');assert.equal(request(4),third,'errors retain the last valid map');assert.equal(pending.length,0,'do not spin on an error');
 assert.equal(request(4,[0],'b'),null,'a refit generation starts a new map');
 context.job={id:'new-run'};assert.equal(request(4),null,'another image/run cannot reuse the old map');
 console.log('PCA map refresh: stable live display, pool/run isolation, stale replies and errors passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1});

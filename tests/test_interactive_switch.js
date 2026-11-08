// Exercise the actual request functions with delayed replies and failures.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('web/app.js','utf8');
const start=source.indexOf('function abandonAnalysis(){');
const end=source.indexOf('\n}',source.indexOf('async function analyze(){'))+2;
async function scenario(failure){
 const context=vm.createContext({AbortController,assert,setTimeout,clearTimeout});
 vm.runInContext(`
 let generation=1,busy=false,pending=true,timer=null,meta={},drag=null,fileId='old',result=null,analysisController=null;
 let calls=[],renders=[],spinnerStops=0,errors=[];
 const settings=()=>({}),requestBody=()=>({file_id:fileId,settings:{}});
 const api=(path,body,signal)=>new Promise((resolve,reject)=>calls.push({resolve,reject,signal}));
 const renderResult=async data=>renders.push(data);
 const syncPeakEditControls=()=>{},syncSpectrumExportControls=()=>{};
 const isDiffraction=()=>false;
 const finishSpectrumLoading=()=>spinnerStops++;
 const message=text=>errors.push(text),$=()=>({});
 `+source.slice(start,end),context);
 await vm.runInContext(`
 (async()=>{
  const old=analyze();abandonAnalysis();generation++;fileId='new';pending=true;
  const current=analyze();assert.equal(calls.length,2);assert.equal(calls[0].signal.aborted,true);
  ${failure?"calls[0].reject(new Error('old failed'));":"calls[0].resolve('old result');"}
  await old;assert.equal(busy,true);assert.equal(spinnerStops,0);assert.equal(renders.length,0);assert.equal(errors.length,0);
  calls[1].resolve('new result');await current;
  assert.equal(result,'new result');assert.equal(renders.length,1);assert.equal(busy,false);assert.equal(spinnerStops,1);
 })()`,context);
}
(async()=>{await scenario(false);await scenario(true);console.log('File-switch request isolation passed');})().catch(e=>{console.error(e);process.exitCode=1});

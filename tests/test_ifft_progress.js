const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('web/fft-masking.js','utf8');
function fixture(){
 const nodes={};const $=id=>nodes[id]??=( {hidden:true,open:true,setAttribute(){},classList:{remove(){}}});
 let now=0,nextId=0;const timers=new Map(),requests=[];
 const ctx={$,snapshot:{file_id:'image',roi:{w:512,h:512}},masks:{mode:'keep',spots:[],keep_dc:false},serial:0,inFlight:false,exporting:false,wanted:true,timer:null,dragging:null,sourceLive:true,spectrumRaw:null,spectrumProcessed:null,extent:null,
 clone:v=>JSON.parse(JSON.stringify(v)),setTimeout:(fn,ms)=>{timers.set(++nextId,{fn,at:now+ms});return nextId},clearTimeout:id=>timers.delete(id),
 api:(_,body)=>new Promise((resolve,reject)=>requests.push({body,resolve,reject})),decodeSpectrumImage:async()=>({}),displaySpectrum(){},draw(){},status(){}};
 vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf(' let loadingTimer='),source.indexOf(' // Keep both square panes')),ctx);
 vm.runInContext(source.slice(source.indexOf(' async function pump()'),source.indexOf('\n let hover=')),ctx);
 return {ctx,nodes,requests,start:()=>vm.runInContext('pump()',ctx),advance(ms){now+=ms;for(const [id,t]of [...timers])if(t.at<=now){timers.delete(id);t.fn()}}};
}
const frame={images:{},extent:[-10,10,-10,10],input:'input',image:'filtered',rms:1};
async function flush(){for(let i=0;i<10;i++)await Promise.resolve()}
(async()=>{
 const f=fixture(),run=f.start();
 assert.equal(f.requests[0].body.preview_only,true);
 f.requests.shift().resolve(frame);await flush();
 assert.ok(f.ctx.spectrumRaw,'FFT displayed before inverse transform finishes');
 assert.equal(f.nodes['ifft-output'],undefined,'No reconstruction published yet');
 assert.equal(f.requests[0].body.preview_only,undefined);
 // Keep a request continuously in flight for more than a second, but deliver fresh frames.
 for(let i=0;i<12;i++){
  f.advance(120);assert.equal(f.nodes['ifft-loading'].hidden,true);
  f.ctx.wanted=true;f.requests.shift().resolve(frame);await flush();
  assert.equal(f.nodes['ifft-loading'].hidden,true,'Fresh frames prevent accumulated busy time showing spinner');
 }
 f.advance(399);assert.equal(f.nodes['ifft-loading'].hidden,true);
 f.advance(1);assert.equal(f.nodes['ifft-loading'].hidden,false,'Stalled reconstruction shows spinner');
 f.ctx.wanted=true;f.requests.shift().resolve(frame);await flush();
 assert.equal(f.nodes['ifft-loading'].hidden,true,'New frame clears an already-visible spinner');
 f.requests.shift().reject(Error('Test failure'));await run;
 assert.equal(f.nodes['ifft-loading'].hidden,true);f.advance(500);assert.equal(f.nodes['ifft-loading'].hidden,true);
 const stale=fixture(),staleRun=stale.start();stale.ctx.serial++;stale.requests.shift().resolve(frame);await staleRun;
 assert.equal(stale.ctx.spectrumRaw,null);assert.equal(stale.requests.length,0,'Obsolete source preview does not launch reconstruction');
 console.log('iFFT progress: staged FFT, continuous fresh frames, stalls, recovery, errors and stale sources passed.');
})().catch(e=>{console.error(e);process.exitCode=1});

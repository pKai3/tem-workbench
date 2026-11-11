const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('web/fft-masking.js','utf8');
const handler=source.slice(source.indexOf("$('ifft-detected').onclick=async"),source.indexOf("$('ifft-export').onclick="));
function fixture(){
 const nodes={'ifft-dialog':{open:true},'ifft-detected':{disabled:false}},calls=[];
 const context={$:id=>nodes[id],clone:v=>JSON.parse(JSON.stringify(v)),canonical:JSON.stringify,
 snapshot:{file_id:'image',roi:{x:0,y:0,w:512,h:512},settings:{fft_window:'tukey'}},
 detecting:false,detectionRun:0,observationKey:'',observations:[],masks:{spots:[]},selected:-1,
 defaults:()=>({radius:.5,feather:.1}),checkpoint(){},changed(){},status:message=>calls.push(message)};
 vm.createContext(context);vm.runInContext(handler,context);return {context,nodes,calls,click:()=>nodes['ifft-detected'].onclick()};
}
(async()=>{
 const f=fixture();let requests=0;
 f.context.api=async(name,body)=>{requests++;assert.equal(name,'spectrum-preview');assert.equal(body.roi.w,512);return {spectrum:{peaks:[{qx:3,qy:1},{qx:-3,qy:-1},{qx:0,qy:4}]}}};
 await f.click();assert.equal(requests,1);assert.equal(f.context.masks.spots.length,2);assert.equal(f.nodes['ifft-detected'].disabled,false);
 await f.click();assert.equal(requests,1,'Unchanged area reuses detections');assert.equal(f.context.masks.spots.length,2,'Pairs are deduplicated');
 for(const change of ['scope','close']){
  const f=fixture();let finish;f.context.api=()=>new Promise(resolve=>finish=resolve);const pending=f.click();
  assert.equal(f.nodes['ifft-detected'].disabled,true);
  if(change==='scope'){f.context.snapshot.roi.w=128;f.context.detectionRun++}else f.nodes['ifft-dialog'].open=false;
  finish({spectrum:{peaks:[{qx:3,qy:1}]}});await pending;assert.equal(f.context.masks.spots.length,0,'Discard obsolete detections');
 }
 const empty=fixture();empty.context.api=async()=>({spectrum:{peaks:[]}});await empty.click();assert.match(empty.calls[0],/No spots detected/);
 const failed=fixture();failed.context.api=async()=>{throw Error('Detection failed')};await failed.click();assert.equal(failed.nodes['ifft-detected'].disabled,false);assert.equal(failed.calls[0],'Detection failed');
 console.log('iFFT detection: full area, paired masks, reuse, stale scope/close, empty and failed detection passed.');
})().catch(e=>{console.error(e);process.exitCode=1});

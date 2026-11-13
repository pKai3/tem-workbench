// Exercise region gestures with the real scheduler and delayed fit responses.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {element}=require('./svg_fixture');
const source=fs.readFileSync('web/app.js','utf8');
function fixture(){
 const nodes=new Map(),listeners=new Map(),timers=new Map(),requests=[],renders=[];
 const $=id=>{if(!nodes.has(id)){
  const node=element('div');node.focus=()=>{};node.setPointerCapture=()=>{};
  node.addEventListener=(name,fn)=>listeners.set(name,fn);nodes.set(id,node);
 }return nodes.get(id)};
 const context=vm.createContext({$,AbortController,document:{querySelector:()=>$('previews')},
  DOMPoint:class{constructor(x,y){this.x=x;this.y=y}matrixTransform(){return this}},
  setTimeout(fn){const id={};timers.set(id,fn);return id},clearTimeout:id=>timers.delete(id),
  isDiffraction:()=>false,overlapPlanning:()=>false,
  rememberRegionSize(){},rememberDiffractionLocation(){},showLiveRegionCrop(){},updateStrengthMode(){},queueLiveRegionPreview(){},
  beginSpectrumLoading(){},finishSpectrumLoading(){},syncSpectrumExportControls(){},syncPeakEditControls(){},
  hideRegionPreview(){context.previewVisible=false},showDragRegionPreview(){context.previewVisible=true},
  api(path,body,signal){return new Promise(resolve=>requests.push({body,signal,resolve}))},
  async renderResult(data){context.result=data;renders.push(data)},message(error){throw Error(error)}});
 vm.runInContext(`
 let meta={width:1024,height:1024,pixel_x_nm:.02},roi={x:100,y:100,w:128,h:128};
 let generation=0,pending=false,busy=false,timer=null,drag=null,analysisController=null,fileId='source';
 const requestBody=()=>({file_id:fileId,roi:{...roi},settings:{}});
 `+fs.readFileSync('web/live-preview.js','utf8').match(/const sameRegion=[^\n]+/)[0]+
 source.slice(source.indexOf('function clamp('),source.indexOf('let rasterContext='))+
 source.slice(source.indexOf('function point(event)'),source.indexOf("$('overview').addEventListener('keydown'")),context);
 context.result={roi:{x:100,y:100,w:128,h:128}};
 return {context,requests,renders,timers,run:code=>vm.runInContext(code,context),
  gesture(name,x=150,y=150,id='roi-box'){
   listeners.get(name)({clientX:x,clientY:y,button:0,pointerId:1,target:{id,closest:()=>null},preventDefault(){}});
  },flush(){const [id,fn]=timers.entries().next().value;timers.delete(id);return fn()},
  async reply(index){requests[index].resolve({roi:requests[index].body.roi});await new Promise(resolve=>setImmediate(resolve))}
 };
}
(async()=>{
 // A stationary press/release and rounding-only motion retain the fit/overlays.
 for(const end of ['pointerup','pointercancel']){
  const f=fixture(),result=f.context.result;
  f.gesture('pointerdown');f.gesture('pointermove',150.1,150.2);f.gesture(end);
  assert.equal(f.run('generation'),0);assert.equal(f.context.result,result);
  assert.equal(f.requests.length,0);assert.equal(f.timers.size,0);
  assert.equal(f.context.previewVisible,false,'Release dismisses the drag crop');
 }
 // Release flushes the last changed region without invalidating it a second time.
 const queued=fixture();queued.gesture('pointerdown');queued.gesture('pointermove',160,170);
 assert.equal(queued.run('generation'),1);assert.equal(queued.context.result,null);
 queued.gesture('pointerup');assert.equal(queued.requests.length,1);assert.equal(queued.timers.size,0);
 assert.deepEqual({...queued.requests[0].body.roi},{x:110,y:120,w:128,h:128});
 assert.equal(queued.run('generation'),1);await queued.reply(0);
 assert.equal(queued.renders.length,1);assert.equal(queued.run('pending'),false);
 // A fit already in flight stays valid when the mouse is released.
 const active=fixture();active.gesture('pointerdown');active.gesture('pointermove',170,180);active.flush();
 active.gesture('pointerup');await active.reply(0);
 assert.equal(active.renders.length,1);assert.equal(active.requests.length,1);assert.equal(active.timers.size,0);
 // Pausing long enough to finish the fit, then releasing, also keeps that result.
 const done=fixture();done.gesture('pointerdown');done.gesture('pointermove',180,180);done.flush();await done.reply(0);
 const current=done.context.result;done.gesture('pointermove',180,180);done.gesture('pointerup');
 assert.equal(done.context.result,current);assert.equal(done.requests.length,1);assert.equal(done.timers.size,0);
 // Newer movement must still supersede an older request and fit the final box.
 const changed=fixture();changed.gesture('pointerdown');changed.gesture('pointermove',160,160);changed.flush();
 changed.gesture('pointermove',190,180);changed.gesture('pointerup');await changed.reply(0);
 assert.equal(changed.renders.length,0,'Old position must not render after release');
 changed.flush();await changed.reply(1);
 assert.equal(changed.renders.length,1);assert.equal(changed.context.result.roi.x,140);
 assert.equal(changed.requests.length,2);assert.equal(changed.timers.size,0);
 // Resize and image-edge clamping use actual pixel changes, not pointer travel.
 const resize=fixture();resize.gesture('pointerdown',228,228,'roi-handle');resize.gesture('pointermove',238,240);
 resize.gesture('pointerup');assert.equal(resize.requests[0].body.roi.w,140);await resize.reply(0);
 const edge=fixture();edge.run('roi.x=0;roi.y=0');edge.gesture('pointerdown',50,50);edge.gesture('pointermove',-20,-20);edge.gesture('pointerup');
 assert.equal(edge.requests.length,0);assert.equal(edge.run('generation'),0);
 // Clicking outside still relocates and fits the selected region.
 const outside=fixture();outside.gesture('pointerdown',500,500);outside.gesture('pointerup');
 assert.equal(outside.requests[0].body.roi.x,436);await outside.reply(0);assert.equal(outside.renders.length,1);
 console.log('No-op gestures, queued/in-flight/completed fits, resize and stale-region isolation passed.');
})().catch(error=>{console.error(error);process.exitCode=1});

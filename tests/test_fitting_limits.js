// Exercise drag events and image-local persistence without running the analysis engine.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/app.js','utf8');
const controls=new Map(),storage=new Map();
function $(id){if(!controls.has(id))controls.set(id,{value:id==='g-max'?'10':'3',dataset:{},events:{},addEventListener(name,fn){this.events[name]=fn},setPointerCapture(){},getScreenCTM(){return {inverse(){return {}}}}});return controls.get(id)}
const context={assert,$,meta:{sha256_pixels:'image-a',name:'A'},fileId:'a',result:{spectrum:{extent:[-10,10,-10,10]}},direct:false,diffractionSettings:{exclude_radius_nm_inv:2.5},invalidations:0,repaints:0,
 readPreference:(k,d)=>storage.get(k)??d,writePreference:(k,v)=>storage.set(k,v),
 clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),isDiffraction:()=>context.direct,
 hideSpectrumHover(){},hideCentreLoupe(){},rememberDiffraction(){},message(){},setTimeout:fn=>fn(),
 DOMPoint:class{constructor(x,y){this.x=x;this.y=y}matrixTransform(){return this}},
 invalidateAnalysisSettings(){context.invalidations++}};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('// Per-image fitting-band overrides'),source.indexOf('function clamp(v,min,max)')),context);
vm.runInContext('repaintFittingLimits=()=>{repaints++;syncFittingOverrideButtons()}',context);
const run=s=>vm.runInContext(s,context);
assert.equal(run('fittingLimitValue("inner",15,{inner:3,outer:10})'),9.9);
assert.equal(run('fittingLimitValue("outer",0,{inner:3,outer:10})'),4);
assert.equal(run('fittingLimitValue("outer",40,{inner:3,outer:10})'),30);
assert.equal(run('fittingLimitValue("inner",-.5,{inner:3,outer:10})'),0);
assert.equal(run('validFittingLimits({inner:10,outer:10})'),false);
const host=$('fft'),handle={dataset:{fittingHandle:'outer'}};
function event(x){return {clientX:x,clientY:210,button:0,pointerId:1,target:{closest:()=>handle},preventDefault(){},stopImmediatePropagation(){}}}
host.events.pointerdown(event(400));host.events.pointerup(event(400));
assert.equal(run('fittingLimitsLocal'),false,'Click without dragging must not create local changes');
host.events.pointerdown(event(400));host.events.pointermove(event(405.46));
assert.equal(Number($('g-max').value),10.3);assert.equal(context.invalidations,0);
host.events.pointerup(event(405.46));assert.equal(context.invalidations,1);
assert.equal(storage.size,0,'Dragging must not silently save or alter shared preferences');
host.events.pointerdown(event(400));host.events.pointermove(event(421));host.events.pointercancel(event(421));
assert.equal(Number($('g-max').value),10.3);assert.equal(context.invalidations,1);
$('save-fitting-override').onclick();assert.deepEqual(JSON.parse(JSON.stringify(storage.get('tem-fitting-limits:image-a'))),{inner:3,outer:10.3});
context.meta={sha256_pixels:'image-b',name:'B'};assert.equal(run('savedFittingLimits()'),null);
context.meta={sha256_pixels:'image-a',name:'A'};run('setFittingLimits({inner:1,outer:12});restoreFittingLimits()');
assert.equal(Number($('g-max').value),10.3);assert.equal(Number($('fft-g-min').value),3);
storage.set('tem-basic-settings',{'g-max':9,'fft-g-min':2});$('remove-fitting-override').onclick();
assert.equal(run('savedFittingLimits()'),null);assert.equal(Number($('g-max').value),9);assert.equal(Number($('fft-g-min').value),2);
context.direct=true;run('setFittingLimits({inner:2.1,outer:11.2})');
assert.equal(context.diffractionSettings.exclude_radius_nm_inv,2.1);assert.equal($('diff-radius').value,'2.1');
console.log('Fitting limits: quantization, bounds, release-only analysis, cancellation, image isolation and override removal passed.');

// Live peak-overlay refresh must preserve radius handles on both images.
// Export cleanup deliberately removes them, but must not be reused for live UI.
const liveNodes=new Map();
for(const id of ['overview','fft']){
 const nodes=[{kind:'handle',remove(){this.removed=true}},{kind:'snap',remove(){this.removed=true}}];
 liveNodes.set(id,nodes);
 $(id).querySelectorAll=selector=>nodes.filter(n=>!n.removed&&((n.kind==='snap'&&selector.includes('.manual-snap-overlay'))||(n.kind==='handle'&&selector.includes('[data-fitting-handle]'))));
 $(id).append=()=>{};
}
$('fft-zoom-view').querySelector=()=>null;
context.el=()=>({append(){}});
context.editSnapshot=()=>({settings:{diffraction:{pixel_x_nm_inv:.01,pixel_y_nm_inv:.01}},spectrum:{extent:[-10,10,-10,10],beam_center_px:[200,200]}});
context.peakEditing=()=>false;
context.diffractionSettings={pixel_x_nm_inv:.01,pixel_y_nm_inv:.01,peak_edits:[]};
vm.runInContext(source.slice(source.indexOf('function drawSnapOverlays(){'),source.indexOf('async function finishRadiusDrag')),context);
for(const direct of [false,true]){
 context.direct=direct;
 for(const nodes of liveNodes.values())for(const node of nodes)node.removed=false;
 run('drawSnapOverlays()');
 for(const [id,nodes] of liveNodes){
  assert.equal(Boolean(nodes[0].removed),false,`${id} radius handle survives ${direct?'diffraction':'FFT'} refresh`);
  assert.equal(nodes[1].removed,true,`${id} stale peak-edit overlay is removed`);
 }
}
console.log('Live FFT/diffraction overlay refresh preserves fitting-radius handles.');

// The visible grip points along the radius; its unrotated target is enlarged.
context.el=(tag,attrs={},text)=>({tag,attrs,text,children:[],append(...nodes){this.children.push(...nodes)}});
const gripRoot={children:[],append(node){this.children.push(node)}};
context.gripRoot=gripRoot;
run('fittingLimitHandle(gripRoot,"outer",100,80,10,-45)');
const gripHandle=gripRoot.children[0],target=gripHandle.children[1],grip=gripHandle.children[2];
assert.equal(grip.attrs.transform,'rotate(-45 100 80)');
assert.equal(target.attrs.width/grip.children[0].attrs.width,1.3);
assert.equal(target.attrs.height/grip.children[0].attrs.height,1.3);
assert.equal(grip.attrs['pointer-events'],'none');
console.log('Radius grip orientation and enlarged hit area passed.');

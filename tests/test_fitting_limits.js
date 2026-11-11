// Exercise drag events and image-local persistence without running the analysis engine.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/app.js','utf8');
const controls=new Map(),storage=new Map();
function $(id){if(!controls.has(id))controls.set(id,{value:id==='g-max'?'10':'3',dataset:{},events:{},addEventListener(name,fn){this.events[name]=fn},setPointerCapture(){},getScreenCTM(){return {inverse(){return {}}}}});return controls.get(id)}
const context={assert,$,meta:{sha256_pixels:'image-a',name:'A'},fileId:'a',result:{spectrum:{extent:[-10,10,-10,10]}},direct:false,diffractionSettings:{exclude_radius_nm_inv:2.5},invalidations:0,repaints:0,
 readPreference:(k,d)=>storage.get(k)??d,writePreference:(k,v)=>storage.set(k,v),
 clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),isDiffraction:()=>context.direct,
 hideSpectrumHover(){},hideCentreLoupe(){},rememberDiffraction(){},syncDetectorControls(){},message(){},setTimeout:fn=>fn(),reciprocalUnit:()=> 'nm⁻¹',
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
assert.equal(run('savedFittingLimits()'),null);assert.equal(Number($('g-max').value),10);assert.equal(Number($('fft-g-min').value),2.5);
context.direct=true;run('setFittingLimits({inner:2.1,outer:11.2})');
assert.equal(context.diffractionSettings.exclude_radius_nm_inv,2.1);assert.equal($('diff-radius').value,'2.1');
// A -> unsaved B -> A must resolve the new image's limits in either mode.
for(const direct of [false,true]){
 context.direct=direct;
 context.meta={sha256_pixels:'saved-band',name:'Saved'};
 storage.set('tem-fitting-limits:saved-band',{inner:1.2,outer:6});
 run('restoreFittingLimits()');
 assert.equal(run('currentFittingLimits().outer'),6);
 context.meta={sha256_pixels:'no-band',name:'No override'};
 run('restoreFittingLimits()');
 assert.equal(run('currentFittingLimits().outer'),10);
 assert.equal(run('currentFittingLimits().inner'),2.5);
 assert.equal(run('fittingLimitsLocal'),false);
 context.meta={sha256_pixels:'saved-band',name:'Saved'};
 run('restoreFittingLimits()');
 assert.equal(run('currentFittingLimits().inner'),1.2);
 assert.equal(run('currentFittingLimits().outer'),6);
}
// Numeric edits must become local before the shared-settings persistence callback.
for(const id of ['fft-g-min','diff-radius','g-max']){
 run('fittingLimitsLocal=false');$(id).events.input();
 assert.equal(run('fittingLimitsLocal'),true,`${id} input is image-local`);
}
context.BASIC_NUMBERS={'fft-g-min':[0,29.9],'g-max':[4,30]};context.BASIC_FLAGS=[];
context.OVERLAY_MODES=[];context.enabledPhases=['HCP'];
context.validControlNumber=(id,value)=>Number.isFinite(value)&&value>=context.BASIC_NUMBERS[id][0]&&value<=context.BASIC_NUMBERS[id][1];
vm.runInContext(source.slice(source.indexOf('function rememberBasicControls(){'),source.indexOf('function rememberRegionSize(){')),context);
context.direct=false;context.meta={sha256_pixels:'typed-band',name:'Typed'};
run('restoreFittingLimits()');
$('g-max').value='7';$('g-max').events.input();run('rememberBasicControls()');
$('fft-g-min').value='1';$('fft-g-min').events.input();run('rememberBasicControls()');
$('save-fitting-override').onclick();
assert.equal(storage.get('tem-basic-settings')['g-max'],9);
assert.equal(storage.get('tem-basic-settings')['fft-g-min'],2);
context.meta={sha256_pixels:'no-band',name:'No override'};run('restoreFittingLimits()');
assert.equal(run('currentFittingLimits().outer'),10);
assert.equal(run('currentFittingLimits().inner'),2.5);
// Save is meaningful only when the live band differs from saved values or defaults.
for(const direct of [false,true]){
 context.direct=direct;context.meta={sha256_pixels:'button-'+direct,name:'Buttons'};
 run('restoreFittingLimits()');assert.equal($('save-fitting-override').disabled,true);
 run('setFittingLimits({inner:2.5,outer:9});syncFittingOverrideButtons()');
 assert.equal($('save-fitting-override').disabled,false);
 assert.equal($('save-fitting-override').textContent,'Save override');
 // Returning to defaults, including a reset, removes the unsaved state.
 run('setFittingLimits(defaultFittingLimits());fittingLimitsLocal=true;syncFittingOverrideButtons()');
 assert.equal($('save-fitting-override').disabled,true);
 assert.equal($('fitting-override-status').textContent,'');
 run('setFittingLimits({inner:2.5,outer:9})');$('save-fitting-override').onclick();
 assert.equal($('save-fitting-override').disabled,true);
 // Persistence key order must not change equality.
 storage.set('tem-fitting-limits:button-'+direct,{outer:9,inner:2.5});
 run('restoreFittingLimits()');assert.equal($('save-fitting-override').disabled,true);
 run('setFittingLimits(defaultFittingLimits());syncFittingOverrideButtons()');
 assert.equal($('save-fitting-override').disabled,false);
 assert.equal($('save-fitting-override').textContent,'Update override');
 $('remove-fitting-override').onclick();assert.equal($('save-fitting-override').disabled,true);
}
console.log('Fitting limits: quantization, bounds, release-only analysis, cancellation, image isolation and override removal passed.');

// Direct-image handle placement remembers radius and angle, but angle never changes the fit.
context.direct=true;context.meta={sha256_pixels:'polar-image',name:'Polar'};context.fileId='polar';
context.diffractionSettings={center_x:500,center_y:400,pixel_x_nm_inv:.02,pixel_y_nm_inv:.04,exclude_radius_nm_inv:2.5};
context.effectiveDetector=()=>context.diffractionSettings;
run('restoreFittingLimits()');
const detector=$('overview'),innerHandle={dataset:{fittingHandle:'inner'}};
function polarEvent(radius,degrees){const theta=degrees*Math.PI/180;return {...event(500+radius*Math.cos(theta)/.02),clientY:400-radius*Math.sin(theta)/.04,target:{closest:()=>innerHandle}}}
const polarInvalidations=context.invalidations;
detector.events.pointerdown(polarEvent(2.5,90));detector.events.pointermove(polarEvent(2.5,127));
assert.equal(run('Math.round(fittingHandleAngles.inner*180/Math.PI)'),120,'Theta snaps to absolute 15-degree increments');
assert.equal(storage.has('tem-fitting-limits:polar-image'),false,'Do not save unfinished drags');
detector.events.pointerup(polarEvent(2.5,127));
assert.equal(context.invalidations,polarInvalidations,'Angle-only drag does not invalidate fits');
let saved=storage.get('tem-fitting-limits:polar-image');
assert.equal(saved.inner,2.5);assert.equal(saved.outer,10);assert.equal(Math.round(saved.handle_angles.inner*180/Math.PI),120);
detector.events.pointerdown(polarEvent(2.5,120));detector.events.pointermove(polarEvent(3.24,182));detector.events.pointerup(polarEvent(3.24,182));
saved=storage.get('tem-fitting-limits:polar-image');assert.equal(saved.inner,3.2);assert.equal(Math.round(saved.handle_angles.inner*180/Math.PI),180);
assert.equal(context.invalidations,polarInvalidations+1,'Radial drag recalculates once on release');
detector.events.pointerdown(polarEvent(3.2,180));detector.events.pointermove(polarEvent(4,273));detector.events.pointercancel(polarEvent(4,273));
assert.equal(run('currentFittingLimits().inner'),3.2);assert.equal(run('Math.round(fittingHandleAngles.inner*180/Math.PI)'),180);
assert.equal(storage.get('tem-fitting-limits:polar-image'),saved,'Cancellation leaves storage unchanged');
// Cross the 360/0 seam and use keyboard angle steps without changing radius.
detector.querySelector=()=>({focus(){}});
detector.events.keydown({...polarEvent(3.2,180),key:'ArrowRight',shiftKey:true});
assert.equal(run('Math.round(fittingHandleAngles.inner*180/Math.PI)'),195);
assert.equal(context.invalidations,polarInvalidations+1);
assert.equal(run('snappedFittingAngle(-Math.PI/36)'),0);
assert.equal(run('snappedFittingAngle(2*Math.PI-Math.PI/36)'),0);
context.meta={sha256_pixels:'different-image'};run('restoreFittingLimits()');
assert.equal(run('fittingHandleAngles.inner'),Math.PI/2);assert.equal(run('currentFittingLimits().inner'),2.5);
context.meta={sha256_pixels:'polar-image'};run('restoreFittingLimits()');
assert.equal(run('Math.round(fittingHandleAngles.inner*180/Math.PI)'),195);assert.equal(run('currentFittingLimits().inner'),3.2);
context.direct=false;run('restoreFittingLimits()');assert.equal(run('fittingHandleAngles.inner'),Math.PI/2,'Direct handle angles do not leak into FFT');
context.direct=true;run('restoreFittingLimits()');$('remove-fitting-override').onclick();
assert.equal(run('fittingHandleAngles.inner'),Math.PI/2);assert.equal(run('currentFittingLimits().inner'),2.5);
storage.set('tem-fitting-limits:polar-image',{inner:1,outer:9,handle_angles:{inner:'bad',outer:Infinity}});run('restoreFittingLimits()');
assert.equal(run('fittingHandleAngles.inner'),Math.PI/2);assert.equal(run('fittingHandleAngles.outer'),Math.PI/4);
assert.equal(run('currentFittingLimits().inner'),1,'Malformed display angles do not discard a valid radius override');
console.log('Polar handles: anisotropic coordinates, 15-degree snapping, automatic image persistence, angle-only display updates and cancellation passed.');

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
context.syncSpectrumHoverRadii=()=>{};context.syncCentreLoupeOverlays=()=>{};context.syncDetectorToolIndicators=()=>{};
context.diffractionSettings={pixel_x_nm_inv:.01,pixel_y_nm_inv:.01,peak_edits:[]};
vm.runInContext(source.slice(source.indexOf('function appendRadiusEditControls('),source.indexOf('async function finishRadiusDrag')),context);
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

// FFT reset must restore the band even when no detector setting changed.
context.direct=false;context.FFT_DETECTOR_CONTROLS={};context.updateStrengthMode=()=>{};context.updateFFTWindowControls=()=>{};
vm.runInContext(source.slice(source.indexOf('function resetFFTControls(){'),source.indexOf("$('reset-fft').onclick=")),context);
context.meta={sha256_pixels:'reset-band',name:'Reset'};
storage.set('tem-fitting-limits:reset-band',{inner:1,outer:6});
storage.set('tem-basic-settings',{'fft-g-min':1,'g-max':6});
run('restoreFittingLimits()');$('threshold').value=.35;
$('fft-window').value='tukey';$('fft-tukey-alpha').value=.5;$('fft-mean').checked=true;
$('fft-strength-mode').value='manual';
const beforeReset=context.invalidations;run('resetFFTControls()');
assert.equal(run('currentFittingLimits().outer'),10);assert.equal(run('currentFittingLimits().inner'),2.5);
assert.equal(context.invalidations,beforeReset+1);
assert.equal(storage.get('tem-basic-settings')['g-max'],10);
assert.equal(storage.get('tem-basic-settings')['fft-g-min'],2.5);
assert.equal(storage.get('tem-fitting-limits:reset-band').outer,6,'Explicit saved image override is retained');
assert.equal($('save-fitting-override').textContent,'Update override');
context.meta={sha256_pixels:'reset-next',name:'Next'};run('restoreFittingLimits()');
assert.equal(run('currentFittingLimits().outer'),10);
console.log('FFT reset restores and remembers the 2.5–10 band without deleting image overrides.');

// Exercise the real asynchronous file-switch flow with stale shared/detector memory.
// The metadata/API and drawing are stubbed; openFile and radius restoration are real.
vm.runInContext(source.slice(source.indexOf('async function openFile(){'),source.indexOf('\nfunction point(event)')),context);
Object.assign(context,{
 config:{files:[{id:'override-fft'},{id:'plain-fft'},{id:'override-direct'},{id:'plain-direct'}]},
 sourceRequest:0,generation:0,rescoreRevision:0,rescoreTimer:null,jobId:null,preferredRegionNm:7,
 hoverCache:new Map(),clearTimeout(){},document:{body:{classList:{remove(){}}}},
 reconnectGridToImage(){},rememberGrid(){},lastImageKey:()=> 'last-image',isGridRunning:()=>false,reciprocalUnit:()=> 'nm⁻¹',renderFileList(){},
 api:async(path,{file_id:id})=>({sha256_pixels:id,name:id,width:100,height:100,pixel_x_nm:.1,pixel_x_nm_inv:.01,pixel_y_nm_inv:.01,device:'test'}),
 setupImageKind(){context.direct=context.meta.name.endsWith('direct');context.diffractionSettings={exclude_radius_nm_inv:1.1}},
 schedule(){context.submittedLimits=JSON.parse(JSON.stringify(run('currentFittingLimits()')))}
});
for(const name of ['updateFileNavigation','abandonAnalysis','scheduleOverlapPreview','syncMapLoading','finishSpectrumLoading','clearSpectrumDisplay','beginSpectrumLoading','hideRegionPreview','syncSpectrumExportControls','resetRegionEditor','renderSavedRegions','renderFavorites','drawGrid','restoreCalibration','updateGridSizeNote','updateBox'])context[name]=()=>{};
for(const id of ['overview','source-image'])$(id).setAttribute=()=>{};
(async()=>{
 storage.set('tem-basic-settings',{'fft-g-min':1.1,'g-max':6});
 for(const id of ['override-fft','override-direct'])storage.set('tem-fitting-limits:'+id,{inner:1.1,outer:6});
 for(const id of ['override-fft','plain-fft','override-direct','plain-direct','plain-fft','override-fft']){
  $('file').value=id;await run('openFile()');
  const override=id.startsWith('override');
  assert.deepEqual(context.submittedLimits,{inner:override?1.1:2.5,outer:override?6:10},'Analysis receives the correct limits after opening '+id);
 }
 context.jobId='background-grid';context.isGridRunning=()=>true;
 const originalApi=context.api,calls=[];context.api=async(path,body)=>{calls.push(path);return originalApi(path,body)};
 $('file').value='plain-fft';await run('openFile()');
 assert.equal(context.jobId,'background-grid');assert.equal(calls.includes('cancel'),false,'Opening a different image never cancels a background grid');
 assert.equal(storage.get('last-image'),'plain-fft','Only a successfully opened image is remembered');
 console.log('Asynchronous image switching ignores contaminated legacy settings in FFT and diffraction, including cross-mode switches.');
})().catch(error=>{console.error(error);process.exitCode=1});

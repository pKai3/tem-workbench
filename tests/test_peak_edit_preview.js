// Exercise actual hover and overlay functions against displayed/stale snapshots.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/app.js','utf8'),controls=new Map(),timers=new Map();let next=0;
const {element}=require('./svg_fixture');
function $(id){if(!controls.has(id))controls.set(id,element(id));return controls.get(id)}
$('fft').tag='svg';
const snapshot={settings:{diffraction:{pixel_x_nm_inv:.02,pixel_y_nm_inv:.02}},spectrum:{extent:[-10,10,-10,10],beam_center_px:[256,256]}};
const context={$,result:snapshot,displayed:snapshot,fftRaw:{},busy:false,pending:false,spectrumLoading:false,
 mode:'view',peakEditing:()=>['add','remove'].includes(context.mode),editSnapshot:()=>context.result||context.displayed,
 isDiffraction:()=>true,reciprocalUnit:()=> 'rel.',meta:{width:512},innerWidth:1200,innerHeight:900,
 document:{body:{append(){}}},DOMPoint:class{constructor(x,y){this.x=x;this.y=y}matrixTransform(){return this}},
 clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),setTimeout(fn){timers.set(++next,fn);return next},clearTimeout:id=>timers.delete(id),
 requestAnimationFrame(fn){timers.set(++next,fn);return next},cancelAnimationFrame:id=>timers.delete(id)};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function spectrumOverlaysVisible('),source.indexOf('function syncSpectrumOverlays(')),context);
vm.runInContext(source.slice(source.indexOf('function detectorToolLabel('),source.indexOf('function clonePreviewOverlay(')),context);
vm.runInContext(source.slice(source.indexOf('function clonePreviewOverlay('),source.indexOf('function prepareCentreLoupe(')),context);
vm.runInContext(source.slice(source.indexOf('let spectrumHoverTimer='),source.indexOf("for(const id of ['fft','fft-zoom-view']){\n $(id).addEventListener('pointermove',hoverSpectrum)")),context);
function hover(extra={}){context.hoverSpectrum({currentTarget:$('fft'),clientX:200,clientY:100,pointerType:'mouse',buttons:0,...extra});for(const [id,fn] of [...timers]){timers.delete(id);fn()}}
for(const mode of ['view','add','remove']){
 context.mode=mode;$('diff-tool').value=mode;context.result=snapshot;context.busy=context.pending=context.spectrumLoading=false;
 hover();assert.equal($('spectrum-hover').hidden,false,mode+' retains hover');
 assert.match($('spectrum-hover-coords').textContent,/rel\./);
 context.hideSpectrumHover();
}
hover({clientX:350,clientY:400});
assert.equal($('spectrum-hover').style.left,'62px','Right preview opens inward, to the left');
assert.equal($('spectrum-hover').style.top,'62px','Right preview opens above the pointer');
hover({clientX:295,clientY:346});assert.equal($('spectrum-hover').style.left,'8px');assert.equal($('spectrum-hover').style.top,'8px');
hover({clientX:296,clientY:347});assert.equal($('spectrum-hover').style.left,'8px');assert.equal($('spectrum-hover').style.top,'9px','Edge clamp has no direction jump');
// schedule() clears result while fitting, but editing retains displayed coordinates.
context.mode='add';context.result=null;context.busy=context.pending=context.spectrumLoading=true;
hover();assert.equal($('spectrum-hover').hidden,false,'Editing preview uses the displayed snapshot while fitting');
hover({buttons:1});assert.equal($('spectrum-hover').hidden,false,'Editing presses retain the loupe');
context.pressSpectrumPreview({currentTarget:$('fft'),clientX:200,clientY:100,pointerType:'mouse',buttons:1});
assert.equal($('spectrum-hover').hidden,false,'Click does not blank a visible preview');
context.mode='view';hover();assert.equal($('spectrum-hover').hidden,true,'Ordinary stale analysis is not presented as current');
context.mode='remove';context.displayed=null;hover();assert.equal($('spectrum-hover').hidden,true,'File switches clear the old preview');

const zoom=element('svg');$('fft-zoom-view').append(zoom);
context.displayed=snapshot;context.diffractionSettings={...snapshot.settings.diffraction,peak_edits:[
 {action:'add',x:100,y:100,snap_radius_nm_inv:.5},{action:'remove',x:200,y:200,radius_nm_inv:.4}]};
context.radiusDrag=context.snapPointer=null;context.savedSnapRadius=edit=>edit.snap_radius_nm_inv;context.savedRemovalRadius=edit=>edit.radius_nm_inv;
context.el=element;
vm.runInContext(source.slice(source.indexOf('function appendRadiusEditControls('),source.indexOf('async function finishRadiusDrag')),context);
for(const root of [$('overview'),$('fft'),zoom])root.append(element('fitting-handle',{'data-fitting-handle':'outer'}));
for(const mode of ['view','add','remove','center','mask','view']){
 context.mode=mode;$('diff-tool').value=mode;context.drawSnapOverlays();
 assert.equal($('overview').querySelectorAll('.manual-snap-overlay').length,1,'Detector always retains edit areas');
 for(const root of [$('fft'),zoom]){
  assert.equal(root.querySelectorAll('.manual-snap-overlay').length,['add','remove'].includes(mode)?1:0,mode+' pattern visibility');
  assert.equal(root.children.some(n=>n.attrs['data-fitting-handle']),true,'Fitting handles survive mode changes');
 }
}
// Both saved radii and the moving cursor radius appear in the loupe without handles.
context.mode='add';$('diff-tool').value='add';$('diff-snap').checked=true;$('diff-snap-radius').value=.6;
context.snapPointer={svg:$('fft'),x:230,y:180};context.drawSnapOverlays();hover();
let radii=$('spectrum-hover-edits').querySelectorAll('ellipse');
assert.equal(radii.length,3);assert.equal(radii[2].attrs.rx,12.6);
assert.equal($('spectrum-hover-edits').querySelectorAll('.snap-radius-handle,title,[id],[tabindex],[role]').length,0);
assert.equal($('spectrum-hover-edits').querySelectorAll('[data-delete-peak-edit]').length,2,'Saved edit × controls remain visible in the pattern preview');
for(const original of $('fft').querySelectorAll('[data-delete-peak-edit]')){
 const copy=$('spectrum-hover-edits').querySelectorAll('[data-delete-peak-edit]').find(node=>node.attrs['data-delete-peak-edit']===original.attrs['data-delete-peak-edit']);
 assert.equal(copy.attrs.transform,undefined,'Pattern preview does not shrink the × relative to its hitbox');
 assert.deepEqual(copy.querySelector('rect').attrs,original.querySelector('rect').attrs);
}
assert.equal($('fft').querySelectorAll('.snap-radius-handle').length,4,'Cloning does not alter live handles');
context.snapPointer.x=240;context.drawSnapOverlays();
assert.notEqual($('spectrum-hover-edits').querySelectorAll('ellipse')[2].attrs.cx,radii[2].attrs.cx,'Moving the cursor updates the preview ring');
$('diff-snap').checked=false;context.drawSnapOverlays();
assert.equal($('spectrum-hover-title').textContent,'Add peak · snap off');
assert.equal($('spectrum-hover-edits').querySelectorAll('ellipse').length,2,'Turning snapping off keeps saved edit rings but removes the cursor radius');
for(const root of [$('overview'),$('fft'),zoom]){
 context.snapPointer.svg=root;context.drawSnapOverlays();
 assert.equal(root.querySelectorAll('[data-hover-peak-radius]').length,0,'No unsnapped cursor ring on either image or enlarged view');
 assert.equal(root.querySelectorAll('[data-delete-peak-edit]').length,2,'Saved edit controls are preserved');
}
context.snapPointer.svg=$('fft');$('diff-snap').checked=true;context.drawSnapOverlays();
assert.equal($('spectrum-hover-edits').querySelectorAll('[data-hover-peak-radius]').length,1,'Re-enabling snapping restores the live preview ring');
$('diff-snap').checked=false;
context.mode='remove';$('diff-tool').value='remove';$('diff-dedupe-radius').value=.4;context.drawSnapOverlays();
assert.equal($('spectrum-hover-edits').querySelectorAll('ellipse')[2].attrs.rx,8.4);
assert.equal($('spectrum-hover-title').textContent,'Remove peak');
// A result redraw replaces the enlarged SVG; the active hover must follow it.
$('fft-zoom').open=true;context.radiusDrag=null;context.syncSpectrumLegendZoom=()=>{};
vm.runInContext(source.slice(source.indexOf('function syncFFTZoom(){'),source.indexOf('function openFFTZoom(){')),context);
hover({currentTarget:$('fft-zoom-view')});context.snapPointer.svg=zoom;
context.syncFFTZoom();context.showSpectrumHover();
const replacement=$('fft-zoom-view').querySelector('svg');
assert.notEqual(replacement,zoom);assert.equal(context.snapPointer.svg,replacement);
assert.equal(vm.runInContext('spectrumHoverPointer.source',context),replacement);
assert.equal($('spectrum-hover').hidden,false,'Fresh enlarged results retain the preview without pointer motion');
context.mode='view';context.drawSnapOverlays();assert.equal($('spectrum-hover-edits').children.length,0);
context.result=snapshot;context.busy=context.pending=context.spectrumLoading=false;
hover({buttons:1});assert.equal($('spectrum-hover').hidden,true,'Nonediting drags still hide hover');
// The left image returns DOMPoint accessors; spreading that object drops x/y.
for(const id of ['overview','fft','fft-zoom-view']){
 const host=$(id);host.events={};host.addEventListener=(name,fn)=>{host.events[name]=fn};
}
context.detectorPoint=()=>Object.create({x:230,y:180});context.mode='add';$('diff-tool').value='add';$('diff-snap').checked=true;context.radiusDrag=null;
const pointerStart=source.indexOf("for(const id of ['overview','fft','fft-zoom-view']){",source.indexOf('async function finishRadiusDrag'));
vm.runInContext(source.slice(pointerStart,source.indexOf("$('diff-undo-peak').onclick",pointerStart)),context);
$('overview').events.pointermove({target:{closest:()=>null}});
assert.equal(context.snapPointer.x,230);assert.equal(context.snapPointer.y,180);
const sourceRings=$('overview').querySelector('.manual-snap-overlay').querySelectorAll('ellipse');
assert.equal(sourceRings[sourceRings.length-1].attrs.cx,230,'Left cursor circle uses the pointer location, not the image corner');
assert.equal(sourceRings[sourceRings.length-1].attrs.cy,180);
console.log('Peak editing: click continuity, live preview radii, enlarged redraws and mode-specific rings passed.');

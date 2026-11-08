// Escape must cancel a draft tool from any focused control, without undoing edits.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/app.js','utf8'),controls=new Map(),events=new Map();
function $(id){if(!controls.has(id))controls.set(id,{value:'view',addEventListener(){}});return controls.get(id)}
const edits=[{action:'add',x:100,y:200,radius_nm_inv:.1}],masks=[{x:30,y:40,w:50,h:60}];
const context={$,direct:true,isDiffraction:()=>context.direct,maskDrag:null,radiusDrag:null,snapPointer:null,fittingLimitDrag:null,
 diffractionSettings:{peak_edits:edits,masks},document:{addEventListener:(name,fn)=>events.set(name,fn)},window:{addEventListener(){}},
 hideCentreLoupe(){},hideSpectrumHover(){},syncPeakTool(){},drawDetector(){},drawSnapOverlays(){},prepareCentreLoupe(){},
 finishFittingLimitDrag(cancel){assert.equal(cancel,true);context.fittingLimitDrag=null}};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function setDetectorTool('),source.indexOf('function detectorPointerDown(')),context);
function escape(dialog=null){
 const event={key:'Escape',target:{closest:()=>dialog},preventDefault(){this.prevented=true}};
 events.get('keydown')(event);return event;
}
for(const mode of ['add','remove','center','mask']){
 $('diff-tool').value=mode;context.maskDrag={rect:{x:1,y:2,w:3,h:4}};
 context.radiusDrag={index:0,radius:2,original:.1};context.snapPointer={x:100,y:200};
 assert.equal(escape().prevented,true);assert.equal($('diff-tool').value,'view');
 for(const key of ['maskDrag','radiusDrag','snapPointer'])assert.equal(context[key],null);
 assert.equal(edits.length,1);assert.equal(edits[0].radius_nm_inv,.1);assert.equal(masks.length,1);
}
$('diff-tool').value='add';assert.equal(escape({id:'fft-zoom'}).prevented,true,'First Escape keeps enlarged view open');
assert.equal(escape({id:'fft-zoom'}).prevented,undefined,'Second Escape permits normal dialog closing');
$('diff-tool').value='remove';assert.equal(escape({id:'folder-picker'}).prevented,undefined,'Unrelated dialog can still close');
assert.equal($('diff-tool').value,'view');
context.fittingLimitDrag={original:{inner:2.5,outer:10}};escape();assert.equal(context.fittingLimitDrag,null);
context.direct=false;$('diff-tool').value='add';escape();assert.equal($('diff-tool').value,'add','Real-space controls are unaffected');
console.log('Detector tools: global Escape, draft cancellation and modal Escape order passed.');

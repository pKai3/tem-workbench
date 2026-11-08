// A returned peak-edit record can have different key order after validation.
// Exercise the real freshness check, visible status, and detector drawing together.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {element}=require('./svg_fixture');
const source=fs.readFileSync('web/app.js','utf8'),controls=new Map();
function $(id){if(!controls.has(id)){const n=element(id);n.dataset={};controls.set(id,n)}return controls.get(id)}
const settings={center_x:540,center_y:450,pixel_x_nm_inv:.02,pixel_y_nm_inv:.02,exclude_radius_nm_inv:2.5,
 spot_sigma_px:2,spot_snr:9,max_center_shift_px:50,refine_center:true,
 masks:[{x:20,y:10,w:30,h:40}],peak_edits:[{action:'add',x:700,y:600,radius_nm_inv:.1,snap_x:702,snap_y:601,snap_radius_nm_inv:.5}]};
const returned={...settings,masks:[{h:40,w:30,y:10,x:20}],peak_edits:[{action:'add',x:700,y:600,radius_nm_inv:.1,snap_radius_nm_inv:.5,snap_x:702,snap_y:601}]};
const report={applied:true,status:'refined',starting_center_px:[540,450],fitted_center_px:[549,451],shift_px:[9,1],pair_count:14,rms_before_px:18,rms_after_px:1.5};
const result={image_kind:'diffraction',settings:{diffraction:returned},spectrum:{center_refinement:report}};
const context={$ ,result,diffractionSettings:settings,config:{diffraction_translation:true},meta:{width:1080,height:912},
 isDiffraction:()=>true,busy:false,pending:false,maskDrag:null,el:element,clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),
 syncPeakEditControls(){},fittingLimitHandle(){},editableObservations:()=>[],drawSnapOverlays(){},reciprocalUnit:()=> 'rel.'};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('const DETECTOR_FIELDS='),source.indexOf('function withTranslationDefaults(')),context);
vm.runInContext(source.slice(source.indexOf('function currentTranslation(){'),source.indexOf('function drawDetectorExclusions(')),context);
$('g-max').value=10;
assert.equal(context.currentTranslation(),report,'Identical edit values survive server key reordering');
context.renderTranslation();assert.match($('diff-centre-result').textContent,/Fitted centre: X 549.00 · Y 451.00/);
context.drawDetector();
const overlay=$('detector-overlay');
assert.ok(overlay.children.some(n=>n.tag==='path'&&n.attrs.stroke==='#94a5b8'&&n.attrs.d.includes('L549,451')),'Starting-to-fitted shift is drawn');
assert.ok(overlay.children.filter(n=>n.tag==='ellipse').every(n=>n.attrs.cx===549&&n.attrs.cy===451),'Fitting circles use the accepted centre');
for(const [record,key] of [[settings,'center_x'],[settings.peak_edits[0],'snap_radius_nm_inv'],[settings.masks[0],'w']]){
 const before=record[key];record[key]+=.1;assert.equal(context.currentTranslation(),null,'Real '+key+' changes still reject a stale result');record[key]=before;
}
settings.peak_edits.push({action:'remove',x:800,y:600,radius_nm_inv:.1});assert.equal(context.currentTranslation(),null);settings.peak_edits.pop();
context.result=null;context.busy=true;context.renderTranslation();assert.equal($('diff-centre-result').textContent,'Refining centre…');
context.busy=false;context.renderTranslation();assert.notEqual($('diff-centre-result').dataset.state,'busy','No running request must not claim to be refining');

// An actual rejected request must refresh the status after clearing busy.
Object.assign(context,{AbortController,setTimeout,clearTimeout,analysisController:null,generation:1,pending:true,timer:null,drag:null,fileId:'unknown3',
 requestBody:()=>({file_id:'unknown3',settings:{diffraction:settings}}),api:async()=>{
  context.renderTranslation();assert.equal($('diff-centre-result').dataset.state,'busy');throw new Error('Test analysis failure');
 },
 message(){},finishSpectrumLoading(){},syncSpectrumExportControls(){},renderResult(){throw new Error('Unexpected render')}});
const start=source.indexOf('function abandonAnalysis(){'),end=source.indexOf('\n}',source.indexOf('async function analyze(){'))+2;
vm.runInContext(source.slice(start,end),context);
(async()=>{await context.analyze();assert.equal(context.busy,false);assert.notEqual($('diff-centre-result').dataset.state,'busy');
 console.log('Translation: reordered edits/masks, shift graphic, stale-result rejection and failed-request status passed.');
})().catch(e=>{console.error(e);process.exitCode=1});

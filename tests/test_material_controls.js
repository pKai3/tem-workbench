// Material-specific visibility must not leave an enabled search hidden.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync('web/app.js','utf8'),controls=new Map();
function $(id){
 if(!controls.has(id)){
  const label={hidden:false,classList:{toggle(){}}};
  controls.set(id,{id,value:'1',textContent:'',closest:()=>label});
 }
 return controls.get(id);
}
const refs={'hcp-a':'hcp_a','hcp-c':'hcp_c','omega-a':'omega_a','omega-c':'omega_c','bcc-a':'bcc_a','fcc-a':'fcc_a','ort-a':'ort_a','ort-b':'ort_b','ort-c':'ort_c'};
const references=Object.fromEntries(Object.values(refs).map(k=>[k,1]));
const presets={titanium:{references,enabled_phases:['HCP','BCC','OMEGA']},iron:{references,enabled_phases:['BCC','FCC']},unknown:{references}};
const panel={dataset:{}},context={$ ,PHASES:['HCP','BCC','FCC','ORT','OMEGA'],REFERENCE_CONTROLS:refs,
 config:{material_presets:presets},enabledPhases:['HCP','BCC','OMEGA'],materialDefaultPreset:'titanium',
 document:{querySelector:()=>panel,querySelectorAll:()=>Object.keys(refs).map($)},writePreference(){},syncOverlayMenus(){},phaseSearchDescription:()=>'',
 rememberBasicControls(){},calibrationView(){},updatePenaltyControls(){},invalidateAnalysisSettings(){},message(){}};
context.setPhaseSelection=phases=>{context.enabledPhases=Array.from(phases)};
context.materialPhases=()=>presets[$('material').value].enabled_phases;
vm.createContext(context);
vm.runInContext(app.slice(app.indexOf('function materialPhaseSymbol('),app.indexOf('const PHASE_DEFAULT_COLORS=')),context);
vm.runInContext(app.slice(app.indexOf('function syncReferenceControls('),app.indexOf('function setPhaseSelection(')),context);
vm.runInContext(app.slice(app.indexOf('function materialView('),app.indexOf('function invalidateAnalysisSettings(')),context);
vm.runInContext(app.slice(app.indexOf("$('reset-material').onclick="),app.indexOf("$('material').onchange=")),context);
const visibleRefs=()=>Object.keys(refs).filter(id=>!$(id).closest('label').hidden);
const visiblePhases=()=>context.PHASES.filter(p=>!$(p.toLowerCase()+'-phase-label').closest('label').hidden);
$('material').value='titanium';context.materialView();
assert.deepEqual(visibleRefs(),['hcp-a','hcp-c','omega-a','omega-c','bcc-a']);
assert.deepEqual(visiblePhases(),['HCP','BCC','OMEGA']);
assert.equal(panel.dataset.material,'titanium');
context.enabledPhases=['BCC'];context.materialView();
assert.equal($('hcp-a').disabled,true);assert.ok(visibleRefs().includes('hcp-a'),'Known but disabled phases stay available to select');
$('material').value='iron';context.enabledPhases=['BCC','FCC'];context.materialView();
assert.deepEqual(visibleRefs(),['bcc-a','fcc-a']);assert.deepEqual(visiblePhases(),['BCC','FCC']);
assert.equal($('bcc-phase-label').textContent,'α (BCC)');assert.equal($('fcc-phase-label').textContent,'γ (FCC)');
for(const material of ['unknown','custom']){
 $('material').value=material;context.materialView();
 assert.deepEqual(visibleRefs(),Object.keys(refs));assert.deepEqual(visiblePhases(),context.PHASES);
}
// Explicit old comparisons remain inspectable, with generic structure labels.
$('material').value='titanium';context.enabledPhases=['FCC'];context.materialView();
assert.equal($('material').value,'custom');assert.deepEqual(context.enabledPhases,['FCC']);
assert.ok(visiblePhases().includes('FCC'));assert.equal($('bcc-phase-label').textContent,'BCC');
$('reset-material').onclick();
assert.equal($('material').value,'titanium');assert.deepEqual(context.enabledPhases,['HCP','BCC','OMEGA']);
assert.ok(!visiblePhases().includes('FCC'),'Reset cannot retain a hidden unsupported search');
$('bcc-a').value='1.01';context.materialView();
assert.equal($('material').value,'custom');assert.equal($('bcc-a').value,'1.01');
assert.deepEqual(visiblePhases(),context.PHASES,'Custom dimensions restore the full comparison controls');
$('bcc-a').value='1';$('material').value='titanium';context.enabledPhases=['BCC'];presets.titanium.available_phases=['BCC'];context.materialView();
assert.deepEqual(visiblePhases(),['BCC'],'Backend preset availability takes precedence over older-client fallbacks');
console.log('Material controls: preset visibility, disabled choices, explicit custom comparisons, legacy migration and reset passed.');

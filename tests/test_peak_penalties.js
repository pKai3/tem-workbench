// Independent controls, saved-setting migration and cached-grid requests.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/app.js','utf8'),controls=new Map(),storage=new Map([['tem-peak-evidence-weight',.3]]);
function $(id){if(!controls.has(id))controls.set(id,{id,value:'',dataset:{},classList:{toggle(){}},disabled:false});return controls.get(id)}
const context={$,config:{grid_rescore:true,peak_evidence:true,separate_peak_penalties:true,peak_evidence_falloff:true},
 document:{activeElement:null,querySelector:()=>$('scale-label')},grid:null,jobId:null,meta:{},
 rescorePending:false,rescoreBusy:false,rescoreJobId:null,rescoreTimer:null,rescoreRevision:0,
 scalePenalty:.1,caPenalty:.1,peakEvidenceWeight:.1,missingPeakWeight:.1,peakFalloff:8,
 readPreference:(k,d)=>storage.has(k)?storage.get(k):d,writePreference:(k,v)=>storage.set(k,v),
 isGridRunning:()=>false,effectiveScalePenalty:()=>context.scalePenalty,syncMapLoading(){},syncMapExportControls(){},
 schedule(){},setTimeout:()=>1,clearTimeout(){},message:s=>{context.error=s},drawGrid(){},gridStatus(){},
 api:async(path,body)=>{context.request={path,body};return {settings:body,can_rescore:true}},
 reciprocalUnit:()=> 'rel.',isDiffraction:()=>false,enabledPhases:['BCC'],FFT_DETECTOR_CONTROLS:{},REFERENCE_CONTROLS:{},
 betaOmegaHidden:new Set(),setPhaseSelection(){},migratedPhaseSelection:()=>['BCC'],materialView(){},updateStrengthMode(){},
 calibrationView(){},rememberCalibration(){},rememberBasicControls(){},syncBetaOmegaControls(){}};
$('scenario').value='auto_uniform';$('material').value='titanium';
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function updatePenaltyControls(){'),source.indexOf('const REFERENCE_CONTROLS=')),context);
vm.runInContext(source.match(/^function settings\(\).*$/m)[0],context);
vm.runInContext(source.slice(source.indexOf('function applyRegionSettings('),source.indexOf("$('saved-region-all').onchange=")),context);
const run=s=>vm.runInContext(s,context);
assert.equal(context.missingPeakWeight,.3,'Legacy shared preference initializes both controls');
$('missing-peak-weight').value='1.2';run('penaltyChanged($("missing-peak-weight"))');
assert.equal(context.peakEvidenceWeight,.3);assert.equal(context.missingPeakWeight,1.2);
assert.equal($('peak-falloff-label').textContent,'Missing half-weight, rel.');
assert.equal(storage.get('tem-missing-peak-weight'),1.2);
assert.equal(run('settings().missing_peak_weight'),1.2);
$('peak-evidence-weight').value='0';run('penaltyChanged($("peak-evidence-weight"))');
assert.equal(context.peakEvidenceWeight,0);assert.equal(context.missingPeakWeight,1.2);
$('missing-peak-weight').value='2.01';run('penaltyChanged($("missing-peak-weight"))');
assert.equal(context.missingPeakWeight,1.2);assert.match(context.error,/0 to 2/);
run('applyRegionSettings({peak_evidence_weight:.25,scale_mode:"fixed"})');
assert.equal(context.peakEvidenceWeight,.25);assert.equal(context.missingPeakWeight,.25);
run('applyRegionSettings({peak_evidence_weight:.05,missing_peak_weight:1.5,scale_mode:"fixed"})');
assert.equal(context.peakEvidenceWeight,.05);assert.equal(context.missingPeakWeight,1.5);
context.grid={can_rescore:true,settings:{scale_mode:'fixed',peak_evidence_weight:.05,missing_peak_weight:1.5,peak_evidence_half_weight_nm_inv:0}};
context.jobId='example';$('missing-peak-slider').value='1.1';run('penaltyChanged($("missing-peak-slider"))');
assert.equal($('save-grid').disabled,true,'Changed missing cost makes old grid stale');
(async()=>{
 await context.rescoreGrid();
 assert.equal(context.request.path,'rescore-grid');
 assert.equal(context.request.body.missing_peak_weight,1.1);
 assert.equal(context.request.body.peak_evidence_weight,.05);
 context.config.separate_peak_penalties=false;run('updatePenaltyControls()');
 assert.equal($('missing-peak-weight').disabled,true,'Older backend cannot silently ignore a live control');
 assert.equal('missing_peak_weight' in run('settings()'),false);
 context.config.brightness_grouping=true;context.isDiffraction=()=>true;
 context.diffractionSettings={exclude_radius_nm_inv:2.5};
 context.grid=null;context.jobId=null;
 $('brightness-grouping-weight').value='.25';run('penaltyChanged($("brightness-grouping-weight"))');
 assert.equal(context.brightnessGroupingWeight,.25);
 assert.equal(context.missingPeakWeight,1.1,'Brightness strength is independent of missing cost');
 assert.equal(storage.get('tem-brightness-grouping-weight'),.25);
 assert.equal(run('settings().brightness_grouping_weight'),.25);
 assert.equal($('brightness-grouping-field').hidden,false);
 $('brightness-grouping-slider').value='0';run('penaltyChanged($("brightness-grouping-slider"))');
 assert.equal(run('settings().brightness_grouping_weight'),0,'Zero is transmitted without falling back to a default');
 run('applyRegionSettings({scale_mode:"fixed",brightness_grouping_weight:.4})');
 assert.equal(context.brightnessGroupingWeight,.4);
 run('applyRegionSettings({scale_mode:"fixed"})');
 assert.equal(context.brightnessGroupingWeight,.1,'Old saved results use the documented default');
 context.isDiffraction=()=>false;run('updatePenaltyControls()');
 assert.equal($('brightness-grouping-field').hidden,false);
 assert.equal($('brightness-grouping-weight').disabled,true,'Older direct-only backends need an update for FFT grouping');
 context.config.fft_brightness_grouping=true;run('updatePenaltyControls()');
 assert.equal($('brightness-grouping-weight').disabled,false);
 assert.equal(run('settings().brightness_grouping_weight'),.1);
 context.grid={can_rescore:true,settings:{scale_mode:'fixed',peak_evidence_weight:.1,missing_peak_weight:.1,brightness_grouping_weight:.1,peak_evidence_half_weight_nm_inv:0}};
 context.jobId='example';$('brightness-grouping-slider').value='.3';run('penaltyChanged($("brightness-grouping-slider"))');
 assert.equal($('save-grid').disabled,true,'A brightness change makes the old map stale');
 await context.rescoreGrid();
 assert.equal(context.request.body.brightness_grouping_weight,.3);
 assert.equal(context.request.body.peak_evidence_weight,.1);
 context.isDiffraction=()=>true;context.config.brightness_grouping=false;run('updatePenaltyControls()');
 assert.equal($('brightness-grouping-weight').disabled,true);
 assert.equal('brightness_grouping_weight' in run('settings()'),false,'Older backends cannot silently ignore a live grouping control');
 context.config.double_diffraction_scoring=true;context.grid=null;context.jobId=null;
 assert.equal(run('settings().double_diffraction_weight'),0);
 $('dd-slider').value='.5';run('penaltyChanged($("dd-slider"))');
 assert.equal(run('settings().double_diffraction_weight'),.5);
 assert.equal(storage.get('tem-dd-weight'),.5);
 $('dd-weight').value='1.01';run('penaltyChanged($("dd-weight"))');
 assert.equal(run('settings().double_diffraction_weight'),.5);assert.match(context.error,/0 to 1/);
 run('applyRegionSettings({scale_mode:"fixed",double_diffraction_weight:.7})');
 assert.equal(run('settings().double_diffraction_weight'),.7);
 run('applyRegionSettings({scale_mode:"fixed"})');assert.equal(run('settings().double_diffraction_weight'),0);
 context.isDiffraction=()=>false;context.grid={can_rescore:true,settings:{scale_mode:'fixed',peak_evidence_weight:.1,missing_peak_weight:.1,peak_evidence_half_weight_nm_inv:0}};context.jobId='example';
 $('dd-weight').value='.25';run('penaltyChanged($("dd-weight"))');assert.equal($('save-grid').disabled,true);
 await context.rescoreGrid();assert.equal(context.request.body.double_diffraction_weight,.25);
 context.config.double_diffraction_scoring=false;run('updatePenaltyControls()');
 assert.equal($('dd-weight').disabled,true);assert.equal('double_diffraction_weight' in run('settings()'),false);
 // Reset the panel atomically; retain image/material edits and reweight only when the model family is unchanged.
 context.config.scale_modes=['auto_hcp_ac','auto_hcp_ratio'];context.grid=null;context.jobId=null;context.rescorePending=false;
 context.invalidations=0;context.invalidateAnalysisSettings=()=>{context.invalidations++};
 context.rememberCalibration=()=>storage.set('tem-scale-last',{mode:$('scenario').value,scale:Number($('model-scale').value)});
 $('scenario').value='custom';$('model-scale').value='1.12';$('material').value='iron';
 run('resetScaleControls()');
 assert.equal($('scenario').value,'auto_hcp_ratio');assert.equal(Number($('model-scale').value),1);assert.equal(context.invalidations,1);
 assert.equal($('material').value,'iron','Scale reset does not reset material or phases');
 for(const key of ['tem-scale-penalty','tem-ca-penalty','tem-peak-evidence-weight','tem-missing-peak-weight','tem-brightness-grouping-weight'])assert.equal(storage.get(key),.1);
 assert.equal(storage.get('tem-dd-weight'),0);assert.equal(storage.get('tem-peak-falloff'),8);
 assert.equal(storage.get('tem-scale-last').mode,'auto_hcp_ratio');
 context.isGridRunning=()=>true;$('missing-peak-weight').value='1';run('resetScaleControls()');
 assert.equal($('missing-peak-weight').value,'1','A running scan blocks reset just like its ranking controls');
 context.isGridRunning=()=>false;context.grid={can_rescore:true,settings:{scale_mode:'auto_hcp_ratio'}};context.jobId='example';
 run('resetScaleControls()');assert.equal(context.invalidations,1);assert.equal(context.rescorePending,true,'Same-mode grid is reweighted from cached fits');
 // Slow responses cannot repaint an older weight or another image's map.
 let reply,draws=0;
 context.api=()=>new Promise(resolve=>{reply=resolve});context.drawGrid=()=>{draws++};
 const originalGrid=context.grid,older=context.rescoreGrid();
 $('missing-peak-weight').value='.4';run('penaltyChanged($("missing-peak-weight"))');
 reply({id:'example',settings:{missing_peak_weight:.1}});await older;
 assert.equal(context.grid,originalGrid);assert.equal(draws,0);assert.equal(context.rescorePending,true);
 const latest=context.rescoreGrid();reply({id:'example',settings:{missing_peak_weight:.4},can_rescore:true});await latest;
 assert.equal(context.grid.settings.missing_peak_weight,.4);assert.equal(draws,1);
 run('queuePenaltyUpdate()');const switched=context.rescoreGrid();
 context.jobId='other-image-grid';context.grid=null;
 reply({id:'example',settings:{missing_peak_weight:.4}});await switched;
 assert.equal(context.grid,null);assert.equal(draws,1);assert.equal(context.rescoreBusy,false);
 console.log('Scale reset: default mode/weights, persistence, source settings preserved, busy guard and cached rescoring passed.');
 console.log('DD weight: zero default, range, independent persistence, saved settings and FFT/grid rescoring passed.');
 console.log('Independent peak penalties: legacy/new settings, persistence, range, zero, stale grids and request propagation passed.');
 console.log('Brightness grouping: separate persistence, zero, saved settings and FFT/direct controls and cached-map requests passed.');
})().catch(e=>{console.error(e);process.exitCode=1});

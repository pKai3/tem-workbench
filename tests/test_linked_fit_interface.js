// Linked fits use the common table/overlay controls without inventing independent scores.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function node(tag){
 const n={tag,children:[],dataset:{},style:{},attrs:{},events:{},className:'',textContent:'',hidden:false,
  append(...children){for(const c of children){c.parent=this;this.children.push(c)}},replaceChildren(...children){this.children=[];this.append(...children)},
  setAttribute(k,v){this.attrs[k]=v},addEventListener(k,fn){this.events[k]=fn},
  closest(selector){let p=this;while(p){if(selector==='table'?p.tag==='table':p.className.split(' ').includes(selector.slice(1)))return p;p=p.parent}return null}};
 n.classList={toggle(c,enabled){const classes=new Set(n.className.split(' ').filter(Boolean));enabled?classes.add(c):classes.delete(c);n.className=[...classes].join(' ')}};return n;
}
const controls=new Map();function $(id){if(!controls.has(id))controls.set(id,node('div'));return controls.get(id)}
const table=node('table'),panel=node('div');panel.className='candidate-table';table.append($('model-head'),$('models'));panel.append(table);
const context={$ ,document:{createElement:node},COVERAGE_HELP:'Weighted coverage',phaseColors:{BCC:'#f4b75e',OMEGA:'#b49aff'},chosenFits:new Set(),result:null,
 indexLabel:v=>'['+v.join(' ')+']',geometryFits:d=>d.geometry||[],analysisPhases:s=>s.enabled_phases,bestModel:(d,p)=>d.models.find(m=>m.phase===p),compareRank:(a,b)=>(b?.score||0)-(a?.score||0),
 scaleSummary:()=>'',zoneLabel:m=>'['+m.zone_3index.join(' ')+']',screenLabel:()=> 'Pass',predictionCounts:()=> '3 + 0 / 3',fittedDimensions:()=> 'a 0.330',scalePercentages:()=> 'a 0%',rankDescription:()=>'',evidenceDescription:()=>'',doubleDiffractionCountHelp:()=>'',coverageCounts:m=>(100*m.coverage).toFixed(0)+'% | —',scaleDetails:()=>'',drawFFT:()=>{}};
vm.createContext(context);vm.runInContext(fs.readFileSync('web/beta-omega.js','utf8'),context);
const app=fs.readFileSync('web/app.js','utf8');
vm.runInContext(app.slice(app.indexOf('function materialPhaseSymbol('),app.indexOf('const PHASE_DEFAULT_COLORS=')),context);
vm.runInContext(app.slice(app.indexOf('const fitVariantColors='),app.indexOf('function weakMarker(')),context);
vm.runInContext(app.slice(app.indexOf('function candidateName('),app.indexOf('function brightnessDescription(')),context);
vm.runInContext(app.slice(app.indexOf('const FIT_COLUMNS='),app.indexOf('function renderMeasuredPeaks(')),context);
vm.runInContext(app.slice(app.indexOf('function renderFitChoices('),app.indexOf('function processedSignalCaption(')),context);
const components=['beta','omega1','omega2','omega3','omega4'].map((id,i)=>({id,active:[0,3,4].includes(i),predicted_nodes:[{q:[1,i],hkl:[1,0,0]}],matched_profiles:1,coverage:.25,rms_relative:.02,c_axis_beta:i?[1,1,-1]:null}));
const fit={phase:'BCC',related_pattern:true,component_ids:['beta','omega3','omega4'],zone_3index:[0,1,1],score:.7,coverage:.75,rms_nm_inv:.05,position_score:.8,scale_penalty:0,valid:true};
const joint={components,selected:true,fit,status:'beta_omega_candidate',parent:{zone_3index:[0,1,1],rotation_deg:.5939380505874459,fundamental_spacing:5},combined:{score:.7,coverage:.75,rms_relative:.01,matched_profiles:3}};
const data={beta_omega:joint,models:[],spectrum:{coordinate_units:'relative'},settings:{enabled_phases:['BCC']}};
$('overlay').value='winner';$('omega-color-by').value='variant';
const before=JSON.stringify(data);context.renderModels(data);context.renderFitChoices(data);
const cells=r=>Object.fromEntries(r.children.map(c=>[c.dataset.column,c.textContent]));
assert.equal($('models').children.length,2);assert.equal(panel.hidden,false);
assert.equal(cells($('models').children[0]).rank,'0.700');
assert.equal(cells($('models').children[0]).candidate,'BCC [0 1 1] + 2×ω','Zone axis belongs to the parent, before the added phase');
assert.equal(context.candidateName(fit),'BCC [0 1 1] + 2×ω','Evidence tables use the same combined label');
assert.equal(cells($('models').children[0]).rms,'0.050','Relative residual is converted to the image coordinate units');
assert.equal($('model-head').children[0].children.find(c=>c.dataset.column==='rms').textContent,'RMS\nrel.');
assert.equal(table.className.includes('linked-only'),false,'The same columns show comparable scores for all candidates');
const descendants=n=>n.children.flatMap(c=>[c,...descendants(c)]),boxes=()=>descendants($('fit-list')).filter(n=>n.tag==='input');
assert.deepEqual(boxes().map(b=>b.attrs['aria-label']),['Overlay BCC [0 1 1] + 2×ω','Overlay BCC parent','Overlay ω₁','Overlay ω₂']);
assert.equal(cells(boxes()[1].parent.parent).candidate,'BCC parent [0 1 1]\n0.6°','Parent shows its recorded in-plane rotation');
assert.ok(boxes().slice(1).every(b=>b.parent.parent.className==='fit-component'));
assert.ok(boxes().every(b=>b.checked));
boxes()[0].checked=false;boxes()[0].events.change();assert.ok(boxes().every(b=>!b.checked));boxes()[0].checked=true;boxes()[0].events.change();assert.ok(boxes().every(b=>b.checked));
const firstOmega=boxes()[2];firstOmega.checked=false;firstOmega.events.change();
assert.equal($('overlay').value,'custom');assert.equal(context.betaOmegaComponentHidden('omega3'),true);assert.equal(context.betaOmegaComponentHidden('omega4'),false);
context.renderFitChoices(data,true);assert.deepEqual(boxes().map(b=>b.checked),[false,true,false,true]);
assert.equal(context.betaOmegaLabel('omega4',joint),'ω₂','Hiding the first displayed variant never renumbers the second');
assert.equal(JSON.stringify(data),before,'All table and overlay changes leave the fit untouched');
// Calibrated and relative results both compare ordinary and related candidates.
const independent={phase:'BCC',zone_3index:[0,0,1],rotation_deg:0,score:.8,coverage:.5,rms_nm_inv:.1,valid:true};
const mixed={...data,models:[independent],spectrum:{coordinate_units:'nm^-1'}};
context.renderModels(mixed);context.renderFitChoices(mixed,true);
assert.equal(table.className.includes('linked-only'),false);
assert.equal($('models').children.length,2);assert.equal(cells($('models').children[0]).rank,'0.800');assert.equal(cells($('models').children[1]).rank,'0.700');
assert.equal(boxes().length,5);assert.equal(boxes().find(b=>b.dataset.fit==='linked-omega3').checked,false);
assert.equal(boxes()[0].dataset.fit,'phase-0','A higher-ranked standalone fit precedes the related group');
assert.ok(!$('models').children.some(r=>r.className==='fit-section'),'All scores occupy one ranked table');
console.log('Linked fit interface: common columns, unit-correct RMS, real component choices, stable aliases and independent coexistence passed.');

// Material aliases clarify structures without changing fit identities or colours.
for(const [material,expected]of Object.entries({
 titanium:['α (HCP)','β (BCC)','FCC'],iron:['HCP','α (BCC)','γ (FCC)'],
 unknown:['HCP','BCC','FCC'],custom:['HCP','BCC','FCC']
}))assert.deepEqual(['HCP','BCC','FCC'].map(p=>context.phaseControlLabel(p,material)),expected);
assert.equal(context.phaseControlLabel('OMEGA','titanium'),'ω (hexagonal)');
assert.equal(context.phaseControlLabel('ORT','iron'),'ORT (orthorhombic)');
assert.equal(context.phaseLabel('BCC+FCC','iron'),'α (BCC) + γ (FCC)');
const labelledBefore=JSON.stringify(joint);
$('material').value='titanium';context.renderFitChoices(data,true);
assert.equal(cells(boxes().find(b=>b.dataset.fit==='related-combined').parent.parent).candidate,'β (BCC) [0 1 1] + 2×ω');
assert.equal(cells(boxes().find(b=>b.dataset.fit==='linked-beta').parent.parent).candidate,'β (BCC) parent [0 1 1]\n0.6°');
assert.equal(context.betaOmegaColorTarget(components[0]),'phase:BCC');
assert.equal(context.betaOmegaColorTarget(components[3]),'variant:omega3');
assert.equal(JSON.stringify(joint),labelledBefore,'Material names do not rewrite numerical phase IDs or fits');
$('material').value='unknown';
const noAngle={...joint,parent:{...joint.parent,rotation_deg:undefined}};
assert.equal(context.betaOmegaCandidateLabel(components[0],noAngle),'BCC parent [0 1 1]','Missing angles are not fabricated');
assert.equal(context.betaOmegaCandidateLabel(components[0],{...noAngle,fit:{...fit,rotation_deg:0}}),'BCC parent [0 1 1]\n0.0°','Older fits can supply their recorded parent angle, including zero');
vm.runInContext(app.slice(app.indexOf('function indexGcd('),app.indexOf('// Presentation preference only:')),context);
const variant={...components[3],vector_model:{phase:'OMEGA',zone_3index:[0,-1,0],rotation_deg:.5939380505874459}};
$('hcp-notation').value='3';
assert.equal(context.betaOmegaCandidateLabel(variant,joint),'ω₁ [0 1\u0305 0]','Variants show their own zone but do not repeat the stored parent rotation');
$('hcp-notation').value='4';
assert.equal(context.betaOmegaCandidateLabel(variant,joint),'ω₁ [1 2\u0305 1 0]','Linked zones follow the same hexagonal notation control');
$('hcp-notation').value='3';
console.log('Material notation: preset aliases, parent zone/angle, linked hexagonal zones and unchanged numerical identities passed.');

// Integrated-brightness order updates without renumbering or modifying fitting input.
vm.runInContext(app.slice(app.indexOf('function renderMeasuredPeaks('),app.indexOf('async function renderResult(')),context);
const peaks=[{profile_id:1,intensity:250,integrated_intensity:100,weight:2},{profile_id:2,intensity:200,integrated_intensity:400,weight:4},{profile_id:3,intensity:100,weight:1}].map(p=>({...p,g_nm_inv:5,qx:3,qy:4}));
const measured={image_kind:'diffraction',spectrum:{peaks,coordinate_units:'relative'}};
const source=JSON.stringify(peaks);context.renderMeasuredPeaks(measured);
assert.deepEqual($('peaks').children.map(row=>row.children[0].textContent),[2,1,3]);
assert.equal($('peak-integrated-heading').attrs['aria-sort'],'descending');
assert.equal(JSON.stringify(peaks),source);
context.renderMeasuredPeaks({...measured,image_kind:'real_space'});
assert.deepEqual($('peaks').children.map(row=>row.children[0].textContent),[2,1,3]);
assert.equal($('peak-integrated-heading').hidden,false);
const legacy=peaks.map(({integrated_intensity,...p})=>p);
context.renderMeasuredPeaks({...measured,image_kind:'real_space',spectrum:{peaks:legacy}});
assert.deepEqual($('peaks').children.map(row=>row.children[0].textContent),[1,2,3]);
assert.equal($('peak-integrated-heading').hidden,true);
console.log('Integrated-intensity sorting, FFT fallback, stable IDs and missing values passed.');

// Group evidence remains inspectable and the winning ordinary pair shows both overlays.
vm.runInContext(app.slice(app.indexOf('function evidenceModels('),app.indexOf('const COVERAGE_HELP=')),context);
vm.runInContext(app.slice(app.indexOf('function overlayModels('),app.indexOf('function geometryFits(')),context);
const report={status:'supported',factor:.2,available_profiles:8,reliable_profile_ids:[1,2,3,4,5,6,7,8],shared_profile_ids:[7,8],
 baseline_loss:4,grouped_loss:1,complexity_cost:1,groups:[{phase:'FCC',relative_level:3,profile_ids:[1,2,3,7,8]},{phase:'HCP',relative_level:.8,profile_ids:[4,5,6,7,8]}]};
const pair={phase:'FCC+HCP',independent_combination:true,component_zones:[[0,0,1],[1,0,0]],score:.72,coverage:1,rms_nm_inv:.02,valid:true,brightness_bonus:.02,brightness_grouping_weight:.1,brightness_grouping:report};
const primary={...independent,phase:'FCC'},secondary={...independent,phase:'HCP'};
const grouped={image_kind:'diffraction',models:[primary,secondary],classification:{combined_fit:pair,combined_fit_selected:true,primary_model:primary,secondary_model:secondary}};
context.renderBrightnessEvidence(grouped);
assert.equal($('brightness-details').hidden,false);
const row=$('brightness-table').children[0].children[1].children[0];
assert.equal(row.children[1].textContent,'0.020');
assert.match(row.children[2].textContent,/Supports/);
assert.match(row.children[3].textContent,/FCC 3.00 \/ HCP 0.80/);
assert.match(row.children[4].textContent,/shared: 7, 8 \(counted once\)/);
assert.deepEqual(Array.from(context.overlayModels(grouped,'winner')),[primary,secondary]);
pair.brightness_grouping_weight=0;pair.brightness_bonus=0;
context.renderBrightnessEvidence(grouped);
assert.match($('brightness-table').children[0].children[1].children[0].children[2].textContent,/Off/);
context.renderBrightnessEvidence({...grouped,image_kind:'real_space'});
assert.equal($('brightness-details').hidden,false);
console.log('Brightness evidence: score, phase levels, shared IDs, disabled state and ordinary combined overlays passed.');

// A same-phase union used for ranking must appear as one scored row and draw
// both orientations, including saved results from before the selected flag.
const bccA={...independent,score:.569,predicted_nodes:[{q:[1,2],hkl:[1,1,0]}]},
 bccB={...independent,score:.566,rotation_deg:70.6,predicted_nodes:[{q:[2,1],hkl:[1,1,0]}]};
const bccPair={...pair,phase:'BCC+BCC',component_zones:[[0,0,1],[0,0,1]],component_rotations_deg:[0,70.6],score:.795,brightness_bonus:0,brightness_grouping_weight:0};
const twoBCC={...data,models:[bccA,bccB],beta_omega:{...joint,selected:false},
 classification:{primary_model:bccA,secondary_model:bccB,combined_fit:bccPair,label:'ambiguous',ambiguity_reason:'related_pattern_tradeoff'}};
context.enabledPhases=['BCC','OMEGA'];context.PHASES=['BCC','OMEGA'];$('overlay').value='winner';
context.renderModels(twoBCC);context.renderFitChoices(twoBCC);
assert.equal(cells($('models').children[0]).candidate,'2 × BCC [0 0 1]');
assert.equal(cells($('models').children[0]).rank,'0.795');
assert.deepEqual(Array.from(context.overlayModels(twoBCC,'winner')),[bccA,bccB]);
assert.deepEqual(Array.from(context.overlayModels(twoBCC,'winner',{vectors:true})),[bccA,bccB]);
const unionBox=boxes().find(b=>b.dataset.fit==='independent-combined');assert.ok(unionBox.checked);
assert.deepEqual(boxes().map(b=>b.dataset.fit),['independent-combined','phase-0','phase-1','related-combined','linked-beta','linked-omega3','linked-omega4','phase-0','phase-1'],
 'Combinations and independent candidates follow rank, with linked component references under each group');
assert.ok(boxes().slice(1,3).every(b=>b.parent.parent.className==='fit-component'));
assert.ok(boxes().slice(-2).every(b=>b.parent.parent.className!=='fit-component'));
assert.ok(boxes().filter(b=>b.dataset.fit.startsWith('phase-')).every(b=>b.checked));
const firstBCC=boxes().find(b=>b.dataset.fit==='phase-0');firstBCC.checked=false;firstBCC.events.change();
assert.equal(boxes()[0].indeterminate,true,'A child toggle updates its combined parent');
boxes()[0].checked=true;boxes()[0].events.change();
assert.ok(boxes().filter(b=>b.dataset.fit.startsWith('phase-')).every(b=>b.checked));
unionBox.checked=false;unionBox.events.change();
assert.ok(boxes().filter(b=>b.dataset.fit.startsWith('phase-')).every(b=>!b.checked));
// A lower-scoring union must not hide its better independent components.
const beta={...bccA,score:.435},omega={...bccB,phase:'OMEGA',score:.301};
const lowerUnion={...twoBCC,beta_omega:null,models:[beta,omega],classification:{primary_model:beta,secondary_model:omega,
 combined_fit:{...pair,phase:'BCC+OMEGA',score:.262},combined_fit_selected:false}};
const unchanged=JSON.stringify(lowerUnion);
context.renderFitChoices(lowerUnion);
assert.deepEqual(boxes().map(b=>b.dataset.fit),['phase-0','phase-1','independent-combined','phase-0','phase-1']);
assert.deepEqual(boxes().filter(b=>b.parent.parent.className!=='fit-component').map(b=>cells(b.parent.parent).rank),['0.435','0.301','0.262']);
boxes()[0].checked=true;boxes()[0].events.change();
assert.ok(boxes().filter(b=>b.dataset.fit==='phase-0').every(b=>b.checked),'Standalone and component reference checkboxes stay synchronized');
boxes().find(b=>b.dataset.fit==='independent-combined').checked=true;
boxes().find(b=>b.dataset.fit==='independent-combined').events.change();
assert.ok(boxes().every(b=>b.checked),'The group toggle also updates standalone rows');
assert.equal(JSON.stringify(lowerUnion),unchanged,'Display order does not change candidate scores or fits');
vm.runInContext(app.slice(app.indexOf('function relatedDDEvidence('),app.indexOf('function scaleSummary(')),context);
assert.match(context.patternExplanation(twoBCC),/2 BCC orientations.*BCC \+ related ω/);
twoBCC.classification.combined_fit_selected=false;$('overlay').value='winner';
assert.deepEqual(Array.from(context.overlayModels(twoBCC,'winner')),[bccA]);
$('overlay').value='related';assert.equal(context.betaOmegaOverlayActive(twoBCC),true);
assert.deepEqual(Array.from(context.overlayModels(twoBCC,'related')),[],'Related predictions use their shared-symbol renderer');
const vectorModel={phase:'OMEGA',zone_3index:[0,1,0]};
const withVectors={...twoBCC,beta_omega:{...twoBCC.beta_omega,components:[{id:'omega1',active:true,vector_model:vectorModel}]}};
assert.deepEqual(Array.from(context.overlayModels(withVectors,'related',{vectors:true})),[vectorModel]);

// The related display option belongs to the ordinary menus and is restricted
// to direct diffraction with both participating phases enabled.
for(const id of ['overlay','reflection-vectors'])Object.defineProperty($(id),'options',{get(){return descendants(this).filter(n=>n.tag==='option')}});
context.Option=function(label,value){const option=node('option');option.value=value;option.textContent=label;return option};
context.direct=true;context.isDiffraction=()=>context.direct;
vm.runInContext(app.slice(app.indexOf('function fittedVectorMode('),app.indexOf('function finishPhaseChange(')),context);
context.syncOverlayMenus('related','fitted_related');
assert.equal($('overlay').value,'related');assert.equal($('reflection-vectors').value,'fitted_related');
assert.ok($('overlay').options.some(o=>o.value==='related'&&o.textContent==='Best BCC + related ω'));
context.syncOverlayMenus('passing','fitted_passing');
assert.equal($('overlay').value,'passing');assert.equal($('reflection-vectors').value,'fitted_passing');
assert.ok($('overlay').options.some(o=>o.value==='passing'&&o.textContent==='All passing fits'));
assert.ok($('reflection-vectors').options.some(o=>o.value==='planes_passing'));
assert.ok(!$('reflection-vectors').options.some(o=>o.textContent.startsWith('Measured')));
context.syncOverlayMenus('passing','BCC');assert.equal($('reflection-vectors').value,'planes_BCC');
context.direct=false;context.syncOverlayMenus();assert.ok(!$('overlay').options.some(o=>o.value==='related'));
context.direct=true;context.enabledPhases=['BCC'];context.syncOverlayMenus();assert.ok(!$('overlay').options.some(o=>o.value==='related'));
console.log('Combined-fit display: same-phase score row, both winning orientations, joint toggles, legacy results and explicit related overlay passed.');

// All passing includes every retained passing orientation and accepted joint
// components, without duplicating ordinary components also retained separately.
context.enabledPhases=['BCC','OMEGA'];$('overlay').value='passing';
const rejected={...bccA,valid:false,predicted_nodes:[{q:[9,9]}]},disabled={...bccA,phase:'HCP'};
context.screenReasons=()=>['Below screen'];
const passing={...withVectors,models:[bccA,bccB,rejected,disabled],classification:{...twoBCC.classification,combined_fit_components:[{...bccA},bccB]}};
assert.deepEqual(Array.from(context.overlayModels(passing,'passing')),[bccA,bccB]);
assert.deepEqual(Array.from(context.overlayModels(passing,'passing',{vectors:true})),[bccA,bccB,vectorModel]);
assert.equal(context.betaOmegaOverlayActive(passing),true,'Passing related fit is visible even when not the winner');
assert.equal(context.betaOmegaOverlayActive({...passing,beta_omega:{...passing.beta_omega,fit:{...fit,valid:false}}}),false);
context.enabledPhases=['BCC'];assert.equal(context.betaOmegaOverlayActive(passing),false);
assert.deepEqual(Array.from(context.overlayModels(passing,'passing',{vectors:true})),[bccA,bccB]);
context.enabledPhases=['BCC','OMEGA'];
context.renderFitChoices({...twoBCC,models:[bccA,bccB,rejected]});
assert.ok(boxes().filter(b=>b.dataset.fit!=='phase-2').every(b=>b.checked));
assert.equal(boxes().find(b=>b.dataset.fit==='phase-2').checked,false);
const belowComponent={...bccB,valid:false};
assert.deepEqual(Array.from(context.overlayModels({...passing,models:[bccA,belowComponent],classification:{combined_fit:bccPair,combined_fit_components:[bccA,belowComponent]}},'passing')),[bccA,belowComponent],
 'Passing joint fits retain all of their components, even a component below the independent screen');
assert.equal(context.overlayModels({...passing,models:[rejected],classification:{},beta_omega:null},'passing').length,0);
console.log('All-passing overlays: accepted independent/combined fits, multiple orientations, deduplication, rejected exclusion and checkbox state passed.');

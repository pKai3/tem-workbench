// Search selection is independent of calibration; old image choices migrate.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const controls=new Map();
function $(id){if(!controls.has(id)){const label={hidden:false};controls.set(id,{value:'winner',checked:false,disabled:false,closest:()=>label})}return controls.get(id)}
const anchorPanel={hidden:false};
const context={$ ,phaseColors:{BCC:'#f4b75e',OMEGA:'#b49aff'},PHASES:['HCP','BCC','FCC','ORT','OMEGA'],enabledPhases:['BCC'],meta:{reciprocal_calibrated:false},direct:true,diffractionSettings:{},document:{querySelector:()=>anchorPanel},
 isDiffraction:()=>context.direct,readPreference:(key,fallback)=>fallback,
 syncOverlayMenus:(pattern,vectors)=>{$('overlay').value=pattern;$('reflection-vectors').value=vectors}};
vm.createContext(context);vm.runInContext(fs.readFileSync('web/beta-omega.js','utf8'),context);
vm.runInContext(fs.readFileSync('web/double-diffraction.js','utf8'),context);
const appSource=fs.readFileSync('web/app.js','utf8');
vm.runInContext(appSource.slice(appSource.indexOf('function materialPhaseSymbol('),appSource.indexOf('const PHASE_DEFAULT_COLORS=')),context);
context.planeLabel=(m,hkl,sign=1)=>'('+hkl.map(v=>v*sign).join(' ')+')';
context.indexLabel=v=>'['+v.join(' ')+']';
context.zoneLabel=m=>context.indexLabel(m.zone_3index);
vm.runInContext(appSource.slice(appSource.indexOf('function markerMotionOffset('),appSource.indexOf('function weakMarker(')),context);
vm.runInContext('syncRelativeUnits=()=>{}',context);
context.setPhaseSelection=phases=>{context.enabledPhases=phases};
context.analysisPhases=saved=>saved.enabled_phases||['BCC'];
context.setupBetaOmegaSearch();assert.equal(context.relatedPhasesSelected(),false,'Relative coordinates do not enable another phase');
assert.equal($('omega-marker').closest('label').hidden,true);assert.equal($('bcc-marker').closest('label').hidden,false);
assert.equal(anchorPanel.hidden,false,'BCC anchors are available for BCC alone');
context.diffractionSettings={indexing_model:'beta_omega'};context.setupBetaOmegaSearch();
assert.equal(context.relatedPhasesSelected(),true,'Old search migrates into ordinary phase selection');assert.equal($('overlay').value,'winner');
assert.equal($('omega-marker').closest('label').hidden,false);
context.meta.reciprocal_calibrated=true;context.setupBetaOmegaSearch();assert.equal(context.relatedPhasesSelected(),true);
context.enabledPhases=['BCC'];context.diffractionSettings={phase_search_version:2,search_beta_omega:true};context.setupBetaOmegaSearch();
assert.equal(context.relatedPhasesSelected(),false,'Explicit current phase selection wins over legacy preferences');
context.direct=false;context.enabledPhases=['BCC','OMEGA'];context.setupBetaOmegaSearch();assert.equal(anchorPanel.hidden,true);
assert.equal(context.relatedPhasesSelected(),true,'FFT supports linked beta/omega without detector anchors');
context.enabledPhases=['HCP'];context.syncPhaseMarkerControls();
assert.equal($('hcp-marker').closest('label').hidden,false);assert.equal($('bcc-marker').closest('label').hidden,true);
assert.equal($('omega-color-by').closest('label').hidden,false,'Colour by applies to FFT and non-omega phases');
context.direct=true;context.enabledPhases=['BCC','OMEGA'];context.syncPhaseMarkerControls();
assert.equal($('bcc-marker').closest('label').hidden,false);assert.equal($('omega-marker').closest('label').hidden,false);
assert.equal($('fcc-marker').closest('label').hidden,true);
assert.ok(!fs.readFileSync('web/index.html','utf8').includes('id="search-beta-omega"'));
console.log('Ordinary phase controls: relative/calibrated searches, legacy migration and explicit phase selection passed.');

// Exercise the actual SVG renderer with the existing shape/visibility controls.
context.el=(tag,attrs={},text)=>({tag,attrs,text,children:[],append(...nodes){this.children.push(...nodes)},removeAttribute(k){delete this.attrs[k]}});
const components=[['beta',[1,0]],['omega3',[0,1]],['omega4',[-1,1]]].map(([id,q],i)=>({id,label:id,color:['#63b3ff','#ffc766','#c4a0ff'][i],active:true,predicted_nodes:[{q,hkl:[1,0,0]}]}));
const assignments=components.map((c,i)=>({profile_id:i+1,component:c.id,compatible_components:[c.id],predicted_q:c.predicted_nodes[0].q,observed_spots:[c.predicted_nodes[0].q]}));
assignments.push({profile_id:4,component:'unexplained',compatible_components:[],observed_spots:[[.3,.2]],geometry_diagnostic:{compatible_components:['omega3']}});
const model={beta_omega:{components,assignments,selected:true,fit:{valid:true}}},qp=(x,y)=>[210+20*x,210-20*y];
const host=context.el('svg');controls.set('fft-overlay',host);
$('overlay').value='winner';$('bcc-marker').value='square';$('peak-marker').value='diamond';$('show-forbidden').checked=true;
function draw(){host.children=[];context.drawBetaOmega(model,qp);return host.children}
function predictions(nodes,phase){return nodes.filter(n=>n.attrs['data-marker-kind']==='prediction'&&n.attrs['data-marker-phase']===phase)}
model.beta_omega.selected=false;$('overlay').value='related';$('omega-marker').value='diamond';
assert.equal(predictions(draw(),'OMEGA').length,4,'Explicit related overlay draws every active variant even when it loses ranking');
assert.equal(predictions(draw(),'BCC').length,2);
$('overlay').value='winner';assert.equal(draw().length,0,'Unselected related fit does not replace the true winner');
model.beta_omega.selected=true;
for(const shape of ['circle','diamond','square','triangle','crosshair','open-crosshair','off']){
 $('omega-marker').value=shape;const nodes=draw(),omega=predictions(nodes,'OMEGA');
 assert.equal(omega.length,shape==='off'?0:4,'Omega predictions respect '+shape);
 assert.ok(omega.every(n=>n.attrs['data-marker-shape']===shape));
 assert.equal(predictions(nodes,'BCC').length,2,'Omega choice leaves parent visible');
 assert.ok(predictions(nodes,'BCC').every(n=>n.attrs['data-marker-shape']==='square'));
 assert.equal(new Set(omega.map(n=>n.attrs.stroke)).size,shape==='off'?0:2,'Variant colours remain distinct');
}
const modelBefore=JSON.stringify(model);
context.phaseColors.BCC='#ff8ac3';context.phaseColors.OMEGA='#39ff5a';
$('omega-marker').value='diamond';
const recolored=draw();
assert.ok(predictions(recolored,'BCC').every(n=>n.attrs.stroke==='#ff8ac3'),'Parent follows selected BCC colour');
assert.ok(recolored.filter(n=>n.attrs['data-beta-omega-component']==='omega3').every(n=>n.attrs.stroke==='#79bafa'),'Variant 3 has a stable independent colour');
assert.ok(recolored.filter(n=>n.attrs['data-beta-omega-component']==='omega4').every(n=>n.attrs.stroke==='#ff8ac3'),'Variant 4 has a distinct bright colour');
$('omega-color-by').value='phase';
assert.ok(predictions(draw(),'OMEGA').every(n=>n.attrs.stroke==='#39ff5a'),'Phase mode follows the chosen omega colour for every variant');
assert.equal(context.betaOmegaColorTarget(components[1]),'phase:OMEGA');
$('omega-color-by').value='variant';
assert.equal(context.betaOmegaColorTarget(components[1]),'variant:omega3');
assert.equal(JSON.stringify(model),modelBefore,'Display colours do not change fitted data');
const allVariants={components:[{id:'beta'},...Array.from({length:4},(_,i)=>({id:'omega'+(i+1),active:true}))]};
context.phaseColors.OMEGA='#f4f7fb';
assert.equal(new Set(allVariants.components.slice(1).map(c=>context.betaOmegaComponentColor(c,allVariants))).size,4,'Variant colours stay distinct regardless of phase colour');
const palette=allVariants.components.map(c=>context.betaOmegaComponentColor(c,allVariants));
allVariants.components.reverse().forEach(c=>c.active=false);
assert.deepEqual(allVariants.components.map(c=>context.betaOmegaComponentColor(c,allVariants)).reverse(),palette,'Neither order nor support changes variant colours');
$('omega-marker').value='triangle';$('bcc-marker').value='off';let nodes=draw();
assert.equal(predictions(nodes,'BCC').length,0);assert.equal(predictions(nodes,'OMEGA').length,4);
assert.ok(nodes.filter(n=>n.attrs['data-beta-omega-assignment']).every(n=>n.attrs['data-marker-shape']==='diamond'&&n.attrs['data-marker-kind']==='measured'&&n.attrs.stroke==='#ffffff'&&!n.attrs['data-legend-label']),'Assignments retain standard measured markers without separate observation legend entries');
$('peak-marker').value='off';nodes=draw();assert.equal(nodes.filter(n=>n.attrs['data-beta-omega-assignment']).length,0);
assert.equal(nodes.filter(n=>n.attrs['data-beta-omega-absence']).length,1,'Absence display is independent of measured markers');
$('show-forbidden').checked=false;nodes=draw();assert.equal(nodes.filter(n=>n.attrs['data-beta-omega-absence']).length,0);
vm.runInContext("betaOmegaHidden.add('omega3')",context);nodes=draw();
assert.equal(nodes.filter(n=>n.attrs['data-beta-omega-component']==='omega3').length,0,'Component visibility still applies');
$('peak-marker').value='circle';nodes=draw();
assert.equal(nodes.filter(n=>n.attrs['data-measured-profile']).length,4,'Hiding predictions does not hide measured spots');
assert.equal(nodes.filter(n=>n.attrs['data-profile-number']).length,0,'Peak numbers default off');
$('show-peak-numbers').checked=true;nodes=draw();assert.equal(nodes.filter(n=>n.attrs['data-profile-number']).length,4);
$('show-peak-numbers').checked=false;nodes=draw();assert.equal(nodes.filter(n=>n.attrs['data-profile-number']).length,0);
// Linked FFT exports can carry one position per profile, whereas the normal
// FFT renderer shows both conjugates. Direct diffraction must not invent spots.
model.beta_omega.observation_kind='image_fft';
$('show-peak-numbers').checked=true;
nodes=draw();
assert.equal(nodes.filter(n=>n.attrs['data-measured-profile']).length,8,'Linked FFT retains both measured peak markers per profile');
assert.equal(nodes.filter(n=>n.attrs['data-profile-number']).length,8);
model.spectrum={peaks:[{profile_id:1,qx:1,qy:0,observed_spots:[[1,0]],manual_observed_spots:[[1,0]]}]};
nodes=draw();
assert.equal(nodes.filter(n=>n.attrs['data-measured-profile']).length,7,'Explicit observed positions retain their own display contract');
assert.ok(nodes.some(n=>n.attrs['data-measured-profile']===1&&n.attrs.stroke==='#ff8ac3'));
delete model.spectrum;delete model.beta_omega.observation_kind;
assert.equal(draw().filter(n=>n.attrs['data-measured-profile']).length,4,'Direct diffraction shows only observed spots');
$('show-peak-numbers').checked=false;
console.log('Linked markers: all shapes, Off, measured styles, absence toggle and variant visibility passed.');

// Coincident positions retain one independently animated shape per phase.
context.phaseColors.BCC='#f4b75e';
vm.runInContext('betaOmegaHidden.clear()',context);
$('bcc-marker').value='square';$('omega-marker').value='diamond';
components[1].predicted_nodes=[{q:[1,0],hkl:[2,0,0]}];
components[2].predicted_nodes=[{q:[1,0],hkl:[0,2,0]}];
let shared=draw().filter(n=>n.attrs['data-shared-prediction']);
assert.equal(shared.length,2,'Opposite shared positions each get one group');
const descendants=n=>n.children.flatMap(c=>[c,...descendants(c)]);
const segments=group=>descendants(group).filter(n=>n.attrs?.['data-marker-kind']==='prediction');
const layers=group=>group.children.filter(n=>n.attrs?.['data-shared-phase']);
assert.equal(layers(shared[0]).length,2,'Beta and omega get separate concentric symbols');
assert.equal(segments(shared[0]).length,3,'Both omega variant colours remain represented');
assert.equal(new Set(segments(shared[0]).map(n=>n.attrs.stroke)).size,3);
assert.ok(segments(shared[0]).every(n=>!n.attrs.class),'Colours within a phase animate together');
const [betaSymbol,omegaSymbol]=layers(shared[0]);
assert.equal(betaSymbol.attrs['data-marker-shape'],'square');
assert.equal(omegaSymbol.attrs['data-marker-shape'],'diamond');
assert.equal(betaSymbol.attrs['data-motion-offset'],.75);
assert.equal(omegaSymbol.attrs['data-motion-offset'],.5,'Omega keeps its own phase timing');
assert.ok(omegaSymbol.attrs['data-marker-radius']>betaSymbol.attrs['data-marker-radius']);
assert.ok(!shared[0].attrs.class,'The shared parent does not impose an additional animation');
const symbolCenter=s=>[s.children[0].attrs.x+s.children[0].attrs.width/2,s.children[0].attrs.y+s.children[0].attrs.height/2];
assert.deepEqual(symbolCenter(betaSymbol),symbolCenter(omegaSymbol),'Symbols rotate about exactly the same spot');
for(const mode of ['circle','diamond','square','triangle','crosshair','open-crosshair']){
 $('omega-marker').value=mode;shared=draw().filter(n=>n.attrs['data-shared-prediction']);
 const symbol=layers(shared[0])[1],parts=segments(symbol);
 assert.equal(symbol.attrs['data-marker-shape'],mode);assert.equal(parts.length,2);
 assert.ok(parts.every(n=>n.tag==='path'&&n.attrs.d&&!/NaN|Infinity/.test(n.attrs.d)));
 assert.equal(parts[0].attrs.d.includes('A'),mode==='circle','Only circle choice uses circular arcs');
 assert.deepEqual(symbolCenter(symbol),symbolCenter(layers(shared[0])[0]),'Even triangles retain a concentric animation origin');
}
$('omega-marker').value='diamond';
vm.runInContext("betaOmegaHidden.add('omega3')",context);
shared=draw().filter(n=>n.attrs['data-shared-prediction']);assert.equal(segments(shared[0]).length,2);
assert.equal(layers(shared[0]).length,2,'Hiding one omega variant retains both phase symbols');
$('bcc-marker').value='off';nodes=draw();
assert.equal(nodes.filter(n=>n.attrs['data-shared-prediction']).length,0,'One visible contributor restores its standalone symbol');
assert.equal(predictions(nodes,'OMEGA').length,2);
assert.ok(predictions(nodes,'OMEGA').every(n=>n.attrs['data-marker-shape']==='diamond'));
vm.runInContext('betaOmegaHidden.clear()',context);
shared=draw().filter(n=>n.attrs['data-shared-prediction']);
assert.equal(layers(shared[0]).length,1,'Two omega variants combine into a single omega symbol');
assert.equal(segments(shared[0]).length,2);
$('omega-color-by').value='phase';shared=draw().filter(n=>n.attrs['data-shared-prediction']);
assert.equal(new Set(segments(shared[0]).map(n=>n.attrs.stroke)).size,1,'Phase colour choice still applies within the combined omega symbol');
$('omega-color-by').value='variant';$('bcc-marker').value='square';
components[2].predicted_nodes=[{q:[1.001,0],hkl:[0,2,0]}];
shared=draw().filter(n=>n.attrs['data-shared-prediction']);
assert.equal(segments(shared[0]).length,2,'Nearby but distinct predictions are not merged');
// Four-colour symbols remain self-contained and work for every supported shape.
for(const mode of ['circle','diamond','square','triangle','crosshair','open-crosshair']){
 const entries=Array.from({length:4},(_,i)=>({shapeMode:mode,attrs:{stroke:['red','blue','green','pink'][i],'data-marker-phase':'OMEGA','data-marker-kind':'prediction'}}));
 const symbol=context.sharedPredictionSymbols(14,12,entries,7,4,false);
 assert.equal(layers(symbol).length,1);assert.equal(segments(symbol).length,4);
 assert.ok(descendants(symbol).every(n=>!n.attrs.class),'Legend symbols stay stationary in live views and exports');
}
console.log('Shared predictions: concentric phase shapes, independent timing, split variant colours, all shapes and visibility passed.');

// Editing a legend colour is display-only and remembers phase/variant choices separately.
context.PHASE_COLOR_OPTIONS={gold:['Gold','#f4b75e'],purple:['Purple','#b49aff']};
context.phaseColorChoices={BCC:'gold',OMEGA:'purple'};
context.Option=function(label,value){this.textContent=label;this.value=value;this.dataset={}};
const saved=new Map();context.writePreference=(key,value)=>saved.set(key,JSON.parse(JSON.stringify(value)));
context.result=model;context.renderEvidence=()=>{};context.renderModels=()=>{};context.renderFitChoices=()=>{};context.renderBetaOmega=()=>{};context.drawFFT=()=>{};context.applyPhaseColors=()=>{};
vm.runInContext(appSource.slice(appSource.indexOf('const isHexColor='),appSource.indexOf('let enabledPhases=')),context);
vm.runInContext(appSource.slice(appSource.indexOf('function editLegendColor('),appSource.indexOf('function renderFitChoices(')),context);
for(const id of ['omega-color','bcc-color']){
 const field=$(id);field.options=[];field.querySelectorAll=()=>field.options;field.append=option=>{option.remove=()=>field.options.splice(field.options.indexOf(option),1);field.options.push(option)};
}
const fitBeforeEdit=JSON.stringify(model);
context.editLegendColor({target:{dataset:{legendColorTarget:'variant:omega3'},value:'#66ddff'}});
assert.equal(saved.get('tem-omega-variant-colors').omega3,'#66ddff');
assert.equal(context.betaOmegaComponentColor(components[1],model.beta_omega),'#66ddff');
assert.equal(context.phaseColorChoices.OMEGA,'purple','Editing a variant leaves the common phase colour alone');
context.enabledPhases=['BCC'];
context.editLegendColor({target:{dataset:{legendColorTarget:'phase:OMEGA'},value:'#bb88ff'}});
assert.equal($('omega-color').value,'disabled','A linked colour edit does not enable a standalone search');
assert.equal(saved.get('tem-phase-colors').OMEGA,'#bb88ff');
assert.equal($('omega-color').options[0].value,'#bb88ff','Custom colour remains available in the phase dropdown');
context.editLegendColor({target:{dataset:{legendColorTarget:'phase:OMEGA'},value:'#bad'}});
assert.equal(saved.get('tem-phase-colors').OMEGA,'#bb88ff','Invalid saved colour is rejected');
assert.equal(JSON.stringify(model),fitBeforeEdit,'Legend editing leaves numerical fitting data untouched');
console.log('Legend edits: separate persistence, custom phase option, validation and unchanged search/fits passed.');

// Compact aliases use support, never visibility; old cached results are supported.
const aliases={components:[{id:'beta',active:true},{id:'omega1',active:false},{id:'omega2',active:false},{id:'omega3',active:true},{id:'omega4',active:true}]};
assert.equal(context.betaOmegaLabel('omega3',aliases),'ω₁');assert.equal(context.betaOmegaLabel('omega4',aliases),'ω₂');
vm.runInContext("betaOmegaHidden.add('omega3')",context);
assert.equal(context.betaOmegaLabel('omega4',aliases),'ω₂');
assert.deepEqual(Array.from(context.betaOmegaComponents(aliases),c=>c.id),['beta','omega3','omega4','omega1','omega2']);
assert.match(context.betaOmegaIdentity({...aliases.components[3],c_axis_beta:[-1,1,-1]},aliases),/orientation ID omega3/);
context.chosenFits=new Set(['linked-omega4']);$('overlay').value='custom';
assert.equal(context.betaOmegaOverlayActive({beta_omega:aliases}),true);
assert.equal(context.betaOmegaComponentHidden('beta'),true);assert.equal(context.betaOmegaComponentHidden('omega4'),false);
context.chosenFits.clear();assert.equal(context.betaOmegaOverlayActive({beta_omega:aliases}),false);
console.log('Aliases and custom overlays: consecutive display labels, stable IDs/visibility and partial linked selection passed.');

// Every phase's independent orientations share the same colour policy. Shared
// assignments use split phase symbols, even when fitted positions differ slightly.
const bccFits=[0,1].map(i=>({phase:'BCC',zone_3index:[0,1,1],rotation_deg:i*70.5,score:.6-i*.01,valid:true,
 predicted_nodes:[{q:[1+i*.01,0],hkl:[1,1,0]}],matches:[{node_index:0,profile_id:1,observed_q:[1,0]}]}));
context.compareRank=(a,b)=>b.score-a.score;
context.planeLabel=(m,hkl,sign=1)=>'('+hkl.map(v=>v*sign).join(' ')+')';
context.result={models:bccFits,spectrum:{peaks:[]}};$('omega-color-by').value='variant';
const colours=bccFits.map(m=>context.independentFitStyle(m));
assert.deepEqual(colours.map(s=>s.name),['BCC','BCC'],'Internal colour-slot numbers stay out of fit names');
assert.notEqual(colours[0].color,colours[1].color);
context.chosenFits=new Set(['phase-1']);
assert.equal(context.independentFitStyle(bccFits[1]).colorTarget,'orientation:BCC:2','Hiding another fit does not change its colour identity');
context.editLegendColor({target:{dataset:{legendColorTarget:'orientation:BCC:2'},value:'#1234ab'}});
assert.equal(saved.get('tem-fit-variant-colors')['BCC:2'],'#1234ab');
assert.equal(context.independentFitStyle(bccFits[1]).color,'#1234ab');
$('omega-color-by').value='phase';assert.equal(context.independentFitStyle(bccFits[1]).color,context.phaseColors.BCC);
$('omega-color-by').value='variant';assert.equal(context.independentFitStyle(bccFits[1]).color,'#1234ab');
vm.runInContext(appSource.slice(appSource.indexOf('function drawFitPredictions('),appSource.indexOf('function drawFFT(')),context);
host.children=[];$('bcc-marker').value='square';
context.drawFitPredictions(bccFits.map(model=>({model,...context.independentFitStyle(model)})),qp);
assert.equal(host.children.length,2,'Opposite positions get separate shared symbols');
assert.equal(layers(host.children[0]).length,1,'Two BCC orientations share their phase shape');
assert.equal(segments(host.children[0]).length,2);
assert.equal(new Set(segments(host.children[0]).map(n=>n.attrs.stroke)).size,2);
assert.ok(segments(host.children[0]).every(n=>n.attrs['data-legend-label']==='BCC [0 1 1]'));
assert.ok(segments(host.children[0]).some(n=>n.attrs['data-legend-color-target']==='orientation:BCC:2'));
$('bcc-marker').value='off';host.children=[];
context.drawFitPredictions(bccFits.map(model=>({model,...context.independentFitStyle(model)})),qp);
assert.equal(host.children.length,0);
for(const phase of ['HCP','FCC','ORT','OMEGA']){
 context.phaseColors[phase]='#79bafa';const fit={...bccFits[0],phase};context.result={models:[fit]};
 assert.equal(context.independentFitStyle(fit).colorTarget,'orientation:'+phase+':1');
}
console.log('All-phase orientation colours: stable labels, separate editable colours, phase switching, shared shapes and Off passed.');

// Component inspectors reuse the same renderer without writing into the main SVG.
const componentSource=fs.readFileSync('web/shared-spectra.js','utf8');
vm.runInContext(componentSource.slice(componentSource.indexOf('function drawComponentFitOverlay('),componentSource.indexOf("if(typeof module!==")),context);
const popup=context.el('g');popup.replaceChildren=function(){this.children=[]};
$('show-spectrum-overlays').getAttribute=()=> 'true';$('bcc-marker').value='square';$('peak-marker').value='circle';$('show-peak-numbers').checked=true;
host.children=[];const detail={g_max:10,candidates:bccFits,peaks:[{profile_id:0,qx:1,qy:0}]},beforeDetail=JSON.stringify(detail);
context.drawComponentFitOverlay(popup,detail,new Set([0,1]));
assert.equal(host.children.length,0,'Inspector drawing cannot change the main image');
assert.equal(popup.children.filter(n=>n.attrs['data-marker-kind']==='measured').length,2);
assert.equal(popup.children.filter(n=>n.attrs['data-profile-number']===1).length,2);
assert.equal(segments(popup.children[0]).length,2,'Shared assignments retain split variant colours');
assert.equal(layers(popup.children[0])[0].attrs['data-marker-shape'],'square');
assert.equal(layers(popup.children[0])[0].attrs['data-motion-offset'],.75,'Shared main animation timing');
$('peak-marker').value='off';$('bcc-marker').value='off';context.drawComponentFitOverlay(popup,detail,new Set([0,1]));assert.equal(popup.children.length,0);
$('show-spectrum-overlays').getAttribute=()=> 'false';$('peak-marker').value='circle';context.drawComponentFitOverlay(popup,detail,new Set([0]));assert.equal(popup.children.length,0);
assert.equal(JSON.stringify(detail),beforeDetail,'Display changes leave fitting data intact');
console.log('Component overlays reuse main shapes, numbering, animation, shared variants and master visibility.');

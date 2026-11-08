// Search selection is independent of calibration; old image choices migrate.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const controls=new Map();
function $(id){if(!controls.has(id)){const label={hidden:false};controls.set(id,{value:'winner',checked:false,disabled:false,closest:()=>label})}return controls.get(id)}
const anchorPanel={hidden:false};
const context={$ ,phaseColors:{BCC:'#f4b75e',OMEGA:'#b49aff'},PHASES:['HCP','BCC','FCC','ORT','OMEGA'],enabledPhases:['BCC'],meta:{reciprocal_calibrated:false},direct:true,diffractionSettings:{},document:{querySelector:()=>anchorPanel},
 isDiffraction:()=>context.direct,readPreference:(key,fallback)=>fallback};
vm.createContext(context);vm.runInContext(fs.readFileSync('web/beta-omega.js','utf8'),context);
const appSource=fs.readFileSync('web/app.js','utf8');
vm.runInContext(appSource.slice(appSource.indexOf('function markerMotionOffset('),appSource.indexOf('function weakMarker(')),context);
vm.runInContext('syncRelativeUnits=()=>{}',context);
context.setupBetaOmegaSearch();assert.equal($('search-beta-omega').checked,false,'Uncalibrated does not select beta/omega');
assert.equal($('omega-marker').closest('label').hidden,true);assert.equal($('bcc-marker').closest('label').hidden,false);
assert.equal($('search-beta-omega').disabled,false);assert.equal(anchorPanel.hidden,true);
context.diffractionSettings={indexing_model:'beta_omega'};context.setupBetaOmegaSearch();
assert.equal($('search-beta-omega').checked,true,'Old image preference migrates');assert.equal($('overlay').value,'beta_omega');
assert.equal($('omega-marker').closest('label').hidden,false,'Linked search exposes omega marker style');
context.meta.reciprocal_calibrated=true;context.setupBetaOmegaSearch();
assert.equal($('search-beta-omega').checked,true,'Same search is available with calibration');
context.diffractionSettings.search_beta_omega=false;context.setupBetaOmegaSearch();
assert.equal($('search-beta-omega').checked,false,'Explicit new choice overrides old mode');
context.direct=false;context.setupBetaOmegaSearch();assert.equal($('search-beta-omega').disabled,true);
context.enabledPhases=['HCP'];context.syncPhaseMarkerControls();
assert.equal($('hcp-marker').closest('label').hidden,false);assert.equal($('bcc-marker').closest('label').hidden,true);
context.direct=true;$('search-beta-omega').checked=true;context.syncPhaseMarkerControls();
assert.equal($('bcc-marker').closest('label').hidden,false);assert.equal($('omega-marker').closest('label').hidden,false);
assert.equal($('fcc-marker').closest('label').hidden,true);
console.log('Beta + Omega: optional calibrated/uncalibrated search, legacy migration and explicit opt-out passed.');

// Exercise the actual SVG renderer with the existing shape/visibility controls.
context.el=(tag,attrs={},text)=>({tag,attrs,text,children:[],append(...nodes){this.children.push(...nodes)}});
const components=[['beta',[1,0]],['omega3',[0,1]],['omega4',[-1,1]]].map(([id,q],i)=>({id,label:id,color:['#63b3ff','#ffc766','#c4a0ff'][i],active:true,predicted_nodes:[{q,hkl:[1,0,0]}]}));
const assignments=components.map((c,i)=>({profile_id:i+1,component:c.id,compatible_components:[c.id],predicted_q:c.predicted_nodes[0].q,observed_spots:[c.predicted_nodes[0].q]}));
assignments.push({profile_id:4,component:'unexplained',compatible_components:[],observed_spots:[[.3,.2]],geometry_diagnostic:{compatible_components:['omega3']}});
const model={beta_omega:{components,assignments}},qp=(x,y)=>[210+20*x,210-20*y];
const host=context.el('svg');controls.set('fft-overlay',host);
$('overlay').value='beta_omega';$('bcc-marker').value='square';$('peak-marker').value='diamond';$('show-forbidden').checked=true;
function draw(){host.children=[];context.drawBetaOmega(model,qp);return host.children}
function predictions(nodes,phase){return nodes.filter(n=>n.attrs['data-marker-kind']==='prediction'&&n.attrs['data-marker-phase']===phase)}
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
assert.ok(recolored.filter(n=>n.attrs['data-beta-omega-component']==='omega3').every(n=>n.attrs.stroke==='#39ff5a'),'First supported variant uses selected omega colour');
assert.ok(recolored.filter(n=>n.attrs['data-beta-omega-component']==='omega4').every(n=>n.attrs.stroke==='#2ecc48'),'Other variant uses a shade of selected omega colour');
assert.equal(JSON.stringify(model),modelBefore,'Display colours do not change fitted data');
const allVariants={components:[{id:'beta'},...Array.from({length:4},(_,i)=>({id:'omega'+(i+1),active:true}))]};
context.phaseColors.OMEGA='#f4f7fb';
assert.equal(new Set(allVariants.components.slice(1).map(c=>context.betaOmegaComponentColor(c,allVariants))).size,4,'White also gives four distinct shades');
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
console.log('Linked markers: all shapes, Off, measured styles, absence toggle and variant visibility passed.');

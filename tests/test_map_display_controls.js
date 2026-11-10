// Changing map presentation preserves the metric, phase and sampling data.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/app.js','utf8'),controls=new Map(),storage=new Map();
const $=id=>{if(!controls.has(id))controls.set(id,{value:id==='map-mode'?'support':'all',replaceChildren(...options){this.options=options;this.value=options[0]?.value||''}});return controls.get(id)};
const context={$ ,result:null,Option:class{constructor(text,value){this.text=text;this.value=value}},grid:{grid:{mode:'overlap'},settings:{},regions:[]},draws:0,
 readPreference:(key,fallback)=>storage.get(key)??fallback,writePreference:(key,value)=>storage.set(key,value),drawOverlapMap(){context.draws++}};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function supportMapView('),source.indexOf('function supportTriangleLegend(')),context);
vm.runInContext(source.slice(source.indexOf("for(const id of ['map-mode','map-display','map-phase'])"),source.indexOf('const savedMapSymbol=')),context);
assert.equal(context.selectedMapView(),'support');
$('map-phase').value='BCC';$('map-display').value='hex';$('map-display').onchange();
assert.equal(context.selectedMapView(),'hex_support');assert.equal($('map-phase').value,'BCC');
$('map-mode').value='strength';$('map-mode').onchange();
assert.equal(context.selectedMapView(),'hex_strength');assert.equal($('map-phase').value,'all','Strength starts with all phases');
assert.equal(storage.get('tem-map-mode'),'strength');assert.equal(storage.get('tem-map-display'),'hex');
for(const [mode,view,display]of [['top','hex','hex'],['raw','raw','centres'],['samples','samples','continuous'],['spread','spread','continuous'],['separate','separate','continuous']]){
 $('map-mode').value=mode;$('map-mode').onchange();
 assert.equal(context.selectedMapView(),view);assert.equal($('map-display').value,display);assert.equal($('map-display').disabled,true);
}
$('map-phase').value='BCC';$('map-mode').value='support';$('map-mode').onchange();
assert.equal(context.selectedMapView(),'hex_support','Returning to a compatible metric restores the preferred representation');
$('map-display').value='continuous';$('map-display').onchange();
assert.equal(context.selectedMapView(),'support');assert.equal($('map-display').disabled,false);
assert.equal(JSON.stringify(context.grid),JSON.stringify({grid:{mode:'overlap'},settings:{},regions:[]}));

// DD has its own count, never changes the single-scattering denominator or coverage.
vm.runInContext(source.slice(source.indexOf('function predictionCounts('),source.indexOf('function evidenceDescription(')),context);
const model={matched_prediction_count:14,predicted_visible_band_node_count:14,peak_evidence:{weak_count:0},coverage:.7,
 double_diffraction:{status:'complete',profile_count:6}};
const before=JSON.stringify(model);
assert.equal(context.predictionCounts(model),'14+0w/14 +6DD');
assert.equal(JSON.stringify(model),before);
assert.match(context.doubleDiffractionCountHelp(model.double_diffraction),/not added to the prediction denominator/);
assert.equal(context.doubleDiffractionCount({status:'complete',profile_count:0}),'+0DD');
assert.equal(context.doubleDiffractionCount({status:'unavailable',profile_count:0}),'DD —');
assert.equal(context.doubleDiffractionCount(null),'DD —');
assert.match(context.doubleDiffractionCountHelp({status:'partial',profile_count:3}),/partial search/);
const weighted={coverage:.6,matches:[{profile_id:1}],double_diffraction:{status:'complete',allowed_profile_ids:[1],profile_ids:[1,2,2]}};
const peaks=[{profile_id:1,weight:6},{profile_id:2,weight:1},{profile_id:3,weight:3}];
assert.equal(context.coverageWithDD(weighted,peaks),.7,'DD adds measured weight, not an unweighted profile fraction; shared IDs count once');
context.result={spectrum:{peaks}};assert.equal(context.coverageCounts(weighted),'60% | 70%');
assert.equal(context.coverageWithDD(weighted,[]),null,'Missing weights never mix weighted and unweighted coverage');
assert.equal(context.coverageWithDD({...weighted,double_diffraction:{status:'complete',profile_ids:[]}},[]),.6);
console.log('Map mode/display independence, preference restoration, phase preservation and distinct DD counts passed.');

// Exercise the actual map renderer: rim visibility never changes aggregation,
// and opacity normalisation uses one factor without changing phase colours.
const {element}=require('./svg_fixture'),mapControls=new Map(),preferences=new Map();
const control=id=>{if(!mapControls.has(id)){const n=element('div');n.dataset={};n.querySelector=()=>({disabled:false});mapControls.set(id,n)}return mapControls.get(id)};
const cell=(x,k)=>({x,y:0,cx:x+.5,cy:.5,samples:2,passes:1,region_id:'r'+x,phases:{BCC:{support:.8*k,passing_strength:.4*k},OMEGA:{support:.2*k,passing_strength:.1*k}}});
const mapData={id:'map1',grid:{mode:'overlap',spacing_nm:2,passes:1},settings:{},regions:[
 {id:'inside',roi:{x:2,y:2,w:4,h:4},label:'bcc_compatible'},
 {id:'rim',rim:true,roi:{x:0,y:2,w:4,h:4},label:'bcc_compatible'}],
 aggregation:{width:2,height:1,cells:[cell(0,1),cell(1,.5)],hex:{radius_x:1,radius_y:1,cells:[cell(0,1),cell(1,.5)]}}};
const mapContext={$:control,el:element,document:{createElement:tag=>{const n=element(tag);n.dataset={};return n}},
 grid:mapData,meta:{width:10,height:10,pixel_x_nm:1},zoneJob:'map1',phaseMaps:()=>({BCC:new Map(),OMEGA:new Map()}),
 analysisPhases:()=>['BCC','OMEGA'],phaseLabel:p=>p,phaseColors:{BCC:'#39ff5a',OMEGA:'#b49aff'},colors:{bcc_compatible:'#39ff5a'},
 clamp:(v,lo,hi)=>Math.max(lo,Math.min(hi,v)),compareRank:(a,b)=>b.score-a.score,
 readPreference:(key,fallback)=>preferences.get(key)??fallback,writePreference:(key,value)=>preferences.set(key,value),
 syncMapOpacityControl(){},hideRegionPreview(){},ensurePassingStrength(){},renderClassLegend(){},renderZoneLegend(){},renderGridSummary(){},updatePenaltyControls(){}};
vm.createContext(mapContext);
vm.runInContext(fs.readFileSync('web/phase-blend.js','utf8'),mapContext);
vm.runInContext(source.slice(source.indexOf('function supportMapView('),source.indexOf('function selectedMapView(')),mapContext);
vm.runInContext(source.slice(source.indexOf('function selectedMapView('),source.indexOf('function syncMapDisplay(')),mapContext);
vm.runInContext(source.slice(source.indexOf('function drawOverlapMap('),source.indexOf("for(const id of ['map-mode'")),mapContext);
vm.runInContext(source.slice(source.indexOf('const savedMapSymbol='),source.indexOf('function syncZoneToggle(')),mapContext);
control('map-mode').value='raw';control('map-symbol').value='circle';control('show-grid').checked=true;control('grid-opacity').value='80';
const original=JSON.stringify(mapData);mapContext.drawOverlapMap();
assert.equal(control('grid-map').querySelectorAll('circle').length,2);
control('map-show-rim').checked=false;control('map-show-rim').onchange();
assert.equal(control('grid-map').querySelectorAll('circle').length,1);
assert.equal(control('grid-map').children[0].attrs['data-id'],'inside');assert.equal(preferences.get('tem-map-show-rim'),false);
mapData.state='running';mapContext.drawOverlapMap();
assert.equal(control('grid-map').querySelectorAll('circle').length,2,'Rim points stay visible while this grid runs');
assert.equal(control('map-show-rim').checked,false,'The saved display preference is preserved');
for(const state of ['complete','cancelled','error']){
 mapData.state=state;mapContext.drawOverlapMap();
 assert.equal(control('grid-map').querySelectorAll('circle').length,1,'Stopped grids restore the chosen rim display');
}
delete mapData.state;
control('map-mode').value='strength';control('map-display').value='continuous';control('map-phase').value='all';mapContext.drawOverlapMap();
const normalized=control('grid-map').querySelectorAll('rect').map(n=>({...n.attrs}));
assert.equal(normalized[0]['fill-opacity'],.8,'Maximum displayed strength reaches the slider opacity');
assert.equal(normalized[1]['fill-opacity'],.8*(.15+.85*.5));
assert.equal(control('map-rim-label').hidden,true);assert.equal(control('zone-legend').hidden,true);assert.equal(control('map-colour-key').hidden,false);
control('map-normalize').checked=false;control('map-normalize').onchange();
const absolute=control('grid-map').querySelectorAll('rect');
assert.equal(absolute[0].attrs['fill-opacity'],.8*(.15+.85*.4));
assert.deepEqual(absolute.map(n=>n.attrs.fill),normalized.map(n=>n.fill),'Normalisation changes opacity, never phase proportions');
control('map-normalize').checked=true;control('map-display').value='hex';mapContext.drawOverlapMap();
assert.equal(control('grid-map').querySelectorAll('polygon')[0].attrs['fill-opacity'],.8,'Hex and continuous strength use the same maximum');
control('map-mode').value='support';mapContext.drawOverlapMap();
assert.equal(control('grid-map').querySelectorAll('polygon')[0].attrs['fill-opacity'],.8,'Passing frequency reaches the same selected maximum opacity');
control('map-phase').value='BCC';mapContext.drawOverlapMap();
assert.equal(control('zone-legend').hidden,true);assert.equal(control('map-colour-key').hidden,false,'Scalar keys use the same host as the triangle');
assert.equal(mapContext.mapSupportScale({cells:[{phases:{BCC:{support:0}}}]},'support',['BCC']),0);
assert.match(mapContext.mapOpacityDescription('support',0),/No positive passing support/);
assert.equal(JSON.stringify(mapData),original,'Visibility and opacity changes preserve every sampled window and measured value');
console.log('Map rendering: rim-only hiding, scalar keys, shared opacity normalisation, fixed-scale restoration, zero support and unchanged data passed.');

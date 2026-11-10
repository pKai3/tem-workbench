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
assert.equal(context.selectedMapView(),'hex_strength');assert.equal($('map-phase').value,'BCC');
assert.equal(storage.get('tem-map-mode'),'strength');assert.equal(storage.get('tem-map-display'),'hex');
for(const [mode,view,display]of [['top','hex','hex'],['raw','raw','centres'],['samples','samples','continuous'],['spread','spread','continuous'],['separate','separate','continuous']]){
 $('map-mode').value=mode;$('map-mode').onchange();
 assert.equal(context.selectedMapView(),view);assert.equal($('map-display').value,display);assert.equal($('map-display').disabled,true);
}
$('map-mode').value='support';$('map-mode').onchange();
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

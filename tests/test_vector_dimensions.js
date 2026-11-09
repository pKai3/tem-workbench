const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/app.js','utf8');
function node(tag,attrs={},text=''){
 return {tag,attrs:{...attrs},text,children:[],append(...items){this.children.push(...items)},
  insertBefore(item,before){this.children.splice(this.children.indexOf(before),0,item)},
  setAttribute(key,value){this.attrs[key]=value},getComputedTextLength(){return plain(this).length*5}};
}
const plain=n=>n.text+n.children.map(plain).join(''),descendants=n=>n.children.flatMap(c=>[c,...descendants(c)]);
const controls=new Map(),$=id=>{if(!controls.has(id))controls.set(id,node('div'));return controls.get(id)};
const context={$ ,el:node,document:{createTextNode:text=>node('text-node',{},text)},clamp:(x,a,b)=>Math.max(a,Math.min(b,x)),
 zoneLabel:()=> '[0 1 1]',planeLabel:(m,h,s=1)=>'('+h.map(v=>v*s).join(' ')+')',reciprocalUnit:()=>context.relative?'rel.':'nm⁻¹',
 overlayModels:()=>context.models,vectorFitStyle:m=>({name:m.phase,color:'#ffffff',colorTarget:'phase:'+m.phase})};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function materialPhaseSymbol('),source.indexOf('const PHASE_DEFAULT_COLORS=')),context);
vm.runInContext(source.slice(source.indexOf('function vectorCellRatio('),source.indexOf('const VECTOR_MODES=')),context);
const hcp={phase:'HCP',fitted_a_nm:.295,fitted_c_nm:.468};
assert.equal(context.vectorCellSummary({phase:'BCC',fitted_a_nm:.33}),' · a 0.3300 nm');
assert.equal(context.vectorCellSummary(hcp),' · a 0.2950 nm · c 0.4680 nm · c/a 1.5864');
assert.equal(context.vectorCellRatio({...hcp,c_axis_visible:false}),' · c/a unconstrained');
assert.equal(context.vectorCellRatio({phase:'HCP',fitted_a_nm:.295,scale_mode:'auto_hcp_ratio'}),' · c/a unconstrained');
assert.equal(context.vectorCellSummary({phase:'ORT',fitted_a_nm:.4,fitted_b_nm:.5,fitted_c_nm:.6,axis_observable:[true,false,true]}),' · a 0.4000 nm · b unconstrained · c 0.6000 nm');
assert.equal(context.vectorCellSummary({...hcp,coordinate_units:'relative'}),' · c/a 1.5864');
assert.equal(context.vectorCellSummary({phase:'BCC',coordinate_units:'relative',fitted_a_nm:.33}),'');
assert.equal(context.vectorCellRatio({phase:'OMEGA',fitted_a_nm:.4614,fitted_c_nm:.2832}),' · c/a 0.6138');

const model={phase:'BCC',valid:true,fitted_a_nm:.33,matches:[
 {hkl:[1,1,0],observed_q:[2.31,0],predicted_q:[-2.32,0]},
 {hkl:[1,-1,0],observed_q:[0,2.34],predicted_q:[0,2.32]},
 {hkl:[1,0,0],observed_q:[1,1]}
]};
const fitted=context.matchedReflectionVectors(model);
assert.equal(fitted.length,2);assert.equal(fitted[0].g,2.32);assert.equal(fitted[1].g,2.32);
assert.equal(fitted[0].q[0],2.32);assert.equal(fitted[0].sign,-1);
assert.deepEqual(Array.from(fitted[0].hkl),[1,1,0]);
const changed=JSON.parse(JSON.stringify(model));changed.matches.forEach(m=>m.observed_q=[70,99]);
assert.equal(JSON.stringify(context.matchedReflectionVectors(changed)),JSON.stringify(fitted),'Observed positions never substitute for fitted vector coordinates');
assert.equal(context.matchedReflectionVectors({matches:[model.matches[2]]}).length,0,'Legacy matches without fitted positions cannot fall back to measured arrows');

model.predicted_nodes=[{q:[3,0],hkl:[2,0,0]},{q:[0,4],hkl:[0,2,0]},{q:[3,4],hkl:[2,2,0]}];
model.matches.forEach((m,i)=>m.node_index=i);
context.models=[model];context.result={spectrum:{peaks:[]}};
const render=(info,mode='fitted_winner')=>{
 $('fft-overlay').children=[];$('vector-info').value=info;$('reflection-vectors').value=mode;
 context.drawReflectionVectors((x,y)=>[210+20*x,210-20*y]);
 return descendants($('fft-overlay'));
};
const arrows=nodes=>nodes.filter(n=>n.attrs['data-reflection-vector']).map(n=>n.children.find(c=>c.tag==='path').attrs.d);
const minimal=render('off'),positions=arrows(minimal);
assert.equal(positions.length,3);assert.equal(minimal.filter(n=>n.attrs['data-vector-label']).length,3);
assert.equal(minimal.filter(n=>n.attrs['data-vector-key']).length,0,'Default leaves arrows and short labels without bottom-left boxes');
const summary=render('summary'),summaryBox=summary.find(n=>n.attrs['data-vector-key']);
assert.ok(summaryBox);assert.match(plain(summaryBox),/BCC.*∠/);assert.doesNotMatch(plain(summaryBox),/g \d|0\.3300 nm/);
assert.deepEqual(arrows(summary),positions);
const full=render('full'),fullBox=full.find(n=>n.attrs['data-vector-key']);
assert.match(plain(fullBox),/a 0\.3300 nm/);assert.match(plain(fullBox),/g 5\.000 nm⁻¹/);assert.deepEqual(arrows(full),positions);
const planes=render('off','planes_winner');assert.equal(arrows(planes).length,2);
assert.ok(planes.filter(n=>n.attrs['data-vector-label']).every(n=>/BCC \(/.test(plain(n))));
context.relative=true;model.coordinate_units='relative';
assert.doesNotMatch(plain($('fft-overlay')),/Measured reciprocal/);
const relative=render('full','planes_winner');assert.match(plain($('fft-overlay')),/g 2\.320 rel\./);assert.doesNotMatch(plain($('fft-overlay')),/ nm/);
assert.equal(render('full','off').length,0);

// Saved measured-plane choices migrate to fitted planes; info boxes start off.
context.PHASES=['HCP','BCC','FCC','ORT','OMEGA'];context.readPreference=(key,fallback)=>key==='tem-reflection-vectors'?'BCC':fallback;
context.syncOverlayMenus=(pattern,vectors)=>{$('overlay').value=pattern;$('reflection-vectors').value=vectors};
context.saved={};context.writePreference=(key,value)=>context.saved[key]=value;context.drawFFT=()=>{};
vm.runInContext(source.slice(source.indexOf('function fittedVectorMode('),source.indexOf('function syncOverlayMenus(')),context);
vm.runInContext(source.slice(source.indexOf('const VECTOR_MODES='),source.indexOf('\nstart();')),context);
assert.equal($('reflection-vectors').value,'planes_BCC');assert.equal($('vector-info').value,'off');
$('vector-info').value='summary';$('vector-info').onchange();assert.equal(context.saved['tem-vector-info'],'summary');
assert.equal(context.fittedVectorMode('off'),'off');assert.equal(context.fittedVectorMode('fitted_passing'),'fitted_passing');
console.log('Fitted vectors: fitted-only coordinates/cells, optional info boxes, unchanged arrows, relative units and preference migration passed.');

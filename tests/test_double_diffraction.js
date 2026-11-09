const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function node(tag,attrs={},text=''){return {tag,attrs,text,textContent:text,style:{},children:[],append(...v){this.children.push(...v)},replaceChildren(...v){this.children=v},removeAttribute(k){delete this.attrs[k]},setAttribute(k,v){this.attrs[k]=v}}}
const controls=new Map();function $(id){if(!controls.has(id))controls.set(id,Object.assign(node('div'),{value:'circle',checked:false}));return controls.get(id)}
const context={$ ,el:node,document:{createElement:tag=>node(tag)},phaseColors:{BCC:'#ff0000',OMEGA:'#00ff00',HCP:'#0000ff'},result:null,zoneLabel:()=> '[010]',planeLabel:(m,h)=>`(${h.join(' ')})`};
vm.createContext(context);vm.runInContext(fs.readFileSync('web/beta-omega.js','utf8'),context);vm.runInContext(fs.readFileSync('web/double-diffraction.js','utf8'),context);
const app=fs.readFileSync('web/app.js','utf8');vm.runInContext(app.slice(app.indexOf('function markerMotionOffset('),app.indexOf('function weakMarker(')),context);
vm.runInContext(app.slice(app.indexOf('function materialPhaseSymbol('),app.indexOf('const PHASE_DEFAULT_COLORS=')),context);
const step=(component,phase,id,hkl)=>({component,phase,profile_id:id,hkl});
const path={kind:'cross_component',steps:[step('beta','BCC',1,[0,1,-1]),step('omega3','OMEGA',2,[1,0,1])],residual_relative:.012,measured_residual_relative:.006};
const same={...path,kind:'same_crystal',steps:[step('omega3','OMEGA',1,[1,0,-1]),step('omega3','OMEGA',2,[1,0,1])]};
const report={status:'checked',hits:[{profile_id:3,observed_q:[1,1],paths:[path,same],path_count:2}],profile_count:1,profile_ids:[3],allowed_profile_count:2,remaining_profile_ids:[4],coverage_with_candidates:.75,measured_rms_relative:.006,rms_with_candidates_relative:.01,normalization_label:'parent shortest reciprocal reflection'};
const linked={selected:true,fit:{valid:true},components:[{id:'beta',active:true},{id:'omega3',active:true}],double_diffraction:report};
context.result={beta_omega:linked};$('overlay').value='winner';$('omega-color-by').value='phase';
const qp=(x,y)=>[210+20*x,210-20*y];
function draw(fits=[]){$('fft-overlay').replaceChildren();context.drawDoubleDiffraction(fits,qp);return $('fft-overlay').children}
for(const mode of ['circle','square','diamond','triangle','crosshair','open-crosshair','off']){
 $('double-diffraction-marker').value=mode;const shapes=draw();assert.equal(shapes.length,mode==='off'?0:1);
 if(shapes.length){assert.equal(shapes[0].attrs['data-marker-shape'],mode);assert.equal(shapes[0].attrs.stroke,'#00ff00');assert.match(shapes[0].children[0].text,/peak 1/);assert.equal(shapes[0].attrs['data-double-diffraction-profile'],3)}
}
$('double-diffraction-marker').value='circle';vm.runInContext("betaOmegaHidden.add('beta')",context);
assert.equal(draw().length,1,'Same-variant path remains when parent overlay is hidden');
vm.runInContext("betaOmegaHidden.add('omega3')",context);assert.equal(draw().length,0,'All paths hidden with required component');
vm.runInContext('betaOmegaHidden.clear()',context);context.phaseColors.OMEGA='#ffffff';assert.equal(draw()[0].attrs.stroke,'#ffffff','Follows user phase colours');
$('omega-color-by').value='variant';assert.equal(draw()[0].attrs.stroke,'#79bafa','Linked DD follows the fixed variant palette');
$('overlay').value='all';
const hcpReport={...report,observation_kind:'image_fft',hits:[{...report.hits[0],paths:[{...same,steps:same.steps.map(s=>({...s,component:'HCP',phase:'HCP'}))}]}]};
const hcp={phase:'HCP',double_diffraction:hcpReport};
const shapes=draw([{geometry:false,model:hcp},{geometry:true,model:{}}]);assert.equal(shapes.length,1);assert.equal(shapes[0].attrs.stroke,'#0000ff');
function text(n){return [n.textContent,n.text,...n.children.map(text)].join(' ')}
assert.match(text($('double-diffraction-list')),/image FFT/);
assert.match(text($('double-diffraction-list')),/75.0%/);
assert.match(text($('double-diffraction-list')),/1.00%/);
$('overlay').value='custom';context.chosenFits=new Set(['linked-beta','linked-omega3','phase-0']);
const mixedShapes=draw([{geometry:false,model:hcp}]);
assert.equal(mixedShapes.length,2,'Custom view keeps independent and linked DD reports separate and both visible');
assert.deepEqual(mixedShapes.map(s=>s.attrs.stroke).sort(),['#0000ff','#79bafa']);
assert.match(context.doubleDiffractionPathLabel(path,linked),/ω variant 1/,'Linked paths use the same variant label as the overlay');
$('overlay').value='all';
draw([{geometry:false,model:{phase:'BCC'}}]);assert.match(text($('double-diffraction-list')),/Reanalyse/,'Older results remain readable');
draw([]);assert.equal($('double-diffraction-details').hidden,true);
assert.match(context.doubleDiffractionSummary({status:'unavailable'}),/Not enough/);
console.log('Double diffraction: candidate paths, shapes/Off, phase colours, component visibility, FFT caveat, counts and old results passed.');

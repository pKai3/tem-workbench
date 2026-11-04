const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/app.js','utf8'),context={};vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function reflectionCellDimensions('),source.indexOf('function matchedReflectionVectors(')),context);
const derive=(phase,hkl,g)=>context.reflectionCellDimensions({phase},hkl,g);
assert.equal(derive('BCC',[-1,1,0],1/.4331),'a 0.6125 nm');
assert.equal(derive('BCC',[-1,-1,0],1/.4273),'a 0.6043 nm');
assert.equal(derive('FCC',[2,0,0],2/.417),'a 0.4170 nm');
assert.equal(derive('HCP',[-1,0,0],1/.4879),'a 0.5634 nm');
assert.equal(derive('HCP',[0,0,-2],1/.445),'c 0.8900 nm');
assert.equal(derive('HCP',[1,0,1],4),'a/c coupled');
for(let i=0;i<3;i++){const hkl=[0,0,0];hkl[i]=-2;assert.equal(derive('ORT',hkl,5),'abc'[i]+' 0.4000 nm')}
assert.equal(derive('ORT',[1,0,1],4),'a/c coupled');
assert.equal(derive('BCC',[1,1,0],0),'');
// Equivalent fitted cubic reflections recover the same cell from their own g.
for(const hkl of [[1,1,0],[2,0,0],[2,2,0]])assert.equal(derive('BCC',hkl,Math.hypot(...hkl)/.60912374),'a 0.6091 nm');
console.log('Vector-derived cell dimensions: cubic, hexagonal, orthorhombic and coupled reflections passed.');

vm.runInContext(source.slice(source.indexOf('function matchedReflectionVectors('),source.indexOf('function fittedReferenceVectors(')),context);
const model={matches:[
 {hkl:[1,1,0],observed_q:[2.31,0],predicted_q:[-2.32,0]},
 {hkl:[1,-1,0],observed_q:[0,2.34],predicted_q:[0,2.32]}
]};
const measured=context.matchedReflectionVectors(model),fitted=context.matchedReflectionVectors(model,true);
assert.equal(measured[0].g,2.31);assert.equal(measured[1].g,2.34);
assert.equal(fitted[0].g,2.32);assert.equal(fitted[1].g,2.32);
assert.equal(fitted[0].q[0],2.32);assert.equal(fitted[0].sign,-1);
assert.deepEqual(Array.from(fitted[0].hkl),[1,1,0]);
console.log('Measured/fitted plane modes preserve indexing and use their respective coordinates.');

assert.equal(context.vectorCellRatio({phase:'HCP',fitted_a_nm:.5636495249,fitted_c_nm:.8958603685}),' · c/a 1.5894');
assert.equal(context.vectorCellRatio({phase:'HCP',fitted_a_nm:.295,fitted_c_nm:null,scale_mode:'auto_hcp_ratio'}),' · c/a unconstrained');
assert.equal(context.vectorCellRatio({phase:'HCP',fitted_a_nm:.295,fitted_c_nm:.468,c_axis_visible:false}),' · c/a unconstrained');
assert.equal(context.vectorCellRatio({phase:'BCC',fitted_a_nm:.33}),'');
console.log('HCP vector key reports fitted c/a and preserves unconstrained axes.');

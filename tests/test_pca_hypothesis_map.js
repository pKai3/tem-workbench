const assert=require('node:assert/strict');
const pca=require('../web/shared-spectra.js');
const maps={models:[{id:0,phase:'HCP'},{id:1,phase:'BCC'},{id:2,phase:'OMEGA'}],model_passing_counts:{0:8,1:6,2:3},model_mean_support:{0:.3,1:.5,2:.9}};
const pool=pca.topHypotheses(maps,2).map(m=>m.id);
assert.deepEqual(pool,[0,1]);
const win={peak_count:8,peak_positions:Array.from({length:8},(_,i)=>[i,Math.cos(i),Math.sin(i)]),candidates:[
 {model:0,phase:'HCP',score:.4,valid:true,profiles:[0,1,2,3]},
 {model:1,phase:'BCC',score:.6,valid:true,profiles:[4,5,6,7]},
 {model:2,phase:'OMEGA',score:.9,valid:true,profiles:[0,1,2,3]}]};
let local=pca.localHypotheses(win,pool);
assert.equal(local.winner.model,1,'local winner is chosen within the fixed global pool');
assert.deepEqual(local.passing.map(c=>c.model),[1,0]);
assert.equal(local.label,'multiple');
const shared={...win,candidates:[{...win.candidates[0],score:.58},{...win.candidates[1],profiles:[0,1,2,3]}]};
assert.equal(pca.localHypotheses(shared,pool).label,'ambiguous','shared peaks do not become coexistence');
const below={...win,candidates:win.candidates.map(c=>({...c,valid:c.model===2}))};
assert.equal(pca.localHypotheses(below,pool).label,'unresolved','no fallback to a hypothesis outside the chosen pool');
const samePhase={...win,candidates:win.candidates.slice(0,2).map(c=>({...c,phase:'HCP'}))};
assert.equal(pca.localHypotheses(samePhase,pool).label,'multiple','independent orientations remain distinct');
assert.deepEqual(pca.hypothesisColour(maps.models[0]),pca.phaseColours.HCP);
assert.notDeepEqual(pca.hypothesisColour(maps.models[0],'hypothesis'),pca.hypothesisColour(maps.models[1],'hypothesis'));
assert.equal(pca.sourceLabel({kind:'combination',components:[0,1],window:12}),'PC 1+2');
assert.equal(pca.sourceLabel({sources:[{component:0,side:'negative'},{kind:'combination',components:[0,1]}]}),'PC 1− / PC 1+2');
assert.deepEqual(pca.topHypotheses({...maps,model_passing_counts:{0:6,1:6,2:3}},2).map(m=>m.id),[1,0]);
console.log('PCA hypothesis maps: global pool, local winner, independent/shared evidence, unresolved windows and combination labels passed.');

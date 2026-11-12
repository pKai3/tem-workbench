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
const supportMap={...maps,windows:[win,shared,below,{candidates:[]}]};
assert.deepEqual(pca.hypothesisPools(supportMap),[{count:1,supported:2,newlySupported:2,improved:0},{count:2,supported:2,newlySupported:0,improved:2},{count:3,supported:3,newlySupported:1,improved:1}],
 'pool support counts overlapping passing windows once and excludes unresolved windows');
for(const pool of pca.hypothesisPools(supportMap)){
 const ids=pca.topHypotheses(supportMap,pool.count).map(m=>m.id);
 assert.equal(pool.supported,supportMap.windows.filter(w=>pca.localHypotheses(w,ids).winner).length);
}
assert.equal(pca.supportPercent(301,324),'92.9%');
assert.equal(pca.supportPercent(0,0),'0.0%');
assert.deepEqual(pca.hypothesisPools({models:[],windows:[],model_passing_counts:{}}),[]);
const gains={...maps,windows:[
 {candidates:[{model:0,valid:true,score:.4},{model:1,valid:true,score:.6},{model:2,valid:true,score:.5}]},
 {candidates:[{model:0,valid:true,score:.5},{model:1,valid:true,score:.5},{model:2,valid:true,score:.8}]},
 {candidates:[{model:0,valid:false,score:.9},{model:1,valid:true,score:.3},{model:2,valid:true,score:.2}]},
 {candidates:[{model:2,valid:true,score:.9}]},
 {candidates:[{model:0,valid:false,score:.9}]}]};
assert.deepEqual(pca.hypothesisPools(gains),[
 {count:1,supported:2,newlySupported:2,improved:0},
 {count:2,supported:3,newlySupported:1,improved:1},
 {count:3,supported:4,newlySupported:1,improved:1}],
 'strict improvements exclude newly supported windows, ties, lower ranks and below-screen fits');
const registry=new Map(),palette=['●','▲','◆'];
let symbols=pca.winningSolutions(maps,[pca.localHypotheses(win,[0])],palette,registry);
assert.deepEqual(symbols.map(s=>[s.model.id,s.symbol,s.count]),[[0,'●',1]]);
symbols=pca.winningSolutions(maps,[pca.localHypotheses(win,[0,1]),pca.localHypotheses(win,[0]),pca.localHypotheses(below,[0,1])],palette,registry);
assert.deepEqual(symbols.map(s=>[s.model.id,s.symbol,s.count]),[[0,'●',1],[1,'▲',1]]);
assert.equal(registry.has(2),false,'nonwinning solutions need no symbol');
assert.deepEqual(pca.winningSolutions(maps,[pca.localHypotheses(win,[0])],palette,registry).map(s=>s.symbol),['●'],'changing the pool preserves existing symbol identities');
assert.deepEqual(pca.winningSolutions(maps,[{winner:null}],palette,registry),[]);
// A broadly passing redundant model must not hide useful local alternatives.
const benefitMap={models:[0,1,2,3].map(id=>({id,phase:'HCP'})),
 model_passing_counts:{0:6,1:5,2:3,3:2},model_mean_support:{0:.6,1:.5,2:.6,3:.9},
 windows:Array.from({length:8},(_,i)=>({candidates:[
  ...(i<6?[{model:0,valid:true,score:.6}]:[]),
  ...(i<5?[{model:1,valid:true,score:.5}]:[]),
  ...([0,6,7].includes(i)?[{model:2,valid:true,score:i===0?.8:.5}]:[]),
  ...([1,2].includes(i)?[{model:3,valid:true,score:.9}]:[]),
  {model:1,valid:false,score:2.}
 ]}))};
const before=JSON.stringify(benefitMap);
assert.deepEqual(pca.orderedHypotheses(benefitMap,'passing').map(m=>m.id),[0,1,2,3]);
const beneficial=pca.orderedHypotheses(benefitMap);
assert.deepEqual(beneficial.map(m=>m.id),[0,2,3,1]);
assert.deepEqual(pca.orderedHypotheses(benefitMap,'better').map(m=>m.id),[0,3,2,1],
 'better-fit sorting prefers existing improvements before new coverage, seeding with total passing support');
assert.deepEqual(pca.hypothesisPools(benefitMap,beneficial),[
 {count:1,supported:6,newlySupported:6,improved:0},
 {count:2,supported:8,newlySupported:2,improved:1},
 {count:3,supported:8,newlySupported:0,improved:2},
 {count:4,supported:8,newlySupported:0,improved:0}]);
const overlap={...benefitMap,windows:benefitMap.windows.map(w=>({candidates:w.candidates.map(c=>c.model===1?{...c,valid:true,score:1.}:c)}))};
assert.equal(pca.orderedHypotheses(overlap)[0].id,1);
assert.ok(pca.hypothesisPools(overlap,pca.orderedHypotheses(overlap)).slice(1).every(p=>p.improved===0&&p.newlySupported===0),
 'incremental gains are recomputed against the best score already selected');
assert.deepEqual(pca.orderedHypotheses({models:[],windows:[],model_passing_counts:{}}),[]);
assert.equal(JSON.stringify(benefitMap),before,'display ordering does not mutate fits or their scores');
console.log('PCA hypothesis maps: global pool, local winner, independent/shared evidence, unresolved windows and combination labels passed.');

// Live maps append completed windows, reset on a new run and never duplicate a prefix.
const initial=pca.mergeLive(null,{generation:'a',models:maps.models,windows:[win],window_offset:0});
const updated=pca.mergeLive(initial,{generation:'a',models:maps.models,windows:[shared],window_offset:1});
assert.deepEqual(updated.windows,[win,shared]);assert.equal(initial.windows.length,1);
assert.deepEqual(pca.mergeLive(updated,{...updated,windows:[shared],window_offset:1}).windows,[win,shared]);
assert.deepEqual(pca.mergeLive(updated,{generation:'b',windows:[],window_offset:0}).windows,[]);
assert.throws(()=>pca.mergeLive(initial,{generation:'a',windows:[],window_offset:2}),/earlier/);
assert.equal(pca.mergeLive(updated,null),null);

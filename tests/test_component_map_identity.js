const assert=require('node:assert/strict'),pca=require('../web/shared-spectra.js');
const models=[{id:0,phase:'BCC',zone_3index:[1,-3,-1],rotation_deg:171.1},{id:1,phase:'BCC',zone_3index:[1,-3,-1],rotation_deg:172.5},{id:2,phase:'HCP',zone_3index:[0,1,-1],rotation_deg:98.9}];
const c=(model,score,valid=true)=>({model,phase:models[model].phase,score,valid,profiles:[0,1,2,3]});
const windows=[
 {index:0,candidates:[c(0,.5),c(1,.6),c(2,.9,false)]},
 {index:1,candidates:[c(0,.7),c(1,.7)]},
 {index:2,candidates:[c(2,.9,false)]},
 {index:3,candidates:[c(2,.8)]}
].map(w=>({...w,peak_count:4,peak_positions:[[0,1,0],[1,0,1],[2,1,1],[3,1,2]]}));
const maps={generation:'generation-1',models,windows,model_passing_counts:{0:2,1:2,2:1},model_mean_support:{0:.6,1:.65,2:.8}};
const grid={id:'job',component:{method:'nmf'},component_pool:{models:[0,1,2]},regions:windows.map(w=>({id:String(w.index),rim:w.index===3}))};
const before=JSON.stringify({grid,maps}),palette=['●','▲','◆'],modelMap=new Map(models.map(m=>[m.id,m]));
for(const ids of [[0,1,2],[0],[1,2],[]]){
 const restored=pca.restoreComponentDisplay({...grid,component_pool:{models:ids}},maps);
 assert.ok(!('windows' in restored.component_hypotheses),'compact metadata must not duplicate original windows');
 for(const showRim of [false,true]){
  const visible=restored.regions.filter(r=>!r.rim||showRim);
  const main=visible.map(r=>pca.componentState(r));
  const detail=visible.map(r=>pca.localHypotheses(windows[Number(r.id)],ids));
  for(const mode of ['best','all'])for(const colour of ['phase','hypothesis']){
   assert.deepEqual(main.map(s=>pca.rawStyle(s,modelMap,mode,colour)),detail.map(s=>pca.rawStyle(s,modelMap,mode,colour)));
  }
  const registry=pca.solutionRegistry(grid.id,maps.generation);
  assert.deepEqual(pca.winningSolutions(maps,main,palette,registry),pca.winningSolutions(maps,detail,palette,registry));
 }
 assert.strictEqual(pca.restoreComponentDisplay(restored,maps),restored,'new-server status needs no compatibility repair');
}
assert.equal(JSON.stringify({grid,maps}),before,'rendering never modifies retained checks');
const repaired=pca.restoreComponentDisplay(grid,maps);
assert.deepEqual(repaired.regions.map(r=>r.component_display.winner),[1,0,null,2],'failed higher ranks never replace passing fits; score ties use model ID');
const registry=pca.solutionRegistry(grid.id,maps.generation);
assert.notEqual(registry.get(0),registry.get(1),'same phase and axis with distinct rotations keep distinct symbols');
assert.strictEqual(pca.solutionRegistry(grid.id,maps.generation),registry,'main and popup share stable symbols');
assert.equal(pca.solutionRegistry('other-job',maps.generation).size,0,'new runs have their own identities');
assert.equal(pca.solutionRegistry(grid.id,'generation-2').size,0,'refits reset changed identities');
assert.strictEqual(pca.restoreComponentDisplay(grid,{...maps,windows:windows.slice(0,2)}),grid,'partial reconnect waits until all displayed windows are available');
assert.strictEqual(pca.restoreComponentDisplay({...grid,component:null},maps).component,null,'ordinary maps remain unchanged');
console.log('Component map identities: main/detail winners, rotations, colours, counts, selected pools, rim filtering and retained-run repair passed.');

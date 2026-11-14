const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const window={};vm.runInNewContext(fs.readFileSync('web/aztec-analysis.js','utf8'),{window,structuredClone});
const store=window.aztecComparisonState,a='/a/Project.oipx',b='/b/Project.oipx',table='XrayMapImages';
const qa=store.identity(a,'same'),qb=store.identity(b,'same');
const old={preferences:{['compare-'+a+':'+table]:{scale_scope:'all',line_offsets:{same:12}},[a+':'+table]:{brightness:2}},
 selections:{['compare-'+a+':'+table]:{ids:['same'],signals:['V']}},
 aliases:{[a+':same']:'Sample A'},crops:{[a+':same']:[.2,.4]},presets:{
  ['compare-'+a+':'+table]:[{name:'Boundary',ids:['same'],signals:['V'],options:{normalisation:'median',line_offsets:{same:12}},aliases:{same:'A'},crops:{same:[.2,.4]}}],
  ['compare-'+b+':'+table]:[{name:'Boundary',ids:[qb,qa],files:[a,b],signals:['V'],options:{scale_scope:'element',line_offsets:{[qb]:3}},aliases:{[qb]:'B'},crops:{}}],
  ['compare-'+b+':XrayLinescans']:[{name:'Line scan',ids:['line'],signals:['Ti'],options:{}}]
 }};
const result=store.migrate(old,a),key=store.key(table),presets=result.presets[key];
assert.equal(result.comparisonScope,2);
assert.equal(presets.length,2);assert.notEqual(presets[0].name,presets[1].name);
assert.equal(presets[0].ids[0],qa);assert.equal(presets[0].options.line_offsets[qa],12);
assert.equal(presets[0].aliases[qa],'A');assert.deepEqual(presets[0].crops[qa],[.2,.4]);
assert.equal(presets[1].ids[0],qb);assert.equal(presets[1].options.line_offsets[qb],3);
assert.equal(presets[1].ids[1],qa);
assert.equal(store.compatibleUnit('Window-count ratio'),'Signal ratio');
assert.equal(store.compatibleUnit('Relative window count'),'Relative signal');
assert.equal(JSON.stringify(['V Kα1',store.compatibleUnit('Window-count ratio'),'ratio']),
 JSON.stringify(['V Kα1',store.compatibleUnit('Signal ratio'),'ratio']));
assert.equal(result.aliases['compare:'+qa],'Sample A');assert.deepEqual(result.crops['compare:'+qa],[.2,.4]);
assert.equal(result.selections[key].ids[0],qa);assert.equal(result.preferences[key].scale_scope,'all');
assert.equal(result.preferences[a+':'+table].brightness,2);assert.equal(result.aliases[a+':same'],'Sample A');
assert.equal(result.presets[store.key('XrayLinescans')][0].ids[0],store.identity(b,'line'));
assert.equal(store.migrate(result),result);assert.equal(old.comparisonScope,undefined);
assert.equal(old.presets['compare-'+a+':'+table][0].ids[0],'same');
// Removing a file must remove its exclusive channels from requests and exports,
// while preserving explicit deselections in the remaining files.
const remaining=['Ti Kα1','V Kα1','Fe Kα1'],both=[...remaining,'W Mα1'];
const removed=store.reconcileChannels(['Ti Kα1','V Kα1','W Mα1'],'W Mα1',remaining,both);
assert.equal(JSON.stringify(removed.signals),JSON.stringify(['Ti Kα1','V Kα1']));
assert.equal(removed.denominator,'Ti Kα1');
const restored=store.reconcileChannels(['V Kα1','W Mα1'],'W Mα1',remaining);
assert.equal(JSON.stringify(restored.signals),JSON.stringify(['V Kα1']));
assert.equal(restored.denominator,'Ti Kα1');
const added=store.reconcileChannels(removed.signals,removed.denominator,both,remaining);
assert.equal(JSON.stringify(added.signals),JSON.stringify(['Ti Kα1','V Kα1','W Mα1']));
assert.equal(store.reconcileChannels(added.signals,added.denominator,[]).signals.length,0);
assert.equal(store.reconcileChannels(added.signals,added.denominator,[]).denominator,'');
const moved='/new/Project renamed.oipx',nativeId='project-guid';
assert.equal(store.relocations({[a]:nativeId,[b]:'other'},[
 {path:moved,kind:'OIPX',project_id:nativeId},{path:b,kind:'OIPX',project_id:'other'}
])[a],moved);
assert.equal(Object.keys(store.relocations({[a]:nativeId},[
 {path:moved,kind:'OIPX',project_id:nativeId},{path:'/copy.oipx',kind:'OIPX',project_id:nativeId}
])).length,0);
const sourceId=store.identity(a,'native-line'),newId=store.identity(moved,'native-line');
const savedState={preferences:{[a+':XrayLinescans']:{raw:true},[store.key('XrayLinescans')]:{line_offsets:{[sourceId]:14}}},
 selections:{[store.key('XrayLinescans')]:{ids:[sourceId],files:[a],signals:['V']}},
 presets:{[store.key('XrayLinescans')]:[{name:'Saved line',ids:[sourceId],files:[a],options:{line_offsets:{[sourceId]:14}},aliases:{[sourceId]:'Sample'},crops:{[sourceId]:[.2,.3]}}]},
 aliases:{['compare:'+sourceId]:'Sample',[a+':native-line']:'Direct'},crops:{['compare:'+sourceId]:[.2,.3]}};
const relocated=store.relocate(savedState,{[a]:moved});
assert.equal(relocated.preferences[moved+':XrayLinescans'].raw,true);
assert.equal(relocated.preferences[store.key('XrayLinescans')].line_offsets[newId],14);
assert.equal(relocated.selections[store.key('XrayLinescans')].ids[0],newId);
assert.equal(relocated.selections[store.key('XrayLinescans')].files[0],moved);
assert.equal(relocated.presets[store.key('XrayLinescans')][0].options.line_offsets[newId],14);
assert.equal(relocated.presets[store.key('XrayLinescans')][0].aliases[newId],'Sample');
assert.equal(relocated.aliases['compare:'+newId],'Sample');
assert.equal(relocated.aliases[moved+':native-line'],'Direct');
assert.equal(savedState.selections[store.key('XrayLinescans')].ids[0],sourceId);
console.log('Comparison migration retains cross-file presets, duplicate names, aliases, crops and trims; direct views stay separate');
console.log('Removed or stale channels are cleared; new channels and valid deselections are retained');
console.log('Native project identity reconnects unique moves and preserves saved comparison state');

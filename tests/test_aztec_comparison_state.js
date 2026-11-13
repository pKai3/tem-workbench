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
console.log('Comparison migration retains cross-file presets, duplicate names, aliases, crops and trims; direct views stay separate');
console.log('Removed or stale channels are cleared; new channels and valid deselections are retained');

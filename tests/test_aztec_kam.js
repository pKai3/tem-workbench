const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const window={addEventListener(){}};
const shared=fs.readFileSync('web/popup-controls.js','utf8');vm.runInNewContext(shared.slice(shared.indexOf('/* Saved-item previews')),{window,structuredClone});
vm.runInNewContext(fs.readFileSync('web/aztec-analysis.js','utf8'),{
 window,WorkbenchWorkspace:{readRaw:()=>null},console,structuredClone
});
const signal=(path,id,label)=>({path,attributes:{'Acquisition ID':id,Acquisition:'Map '+id,Label:label}});
const catalogue={source:{path:'/native.oipx'},acquisitions:[{specimen:'AB',label:'Site 1',layers:[{signals:[
 signal('/EbsdMaps/full/phase','full','Phase'),
 signal('/EbsdMapImages/preview','preview','IPF Z Color'),
 signal('/KamMapImages/full','full','KAM'),
 signal('/XrayMapImages/chemistry','chemistry','Ti Kα1'),
 signal('/QuantMapImages/chemistry/22','chemistry','Ti')
]}]}]};
const analysis=window.createAztecAnalysis({state:{file:{catalogue}}});
const groups=analysis.groups();
assert.equal(groups.length,3,'Decoded scalar fields and saved preview colours are not KAM acquisitions');
const kam=groups.find(g=>g.table==='KamMapImages');
assert.equal(kam.kind,'map');assert.equal(kam.id,'full');assert.equal(kam.signals.join(','),'KAM');
assert.equal(kam.derived,false,'KAM must not enter reconstructed EDS window handling');
const store=window.aztecComparisonState;
assert.notEqual(store.key('KamMapImages'),store.key('XrayMapImages'));
const saved={preferences:{'compare-/native.oipx:KamMapImages':{kam_kernel:5,kam_max_angle:3,kam_periphery:false}},
 selections:{'compare-/native.oipx:KamMapImages':{ids:['full'],signals:['KAM']}},presets:{
  'compare-/native.oipx:KamMapImages':[{name:'Native KAM',ids:['full'],signals:['KAM'],options:{kam_kernel:5,kam_periphery:false}}]
 }};
const migrated=store.migrate(saved,'/native.oipx'),key=store.key('KamMapImages');
assert.equal(migrated.preferences[key].kam_kernel,5);
assert.equal(migrated.preferences[key].kam_periphery,false);
assert.equal(migrated.presets[key][0].options.kam_kernel,5);
assert.equal(migrated.selections[key].ids[0],store.identity('/native.oipx','full'));
console.log('KAM map grouping and presets retain native acquisition identity and stay separate from EDS families.');
const sources=window.aztecKamSources,options={kam_source:'native',kam_sources:{a:'h5_saved',b:'h5_processed'}};
assert.equal(sources.mode(options,'a'),'h5_saved');assert.equal(sources.mode(options,'b'),'h5_processed');assert.equal(sources.mode(options,'c'),'native');
assert.equal(sources.allSaved(options,['a']),true);assert.equal(sources.allSaved(options,['a','b']),false);assert.equal(sources.allSaved(options,[]),false);
assert.equal(sources.accepted(options,['a','b'],{kam_sources:{a:'h5_saved',b:'h5_processed'}}),true);
assert.equal(sources.accepted(options,['a','b'],{kam_source:'h5_saved'}),false,'An old/global backend must not silently calculate another source');
assert.match(sources.configuration({kernel_size:3,only_periphery:true,maximum_angle_degrees:5,minimum_angle_degrees:null}),/min not stored/);
const oldSource='/old.oipx',newSource='/new.oipx',oldId=store.identity(oldSource,'a'),newId=store.identity(newSource,'a');
const sourceState={preferences:{[key]:{kam_sources:{[oldId]:'h5_saved'},distribution_view:'exceedance'}},presets:{[key]:[{ids:[oldId],options:{kam_sources:{[oldId]:'h5_processed'}}}]}};
const relocated=store.relocate(sourceState,{[oldSource]:newSource});
assert.equal(relocated.preferences[key].kam_sources[newId],'h5_saved');assert.equal(relocated.presets[key][0].options.kam_sources[newId],'h5_processed');
assert.equal(relocated.preferences[key].distribution_view,'exceedance');

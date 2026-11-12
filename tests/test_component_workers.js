const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('web/shared-spectra.js','utf8');
const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:false});return nodes.get(id)};
const requests=[],c=vm.createContext({$,config:{component_workers:true},job:{id:'original'},epoch:1,pipeline:null,
 data:{fits:{},phase_support:{}},sampleEpoch:0,symbolModels:null,cancelRequested:false,
 isPca:()=>true,combinationOptions:()=>({feature_components:[0,2],combination_mode:'together'}),
 controls(){},closeInspector(){},showFits(){},showPhaseMaps(){},notify(){},poll(){},
 api:async(path,body)=>{requests.push({path,body});return {id:'original',state:'running'}}});
vm.runInContext(source.slice(source.indexOf('  const workerOptions='),source.indexOf("  let section='signals'")),c);
vm.runInContext(source.slice(source.indexOf('  async function startStage('),source.indexOf('  const viewerKey=')),c);
(async()=>{
 $('pca-workers').value='4';$('nmf-cutoff').value='.35';
 await vm.runInContext("startStage('fit',1)",c);
 assert.equal(requests[0].body.options.workers,4);
 assert.deepEqual(requests[0].body.options.feature_components,[0,2]);
 $('pca-workers').value='2';await vm.runInContext("startStage('support',1)",c);
 assert.equal(requests[1].body.workers,2,'Update mapping can change worker count without refitting');
 assert.equal(requests[1].body.id,'original');
 c.config.component_workers=false;assert.equal(vm.runInContext('workerOptions().workers',c),1,'older backends stay serial');
 console.log('Component workers: fitting/mapping requests, saved choices and legacy fallback passed.');
})().catch(e=>{console.error(e);process.exitCode=1});

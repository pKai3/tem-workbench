const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('web/app.js','utf8');
const rows=[
 {id:'a',source_id:'p1',eligible:true},
 {id:'b',source_id:'p2',eligible:true},
];
const nodes=new Map();
const $=id=>{
 if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,textContent:'',disabled:false,setAttribute(){}});
 return nodes.get(id);
};
const context=vm.createContext({
 $,config:{sources:[{id:'p1',output:'/project-one'},{id:'p2',output:'/project-two'}],output_root:'/fallback',batch_unified_output:true},
 batchFiles:rows,batchSelected:new Set(['a','b']),batchSelectionReady:true,batchReviewReady:true,batchRunning:false,
 batchShowSelected:false,batchFolderSelection:null,batchProjectFiles:()=>rows.slice(0,1),matchesBatchFolders:()=>true,
 matchingBatchFiles:()=>rows.slice(0,1),batchPngRows:()=>[{}],duplicateBatchPngRows:()=>new Set(),invalidBatchPngRows:()=>false,
});
vm.runInContext(source.slice(source.indexOf('function batchOutputPlan()'),source.indexOf('function renderBatchFiles()')),context);
$('batch-png').value='off';$('batch-project').value='p1';
vm.runInContext('syncBatchSelection()',context);
assert.equal($('batch-output-warning').hidden,false);
assert.match($('batch-output-warning').textContent,/\/fallback\/batch_/);
assert.equal($('batch-start').disabled,false);
context.config.sources[1].output='/project-one';vm.runInContext('syncBatchSelection()',context);
assert.equal($('batch-output-warning').hidden,false);
context.config.sources[1].output='/project-two';
// A selection outside the visible project still controls the destination.
context.batchSelected.delete('b');vm.runInContext('syncBatchSelection()',context);
assert.equal($('batch-output-warning').hidden,true);
context.batchSelected.add('b');context.config.batch_unified_output=false;
vm.runInContext('syncBatchSelection()',context);
assert.match($('batch-output-warning').textContent,/Restart TEM Workbench/);
assert.equal($('batch-start').disabled,true);
context.batchSelected.delete('b');vm.runInContext('syncBatchSelection()',context);
assert.equal($('batch-output-warning').hidden,false);
assert.equal($('batch-start').disabled,true);
console.log('Batch output warning follows the complete selection and backend capability.');

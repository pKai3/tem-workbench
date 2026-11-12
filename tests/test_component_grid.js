const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('web/app.js','utf8'),nodes=new Map();
const $=id=>nodes.get(id),put=(id,value,tagName='INPUT')=>nodes.set(id,{value,tagName});
put('grid-mode','pca','SELECT');
for(const [id,value,tag]of [['pca-count','4'],['pca-angle','0'],['pca-scale','0'],['pca-normalization','unit_norm','SELECT'],['pca-combination-mode','together','SELECT'],['nmf-cutoff','.35']]){
 put(id,value,tag);put('grid-'+id,value,tag);
}
const context=vm.createContext({$,assert,trackedGrid:null,gridStarting:false});
vm.runInContext(source.slice(source.indexOf('function componentGridMode()'),source.indexOf("document.addEventListener('DOMContentLoaded',()=>{",source.indexOf('function componentGridMode()'))),context);
let request=vm.runInContext('componentRequest()',context);
assert.equal(request.method,'pca');assert.equal(request.options.components,4);assert.equal(request.fit_options.peak_fraction,.35);
// Reading a retained inspector must not silently replace the visible next-run controls.
$('pca-count').value='8';assert.equal(vm.runInContext('componentRequest().options.components',context),4);
$('grid-pca-count').value='2';assert.equal(vm.runInContext('componentRequest().options.components',context),2);
vm.runInContext("restoreComponentControls({options:{components:6},fit_options:{peak_fraction:.4}})",context);
assert.equal($('grid-pca-count').value,6);assert.equal($('pca-count').value,6);assert.equal($('grid-nmf-cutoff').value,.4);
$('grid-mode').value='nmf';assert.equal(vm.runInContext('componentRequest().method',context),'nmf');
$('grid-mode').value='overlap';assert.equal(vm.runInContext('componentRequest()',context),null);
put('batch-project','p1','SELECT');put('batch-search','one');
context.batchFiles=[{id:'a',source_id:'p1',sample:'s',name:'one',folder:'parent/child'},{id:'b',source_id:'p2',sample:'s',name:'one',folder:'parent/child'},{id:'c',source_id:'p1',sample:'s',name:'two',folder:'parent'}];
context.batchFolderSelection=new Set(['parent']);
for(const [from,to]of [['function batchFolder(row)','function batchProjectFiles()'],['function batchProjectFiles()','function populateBatchFolders('],['function matchesBatchFolders(row)','function syncBatchSelection()']])vm.runInContext(source.slice(source.indexOf(from),source.indexOf(to)),context);
assert.equal(vm.runInContext('matchingBatchFiles().map(r=>r.id).join()',context),'a');
$('batch-project').value='';assert.equal(vm.runInContext('matchingBatchFiles().map(r=>r.id).join()',context),'a,b');
context.batchFolderSelection=new Set(['parent/other']);assert.equal(vm.runInContext('matchingBatchFiles().length',context),0);
const inspector=fs.readFileSync('web/shared-spectra.js','utf8');
for(const [id,value]of [['pca-batch-open',''],['pca-method','pca'],['pca-window','7.5'],['pca-spacing','3.75'],['pca-sampling','hex'],['pca-passes','3'],['pca-workers','4'],['pca-rim',''],['map-size-mode','image_percent'],['map-spacing-mode','window_percent'],['map-layout',''],['map-passes',''],['grid-workers',''],['map-sample-edges',''],['map-window','5'],['map-spacing','2.5']])put(id,value);
context.meta={};context.options=()=>({components:2});context.overlapRequest=()=>({});context.overlapDimensions=()=>({width:7.5,spacing:3.75});context.dialog={close(){}};context.updateGridSizeNote=()=>{};context.rememberBasicControls=()=>{};
nodes.set('batch-panel',{open:false,scrollIntoView(){}});
vm.runInContext(inspector.slice(inspector.indexOf("  $('pca-batch-open').onclick="),inspector.indexOf('  function controls()')),context);
$('pca-batch-open').onclick();assert.equal($('map-size-mode').value,'image_percent');assert.equal($('map-spacing-mode').value,'window_percent');assert.equal($('batch-panel').open,true);
$('pca-window').value='8';$('pca-spacing').value='4';$('pca-batch-open').onclick();assert.equal($('map-size-mode').value,'fixed_nm');assert.equal($('map-window').value,'8');assert.equal($('map-spacing-mode').value,'fixed_nm');
console.log('Integrated component grids: visible settings, retained-inspector isolation, ordinary modes and project/subfolder filters passed.');

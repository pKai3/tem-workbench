const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('web/shared-spectra.js','utf8'),nodes=new Map(),saved=new Map();
const put=(id,value,options=[])=>nodes.set(id,{value,checked:false,tagName:options.length?'SELECT':'INPUT',options:options.map(value=>({value}))});
for(const [a,b,values]of [['map-mode','pca-map-metric',['top','support','strength','raw']],['map-display','pca-map-display',['hex','continuous','centres']],['map-phase','nmf-map-phase',['all','HCP','BCC']],['map-symbol','pca-map-symbols',['circle','both','zone']],['grid-workers','pca-workers',['0','1','4']]]){
 put(a,values[0],values);put(b,values[0],a==='map-mode'?['best','frequency','strength','raw']:values);
}
for(const id of ['grid-opacity','nmf-map-opacity','map-show-rim','pca-map-rim','map-normalize','pca-map-normalize'])put(id,'');
const $=id=>nodes.get(id);$('grid-opacity').value='37';$('map-normalize').checked=true;$('map-show-rim').checked=true;
let linked=true;
const context=vm.createContext({$,linkedGrid:()=>linked,preferredMapDisplay:'hex',readPreference:(k,v)=>saved.get(k)??v,writePreference:(k,v)=>saved.set(k,v),rememberViewer(){},syncMapDisplay(){},updateGridOpacity(){}});
vm.runInContext(source.slice(source.indexOf('  function syncLinkedControls('),source.indexOf("  $('component-map-top').onchange=")),context);
context.syncLinkedControls();
assert.equal($('nmf-map-opacity').value,'0.37');assert.equal($('pca-map-metric').value,'best');assert.equal($('pca-map-normalize').checked,true);assert.equal($('pca-map-rim').checked,true);
$('nmf-map-opacity').value='.65';$('pca-map-metric').value='frequency';$('pca-map-display').value='continuous';$('nmf-map-phase').value='BCC';$('pca-map-symbols').value='both';$('pca-map-rim').checked=false;$('pca-workers').value='4';
context.syncLinkedControls(false);
assert.equal($('grid-opacity').value,'65');assert.equal($('map-mode').value,'support');assert.equal($('map-display').value,'continuous');assert.equal($('map-phase').value,'BCC');assert.equal($('map-symbol').value,'both');assert.equal($('map-show-rim').checked,false);assert.equal($('grid-workers').value,'4');
assert.equal(saved.get('tem-grid-opacity'),65);assert.equal(saved.get('tem-map-display'),'continuous');assert.equal(saved.get('tem-map-show-rim'),false);
// A different source or an ordinary grid must not inherit stale popup state.
linked=false;$('nmf-map-opacity').value='.2';context.syncLinkedControls(false);assert.equal($('grid-opacity').value,'65');
console.log('Component map controls: bidirectional values, opacity units, preferences and source isolation passed.');

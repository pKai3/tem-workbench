// Cross-batch coordinates require a manual anchor; local corrections remain relative to it.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const controls=new Map(),saved=new Map();
const document={getElementById(id){if(!controls.has(id))controls.set(id,{value:0,checked:false});return controls.get(id)}};
const context={document,config:{data_root:'test'},readPreference:(k,d)=>saved.has(k)?saved.get(k):d};
vm.createContext(context);
let source=fs.readFileSync('web/acquisition-map.js','utf8');
const zoomCode=source.slice(source.indexOf(' function zoom('),source.indexOf(" byId('acquisition-zoom-in').onclick="));
source=source.slice(0,source.indexOf(" byId('acquisition-map-open').onclick="))+`
 ${zoomCode}
 draw=()=>{};hideHover=()=>{};
 globalThis.test={set:(files,groups,ref)=>{data={files,batches:groups};visible=files;reference=files.find(f=>f.id===ref)},
 location:id=>location(data.files.find(f=>f.id===id)),
 place:(id,ref,value)=>{const f=data.files.find(f=>f.id===id),r=data.files.find(f=>f.id===ref);placements.set(placementKey(f,r),value)},
 extent:()=>fittedView(),fitOverview:()=>fit(true),zoomOut:()=>zoom(1/.65),view:()=>view,
 clear:()=>placements.clear()};})();`;
vm.runInContext(source,context);
document.getElementById('acquisition-units').value=1000;
const row=(id,batch,x,y)=>({id,acquisition_batch:batch,stage_position:{x,y},field_nm:[100,100]});
const files=[row('a','one',0,0),row('b','one',.1,.2),row('c','two',999,999),row('d','two',999.3,999.4),row('missing','three',null,null)];
const groups=[{id:'one',reference_id:'a'},{id:'two',reference_id:'c'},{id:'three',reference_id:'missing'}];
const t=context.test,location=id=>{const p=t.location(id);return p&&Array.from(p)};
t.set(files,groups,'a');assert.deepEqual(location('b'),[.1,-.2]);assert.equal(location('c'),null);assert.equal(location('d'),null);
t.place('c','a',{x:2,y:3});assert.deepEqual(location('c'),[2,3]);
assert.ok(Math.abs(location('d')[0]-2.3)<1e-9);assert.ok(Math.abs(location('d')[1]-2.6)<1e-9);
// An old cross-boundary child override must not override the aligned batch transform.
t.place('d','a',{x:500,y:500});assert.ok(location('d')[0]<3);
// Within-batch manual correction follows the group's anchor when it moves.
t.place('d','c',{x:.7,y:.8});assert.deepEqual(location('d'),[2.7,3.8]);
t.place('c','a',{x:4,y:5});assert.deepEqual(location('d'),[4.7,5.8]);
t.place('c','a',null);assert.equal(location('d'),null);
// Missing stage coordinates do not prevent explicit manual anchor placement.
t.place('missing','a',{x:1,y:2});assert.deepEqual(location('missing'),[1,2]);
// Saved anchor and batch-specific rotation are restored, without rotating pixels.
t.clear();saved.set('tem-acquisition-placement:'+JSON.stringify(['test','a','c']),{x:1,y:1});
saved.set('tem-acquisition-rotation:'+JSON.stringify(['test','c']),90);
assert.ok(Math.abs(location('d')[0]-.6)<1e-9);assert.ok(Math.abs(location('d')[1]-.7)<1e-9);
console.log('Acquisition placements: batch isolation, rigid translation, local overrides, missing metadata and restored rotation passed.');

// Fitting the small reference must not cap zoom-out before distant images fit.
t.clear();saved.clear();t.set(files,groups,'a');t.place('c','a',{x:10,y:20});
const extent=t.extent();t.fitOverview();
assert.ok(extent.w>t.view().w*100);
for(let i=0;i<30;i++)t.zoomOut();
assert.ok(t.view().w>=extent.w);assert.ok(t.view().w<=extent.w*2+1e-9);
// A newly moved batch extends the limit immediately, without requiring Fit all first.
t.place('c','a',{x:100,y:200});const expanded=t.extent();
for(let i=0;i<30;i++)t.zoomOut();
assert.ok(t.view().w>=expanded.w);assert.ok(t.view().w<=expanded.w*2+1e-9);
console.log('Acquisition zoom: reference view and moved placements retain access to full map extent.');

const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.attrs={};this.classList={add:()=>{},toggle:()=>{}};this.listeners={};this.value=0;this.checked=false;this.textContent=''}
 append(...nodes){this.children.push(...nodes)}
 replaceChildren(...nodes){this.children=nodes}
 setAttribute(k,v){this.attrs[k]=v}
 addEventListener(k,f){this.listeners[k]=f}
 querySelectorAll(){return []}
}
const controls=new Map(),saved=new Map();const context={clearTimeout:()=>{},document:{createElement:tag=>new Element(tag),getElementById:id=>{if(!controls.has(id))controls.set(id,new Element('div'));return controls.get(id)}},config:{data_root:'test'},readPreference:(k,d)=>saved.has(k)?saved.get(k):d,writePreference:(k,v)=>saved.set(k,v),acquisitionNumber:f=>Number(f.id.slice(1))};
vm.createContext(context);let source=fs.readFileSync('web/acquisition-map.js','utf8');
source=source.slice(0,source.indexOf(" byId('acquisition-map-open').onclick="))+`
 globalThis.test={set:(files,groups,ref)=>{data={files,batches:groups};visible=files;scopedBatches=groups;reference=files.find(f=>f.id===ref);batchId='*';treeSnapshot=null;treeMasterId=ref},view:id=>{reference=data.files.find(f=>f.id===id)},parent:()=>parentImage()?.id,render:renderImageTree,tree:spatialTree,tilt,peers:footprintPeers,outside:outsideReferenceFraction,parents:comparisonParents,crop:cropDetails,label:groupName,startMove:startPlacementMove,move:applyPlacementMove,finishMove:finishPlacementMove,location:f=>location(f),place:(f,ref,x,y)=>placements.set(placementKey(f,ref),{x,y}),clearMoves:()=>placements.clear(),leavesFirst,referenceChildCount,
 remember:rememberSelection,restore:(sample,current=null,opening=false)=>{data.sample=sample;restoreSelection(current,opening)},seed:openingSeed,
 selection:()=>({folder:selectedFolder,batch:batchId}),
 updateSelection:()=>{renderImageTree=()=>{};navigation=()=>{};syncAdjustment=()=>{};preview=()=>{};fit=()=>{};draw=()=>{};update()},
 reference:()=>reference?.id};})();`;
vm.runInContext(source,context);
controls.get('acquisition-list')||context.document.getElementById('acquisition-list');
context.document.getElementById('acquisition-units').value=1000;
const row=(id,size,x=0,batch='a')=>({id,name:id,folder:'test',date:'today',time:'now',field_nm:size?[size,size]:null,stage_position:{x,y:0,alpha:.90001234,beta:0},acquisition_batch:batch});
const files=[row('i102',8000),row('i103',8000),row('i104',4000),row('i101',2000),row('i100',0),row('i105',1000,3),row('i106',1000,4.3),row('i107',1000,10),row('i108',500,0,'b')];
const groups=[{id:'a',reference_id:'i102',members:files.filter(f=>f.acquisition_batch==='a').map(f=>f.id)},{id:'b',reference_id:'i108',members:['i108']}];
context.test.set(files,groups,'i102');
const tree=context.test.tree();
assert.deepEqual(Array.from(tree.root.files,f=>f.id),['i102','i103']);
const nested=tree.root.children.find(g=>g.files[0].id==='i104');
assert.equal(nested.children[0].files[0].id,'i101');
assert.equal(nested.children[0].children[0].files[0].id,'i100');
assert.ok(tree.root.children.some(g=>g.files[0].id==='i105'));
assert.ok(tree.root.children.some(g=>g.files[0].id==='i106'),'partial overlap belongs on tree');
assert.equal(tree.roots[1].files[0].id,'i107');assert.equal(tree.unplaced[0].files[0].id,'i108');
assert.deepEqual(Array.from(context.test.parents(files[3],'closest'),f=>f.id),['i104']);
assert.deepEqual(Array.from(context.test.parents(files[3],'all'),f=>f.id),['i104','i102']);
assert.deepEqual(Array.from(context.test.parents(files[3],'master'),f=>f.id),['i102']);
assert.equal(context.test.parents(files[1],'all').length,0,'alternate reference does not crop itself');
const crop=context.test.crop(files[3],files[2]);assert.equal(crop.bounds.w,.5);assert.equal(crop.bounds.x,.25);
// Crop coordinates subtract the parent location, not just the master origin.
files[2].stage_position.x=.4;files[3].stage_position.x=.6;
assert.ok(Math.abs(context.test.crop(files[3],files[2]).bounds.x-.3)<1e-12);
files[2].stage_position.x=0;files[3].stage_position.x=0;
assert.equal(context.test.tilt(.9),'0.900');assert.equal(context.test.tilt(.90001234),'0.90001234');assert.equal(context.test.tilt(0),'0.00');
context.test.render();
const root=controls.get('acquisition-list').children[0],top=root.children[0];
assert.equal(top.children[0].children[0].children[0].textContent,'102/103');
const branch=top.children[1];branch.open=false;branch.listeners.toggle();context.test.render();
assert.equal(controls.get('acquisition-list').children[0].children[0].children[1].open,false);
context.test.set(files,groups,'i103');assert.deepEqual(Array.from(context.test.tree().root.files,f=>f.id),['i102','i103']);
// Similar but non-identical fields must not be merged.
files[1].field_nm=[8001,8000];context.test.set(files,groups,'i102');assert.equal(context.test.tree().root.files.length,1);
console.log('Spatial tree: grouped duplicates, recursive nesting, point locations, partial overlap, outside/unplaced, reference choice, collapse and tilt precision passed.');

// Disconnected footprints form full independent trees, including parent crops.
const forestFiles=[row('i201',8000),row('i202',4000),row('i203',6000,20),row('i204',2000,20),row('i205',500,20)];
context.test.set(forestFiles,[{id:'a',reference_id:'i201',members:forestFiles.map(f=>f.id)}],'i201');
const forest=context.test.tree();
assert.equal(forest.roots.length,2);
assert.equal(forest.roots[1].children[0].children[0].files[0].id,'i205');
assert.deepEqual(Array.from(context.test.parents(forestFiles[4],'all'),f=>f.id),['i204','i203']);
assert.deepEqual(Array.from(context.test.parents(forestFiles[4],'master'),f=>f.id),['i203']);
assert.deepEqual(Array.from(context.test.parents(forestFiles[4],'closest'),f=>f.id),['i204']);
assert.equal(context.test.parents(forestFiles[2],'all').length,0);
context.test.render();
assert.equal(controls.get('acquisition-list').children[0].children.length,2);
// The current-reference mode stops at the viewed ancestor, including alternate captures.
context.test.view('i204');
assert.deepEqual(Array.from(context.test.parents(forestFiles[4],'current'),f=>f.id),['i204']);
assert.equal(context.test.parents(forestFiles[3],'current').length,0);
context.test.view('i203');
assert.deepEqual(Array.from(context.test.parents(forestFiles[4],'current'),f=>f.id),['i204','i203']);
context.test.view('i201');
assert.deepEqual(Array.from(context.test.parents(forestFiles[4],'current'),f=>f.id),['i204']);
const treeRow=controls.get('acquisition-list').children[0].children[0].children[0];
assert.equal(treeRow.children[0].onmouseenter,undefined);
assert.equal(typeof treeRow.children[1].onmouseenter,'function');
assert.equal(typeof treeRow.onmouseenter,'function');
console.log('Independent acquisition trees and local parent previews passed.');

const pair=[{...row('i123',1000),name:'1.2MX_ADF_TiFe_0123'},{...row('i124',1000),id:'i123',name:'1.2MX_Hitachi_TiFe_0123'}];
assert.equal(context.test.label({files:pair}),'123 (ADF & Hitachi)');
console.log('Shared detector capture labels passed.');

// A deep click changes the highlight/view only; Parent follows each actual ancestor.
context.test.set(forestFiles,[{id:'a',reference_id:'i201',members:forestFiles.map(f=>f.id)}],'i201');
const stable=context.test.tree();
context.test.view('i205');
assert.equal(context.test.tree(),stable);
assert.equal(context.test.parent(),'i204');
context.test.view('i204');assert.equal(context.test.parent(),'i203');
context.test.view('i203');assert.equal(context.test.parent(),undefined);
context.test.view('i202');assert.equal(context.test.parent(),'i201');
console.log('Stable forest and level-by-level parent navigation passed.');

context.test.clearMoves();context.test.set(files,groups,'i102');
const start=Array.from(context.test.location(files[3]));
let move=context.test.startMove(files[2],false);context.test.move(move,1,2);
assert.deepEqual(Array.from(context.test.location(files[3])),start,'image-only leaves child stationary');
context.test.finishMove(move,false);
move=context.test.startMove(files[2],true);context.test.move(move,1,2);
assert.deepEqual(Array.from(context.test.location(files[3])),[start[0]+1,start[1]+2]);
context.test.finishMove(move,false);
assert.deepEqual(Array.from(context.test.location(files[3])),start,'cancel restores descendants');
console.log('Image-only, descendant translation and cancellation passed.');

// Moving a foreign batch anchor must not silently move its children in image-only mode.
const cross=[row('i301',10000),row('i302',4000,0,'b'),row('i303',1000,.2,'b')];
const crossGroups=[{id:'a',reference_id:'i301',members:['i301']},{id:'b',reference_id:'i302',members:['i302','i303']}];
context.test.clearMoves();context.test.set(cross,crossGroups,'i301');context.test.place(cross[1],cross[0],1,0);
const childStart=Array.from(context.test.location(cross[2]));
move=context.test.startMove(cross[1],false);context.test.move(move,1,2);
assert.deepEqual(Array.from(context.test.location(cross[2])),childStart);
context.test.finishMove(move,false);
move=context.test.startMove(cross[1],true);context.test.move(move,1,2);
assert.deepEqual(Array.from(context.test.location(cross[2])),[childStart[0]+1,childStart[1]+2]);
context.test.finishMove(move,false);
assert.deepEqual(Array.from(context.test.location(cross[2])),childStart);
console.log('Cross-batch anchor movement respects selected move scope.');

context.test.set(files,groups,'i102');
assert.equal(context.test.parents(files[4],'all').length,0,'point-only diffraction images must not request real-space parent crops');
console.log('Diffraction hover omits unavailable real-space crops.');

// Whole-batch translation includes members outside the anchor's spatial subtree.
const remote=row('i304',500,12,'b');cross.push(remote);crossGroups[1].members.push(remote.id);
context.test.clearMoves();context.test.set(cross,crossGroups,'i301');context.test.place(cross[1],cross[0],1,0);
const before=cross.map(f=>Array.from(context.test.location(f)));
move=context.test.startMove(cross[1],false,true);context.test.move(move,2,3);
assert.deepEqual(Array.from(context.test.location(cross[0])),before[0],'master stays fixed');
for(let i=1;i<cross.length;i++)assert.deepEqual(Array.from(context.test.location(cross[i])),[before[i][0]+2,before[i][1]+3]);
context.test.finishMove(move,false);
for(let i=0;i<cross.length;i++)assert.deepEqual(Array.from(context.test.location(cross[i])),before[i]);
console.log('Whole-batch translation includes off-tree members and cancels cleanly.');

// Outside preview threshold is based on image area, not centre position.
context.test.clearMoves();
const boundary=[row('i301',8000),row('i302',1000,4),row('i303',1000,4.1),row('i304',1000,0),row('i305',0,4)];
context.test.set(boundary,[{id:'a',reference_id:'i301',members:boundary.map(f=>f.id)}],'i301');
assert.equal(context.test.outside(boundary[1]),.5);
assert.ok(Math.abs(context.test.outside(boundary[2])-.6)<1e-10);
assert.equal(context.test.outside(boundary[3]),0);
assert.equal(context.test.outside(boundary[4]),0);
console.log('Outside preview uses calibrated footprint overlap.');

// Display sorting does not mutate the hierarchy or disturb order within each group.
const ordered=context.test.leavesFirst([{children:[1],id:'branch1'},{children:[],id:'leaf1'},{children:[1],id:'branch2'},{children:[],id:'leaf2'}]);
assert.deepEqual(Array.from(ordered,g=>g.id),['leaf1','leaf2','branch1','branch2']);

// Equal-size parent/reference choices favour more covered smaller footprints.
const ties=[row('i401',8000,0),row('i402',8000,5),row('i403',1000,2.5),row('i404',1000,6),row('i405',1000,7)];
context.test.clearMoves();context.test.set(ties,[{id:'a',reference_id:'i401',members:ties.map(f=>f.id)}],'i401');
context.test.tree();context.test.view('i403');assert.equal(context.test.parent(),'i402');
assert.equal(context.test.referenceChildCount(ties[0],ties),1);
assert.equal(context.test.referenceChildCount(ties[1],ties),3);
context.document.getElementById('acquisition-date').value='today';
context.document.getElementById('acquisition-scope').value='sample';
context.document.getElementById('acquisition-reference').value='';
context.test.updateSelection();assert.equal(context.test.reference(),'i402');
context.document.getElementById('acquisition-reference').value='i401';
context.test.updateSelection();assert.equal(context.test.reference(),'i401','retain explicit reference');

// Saved state survives new map initialization, is sample/data-source scoped, and validates stale options.
context.config.files=ties.map(f=>({...f,sample:'ST'}));
context.test.restore('ST');
context.document.getElementById('acquisition-date').value='today';
context.document.getElementById('acquisition-scope').value='folder';
context.document.getElementById('acquisition-align-batch').value='a';
context.test.updateSelection();context.test.remember();
assert.equal(context.test.seed().sample,'ST');
context.document.getElementById('acquisition-date').value='*';
context.document.getElementById('acquisition-scope').value='sample';
context.document.getElementById('acquisition-reference').value='';
context.document.getElementById('acquisition-align-batch').value='';
context.test.restore('ST');
assert.equal(context.document.getElementById('acquisition-scope').value,'folder');
assert.equal(context.document.getElementById('acquisition-date').value,'today');
assert.equal(context.document.getElementById('acquisition-reference').value,'i401');
assert.equal(context.document.getElementById('acquisition-align-batch').value,'a');
assert.equal(context.test.selection().folder,'test');
assert.equal(context.test.selection().batch,'a');
const stateKey='tem-acquisition-selection:'+JSON.stringify(['test','ST']);
saved.set(stateKey,{...saved.get(stateKey),batch:'*'});context.test.restore('ST');
assert.equal(context.test.selection().batch,'*');
context.test.restore('STA');assert.equal(context.document.getElementById('acquisition-scope').value,'sample');
context.config.data_root='different';context.test.restore('ST');
assert.equal(context.document.getElementById('acquisition-date').value,'*');
context.config.data_root='test';
saved.set('tem-acquisition-selection:'+JSON.stringify(['test','ST']),{folder:'deleted',scope:'invalid',date:'deleted',batch:'deleted',reference:'deleted'});
context.document.getElementById('acquisition-reference').value='';
context.test.restore('ST');context.test.updateSelection();
assert.equal(context.test.selection().folder,'test');assert.equal(context.test.selection().batch,'a');
assert.equal(context.document.getElementById('acquisition-date').value,'*');
assert.equal(context.test.reference(),'i402');
console.log('Leaf ordering, most-covered ties, retained references, selection restoration and stale-state fallbacks passed.');

// Reference-specific saved movements must not retain impossible parent links.
const shifted=[row('i1189',8000),row('i1187',3123),row('i1188',1984),row('i1185',1526)];
context.test.clearMoves();context.test.set(shifted,[{id:'a',reference_id:'i1189',members:shifted.map(f=>f.id)}],'i1189');
const originalTree=context.test.tree();
context.test.view('i1185');assert.equal(context.test.parent(),'i1188');
assert.equal(context.test.tree(),originalTree,'changing origin alone preserves the tree');
context.test.place(shifted[2],shifted[1],0,5);
context.test.view('i1187');
assert.notEqual(context.test.tree(),originalTree,'saved placement changes invalidate snapshot');
assert.deepEqual(Array.from(context.test.parents(shifted[3],'all'),f=>f.id),['i1187','i1189']);
context.test.view('i1188');
assert.equal(context.test.tree().roots.length,1,'another view recalculates its own saved placements');
console.log('Tree follows visible saved placements while preserving origin-only navigation.');

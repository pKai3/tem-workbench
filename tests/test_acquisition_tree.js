const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.attrs={};this.classList={add:()=>{}};this.listeners={};this.value=0;this.checked=false;this.textContent=''}
 append(...nodes){this.children.push(...nodes)}
 replaceChildren(...nodes){this.children=nodes}
 setAttribute(k,v){this.attrs[k]=v}
 addEventListener(k,f){this.listeners[k]=f}
}
const controls=new Map();const context={document:{createElement:tag=>new Element(tag),getElementById:id=>{if(!controls.has(id))controls.set(id,new Element('div'));return controls.get(id)}},config:{data_root:'test'},readPreference:(k,d)=>d,acquisitionNumber:f=>Number(f.id.slice(1))};
vm.createContext(context);let source=fs.readFileSync('web/acquisition-map.js','utf8');
source=source.slice(0,source.indexOf(" byId('acquisition-map-open').onclick="))+`
 globalThis.test={set:(files,groups,ref)=>{data={files,batches:groups};visible=files;scopedBatches=groups;reference=files.find(f=>f.id===ref);batchId='*'},render:renderImageTree};})();`;
vm.runInContext(source,context);
controls.get('acquisition-list')||context.document.getElementById('acquisition-list');
context.document.getElementById('acquisition-units').value=1000;
const row=(id,batch)=>({id,name:id,folder:'test',date:'today',time:'now',field_nm:[100,100],stage_position:{x:0,y:0,alpha:0,beta:0},acquisition_batch:batch});
const files=[row('i1','a'),row('i2','a'),row('i3','b'),row('i4','b')];
const groups=[{id:'a',reference_id:'i2',members:['i1','i2'],first:1,last:2},{id:'b',reference_id:'i3',members:['i3','i4'],first:3,last:4}];
context.test.set(files,groups,'i2');context.test.render();
const root=controls.get('acquisition-list').children[0],top=root.children[0];
assert.equal(top.children[0].children[0].textContent,'i2');
const branch=top.children[1],nested=branch.children[1];
assert.equal(nested.children[0].children[0].children[0].textContent,'i1');
const batch=nested.children[1];assert.equal(batch.children[0].children[0].textContent,'i3');
assert.match(batch.children[0].children[0].children[0].textContent,/Not placed/);
assert.equal(batch.children[1].children[1].children[0].children[0].children[0].textContent,'i4');
branch.open=false;branch.listeners.toggle();context.test.render();assert.equal(controls.get('acquisition-list').children[0].children[0].children[1].open,false);
console.log('Tree hierarchy: current reference first, nested batch members, unplaced status and collapse persistence passed.');

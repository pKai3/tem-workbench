// Temporary indicators retain animation between polls and never consume input.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('web/app.js','utf8');
function element(tag,attrs={}){
 const node={tag,attrs:{...attrs},children:[],dataset:{},style:{},classList:{add(){}},
  setAttribute(k,v){this.attrs[k]=v},append(child){child.parent=this;this.children.push(child)},
  remove(){this.parent.children=this.parent.children.filter(n=>n!==this)},cloneNode(){return element(tag,attrs)}};
 if(attrs['data-window'])node.dataset.window=attrs['data-window'];return node;
}
const context=vm.createContext({el:element,$:()=>({querySelector:()=>element('svg')})});
vm.runInContext(source.slice(source.indexOf('function drawActiveGridWindows('),source.indexOf('function drawGrid(){')),context);
const group=element('g'),job={id:'one',state:'running',source:{width:4096},active_windows:[{x:10,y:20,w:100,h:100},{x:110,y:20,w:100,h:100}]};
context.drawActiveGridWindows(group,job);assert.equal(group.children.length,2);
const original=group.children[0];context.drawActiveGridWindows(group,job);assert.equal(group.children[0],original);
assert.equal(original.children[0].attrs.stroke,'#fff');assert.equal(original.children[0].attrs.fill,'none');
assert.equal(original.children[1].style.width,'45px');
assert.equal(original.children[1].attrs.width,45);assert.equal(original.children[1].attrs.height,45);
job.active_windows.pop();context.drawActiveGridWindows(group,job);assert.equal(group.children.length,1);
for(const state of ['complete','cancelled','error']){context.drawActiveGridWindows(group,{...job,state});assert.equal(group.children.length,0)}
context.drawActiveGridWindows(group,job);context.drawActiveGridWindows(group,{...job,cancelling:true});assert.equal(group.children.length,0);
context.drawActiveGridWindows(group,job);context.drawActiveGridWindows(group,null);assert.equal(group.children.length,0);
context.drawActiveGridWindows(group,{...job,active_windows:[{x:NaN,y:0,w:3,h:3}]});assert.equal(group.children.length,0);
const html=fs.readFileSync('web/index.html','utf8');
for(const id of ['grid-active-windows','batch-active-windows'])assert.match(html,new RegExp(`<g id="${id}" pointer-events="none" aria-hidden="true">`));
assert.match(source,/gridMatchesSource\(grid\)\?grid:null/);
assert.match(source,/#overlap-preview,#grid-active-windows,title/);
console.log('Active grid window indicators passed');

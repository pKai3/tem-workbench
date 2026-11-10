// Temporary indicators retain animation between polls and never consume input.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('web/app.js','utf8');
function element(tag,attrs={}){
 const node={tag,attrs:{...attrs},children:[],dataset:{},style:{},classList:{add(){}},
  prepend(child){child.parent=this;this.children.unshift(child)},setAttribute(k,v){this.attrs[k]=v;if(k==='data-window')this.dataset.window=v},append(child){child.parent=this;this.children.push(child)},
  remove(){this.parent.children=this.parent.children.filter(n=>n!==this)},cloneNode(){return element(tag,attrs)}};
 if(attrs['data-window'])node.dataset.window=attrs['data-window'];return node;
}
const context=vm.createContext({NS:'http://www.w3.org/2000/svg',document:{createElementNS:(_,tag)=>element(tag)},$:()=>({querySelector:()=>element('svg')})});
// Use the real SVG factory: a permissive stub hid missing attribute arguments.
vm.runInContext(source.split('\n').find(line=>line.startsWith('function el(')),context);
vm.runInContext(source.slice(source.indexOf('function drawActiveGridWindows('),source.indexOf('function drawGrid(){')),context);
const group=element('g'),job={id:'one',state:'running',source:{width:4096},active_windows:[{x:10,y:20,w:100,h:100},{x:110,y:20,w:100,h:100}]};
context.drawActiveGridWindows(group,job);assert.equal(group.children.length,2);
const [outlines,spinners]=group.children;
assert.equal(outlines.children.length,2);assert.equal(spinners.children.length,2);
const original=spinners.children[0];context.drawActiveGridWindows(group,job);assert.equal(spinners.children[0],original);
assert.equal(outlines.children[0].attrs.stroke,'#fff');assert.equal(outlines.children[0].attrs.fill,'none');
assert.equal(original.children[0].style.width,'65px');
assert.equal(original.children[0].attrs.width,65);assert.equal(original.children[0].attrs.height,65);
// A new overlapping window must remain behind ALL spinners, including existing ones.
job.active_windows.push({x:60,y:20,w:100,h:100});context.drawActiveGridWindows(group,job);
assert.equal(group.children[0],outlines);assert.equal(group.children[1],spinners);
assert.ok(outlines.children.every(n=>n.tag==='rect'));
assert.ok(spinners.children.every(n=>n.children[0].tag==='svg'));
assert.equal(spinners.children[0],original);
job.active_windows.splice(1);context.drawActiveGridWindows(group,job);
assert.equal(outlines.children.length,1);assert.equal(spinners.children.length,1);
for(const state of ['complete','cancelled','error']){context.drawActiveGridWindows(group,{...job,state});assert.equal(group.children.length,0)}
context.drawActiveGridWindows(group,job);context.drawActiveGridWindows(group,{...job,cancelling:true});assert.equal(group.children.length,0);
context.drawActiveGridWindows(group,job);context.drawActiveGridWindows(group,null);assert.equal(group.children.length,0);
context.drawActiveGridWindows(group,{...job,active_windows:[{x:NaN,y:0,w:3,h:3}]});assert.equal(group.children.length,0);
const html=fs.readFileSync('web/index.html','utf8');
for(const id of ['grid-active-windows','batch-active-windows'])assert.match(html,new RegExp(`<g id="${id}" pointer-events="none" aria-hidden="true">`));
assert.match(source,/gridMatchesSource\(grid\)\?grid:null/);
assert.match(source,/#overlap-preview,#grid-active-windows,title/);
console.log('Active grid window indicators passed');

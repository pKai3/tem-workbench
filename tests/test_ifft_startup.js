// Use the production SVG helper: a permissive mock hid an iFFT startup failure.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {element}=require('./svg_fixture');
const nodes=new Map();
function node(tag){const n=element(tag);n.addEventListener=()=>{};return n}
const $=id=>{if(!nodes.has(id))nodes.set(id,node('div'));return nodes.get(id)};
const context={$,NS:'http://www.w3.org/2000/svg',
 document:{createElement:node,createElementNS:(_,tag)=>node(tag),querySelector:$,querySelectorAll:()=>[],addEventListener(){}},
 window:{addEventListener(){}},ResizeObserver:class{observe(){}}};
vm.createContext(context);
const app=fs.readFileSync('web/app.js','utf8');
const helper=app.split('\n').find(line=>line.startsWith('function el('));
assert.ok(helper,'Production SVG helper is present');
vm.runInContext(helper,context);
vm.runInContext(fs.readFileSync('web/fft-masking.js','utf8'),context);
assert.equal(typeof $('open-ifft').onclick,'function','Setup reaches the open handler');
assert.equal(typeof $('ifft-import-file').onchange,'function','Entire workspace initializes');
assert.ok($('ifft-dialog').children.some(n=>n.className==='ifft-hover'),'Hover preview initializes');
console.log('iFFT startup with production SVG helper passed.');

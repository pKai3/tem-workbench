// Cursor-following detector preview: viewport coordinates must not use detector quadrants.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/app.js','utf8'),controls=new Map();
function $(id){
 if(!controls.has(id))controls.set(id,{hidden:true,style:{},attributes:{},value:'view',textContent:'',
  getBoundingClientRect(){return {width:270,height:320}},
  setAttribute(k,v){this.attributes[k]=v},getAttribute(k){return this.attributes[k]}});
 return controls.get(id);
}
const document={body:{append(card){card.parentElement=this}}};
const context={document,$,isDiffraction:()=>true,meta:{width:4096,height:4096},fileId:'test',innerWidth:1200,innerHeight:900,encodeURIComponent,
 clamp:(v,a,b)=>Math.min(b,Math.max(a,v))};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function hideCentreLoupe()'),source.indexOf("$('diff-tool').onchange=")),context);
function move(x,y,px=2000,py=2000){context.moveCentreLoupe({x:px,y:py},{clientX:x,clientY:y});return $('centre-loupe')}
let card=move(100,100);assert.equal(card.parentElement,document.body);assert.equal(card.hidden,false);assert.equal(card.style.left,'118px');assert.equal(card.style.top,'118px');
card=move(240,160);assert.equal(card.style.left,'258px');assert.equal(card.style.top,'178px');
// Same pointer, different detector half: position remains at the pointer.
card=move(240,160,3000,3000);assert.equal(card.style.left,'258px');assert.equal(card.style.top,'178px');
assert.equal($('centre-loupe-view').attributes.viewBox,'2936 2936 128 128');
card=move(1195,895);assert.equal(card.style.left,'907px');assert.equal(card.style.top,'557px');
$('diff-tool').value='center';move(500,300);assert.equal($('centre-loupe-hint').hidden,false);
$('diff-tool').value='add';assert.equal(move(500,300).hidden,true);
$('diff-tool').value='view';assert.equal(move(500,300,-1,30).hidden,true);
context.innerWidth=280;context.innerHeight=330;card=move(150,160);assert.equal(card.style.left,'8px');assert.equal(card.style.top,'8px');
console.log('Detector hover: cursor tracking, viewport edges, native crop and tool modes passed.');

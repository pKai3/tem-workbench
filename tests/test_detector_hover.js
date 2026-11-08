// Cursor-following detector preview: viewport coordinates must not use detector quadrants.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/app.js','utf8'),controls=new Map();
const {element}=require('./svg_fixture');
function $(id){
 if(!controls.has(id))controls.set(id,element(id));
 return controls.get(id);
}
const document={body:{append(card){card.parentElement=this}}};
const context={document,$,isDiffraction:()=>true,meta:{width:4096,height:4096},fileId:'test',innerWidth:1200,innerHeight:900,encodeURIComponent,
 diffractionSettings:{pixel_x_nm_inv:.02,pixel_y_nm_inv:.04},
 clamp:(v,a,b)=>Math.min(b,Math.max(a,v))};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function hideCentreLoupe()'),source.indexOf("$('diff-tool').onchange=")),context);
function move(x,y,px=2000,py=2000){context.moveCentreLoupe({x:px,y:py},{clientX:x,clientY:y});return $('centre-loupe')}
let card=move(100,100);assert.equal(card.parentElement,document.body);assert.equal(card.hidden,false);assert.equal(card.style.left,'118px');assert.equal(card.style.top,'8px');
const marker=element('path',{class:'detector-observation',id:'original-peak'}),rings=element('g',{class:'manual-snap-overlay'});
rings.append(element('ellipse',{rx:20,ry:40}),element('rect',{class:'snap-radius-handle'}));
const deletion=element('g',{'data-delete-peak-edit':0,role:'button',tabindex:0,'pointer-events':'all'});
deletion.append(element('rect',{x:94,y:94,width:12,height:12}),element('path',{d:'M97 97l6 6'}));rings.append(deletion);
rings.append(element('text',{x:120,y:100,'font-size':28},'0.500 rel.'));
$('overview').getScreenCTM=()=>({a:.5,b:0});$('centre-loupe-view').getScreenCTM=()=>({a:2,b:0});
$('detector-overlay').append(marker);$('overview').append(rings);
$('detector-overlay').append(element('path',{'data-centre-translation':'true'}),element('path',{'data-centre-marker':'fitted'}));
move(100,100);
assert.equal($('centre-loupe-overlay').querySelectorAll('.detector-observation').length,1);
assert.equal($('centre-loupe-overlay').querySelectorAll('[data-centre-translation],[data-centre-marker]').length,2,'Magnified detector retains both centre and shift markers');
assert.equal($('centre-loupe-overlay').querySelector('ellipse').attrs.ry,40,'Detector preview preserves anisotropic radius');
assert.equal($('centre-loupe-overlay').querySelectorAll('[id],.snap-radius-handle').length,0);
const previewDelete=$('centre-loupe-overlay').querySelector('[data-delete-peak-edit]');
assert.equal(previewDelete.attrs.transform,undefined,'Preview × magnifies with its source hitbox');
assert.deepEqual(previewDelete.querySelector('rect').attrs,deletion.querySelector('rect').attrs,'Preview outline has exactly the source clickable bounds');
assert.deepEqual(previewDelete.querySelector('path').attrs,deletion.querySelector('path').attrs,'The × follows the same magnification as its box');
assert.equal(previewDelete.getAttribute('tabindex'),undefined);assert.equal(previewDelete.getAttribute('pointer-events'),undefined);
assert.equal($('centre-loupe-overlay').querySelector('text').attrs.transform,'translate(120 100) scale(0.25) translate(-120 -100)','Radius label does not magnify over the preview');
assert.equal(deletion.attrs.role,'button');assert.equal(deletion.attrs.tabindex,0,'Original × remains interactive');
assert.equal(marker.attrs.id,'original-peak','Preview leaves original markers intact');
card=move(240,500);assert.equal(card.style.left,'258px');assert.equal(card.style.top,'162px');
// Same pointer, different detector half: position remains at the pointer.
card=move(240,500,3000,3000);assert.equal(card.style.left,'258px');assert.equal(card.style.top,'162px');
assert.equal($('centre-loupe-view').attributes.viewBox,'2936 2936 128 128');
// Crossing the old collision threshold clamps continuously instead of flipping.
card=move(904,500);assert.equal(card.style.left,'922px');
card=move(905,500);assert.equal(card.style.left,'922px');
card=move(1195,895);assert.equal(card.style.left,'922px');assert.equal(card.style.top,'557px');
$('diff-tool').value='center';move(500,300);assert.equal($('centre-loupe-hint').hidden,false);
for(const tool of ['add','remove']){$('diff-tool').value=tool;assert.equal(move(500,300).hidden,false);assert.equal($('centre-loupe-hint').hidden,true)}
$('diff-tool').value='add';$('diff-snap').checked=true;$('diff-snap-radius').value=5;
move(500,300);assert.equal($('centre-loupe-view').attributes.viewBox,'1700 1700 600 600','Large add radius fits within the preview');
$('diff-tool').value='remove';$('diff-dedupe-radius').value=4;
move(500,300);assert.equal($('centre-loupe-view').attributes.viewBox,'1760 1760 480 480','Remove radius also fits at anisotropic sampling');
$('diff-snap').checked=false;$('diff-tool').value='add';assert.equal(context.centreLoupeSpan(),480,'Unsnapped additions use the edit radius');
$('diff-tool').value='mask';assert.equal(move(500,300).hidden,true);
$('diff-tool').value='view';assert.equal(move(500,300,-1,30).hidden,true);
context.innerWidth=280;context.innerHeight=330;card=move(150,160);assert.equal(card.style.left,'8px');assert.equal(card.style.top,'8px');
console.log('Detector hover: cursor tracking, viewport edges, native crop and tool modes passed.');

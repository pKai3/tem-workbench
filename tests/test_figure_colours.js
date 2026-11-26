/* Figures reuses AZtec's persisted choices without assigning colours on opening. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/figures.js','utf8'),shared=fs.readFileSync('web/popup-controls.js','utf8');
class Element{
 constructor(tag){Object.assign(this,{tag,children:[],attributes:{},style:{},listeners:{},isConnected:true,value:''})}
 append(...nodes){this.children.push(...nodes);for(const node of nodes)if(typeof node==='object')node.parent=this}
 replaceChildren(...nodes){this.children=[];this.append(...nodes)}
 setAttribute(key,value){this.attributes[key]=value}
 addEventListener(key,fn){this.listeners[key]=fn}
 removeEventListener(key,fn){if(this.listeners[key]===fn)delete this.listeners[key]}
 closest(){for(let p=this.parent;p;p=p.parent)if(p.tag==='dialog'&&p.open)return p;return null}
 getBoundingClientRect(){return {left:30,bottom:70,width:300,height:240}}
 show(){this.open=true}
 close(){this.open=false;this.listeners.close?.()}
 remove(){this.isConnected=false;this.parent.children=this.parent.children.filter(node=>node!==this)}
 focus(){focused=this}
 querySelector(selector){const all=this.children.flatMap(node=>typeof node==='object'?[node,...node.descendants()]:[]);return selector==='.eds-colour-swatches button'?all.find(node=>node.tag==='button'&&node.parent.className==='eds-colour-swatches'):null}
 descendants(){return this.children.flatMap(node=>typeof node==='object'?[node,...node.descendants()]:[])}
}
let focused=null,saves=0,changes=0;
const values=new Map(),storage={readRaw:key=>values.get(key),writeRaw:(key,value)=>values.set(key,value)};
const body=new Element('body'),document={body,createElement:tag=>new Element(tag)};
const c={window:{},document,Date,innerWidth:800,innerHeight:600,WorkbenchWorkspace:storage,
 recipe:{slots:[]},saved:{},tagRows:[],normaliseHex:value=>{const s=String(value||'').trim();return /^#[\da-f]{6}$/i.test(s)?s.toLowerCase():null},
 saveTags(){saves++},validateTags(){},changed(){changes++},status(){},index:0};vm.createContext(c);
vm.runInContext(shared.slice(shared.indexOf('/* Shared colour memory')),c);
c.colourMemory=c.window.WorkbenchLabelColours.create(storage);
const aztec=c.window.WorkbenchLabelColours.create(storage);
aztec.remember({colour:'#123456',label:'AB',sample:'AB'});
aztec.remember({colour:'#ff0000',label:'STA',sample:'STA'});
vm.runInContext(source.slice(source.indexOf(' function figureColourContext('),source.indexOf(' function tagError(')),c);
vm.runInContext(source.slice(source.indexOf(' function tagInk('),source.indexOf(' function addTagSet(')),c);
const panel={name:'AB_Far_1.tif',label:'AB_Far_1',zoom:2,annotations:[{text:'β'}],bar_px:64,scale_nm:1000};
c.recipe.slots=[panel];c.slot=panel;c.fields=new Element('div');
const outer=new Element('dialog');outer.open=true;outer.append(c.fields);body.append(outer);
vm.runInContext(source.slice(source.indexOf("   const colourLabel=document.createElement('label');colourLabel.textContent='Label shade'"),source.indexOf("   inputField(fields,'Zoom ×'")),c);
const controls=c.fields.children[0].children[0], [picker,hex,reset]=controls.children;
assert.deepEqual(c.fields.children[0].children[1].children.map(button=>button.textContent),['Apply to row','Apply to column']);
const original=JSON.stringify(panel);picker.onclick();assert.equal(JSON.stringify(panel),original,'Opening suggestions must not edit a panel');
let palette=outer.children.at(-1);assert.equal(palette.tag,'dialog');assert.equal(palette.open,true);
let suggestion=palette.querySelector('.eds-colour-swatches button');assert.match(suggestion.attributes['aria-label'],/#123456 · Matches AB/);
suggestion.onclick();assert.equal(panel.label_colour,'#123456');assert.equal(changes,1);assert.equal(palette.isConnected,false);assert.equal(focused,picker);
assert.equal(panel.zoom,2);assert.equal(panel.bar_px,64);assert.equal(panel.annotations[0].text,'β');
hex.onclick();palette=outer.children.at(-1);assert.equal(focused,hex,'Hex suggestions retain typing focus');palette.close();
hex.value='#445566';hex.oninput();hex.onchange();assert.equal(aztec.suggestions([],{label:'AB_Far_1'})[0].colour,'#445566','AZtec sees new Figures choices without reloading');
reset.onclick();assert.equal(panel.label_colour,null);assert.equal(hex.value,'');
hex.value='invalid';hex.oninput();assert.equal(hex.attributes['aria-invalid'],'true');assert.equal(panel.label_colour,null);
const list=new Element('div'),tagDialog=new Element('dialog');tagDialog.open=true;tagDialog.append(list);body.append(tagDialog);
c.$=()=>list;c.tagRows=[{label:'AB',colour:''}];c.renderTags();
const row=list.children[0],tagPicker=row.children[2],tagHex=row.children[3];tagPicker.onclick();palette=tagDialog.children.at(-1);
suggestion=palette.querySelector('.eds-colour-swatches button');suggestion.onclick();assert.equal(c.tagRows[0].colour,tagHex.value);assert.ok(c.tagRows[0].colour);assert.ok(saves>0);
tagHex.value='#778899';tagHex.oninput();tagHex.onchange();assert.equal(aztec.suggestions([],{label:'AB'})[0].colour,'#778899');
tagPicker.onclick();palette=tagDialog.children.at(-1);tagDialog.close();assert.equal(palette.isConnected,false,'Closing the parent also removes its suggestions');
// Bulk colour actions follow the displayed grid and preserve every other field.
const slots=Array.from({length:6},(_,i)=>({path:'/image'+i,name:'AB_'+i,label:'Panel '+i,label_colour:'#999999',zoom:2,annotations:[{text:'β'}]}));
slots[1].label_colour='#445566';slots[2]={kind:'placeholder',placeholder:{title:'Not acquired'}};slots[5]={};
c.recipe={columns:3,rows:2,slots};const beforeSlots=JSON.stringify(slots.map(({label_colour,...rest})=>rest));
const beforeChanges=changes;c.applyFigureColour(1,'row');assert.equal(changes,beforeChanges+1);
assert.equal(slots[0].label_colour,'#445566');assert.equal(slots[1].label_colour,'#445566');assert.equal(slots[3].label_colour,'#999999');assert.equal(slots[2].label_colour,undefined);
c.applyFigureColour(1,'column');assert.equal(slots[4].label_colour,'#445566');assert.equal(slots[3].label_colour,'#999999');
assert.equal(JSON.stringify(slots.map(({label_colour,...rest})=>rest)),beforeSlots);
c.recipe={columns:2,rows:3,slots:[slots[0],slots[3],slots[1],slots[4],slots[2],slots[5]]};
slots[1].label_colour='#123456';c.applyFigureColour(2,'row');assert.equal(slots[4].label_colour,'#123456');assert.equal(slots[0].label_colour,'#445566','Row applies in the transposed layout');
slots[1].label_colour=null;c.applyFigureColour(2,'column');assert.equal(slots[0].label_colour,null);assert.equal(slots[4].label_colour,'#123456');assert.equal(slots[2].label_colour,undefined,'Reset-to-default skips placeholders');
console.log('Figures colour suggestions, shared memory, hex/reset, nested dialogs and row/column actions preserve all non-colour edits.');

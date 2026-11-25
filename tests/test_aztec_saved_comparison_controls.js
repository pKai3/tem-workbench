/* Check the actual comparison control handlers and persistence boundary. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/aztec-analysis.js','utf8');
class Element{
 constructor(tag,text='',className=''){Object.assign(this,{tag,textContent:text,children:[],attributes:{},value:'',style:{},className});this.classList={add(){},toggle(){}}}
 append(...nodes){this.children.push(...nodes)}
 replaceChildren(...nodes){this.children=[...nodes]}
 setAttribute(key,value){this.attributes[key]=value}
 get childElementCount(){return this.children.length}
 focus(){}
 getBoundingClientRect(){return {height:300}}
 querySelector(selector){const all=this.children.flatMap(child=>[child,...child.descendants()]);return all.find(node=>selector.startsWith('.')?node.className.split(' ').includes(selector.slice(1)):node.attributes['aria-label']===selector.match(/"(.*)"/)?.[1])||null}
 descendants(){return this.children.flatMap(child=>[child,...child.descendants()])}
}
const key='compare:KamMapImages',a='["/project.oipx","a"]',b='["/project.oipx","b"]';
const first={name:'Original',ids:[a],files:['/project.oipx'],signals:['KAM'],options:{low:0,high:3},aliases:{[a]:'AB'},labelColours:{},crops:{}};
const roots={'eds-analysis-tools':new Element('div'),'eds-analysis-views':new Element('div')},writes=[];
const context={window:{scrollY:123,scrollX:0,scrollTo(){}},structuredClone,console,clearTimeout(){},
 $:id=>roots[id],el:(...args)=>new Element(...args),
 presets:{[key]:[structuredClone(first)]},activePresets:{[key]:'Original'},preferences:{},selections:{},aliases:{['compare:'+a]:'AB'},labelColours:{},cropCentres:new Map(),sourceErrors:new Map(),lastTables:{},persistTimer:null,openVersion:0,
 current:{kind:'map',table:'KamMapImages',comparison:true,preferenceKey:key,ids:[a],files:['/project.oipx'],signals:['KAM'],options:{low:0,high:3}},
 WorkbenchWorkspace:{writeRaw(_,value){writes.push(JSON.parse(value))}},viewKey:table=>'compare:'+table,
 controls(){roots['eds-analysis-tools'].replaceChildren();vm.runInContext('presetControls($("eds-analysis-tools"))',sandbox)},
 update(){vm.runInContext('persist()',sandbox)},
 async open(){context.openVersion++;const selected=context.presets[key].find(item=>item.name===context.activePresets[key]);vm.runInContext('restorePreset(presets["'+key+'"].find(item=>item.name===activePresets["'+key+'"]),"'+key+'")',sandbox);context.current={kind:'map',table:'KamMapImages',comparison:true,preferenceKey:key,...structuredClone(selected),all:[]};context.controls();context.update()}
};
const sandbox=vm.createContext(context);vm.runInContext(source.slice(0,source.indexOf('window.createAztecAnalysis=')),sandbox);context.comparisonState=context.window.aztecComparisonState;
vm.runInContext(source.slice(source.indexOf(' function persist(){'),source.indexOf(' function relocateSources(')),sandbox);
vm.runInContext(source.slice(source.indexOf(' function presetControls(root){'),source.indexOf(' function normaliseLabelColour')),sandbox);
const button=text=>roots['eds-analysis-tools'].descendants().find(node=>node.tag==='button'&&node.textContent===text),input=()=>roots['eds-analysis-tools'].querySelector('[aria-label="Comparison name"]');
context.controls();assert.equal(input().value,'Original');
context.current.ids=[b,a];context.current.options.high=4;context.cropCentres.set('compare:'+a,[.2,.6]);context.update();
assert.equal(writes.at(-1).presets[key][0].ids[0],b);assert.equal(writes.at(-1).presets[key][0].options.high,4);
button('Save as…').onclick();assert.equal(context.activePresets[key],'Original copy');assert.equal(context.presets[key].length,2);
context.current.ids=[a];context.current.options.high=2;context.update();assert.equal(context.presets[key][0].ids.length,2);assert.equal(context.presets[key][0].options.high,4);
input().value='Paper';button('Rename').onclick();assert.equal(context.activePresets[key],'Paper');assert.equal(context.presets[key].length,2);
button('New comparison').onclick();assert.equal(context.current.ids.length,0);assert.equal(context.activePresets[key],undefined);assert.equal(context.presets[key][1].ids.length,1);
(async()=>{
 const select=roots['eds-analysis-tools'].querySelector('[aria-label="Saved comparisons"]');select.value='KamMapImages:Original';await select.onchange();
 assert.equal(context.activePresets[key],'Original');assert.equal(context.current.ids.length,2);assert.equal(context.current.options.high,4);assert.equal(input().value,'Original');
 assert.deepEqual(Array.from(context.cropCentres.get('compare:'+a)),[.2,.6]);
 context.sourceErrors.set('/project.oipx','temporarily unavailable');context.current.ids=[];context.update();
 assert.equal(context.presets[key][0].ids.length,2,'A failed source read must not erase the saved selection');
 assert.match(roots['eds-analysis-tools'].querySelector('.eds-comparison-save-status').textContent,/paused/);
 context.sourceErrors.clear();context.current.ids=[b,a];context.update();
 button('Delete').onclick();assert.equal(context.presets[key].length,1);assert.equal(context.activePresets[key],undefined);
 await button('Undo').onclick();assert.equal(context.presets[key].length,2);assert.equal(context.activePresets[key],'Original');
 console.log('Actual comparison controls autosave, duplicate, rename, switch, detach, delete/undo and retain unreadable sources.');
})().catch(error=>{console.error(error);process.exitCode=1});

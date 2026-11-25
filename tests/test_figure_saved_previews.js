/* Saved figure previews must include the full recipe without loading or saving it. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/figures.js','utf8'),shared=fs.readFileSync('web/popup-controls.js','utf8');
const image={path:'/images/ab.tif',sha256:'same-pixels',label:'AB',zoom:2,center_x:.3,center_y:.6,annotations:[{type:'text',text:'β',x:.4,y:.3,size:30,color:'#ffffff'},{type:'arrow',x1:.1,y1:.2,x2:.5,y2:.6,color:'#ff2020',width:3}]};
const figure={schema_version:2,name:'Annotated figure',rows:1,columns:2,aspect:4/3,transposed:true,background:'white',slots:[image,{kind:'placeholder',label:'Not acquired'}]};
const fields={},requests=[],selected=[];
const c={window:{},structuredClone,Date,console,Option:function(text,value){this.text=text;this.value=value},currentId:'one',recipe:{...structuredClone(figure),name:'Independent draft'},saved:{one:structuredClone(figure),two:{...structuredClone(figure),name:'Another figure'}},
 $:id=>fields[id]??={textContent:'',replaceChildren(){},add(){}},selectFigure:id=>selected.push(id),
 api:async(path,body)=>{requests.push({path,body});return {image:'data:image/png;figure'}}};vm.createContext(c);
vm.runInContext(shared.slice(shared.indexOf('/* Saved-item previews')),c);
vm.runInContext(source.slice(source.indexOf(' const blank='),source.indexOf(' const parse=')),c);
vm.runInContext(source.slice(source.indexOf(' async function renderSavedFigure('),source.indexOf(' function sync(')),c);
c.savedFigurePreview=c.window.WorkbenchPreviewPicker.createCache(c.renderSavedFigure);
(async()=>{
 const original=JSON.stringify({saved:c.saved,recipe:c.recipe});
 assert.equal(await c.savedFigurePreview({value:'one',item:c.saved.one}),'data:image/png;figure');
 assert.equal(requests[0].path,'figures/render');assert.equal(requests[0].body.width,1000);assert.equal(requests[0].body.recipe.transposed,true);
 assert.deepEqual(requests[0].body.recipe.slots[0].annotations,image.annotations);assert.equal(requests[0].body.recipe.slots[0].zoom,2);assert.equal(requests[0].body.recipe.slots[1].kind,'placeholder');
 assert.notEqual(requests[0].body.recipe,c.saved.one);assert.equal(JSON.stringify({saved:c.saved,recipe:c.recipe}),original);assert.equal(c.currentId,'one');assert.equal(selected.length,0);
 c.saved.one.slots[0].annotations[0].text='α';await c.savedFigurePreview({value:'one',item:c.saved.one});assert.equal(requests.length,2);assert.equal(requests[1].body.recipe.slots[0].annotations[0].text,'α','Saved edits refresh their preview');
 let options;c.window.WorkbenchPreviewPicker.open=value=>options=value;c.openSavedFigures();
 assert.equal(options.title,'Saved figures');assert.equal(options.noun,'figure');assert.equal(options.selected,'one');assert.deepEqual(Array.from(options.entries,entry=>entry.value),['one','two']);assert.equal(selected.length,0);
 options.onSelect('two');assert.deepEqual(selected,['two'],'Loading happens only after explicit selection');
 c.chooseSaved();assert.equal(fields['fig-saved-picker'].textContent,'Annotated figure ▾');c.currentId='';c.chooseSaved();assert.equal(fields['fig-saved-picker'].textContent,'New figure ▾');
 c.api=async()=>{throw new Error('Original image is unavailable')};await assert.rejects(c.renderSavedFigure({item:c.saved.two}),/Original image is unavailable/);
 assert.equal(c.recipe.name,'Independent draft');
 console.log('Saved figure previews preserve annotations, layout, placeholders and the independent draft; only explicit selection loads a figure.');
})().catch(error=>{console.error(error);process.exitCode=1});

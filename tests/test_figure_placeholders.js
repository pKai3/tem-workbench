const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync('web/figures.js','utf8'),fields={};
const context={structuredClone,Math,Number,Boolean,Array,String,files:[],hoverEnabled:true,currentId:'',
 recipe:{},selectedPanel:0,changed(){},opened:[],openSlot(index){context.opened.push(index)},
 status(message,error){context.message={message,error}},exportGeometry(){return {pixels:100}},updateExportEstimate(){},
 $:id=>fields[id]??=( {value:'',setAttribute(){}} ),document:{querySelectorAll(){return []}}};
vm.createContext(context);
vm.runInContext(app.slice(app.indexOf(' const blank='),app.indexOf(' const parse=')),context);
const extract=(start,end)=>vm.runInContext(app.slice(app.indexOf(start),app.indexOf(end)),context);
extract(' function sync(){',' function saveTags(');
extract(' function addPlaceholder(',' function openSlot(');
extract(' function changeLayout(){',' async function start(');
context.recipe=context.normaliseRecipe({columns:6,rows:3,slots:Array.from({length:18},()=>({}))});
assert.equal(context.recipe.slots.length,18);assert.equal(context.recipe.columns,6);
context.selectedPanel=11;context.addPlaceholder();
assert.equal(context.recipe.slots[11].kind,'placeholder');
assert.equal(context.opened[0],11);
context.recipe.slots[11].placeholder.sample='ST';
context.recipe.slots[11].placeholder.location='Near';
context.recipe.slots[11].placeholder.target_magnification_x=8000;
const restored=context.normaliseRecipe(JSON.parse(JSON.stringify(context.recipe)));
assert.equal(restored.slots[11].placeholder.sample,'ST');
assert.equal(restored.slots[11].placeholder.target_magnification_x,8000);
assert.equal(restored.columns,6);
// A second add uses another empty slot rather than overwriting the current panel.
context.addPlaceholder();
assert.equal(context.opened[1],0);assert.equal(context.recipe.slots[11].placeholder.sample,'ST');
context.sync();assert.equal(fields['fig-export'].disabled,true);
assert.match(fields['fig-count'].textContent,/2 of 18 filled · 2 placeholders/);
// Placeholders can export without scale data; ordinary images retain calibration requirements.
context.recipe.slots=Array.from({length:18},()=>({kind:'placeholder',placeholder:{title:'Not acquired'}}));
context.sync();assert.equal(fields['fig-export'].disabled,false);
context.recipe.slots[0]={path:'/image.tif',scale_mode:'metadata'};
context.sync();assert.equal(fields['fig-export'].disabled,true);
context.recipe.slots[0].pixel_size_nm=2;
context.sync();assert.equal(fields['fig-export'].disabled,false);
context.addPlaceholder();assert.match(context.message.message,/Clear a slot/);
assert.equal(context.recipe.slots[0].path,'/image.tif');
// Shrinking cannot silently discard a placeholder, and the 24-panel cap still applies.
fields['fig-rows'].value='2';fields['fig-columns'].value='6';
context.changeLayout();assert.equal(context.recipe.slots.length,18);
assert.match(context.message.message,/Clear or move panels/);
fields['fig-rows'].value='6';fields['fig-columns'].value='6';
context.changeLayout();assert.equal(context.recipe.slots.length,18);
assert.match(context.message.message,/at most 24/);
for(let i=12;i<18;i++)context.recipe.slots[i]={};
fields['fig-rows'].value='2';fields['fig-columns'].value='6';
context.changeLayout();assert.equal(context.recipe.slots.length,12);
console.log('Placeholder creation, six-column recipe restoration, export eligibility and layout protection passed.');

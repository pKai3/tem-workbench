const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const window={};vm.runInNewContext(fs.readFileSync('web/aztec-export.js','utf8'),{window});
const layout=window.aztecMapLayout,result={kam:{},ipf_direction:'Y',rows:[{width:400,height:300}]};
assert.equal(layout.columns(result,['KAM'],{}).map(c=>c.label).join(','),'Electron image,IPF Y,KAM (°)');
assert.equal(layout.columns(result,['KAM'],{ebsd_layout:'ipf'}).length,2);
assert.equal(layout.columns(result,['KAM'],{ebsd_layout:'kam'})[1].channel,'KAM');
const transposed=layout.grid(2,3,true);
assert.equal(transposed.rows,3);assert.equal(transposed.columns,2);
assert.equal(JSON.stringify(transposed.position(1,2)),'[2,1]');
assert.equal(layout.aspect(result),4/3);
const multiple={...result,rows:[{overviews:[{image:'se',label:'SE'},{image:'bse',label:'BSE'}]},{overviews:[]}]};
const chosen=layout.columns(multiple,['KAM'],{});assert.equal(chosen.length,4);
assert.equal(layout.overview(multiple.rows[0],chosen[1]).image,'bse');assert.equal(layout.overview(multiple.rows[1],chosen[0]),undefined);
assert.equal(layout.columns({...result,rows:[{overviews:[]}]},['KAM'],{}).length,2,'No chosen overviews leaves IPF and KAM only');
assert.equal(layout.grid(3,chosen.length,true).rows,4,'Every chosen overview transposes and exports as its own column');
assert.equal(JSON.stringify(layout.sourceRect({full_resolution:true,crop_points:[[11.25,-5],[967.5,712.25]]},1024,768)),JSON.stringify({x:11.25,y:-5,width:956.25,height:717.25}),'Use exact registered source coordinates without rounding or resizing the source');
assert.equal(JSON.stringify(layout.sourceRect({},400,300)),JSON.stringify({x:0,y:0,width:400,height:300}));
// The live grid must use the same rectangular field geometry as the PNG.
const analysis=fs.readFileSync('web/aztec-analysis.js','utf8');
const geometry=analysis.slice(analysis.indexOf("     if(['physical','crop'].includes(current.options.spatial)&&row.width)"),analysis.indexOf("     cell.classList.toggle('eds-crop-tile'"));
for(const transpose of [false,true])for(const spatial of ['physical','crop']){
 const rectangular={rows:[{width:400,height:300,distance_unit:'nm'}]},frame={style:{}},options={spatial,transpose};
 vm.runInNewContext(geometry,{window,current:{options},result:rectangular,row:rectangular.rows[0],frame,sizes:new Map([['nm',400]]),crops:new Map([['nm',300]])});
 const width=parseFloat(frame.style.width)/100*360,height=parseFloat(frame.style.height)/100*(360/layout.aspect(rectangular,options));
 assert.ok(Math.abs(width/height-4/3)<1e-12,'Live overview and map frames must not squeeze or letterbox a rectangular acquisition');
 if(spatial==='physical'){assert.equal(width,360);assert.equal(height,270)}
}
const app=fs.readFileSync('web/figures.js','utf8'),a={path:'a',zoom:2},b={kind:'placeholder',label:'b'},c={path:'c'},d={},e={path:'e'},f={path:'f'};
const ctx={recipe:{rows:2,columns:3,slots:[a,b,c,d,e,f]},selectedPanel:4,changed(){}};
vm.createContext(ctx);vm.runInContext(app.slice(app.indexOf(' function transposeLayout(){'),app.indexOf(' function changeLayout(){')),ctx);
ctx.transposeLayout();
assert.equal(ctx.recipe.rows,3);assert.equal(ctx.recipe.columns,2);assert.equal(ctx.recipe.transposed,true);
assert.deepEqual(Array.from(ctx.recipe.slots),[a,d,b,e,c,f]);assert.equal(ctx.selectedPanel,3);
assert.equal(ctx.recipe.slots[0].zoom,2,'Panel edits stay with the source, including placeholders and empty slots');
ctx.transposeLayout();
assert.deepEqual(Array.from(ctx.recipe.slots),[a,b,c,d,e,f]);assert.equal(ctx.selectedPanel,4);assert.equal(ctx.recipe.transposed,false);
const restored=JSON.parse(JSON.stringify(ctx.recipe));assert.equal(JSON.stringify(restored.slots),JSON.stringify(ctx.recipe.slots));
console.log('Map and figure transpose swap rows/columns without changing panel contents or image aspect.');

/* The export view uses the actual PNG route, including current labels and crops. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/aztec-analysis.js','utf8'),calls=[],pending=[];
class Element{
 constructor(tag,text=''){Object.assign(this,{tag,textContent:text,children:[],dataset:{},style:{},attributes:{},isConnected:true,classList:{add(){}}})}
 setAttribute(key,value){this.attributes[key]=value}
 replaceChildren(...children){this.children=children}
 async decode(){}
}
const result={rows:[{acquisition:'a'}]},current={comparison:true,result,options:{map_preview:'exported',png_background:'white',transpose:true,brightness:1.7}};
const context={current,plotObservers:[],el:(...args)=>new Element(...args),selectedSignals:()=>['V'],exportLabel:()=>'AB',labelColour:()=>'#cc5500',itemKey:id=>'compare:'+id,cropCentres:new Map([['compare:a',[.3,.6]]]),linkMapHover(tiles,path,label,observers){observers.push({disconnect(){context.disconnections++}})},disconnections:0,
 window:{aztecMapLayout:{columns:()=>[{},{}],grid:()=>({columns:1})},aztecExport:{png(settings){calls.push(settings);return new Promise((resolve,reject)=>pending.push({resolve,reject}))}}}};
vm.createContext(context);vm.runInContext(source.slice(source.indexOf(' async function renderExportPreview('),source.indexOf(' function renderComparison(')),context);
(async()=>{
 const wrap=new Element('div'),first=context.renderExportPreview(wrap,result);
 assert.equal(wrap.attributes['aria-busy'],'true');assert.equal(calls[0].result,result);
 assert.equal(calls[0].kind,'map');assert.equal(calls[0].options.png_background,'white');assert.equal(calls[0].options.brightness,1.7);
 assert.equal(calls[0].names.a,'AB');assert.equal(calls[0].colours.a,'#cc5500');assert.deepEqual(calls[0].crops.a,[.3,.6]);
 pending.shift().resolve('data:image/png;first');await first;
 assert.equal(wrap.children[0].src,'data:image/png;first');assert.equal(wrap.attributes['aria-busy'],'false');
 current.options.png_background='transparent';const older=context.renderExportPreview(wrap,result),newer=context.renderExportPreview(wrap,result);
 assert.equal(context.disconnections,1,'Refresh disconnects the preceding hover handlers');
 const a=pending.shift(),b=pending.shift();b.resolve('data:image/png;latest');await newer;a.resolve('data:image/png;stale');await older;
 assert.equal(wrap.children[0].src,'data:image/png;latest','A late render must not replace newer settings');
 const failed=context.renderExportPreview(wrap,result);pending.shift().reject(new Error('Select fewer acquisitions'));await failed;
 assert.match(wrap.children[0].textContent,/Select fewer acquisitions/);assert.equal(wrap.attributes['aria-busy'],'false');
 console.log('Whole-grid export preview reuses PNG settings and handles refresh, stale work and errors.');
})().catch(error=>{console.error(error);process.exitCode=1});

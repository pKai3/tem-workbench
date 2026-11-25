const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/aztec-export.js','utf8'),labels=[];
const context={load:async()=>({}),svgSource:()=>'',badge:(_,label,...args)=>{labels.push(label);context.anchor=args.at(-1)},labelInk:()=>'',plotHeight:()=>100,plotBadges:(_,parts)=>labels.push(...parts.map(p=>p.label))};
vm.createContext(context);vm.runInContext(source.slice(source.indexOf(' async function drawReference('),source.indexOf(' async function lines(')),context);
const ctx={drawImage(){},fillRect(){},fillText(){},measureText:()=>({width:30})};
(async()=>{
 for(const visible of [true,false]){
  labels.length=0;
  await context.drawReference(ctx,{width:100,height:100},'ST',0,0,100,100,{},'#123456',visible);
  assert.equal(labels.includes('ST'),visible,'Reference-image label visibility is independent of the image');
  labels.length=0;
  await context.drawPlot(ctx,{showLabels:visible,image:{},legend:[{label:'Ti',colour:'#fff'}]},0,0,100,null,'ST');
  assert.equal(labels.includes('ST'),visible);assert.equal(labels.includes('Ti'),visible,'Line plot labels respect the switch in PNG export');
 }
 for(const corner of ['top-left','top-right','bottom-left','bottom-right']){await context.drawReference(ctx,{width:100,height:100},'ST',0,0,100,100,{},null,true,corner);assert.equal(context.anchor.position,corner);assert.equal(context.anchor.bounds.bottom,100)}
 console.log('Line PNG reference and plot label switches are independent and retain images.');
})().catch(error=>{console.error(error);process.exitCode=1});

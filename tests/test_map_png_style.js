const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function canvas(){
 const log=[],stack=[];let path=[];
 const ctx={font:'10px Arial',globalAlpha:1,
  save(){stack.push({font:this.font,alpha:this.globalAlpha})},restore(){const state=stack.pop();this.font=state.font;this.globalAlpha=state.alpha},
  beginPath(){path=[]},moveTo(x,y){path.push([x,y])},lineTo(x,y){path.push([x,y])},closePath(){},rect(...args){path.push({rect:args})},roundRect(...args){path.push({rounded:args})},
  fill(){log.push({kind:'path',path:[...path],colour:this.fillStyle,alpha:this.globalAlpha})},stroke(){},
  fillRect(...args){log.push({kind:'rect',args,colour:this.fillStyle})},drawImage(...args){log.push({kind:'image',args})},strokeText(){},
  fillText(text,x,y){log.push({kind:'text',text,x,y,font:this.font,colour:this.fillStyle,align:this.textAlign,baseline:this.textBaseline,metrics:this.measureText(text)})},measureText(text){const size=Number(this.font.match(/([\d.]+)px/)[1]);return {width:[...text].length*size*.5,actualBoundingBoxAscent:size*.72,actualBoundingBoxDescent:/[βgjpqy]/.test(text)?size*.2:0}},
  createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)}},putImageData(){}
 };
 return {width:1800,height:900,log,getContext:()=>ctx};
}
const document={createElement:canvas,addEventListener(){}};
const context=vm.createContext({document});
vm.runInContext(fs.readFileSync('web/phase-blend.js','utf8')+fs.readFileSync('web/map-export.js','utf8')+'\nglobalThis.exports=MapPngExport;',context);
const exporter=context.exports;
assert.equal(exporter.settings().background,'dark');assert.equal(exporter.normalize({mode:'paper'}).background,'white');
assert.equal(exporter.normalize({legend_colour:'invalid',legend_position:'unknown'}).legend_colour,'#ffffff');
assert.equal(exporter.scaleBar(1800,10000).label,'2 µm');assert.equal(exporter.scaleBar(1800,10000).pixels,360);
for(const value of [0,-1,NaN,Infinity,undefined])assert.equal(exporter.scaleBar(100,value),null);
const map=canvas(),legend=[{text:'BCC [1 1 1] · 12.5°',colour:'#ffcc00'},{text:'A long hypothesis label '.repeat(6),colour:'#ff0000'}];
for(const background of ['transparent','white','dark']){
 const output=exporter.compose({map,fieldNm:10000,legend,caption:'Match frequency · opacity: 0–100%',name:'private sample',choice:{mode:'paper',background}});
 const texts=output.log.filter(row=>row.kind==='text'),backgroundRect=output.log.find(row=>row.kind==='rect'&&row.args[0]===0&&row.args[1]===0),shade=output.log.find(row=>row.kind==='path'&&row.path[0]?.rounded);
 assert.equal(!!backgroundRect,background!=='transparent');assert.equal(output.width,1800);assert.equal(output.height,900,'No external border or caption/legend strip');assert.deepEqual(output.log.find(row=>row.kind==='image').args.slice(1),[0,0,1800,900]);
 assert.ok(texts.some(row=>row.text==='2 µm'));assert.ok(!texts.some(row=>/opacity|Match frequency|private sample/.test(row.text)));
 assert.ok(shade&&shade.alpha===.72,'The legend has a translucent on-image backdrop');
 assert.ok(texts.filter(row=>row.font==='64px Arial').every(row=>row.x+row.text.length*32<=1800),'Legends wrap inside the image');
 assert.ok(texts.every(row=>row.y>=32&&row.y<900),'All annotations stay on the image');assert.equal(map.log.length,0);
}
const blend=[{text:'α (HCP)',colour:'#ff0000'},{text:'β (BCC) phase',colour:'rgb(0, 255, 0)'}];
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} should equal ${b}`);
for(const continuous of [true,false]){
 const output=exporter.compose({map,legend:blend,blend:continuous?blend:[],hex:true,choice:{mode:'paper',scale_bar:false}});
 const labels=output.log.filter(r=>r.kind==='text'),symbols=output.log.filter(r=>r.kind==='path'&&r.path.length===6).map(r=>({left:Math.min(...r.path.map(p=>p[0])),right:Math.max(...r.path.map(p=>p[0])),cy:(Math.min(...r.path.map(p=>p[1]))+Math.max(...r.path.map(p=>p[1])))/2}));
 const [x,y,w,h]=output.log.find(r=>r.kind==='path'&&r.path[0]?.rounded).path[0].rounded,centre=y+h/2;
 assert.equal(symbols.length,2,'Hex maps have hexagonal phase keys');
 for(const label of labels){assert.equal(label.baseline,'alphabetic');near(label.y+(label.metrics.actualBoundingBoxDescent-label.metrics.actualBoundingBoxAscent)/2,centre)}
 symbols.forEach(symbol=>near(symbol.cy,centre));
 const [left,right]=labels;
 assert.equal(right.align,'left');assert.ok(symbols[1].right<right.x);
 if(continuous){
  const strips=output.log.filter(r=>r.kind==='rect'&&r.args[2]<2),start=strips[0].args[0],end=strips.at(-1).args[0]+strips.at(-1).args[2]-.1;
  assert.equal(left.align,'right');assert.ok(left.x<symbols[0].left&&symbols[0].right<start&&end<symbols[1].left,'Continuous legend reads text / hex / bar / hex / text');
  near((start+end)/2,x+w/2);near(start-symbols[0].right,symbols[1].left-end);
  strips.forEach(strip=>near(strip.args[1]+strip.args[3]/2,centre));
 }else{
  assert.equal(left.align,'left');assert.ok(symbols[0].right<left.x&&left.x+left.metrics.width<symbols[1].left,'Discrete legend reads hex / text / hex / text');
 }
}
for(const corner of ['top-left','top-right','bottom-left','bottom-right']){
 const choice=exporter.normalize({legend_position:corner,scale_bar_position:corner}),bounds={x:32,y:32,width:1800,height:900};
 const boxes=exporter.overlayBoxes(bounds,{width:700,height:150},{width:350,height:100},choice,32);
 assert.ok(boxes.legend.y>=64&&boxes.bar.y>=64);assert.ok(boxes.bar.y+100<=900);
 assert.ok(boxes.legend.y+150<=boxes.bar.y||boxes.bar.y+100<=boxes.legend.y,'Shared corners stack without collisions');
 assert.equal(boxes.legend.x>900,corner.endsWith('right'));
}
const hidden=exporter.compose({map,name:'private sample',legend,blend,fieldNm:100,choice:{mode:'paper',legend:false,scale_bar:false}});
assert.equal(hidden.log.filter(r=>r.kind==='text').length,0,'Both overlays can be hidden');
const named=exporter.compose({map,name:'chosen label',choice:{mode:'paper',show_name:true,legend:false,scale_bar:false}});assert.ok(named.log.some(r=>r.text==='chosen label'));
const triangle=exporter.compose({map,blend:[...blend,{text:'FCC',colour:'#0000ff'}],hex:true,choice:{mode:'paper'}});
assert.equal(triangle.log.filter(r=>r.kind==='path'&&r.path.length===6).length,3);assert.ok(triangle.log.some(r=>r.text==='FCC'));
const [triImage,triShade]=[triangle.log.filter(r=>r.kind==='image').at(-1).args.slice(1),triangle.log.find(r=>r.kind==='path'&&r.path[0]?.rounded).path[0].rounded];
near(triImage[0]+triImage[2]/2,triShade[0]+triShade[2]/2);near(triImage[1]+triImage[3]/2,triShade[1]+triShade[3]/2);
const triLabels=triangle.log.filter(r=>r.kind==='text'),triSymbols=triangle.log.filter(r=>r.kind==='path'&&r.path.length===6),triCentres=[];
triLabels.forEach((label,i)=>{
 const points=triSymbols[i].path,cx=(Math.min(...points.map(p=>p[0]))+Math.max(...points.map(p=>p[0])))/2,cy=(Math.min(...points.map(p=>p[1]))+Math.max(...points.map(p=>p[1])))/2;
 near(label.y+(label.metrics.actualBoundingBoxDescent-label.metrics.actualBoundingBoxAscent)/2,cy);
 if(i===1){assert.equal(label.align,'right');assert.ok(label.x<Math.min(...points.map(p=>p[0])),'Ternary bottom-left key reads text / symbol')}
 else {assert.equal(label.align,'left');assert.ok(Math.max(...points.map(p=>p[0]))<label.x,'Other ternary keys read symbol / text')}
 triCentres.push({x:label.align==='right'?(label.x-label.metrics.width+cx+64*.65/2)/2:(cx-64*.65/2+label.x+label.metrics.width)/2,y:cy});
});
near(triCentres[0].x,triShade[0]+triShade[2]/2);near((triCentres[1].x+triCentres[2].x)/2,triCentres[0].x);near(triCentres[1].y,triCentres[2].y);

const identities=[['●','BCC','[1 3̅ 1̅]','171.3°','×649','#00ff00'],['▲','HCP','[1 1̅ 0]','172.5°','×250','#79b8f8'],['◆','HCP','[0 1 1̅]','98.9°','×245','#79b8f8']];
const identityNodes=identities.map(([symbol,phase,zone,angle,count,colour])=>({textContent:`${symbol} ${phase} ${zone} · ${angle} ${count}`,style:{color:colour},dataset:{mapLegendKind:'solution',legendSymbol:symbol,legendPhase:phase,legendZone:zone,legendAngle:angle,legendCount:count}}));
const entries=exporter.legendEntries([{textContent:'● Unresolved',style:{color:'#888888'},dataset:{legendSymbol:'●'}},...identityNodes]);
assert.equal(entries.length,3,'Solution rows replace the redundant phase-only legend');
const table=exporter.compose({map,legend:entries,choice:{mode:'paper',scale_bar:false}}),cells=table.log.filter(r=>r.kind==='text');
assert.equal(cells.length,15);assert.equal(table.log.filter(r=>r.kind==='path').length,1,'Only the shaded panel is drawn; no extra square swatches');
for(let row=0;row<3;row++)for(let column=0;column<5;column++){
 const cell=cells[row*5+column],symbol=cells[row*5];assert.equal(cell.text,identities[row][column].replaceAll('\u0305',''));near(cell.x,cells[column].x);
 const ascent=cell.metrics.actualBoundingBoxAscent+(column===2?64*.13:0);
 assert.equal(cell.colour,column===0?identities[row][5]:'#ffffff');near(cell.y+(cell.metrics.actualBoundingBoxDescent-ascent)/2,symbol.y+(symbol.metrics.actualBoundingBoxDescent-symbol.metrics.actualBoundingBoxAscent)/2);
}
const overbars=table.log.filter(r=>r.kind==='rect'&&r.args[3]===64*.05);assert.equal(overbars.length,4,'Every negative zone index gets an explicitly positioned overbar');
for(const [i,offsets]of [[0,[3,5]],[1,[3]],[2,[5]]]){
 const zone=cells[i*5+2];for(const offset of offsets)assert.ok(overbars.some(bar=>Math.abs(bar.args[0]-(zone.x+offset*32))<1e-6&&Math.abs(bar.args[1]-(zone.y-64*(.72+.13)))<1e-6&&bar.args[2]===32),'Overbars align to the individual negative digits');
}
const circles=exporter.compose({map,legend:exporter.legendEntries([{textContent:'● HCP',style:{color:'#79b8f8'},dataset:{legendSymbol:'●'}}]),choice:{mode:'paper',scale_bar:false}});
assert.equal(circles.log.filter(r=>r.kind==='path').length,1);assert.equal(circles.log.find(r=>r.text==='●').colour,'#79b8f8');
assert.throws(()=>exporter.overlayBoxes({x:0,y:0,width:100,height:100},{width:200,height:30},null,exporter.settings(),10),/does not fit/);
console.log('Map PNG overlays: no captions, shaded on-image legends, hex keys, flanking phase labels, corner collision avoidance, visibility, colour normalization and transparency passed.');

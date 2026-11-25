/* Exercise export routes and resolution-dependent rendering, without a browser. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class Element{
 constructor(tag){this.tag=tag;this.attributes={};this.children=[];this.style={}}
 setAttribute(key,value){this.attributes[key]=String(value)}
 getAttribute(key){return this.attributes[key]}
 removeAttribute(key){delete this.attributes[key]}
 querySelectorAll(){return this.children.flatMap(child=>[...(child.attributes['vector-effect']?[child]:[]),...child.querySelectorAll()])}
 append(...nodes){this.children.push(...nodes)}
}
const canvases=[],svgs=[];
function canvas(){
 const log=[],stack=[];let scale=1;
 const ctx={font:'10px system-ui',imageSmoothingEnabled:true,
  scale(x,y){assert.equal(x,y);scale*=x},save(){stack.push({scale,font:this.font,align:this.textAlign,smoothing:this.imageSmoothingEnabled})},restore(){const s=stack.pop();scale=s.scale;this.font=s.font;this.textAlign=s.align;this.imageSmoothingEnabled=s.smoothing},
  measureText(text){return {width:text.length*parseFloat(this.font.match(/([\d.]+)px/)[1])*.5}},
  fillText(text,...args){log.push({type:'text',text,args,scale,font:this.font,align:this.textAlign})},
  drawImage(img,...args){log.push({type:'image',source:img.src,args,scale,smoothing:this.imageSmoothingEnabled})},
  createLinearGradient(){return {addColorStop(){}}},
  fillRect(...args){log.push({type:'fill',args,colour:this.fillStyle})},
  beginPath(){},roundRect(...args){this.roundedRect=args},fill(){log.push({type:'roundedFill',args:this.roundedRect,colour:this.fillStyle})},strokeText(){},rect(){},clip(){},translate(){},rotate(){}
 };
 const out={log,width:0,height:0,getContext:()=>ctx,toBlob(done){done(out)}};canvases.push(out);return out;
}
const document={createElement:()=>canvas(),createElementNS:(_,tag)=>new Element(tag)};
class MockImage{async decode(){this.naturalWidth=this.src==='overview'?1024:400;this.naturalHeight=this.src==='overview'?768:300}}
class FileReader{readAsDataURL(blob){this.result='data:image/png;test';this.onload()}}
class XMLSerializer{serializeToString(svg){svgs.push(svg);return '<svg/>'}}
const window={};const context={window,document,Image:MockImage,FileReader,XMLSerializer};
for(const file of ['web/aztec-distributions.js','web/aztec-ipf-legend.js','web/aztec-export.js'])vm.runInNewContext(fs.readFileSync(file,'utf8'),context);
const group={id:'kam',label:'KAM',unit:'degrees',edges:[0,1,2],exceedance_thresholds:[0,1,2],series:[{acquisition:'a',pixels:4,excluded:0,counts:[1,3],exceedance_percent:[75,25,0],mean:1,median:.9,p99:1.8}]};
const result={kam:{},normalisation:'none',ipf_direction:'Z',scale_scope:'all',kam_colour_stops:['#0000ff','#00ff00','#ffff00','#ff0000'],
 rows:[{acquisition:'a',label:'AB',width:40000,height:30000,distance_unit:'nm',overviews:[{path:'private-source-name',label:'Electron Image 1',image:'overview',full_resolution:true,source_shape:[768,1024],crop_points:[[0,0],[1024,768]]}],
 tiles:[{channel:'IPF',label:'IPF Z · H5OINA',image:'ipf',shape:[300,400]},{channel:'KAM',label:'KAM · Saved H5OINA KAM',image:'kam',shape:[300,400],image_limits:[0,3]}]}],distributions:[group]};
const settings={kind:'map',result,options:{png_background:'white',brightness:1,png_distribution:true},comparison:true,signals:['KAM'],names:{a:'AB'},colours:{a:'#e76f00'},crops:{}};
(async()=>{
 await window.aztecExport.png(settings);let out=canvases.at(-1);
 assert.equal(svgs.length,0,'Legacy PNG distribution flag must never append a chart');
 const images=out.log.filter(c=>c.type==='image');assert.equal(images.length,3);
 assert.equal(images[0].args[6]*images[0].scale,1024,'Export retains the entire overview resolution');
 assert.equal(images[0].smoothing,true,'Electron images retain their normal rendering');
 assert.deepEqual(images.slice(1).map(i=>i.smoothing),[false,false],'IPF/KAM enlarge measured cells without colour blending');
 const text=out.log.filter(c=>c.type==='text');assert.deepEqual(text.filter(c=>['AB','IPF Z','KAM'].includes(c.text)).map(c=>c.text),['AB','IPF Z','KAM']);
 const minimum=text.find(c=>c.text==='0°'),maximum=text.find(c=>c.text==='3°'),backdrop=out.log.find(c=>c.type==='roundedFill'&&c.colour==='#080e14bf');
 assert.ok(backdrop,'The KAM scale must export its translucent background');
 assert.equal(minimum.align,'left');assert.equal(maximum.align,'right');
 assert.equal(minimum.args[0],backdrop.args[0]+4);assert.equal(maximum.args[0],backdrop.args[0]+backdrop.args[2]-4);
 assert.equal(minimum.args[1],maximum.args[1]);assert.ok(minimum.args[1]<backdrop.args[1]+backdrop.args[3]);
 assert.ok(out.log.indexOf(backdrop)<out.log.indexOf(minimum),'Background is drawn behind the endpoint labels');
 assert.ok(!text.some(c=>c.text==='0 – 3°'),'The combined right-aligned range is replaced by two endpoints');
 assert.ok(!text.some(c=>/H5OINA|Electron Image 1|private-source-name/.test(c.text)),'Caption/source qualifiers do not belong in the exported image');
 const fontPx=c=>Number(c.font.match(/([\d.]+)px/)[1])*c.scale;
 const label=text.find(c=>c.text==='AB');assert.equal(fontPx(label)/1024,18/320,'Native-resolution export keeps the original label-to-panel proportions');
 const edsResult={...result,kam:null,mode:'signal',rows:[{...result.rows[0],tiles:[{channel:'V',label:'V',image:'v',shape:[300,400],image_limits:[.804,1.2]}]}]};
 for(const enabled of [true,false]){
  await window.aztecExport.png({...settings,result:edsResult,signals:['V'],options:{...settings.options,show_colour_scale:enabled}});
  const log=canvases.at(-1).log,range=log.find(c=>c.type==='text'&&c.text==='0.804 – 1.2');
  assert.equal(!!range,enabled,'EDS colour range visibility applies to PNG output');
  if(enabled){const backing=log.find(c=>c.type==='roundedFill'&&c.colour==='#080e14bf');assert.ok(backing&&log.indexOf(backing)<log.indexOf(range),'EDS range has a shaded background behind the text')}
 }
 for(const enabled of [true,false]){
  await window.aztecExport.png({...settings,result:{...edsResult,normalisation:'median',low:.7,high:1.3,scale_scope:'all'},signals:['V'],options:{...settings.options,show_colour_scale:enabled}});
  assert.equal(canvases.at(-1).log.some(c=>c.type==='text'&&c.text.includes('Relative to each map')),enabled,'Shared scale visibility follows the same switch');
 }
 const firstHeight=out.height;
 await window.aztecExport.png({...settings,options:{...settings.options,transpose:true}});out=canvases.at(-1);
 assert.ok(out.height>firstHeight);assert.equal(out.log.find(c=>c.type==='text'&&c.text==='AB').scale,label.scale,'Transpose preserves label proportions');
 const legendResult=structuredClone(result);
 legendResult.rows[0].tiles[0].phases=[{name:'Ti-Hex',family:'hexagonal'},{name:'Titanium cubic',family:'cubic'}];
 legendResult.rows.push({...structuredClone(legendResult.rows[0]),acquisition:'b'});
 for(const transpose of [false,true])for(const [mode,target,count]of [['one','',1],['one','b',1],['all','',2],['none','',0],['one','unavailable',0]]){
  const start=svgs.length;
  await window.aztecExport.png({...settings,result:legendResult,names:{a:'AB',b:'ST'},options:{...settings.options,transpose,ipf_legend:mode,ipf_legend_target:target,ipf_legend_hexagonal:false}});
  const keys=svgs.slice(start);assert.equal(keys.length,count,'Export follows one/all/off/target selection in either orientation');
  for(const key of keys){assert.equal(key.children.filter(c=>c.tag==='image').length,1);assert.ok(key.children.some(c=>c.textContent==='Titanium cubic'));assert.ok(!key.children.some(c=>c.textContent==='Ti-Hex'))}
  const draws=canvases.at(-1).log.filter(c=>c.type==='image'&&c.source.startsWith('data:image/svg'));
  assert.equal(draws.length,count);assert.ok(draws.every(c=>c.args[2]>0&&c.args[3]>0));
 }
 for(const transpose of [false,true])for(const corner of window.aztecOverlayPlacement.corners){
  await window.aztecExport.png({...settings,result:{...legendResult,rows:legendResult.rows.slice(0,1)},options:{...settings.options,transpose,scale_bar_position:corner,ipf_legend_position:corner,kam_legend_position:corner}});
  const log=canvases.at(-1).log,ipf=log.find(c=>c.type==='image'&&c.source==='ipf'),kam=log.find(c=>c.type==='image'&&c.source==='kam'),overview=log.find(c=>c.type==='image'&&c.source==='overview');
  const key=log.find(c=>c.type==='image'&&c.source.startsWith('data:image/svg')),scale=log.find(c=>c.type==='roundedFill'&&c.colour==='#080e14bf'),bar=log.find(c=>c.type==='text'&&c.text==='5 µm');
  const right=corner.endsWith('right'),top=corner.startsWith('top');
  for(const [overlay,frame]of [[key,ipf],[scale,kam]]){
   const [x,y,w,h]=overlay.args,[left,upper,width,height]=frame.args.slice(4);
   assert.equal(x>left+width/2,right,corner+' horizontal placement');
   assert.equal(y<upper+height/2,top,corner+' vertical placement');
   assert.ok(x>=left&&x+w<=left+width&&y>=upper&&y+h<=upper+height,'Keep the complete overlay inside its panel');
   if(corner==='top-left')assert.ok(y>upper+30,'Leave room for the panel label');
  }
  assert.equal(bar.args[0]>overview.args[4]+overview.args[6]/2,right,'Spatial bar follows its chosen side');
  assert.equal(bar.args[1]<overview.args[5]+overview.args[7]/2,top,'Spatial bar follows its chosen vertical position');
 }
 for(const [scale_bar_overlay,scale_bar_scope,count]of [[true,'all',6],[true,'overview',2],[false,'all',0]]){
  await window.aztecExport.png({...settings,result:legendResult,names:{a:'AB',b:'ST'},options:{...settings.options,scale_bar_overlay,scale_bar_scope}});
  assert.equal(canvases.at(-1).log.filter(c=>c.type==='text'&&c.text==='5 µm').length,count,'Physical scale bar scope matches the selected panels');
 }
 for(const [kind,label]of [['overview','AB'],['ipf','IPF Z'],['kam','KAM']]){
  await window.aztecExport.png({...settings,options:{...settings.options,panel_labels:{[kind]:false}}});
  const labels=canvases.at(-1).log.filter(c=>c.type==='text').map(c=>c.text);
  assert.ok(!labels.includes(label),'Hidden '+kind+' label is omitted from PNG');
  for(const other of ['AB','IPF Z','KAM'].filter(x=>x!==label))assert.ok(labels.includes(other),'Other panel types retain labels');
  assert.ok(labels.includes('5 µm'),'Label visibility does not hide scale bars');
 }
 for(const transpose of [false,true])for(const corner of window.aztecOverlayPlacement.corners){
  await window.aztecExport.png({...settings,options:{...settings.options,transpose,panel_label_positions:{overview:corner,ipf:corner,kam:corner}}});
  const log=canvases.at(-1).log;
  for(const [label,source]of [['AB','overview'],['IPF Z','ipf'],['KAM','kam']]){
   const text=log.find(c=>c.type==='text'&&c.text===label),frame=log.find(c=>c.type==='image'&&c.source===source),[left,top,width,height]=frame.args.slice(4);
   assert.equal(text.args[0]>left+width/2,corner.endsWith('right'),label+' horizontal anchor');
   assert.equal(text.args[1]>top+height/2,corner.startsWith('bottom'),label+' vertical anchor');
  }
 }
 for(const [mode,target,count]of [['none','',0],['one','',1],['one','b',1],['one','missing',0],['all','',2]]){
  await window.aztecExport.png({...settings,result:legendResult,names:{a:'AB',b:'ST'},options:{...settings.options,kam_legend:mode,kam_legend_target:target}});
  assert.equal(canvases.at(-1).log.filter(c=>c.type==='roundedFill'&&c.colour==='#080e14bf').length,count,'KAM key scope and chosen target in export');
 }
 const rectangular=structuredClone(result);delete rectangular.kam;rectangular.rows[0].width=25721.508372539218;rectangular.rows[0].height=19291.131279404413;rectangular.rows[0].tiles=[{channel:'V',label:'V',image:'eds',shape:[384,512]}];rectangular.rows.push({...structuredClone(rectangular.rows[0]),acquisition:'b'});
 for(const transpose of [false,true]){
  await window.aztecExport.png({...settings,result:rectangular,signals:['V'],names:{a:'AB',b:'ST'},options:{...settings.options,spatial:'physical',transpose}});
  const out=canvases.at(-1),images=out.log.filter(c=>c.type==='image');
  assert.equal(out.height,1604,'Two 4:3 rows need 500 logical pixels including margins/gap, without square padding');
  assert.ok(Math.abs(images[0].args[5]-8)<1e-9,'No letterbox band above the first map');
  assert.ok(Math.abs(images[0].args[7]-240)<1e-9,'Use the rectangular acquisition height');
  const next=images[transpose?1:2];assert.ok(Math.abs(next.args[5]-(images[0].args[5]+images[0].args[7])-5)<1e-9,'Only the configured gutter separates rows');
 }
 for(const background of ['white','dark','transparent']){
  await window.aztecExport.png({...settings,kind:'distribution',options:{png_background:background,distribution_view:'exceedance',distribution_x_min:.25,distribution_x_max:1.25}});
  const svg=svgs.at(-1),chart=canvases.at(-1);
  const [, ,width,height]=svg.getAttribute('viewBox').split(' ').map(Number);
  assert.equal(chart.width,(width+16)*8);assert.equal(chart.height,(height+16)*8,'Fourfold width and height, sixteenfold pixel count');
  assert.equal(svg.getAttribute('width'),String(width*8));assert.equal(svg.getAttribute('height'),String(height*8),'Rasterize SVG at the output resolution');
  assert.equal(svg.querySelectorAll('[vector-effect]').length,0,'Stroke widths must scale with the rest of the chart');
  assert.equal(svg.getAttribute('data-x-min'),'0.25');assert.equal(svg.getAttribute('data-x-max'),'1.25');
  assert.ok(svg.children.some(c=>c.tag==='path'&&c.attributes.stroke==='#e76f00'),'Chart retains assigned export-label colours');
  assert.ok(svg.children.some(c=>c.textContent==='Pixels above angle (%)'));
  assert.equal(chart.log.filter(c=>c.type==='image').length,1,'Standalone chart has no map panels');
  assert.equal(chart.log.some(c=>c.type==='fill'),background!=='transparent');
 }
 await assert.rejects(()=>window.aztecExport.png({...settings,kind:'distribution',result:{...result,distributions:[]}}),/no valid pixels/);
 await assert.rejects(()=>window.aztecExport.png({...settings,kind:'distribution',options:{distribution_view:'exceedance'},result:{...result,distributions:[{...group,exceedance_thresholds:null}]}}),/Restart/);
 console.log('Separate map/chart exports, label proportions, source-label omission and crisp EBSD rendering passed.');
})().catch(error=>{console.error(error);process.exitCode=1});

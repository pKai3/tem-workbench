/* TEM map PNG composition and the shared export-settings preview. */
const MapPngExport=(()=>{
 const themes={dark:{background:'#0c121a',ink:'#dce6ef'},white:{background:'#fff',ink:'#18212b'},transparent:{background:null,ink:'#18212b'}};
 const corners=['top-left','top-right','bottom-left','bottom-right'];
 const defaults={legend:true,legend_position:'bottom-left',legend_colour:'#ffffff',legend_shade:'#000000',legend_opacity:.72,scale_bar:true,scale_bar_position:'bottom-right',scale_bar_colour:'#ffffff',text_scale:1};
 let mode='standard',backgrounds={standard:'dark',paper:'white'},names={standard:true,paper:false},options={...defaults};
 const providers=new Map(),triangles=new Map();let dialog,activeSource='main',opener,timer,poll,revision=0,preview=null,saving=false,lastKey='';
 const validColour=value=>/^#[0-9a-f]{6}$/i.test(value);
 function normalize(choice={}){
  const c={...defaults,...choice};c.mode=c.mode==='paper'?'paper':'standard';c.background=themes[c.background]?c.background:c.mode==='paper'?'white':'dark';
  for(const key of ['legend','scale_bar'])c[key]=c[key]!==false;
  c.show_name=typeof c.show_name==='boolean'?c.show_name:c.mode==='standard';
  for(const key of ['legend_position','scale_bar_position'])if(!corners.includes(c[key]))c[key]=defaults[key];
  for(const key of ['legend_colour','legend_shade','scale_bar_colour'])if(!validColour(c[key]))c[key]=defaults[key];
  for(const [key,min,max]of [['text_scale',.5,1.5],['legend_opacity',0,1]])c[key]=Number.isFinite(c[key])?Math.max(min,Math.min(max,c[key])):defaults[key];
  return c;
 }
 const settings=()=>normalize({...options,mode,background:backgrounds[mode],show_name:names[mode]});
 const theme=(choice=settings())=>themes[choice.background]||themes.dark;
 const persist=()=>writePreference('tem-map-png-style',{mode,backgrounds:{...backgrounds},names:{...names},options:{...options}});
 const register=(id,provider)=>providers.set(id,provider);
 const symbolFont=size=>`${size}px "Arial Unicode MS","Segoe UI Symbol",sans-serif`;
 function legendEntries(nodes){
  const entries=[...nodes],solutions=entries.filter(node=>node.dataset.mapLegendKind==='solution');
  return (solutions.length?solutions:entries).map(node=>{
   const entry={text:node.textContent.trim().replace(/^●\s*/,''),colour:node.style.color};
   for(const key of ['symbol','phase','zone','angle','count']){const value=node.dataset['legend'+key[0].toUpperCase()+key.slice(1)];if(value)entry[key]=value}
   return entry;
  });
 }
 function wrap(text,measure,width){
  const lines=[];let line='';
  for(const word of String(text).split(/\s+/)){
   if(line&&measure(line+' '+word)>width){lines.push(line);line=''}
   for(const char of (line?' ':'')+word){if(line&&measure(line+char)>width){lines.push(line);line=''}line+=char}
  }
  if(line)lines.push(line);return lines;
 }
 function scaleBar(width,fieldNm){
  if(!(Number.isFinite(fieldNm)&&fieldNm>0))return null;
  const target=fieldNm*.2,power=10**Math.floor(Math.log10(target)),value=[1,2,5,10].map(n=>n*power).reduce((a,b)=>Math.abs(a-target)<Math.abs(b-target)?a:b);
  return {pixels:width*value/fieldNm,label:value>=1000?`${Number((value/1000).toPrecision(4))} µm`:`${Number(value.toPrecision(4))} nm`};
 }
 function hexColour(colour){
  if(validColour(colour))return colour;
  const rgb=String(colour).match(/^rgb\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)\s*\)$/);
  return rgb?'#'+rgb.slice(1).map(n=>Math.min(255,Number(n)).toString(16).padStart(2,'0')).join(''):'#a4adba';
 }
 function triangleImage(entries){
  const colours=entries.map(e=>hexColour(e.colour)),key=colours.join('|');if(triangles.has(key))return triangles.get(key);
  const c=document.createElement('canvas');c.width=140;c.height=122;const ctx=c.getContext('2d'),pixels=ctx.createImageData(c.width,c.height);
  for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
   const a=1-(y+.5)/c.height,d=(y+.5)/(2*c.height)+(x+.5)/c.width-.5,weights=[a,1-a-d,d];if(Math.min(...weights)<0)continue;
   const colour=blendSupport(colours.map((v,i)=>[v,weights[i]])).colour,offset=4*(y*c.width+x);
   for(let i=0;i<3;i++)pixels.data[offset+i]=parseInt(colour.slice(1+i*2,3+i*2),16);pixels.data[offset+3]=255;
  }
  ctx.putImageData(pixels,0,0);if(triangles.size>=8)triangles.delete(triangles.keys().next().value);triangles.set(key,c);return c;
 }
 function labelMetrics(ctx,text,font){
  // Match the vector/IPF labels: decorate negative indices explicitly instead of relying on font fallback for combining overbars.
  const align=ctx.textAlign;ctx.textAlign='left';
  const plain=text.replaceAll('\u0305',''),m=ctx.measureText(plain),bars=[];let prefix='';
  for(const part of text.split(/((?:\d\u0305)+)/)){
   const value=part.replaceAll('\u0305','');
   if(part.includes('\u0305')){
    const digit=ctx.measureText(value),left=digit.actualBoundingBoxLeft??0,right=digit.actualBoundingBoxRight??digit.width;
    bars.push({x:ctx.measureText(prefix).width-left,width:left+right,top:(digit.actualBoundingBoxAscent??font*.8)+font*.08+font*.05,height:font*.05});
   }
   prefix+=value;
  }
  ctx.textAlign=align;return {plain,bars,width:m.width,actualBoundingBoxAscent:Math.max(m.actualBoundingBoxAscent??font*.8,...bars.map(bar=>bar.top)),actualBoundingBoxDescent:m.actualBoundingBoxDescent??font*.2};
 }
 function paintLabel(ctx,text,x,y,font,metrics=labelMetrics(ctx,text,font)){
  ctx.fillText(metrics.plain,x,y);
  const left=x-(ctx.textAlign==='right'?metrics.width:ctx.textAlign==='center'?metrics.width/2:0);
  for(const bar of metrics.bars)ctx.fillRect(left+bar.x,y-bar.top,bar.width,bar.height);
 }
 function legendLayout(ctx,entries,blend,maxWidth,font){
  const pad=font*.3,gap=font*.35,symbol=font*.65,keyGap=font*.28,line=font*1.25,content=maxWidth-2*pad;
  ctx.textBaseline='alphabetic';
  if(!blend.length&&entries.some(entry=>entry.phase&&entry.symbol)){
   const columns=[font*.65,0,0,0,0],rows=entries.filter(entry=>entry.phase&&entry.symbol).map(entry=>{
    const cells=['symbol','phase','zone','angle','count'].map((key,i)=>{
     const text=String(entry[key]||'');ctx.font=i===0?symbolFont(font):`${font}px Arial`;const m=labelMetrics(ctx,text,font),ascent=m.actualBoundingBoxAscent,descent=m.actualBoundingBoxDescent;
     columns[i]=Math.max(columns[i],m.width);return {text,metrics:m,ascent,height:ascent+descent};
    });
    return {...entry,cells,height:Math.max(...cells.map(cell=>cell.height))};
   });
   ctx.font=`${font}px Arial`;
   return {kind:'table',pad,gap,rows,columns,width:2*pad+columns.reduce((sum,width)=>sum+width,0)+4*gap,height:2*pad+rows.reduce((sum,row)=>sum+row.height,0)+Math.max(0,rows.length-1)*gap};
  }
  const key=(entry,limit=content)=>{
   const lines=wrap(entry.text,t=>labelMetrics(ctx,t,font).width,Math.max(font,limit-symbol-keyGap)),metrics=lines.map(t=>labelMetrics(ctx,t,font));
   const ascent=metrics[0]?.actualBoundingBoxAscent??font*.8,descent=metrics.at(-1)?.actualBoundingBoxDescent??font*.2,textHeight=Math.max(0,lines.length-1)*line+ascent+descent,textWidth=Math.max(0,...metrics.map(m=>m.width));
   return {...entry,lines,ascent,textHeight,textWidth,width:symbol+keyGap+textWidth,height:Math.max(symbol,textHeight)};
  };
  if(blend.length===2){
   let ramp=Math.min(font*5.5,content*.28),limit=(content-ramp-2*gap)/2;
   const left=key(blend[0],limit),right=key(blend[1],limit),height=Math.max(left.height,right.height,font*.6),side=Math.max(left.width,right.width);
   return {kind:'ramp',pad,gap,symbol,keyGap,line,width:2*pad+2*side+ramp+2*gap,height:2*pad+height,left,right,ramp,side,contentHeight:height};
  }
  if(blend.length===3){
   const bottomLimit=(content-gap)/2,keys=[key(blend[0]),key(blend[1],bottomLimit),key(blend[2],bottomLimit)],triangle=Math.min(font*4.8,content*.6);
   const width=Math.max(keys[0].width,2*Math.max(keys[1].width,keys[2].width)+gap,triangle+font),bandHeight=Math.max(...keys.map(k=>k.height));
   return {kind:'triangle',pad,gap,symbol,keyGap,line,keys,triangle,column:(width-gap)/2,bandHeight,width:width+2*pad,height:2*pad+2*bandHeight+2*gap+triangle*.87};
  }
  const rows=[];let x=0,y=0,rowHeight=0,width=0,rowStart=0;
  const finishRow=()=>{for(let i=rowStart;i<rows.length;i++)rows[i].y+=(rowHeight-rows[i].height)/2;rowStart=rows.length};
  for(const entry of entries){const k=key(entry);if(x&&x+k.width>content){finishRow();y+=rowHeight+gap;x=0;rowHeight=0}rows.push({...k,x,y});width=Math.max(width,x+k.width);rowHeight=Math.max(rowHeight,k.height);x+=k.width+gap}finishRow();
  return {kind:'keys',pad,gap,symbol,keyGap,line,rows,width:width+2*pad,height:y+rowHeight+2*pad};
 }
 function anchor(bounds,w,h,corner,margin){return {x:corner.endsWith('right')?bounds.x+bounds.width-margin-w:bounds.x+margin,y:corner.startsWith('top')?bounds.y+margin:bounds.y+bounds.height-margin-h,width:w,height:h}}
 const intersects=(a,b,gap=0)=>a.x<b.x+b.width+gap&&a.x+a.width+gap>b.x&&a.y<b.y+b.height+gap&&a.y+a.height+gap>b.y;
 function overlayBoxes(bounds,legend,bar,choice,margin){
  const box=legend?anchor(bounds,legend.width,legend.height,choice.legend_position,margin):null;
  if(box&&(box.width>bounds.width-2*margin||box.height>bounds.height-2*margin))throw new Error('The legend does not fit. Reduce Text size or turn the legend off.');
  const scale=bar?anchor(bounds,bar.width,bar.height,choice.scale_bar_position,margin):null;
  if(scale&&box&&intersects(scale,box,margin)){
   const candidates=choice.scale_bar_position.startsWith('top')?[box.y+box.height+margin,box.y-margin-scale.height]:[box.y-margin-scale.height,box.y+box.height+margin];
   const y=candidates.find(y=>y>=bounds.y+margin&&y+scale.height<=bounds.y+bounds.height-margin&&!intersects({...scale,y},box,margin*.5));
   if(y===undefined)throw new Error('The legend and scale bar do not fit together. Reduce Text size or move an overlay.');scale.y=y;
  }
  if(scale&&(scale.width>bounds.width-2*margin||scale.height>bounds.height-2*margin))throw new Error('The scale bar does not fit. Reduce Text size.');
  return {legend:box,bar:scale};
 }
 function swatch(ctx,x,y,size,colour,hex){
  ctx.fillStyle=colour;ctx.strokeStyle='rgba(255,255,255,.65)';ctx.lineWidth=Math.max(1,size*.025);
  ctx.beginPath();if(hex){for(let i=0;i<6;i++){const angle=(30+i*60)*Math.PI/180,px=x+size/2+size/2*Math.cos(angle),py=y+size/2+size/2*Math.sin(angle);if(i)ctx.lineTo(px,py);else ctx.moveTo(px,py)}ctx.closePath()}else ctx.rect(x,y,size,size);ctx.fill();ctx.stroke();
 }
 function paintLegend(ctx,layout,box,choice,font,hex,blend){
  ctx.save();ctx.globalAlpha=choice.legend_opacity;ctx.fillStyle=choice.legend_shade;ctx.beginPath();ctx.roundRect(box.x,box.y,box.width,box.height,font*.15);ctx.fill();ctx.restore();
  ctx.font=`${font}px Arial`;ctx.textBaseline='alphabetic';
  const drawKey=(k,x,y,reverse=false)=>{
   const sx=reverse?x+k.textWidth+layout.keyGap:x,cy=y+k.height/2;
   if(k.symbol){ctx.font=symbolFont(layout.symbol);const m=ctx.measureText(k.symbol);ctx.fillStyle=k.colour;ctx.textAlign='center';ctx.fillText(k.symbol,sx+layout.symbol/2,cy+((m.actualBoundingBoxAscent??layout.symbol*.8)-(m.actualBoundingBoxDescent??layout.symbol*.2))/2);ctx.font=`${font}px Arial`}
   else swatch(ctx,sx,cy-layout.symbol/2,layout.symbol,k.colour,hex);
   ctx.fillStyle=choice.legend_colour;ctx.textAlign=reverse?'right':'left';
   const tx=reverse?x+k.textWidth:x+layout.symbol+layout.keyGap,baseline=y+(k.height-k.textHeight)/2+k.ascent;
   k.lines.forEach((text,i)=>paintLabel(ctx,text,tx,baseline+i*layout.line,font));
  };
  const x=box.x+layout.pad,y=box.y+layout.pad;
  if(layout.kind==='table'){
   let rowY=y;
   for(const row of layout.rows){let columnX=x;row.cells.forEach((cell,i)=>{
    ctx.font=i===0?symbolFont(font):`${font}px Arial`;ctx.fillStyle=i===0?row.colour:choice.legend_colour;ctx.textAlign=i===0?'center':i>=3?'right':'left';
    paintLabel(ctx,cell.text,columnX+(i===0?layout.columns[i]/2:i>=3?layout.columns[i]:0),rowY+(row.height-cell.height)/2+cell.ascent,font,cell.metrics);columnX+=layout.columns[i]+layout.gap;
   });rowY+=row.height+layout.gap}
  }else if(layout.kind==='keys')for(const k of layout.rows)drawKey(k,x+k.x,y+k.y);
  else if(layout.kind==='ramp'){
   drawKey(layout.left,x+layout.side-layout.left.width,y+(layout.contentHeight-layout.left.height)/2,true);
   const rx=x+layout.side+layout.gap,ry=y+(layout.contentHeight-font*.42)/2;
   const count=Math.max(2,Math.ceil(layout.ramp));
   for(let i=0;i<count;i++){ctx.fillStyle=blendSupport(blend.map((e,j)=>[hexColour(e.colour),j?i/(count-1):1-i/(count-1)])).colour;ctx.fillRect(rx+i*layout.ramp/count,ry,layout.ramp/count+.1,font*.42)}
   drawKey(layout.right,rx+layout.ramp+layout.gap,y+(layout.contentHeight-layout.right.height)/2);
  }else{
   const [top,left,right]=layout.keys;drawKey(top,box.x+(box.width-top.width)/2,y+(layout.bandHeight-top.height)/2);
   const ty=y+layout.bandHeight+layout.gap;ctx.drawImage(triangleImage(blend),box.x+(box.width-layout.triangle)/2,ty,layout.triangle,layout.triangle*.87);
   const by=ty+layout.triangle*.87+layout.gap;
   drawKey(left,x+(layout.column-left.width)/2,by+(layout.bandHeight-left.height)/2,true);
   drawKey(right,x+layout.column+layout.gap+(layout.column-right.width)/2,by+(layout.bandHeight-right.height)/2);
  }
 }
 function compose({map,width=map.width,height=map.height,fieldNm,legend=[],blend=[],hex=false,name='',choice=settings()}){
  choice=normalize(choice);const palette=theme(choice),unit=width/1800,font=(choice.mode==='paper'?64:32)*unit*choice.text_scale,margin=32*unit;
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=`${font}px Arial`;
  const title=choice.show_name&&name?wrap(name,t=>ctx.measureText(t).width,width-2*margin):[],heading=title.length?Math.ceil(title.length*font*1.25+2*margin):0;
  canvas.width=width;canvas.height=height+heading;
  if(palette.background){ctx.fillStyle=palette.background;ctx.fillRect(0,0,canvas.width,canvas.height)}
  ctx.font=`${font}px Arial`;ctx.textBaseline='top';ctx.fillStyle=palette.ink;title.forEach((line,i)=>ctx.fillText(line,margin,margin+i*font*1.25));
  const bounds={x:0,y:heading,width,height};ctx.drawImage(map,bounds.x,bounds.y,width,height);
  const entries=legend.filter(e=>e.text).map(e=>({...e,colour:hexColour(e.colour)})),mixture=[2,3].includes(blend.length)?blend.map(e=>({...e,colour:hexColour(e.colour)})):[];
  const layout=choice.legend&&(entries.length||mixture.length)?legendLayout(ctx,entries,mixture,width-2*margin,font):null;
  const geometry=choice.scale_bar?scaleBar(width,fieldNm):null,barFont=font*1.06;
  ctx.font=`bold ${barFont}px Arial`;
  const bar=geometry?{...geometry,width:Math.max(geometry.pixels,ctx.measureText(geometry.label).width)+font*.3,height:barFont*1.2+font*.4}:null;
  const boxes=overlayBoxes(bounds,layout,bar,choice,margin);
  if(layout)paintLegend(ctx,layout,boxes.legend,choice,font,hex,mixture);
  if(bar){
   const box=boxes.bar,cx=box.x+box.width/2,y=box.y+barFont*1.2,left=cx-bar.pixels/2,thickness=Math.max(3,font*.18),outline=Math.max(1,font*.06);
   const rgb=[1,3,5].map(i=>parseInt(choice.scale_bar_colour.slice(i,i+2),16)),stroke=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722>128?'#000':'#fff';
   ctx.font=`bold ${barFont}px Arial`;ctx.textAlign='center';ctx.textBaseline='top';ctx.lineJoin='round';ctx.lineWidth=outline*2;ctx.strokeStyle=stroke;ctx.fillStyle=choice.scale_bar_colour;
   ctx.strokeText(bar.label,cx,box.y);ctx.fillText(bar.label,cx,box.y);ctx.fillStyle=stroke;ctx.fillRect(left-outline,y-outline,bar.pixels+2*outline,thickness+2*outline);ctx.fillStyle=choice.scale_bar_colour;ctx.fillRect(left,y,bar.pixels,thickness);
  }
  if(Math.max(canvas.width,canvas.height)>3200){const factor=3200/Math.max(canvas.width,canvas.height),out=document.createElement('canvas');out.width=Math.round(canvas.width*factor);out.height=Math.round(canvas.height*factor);out.getContext('2d').drawImage(canvas,0,0,out.width,out.height);return out}
  return canvas;
 }
 async function placeholder({source,width,height,fieldNm,name='',hex=false,file_id,choice=settings()}){
  if(!source||!(width>0&&height>0))throw new Error('Select an image to preview its export settings.');
  const map=new Image();map.src=source;await map.decode();
  const longest=Math.max(width,height),canvas=compose({map,width:Math.round(1800*width/longest),height:Math.round(1800*height/longest),fieldNm,name,hex,choice,legend:[{text:'Legend placeholder',colour:'#a4adba'}]});
  return {url:canvas.toDataURL('image/png'),file_id,placeholder:true};
 }
 function syncControls(){
  const choice=settings();for(const input of dialog.querySelectorAll('[data-map-setting]')){const key=input.dataset.mapSetting;input.type==='checkbox'?input.checked=choice[key]:input.value=['text_scale','legend_opacity'].includes(key)?Math.round(choice[key]*100):choice[key]}
  for(const button of dialog.querySelectorAll('[data-map-position]'))button.setAttribute('aria-pressed',String(choice[button.dataset.mapPosition].split('-')[Number(button.dataset.axis)]===button.dataset.value));
  for(const group of ['legend','scale_bar'])for(const input of dialog.querySelectorAll(`[data-overlay="${group}"]`))input.disabled=!choice[group];
  syncIntensity();
 }
 const intensitySource=()=>providers.get(activeSource)?.intensity?.();
 function syncIntensity(){
  const source=intensitySource(),input=dialog.querySelector('.map-export-intensity input'),output=dialog.querySelector('.map-export-intensity output');
  input.disabled=saving||!source||source.disabled;
  const min=Number(source?.min)||0,max=Number(source?.max)||100,value=source?100*(Number(source.value)-min)/(max-min):0;
  input.value=value;input.step=source?100*Number(source.step)/(max-min):1;output.textContent=Math.round(value)+'%';
 }
 function setIntensity(value){
  const source=intensitySource();if(!source||source.disabled||saving)return;
  const min=Number(source.min)||0,max=Number(source.max)||100;source.value=min+value*(max-min)/100;source.dispatchEvent(new Event('input',{bubbles:true}));
 }
 const previewKey=()=>String(ready())+'|'+(providers.get(activeSource)?.key?.()||'')+'|'+(intensitySource()?.value??'')+'|'+(intensitySource()?.disabled??'');
 const ready=()=>Boolean(providers.get(activeSource)?.ready());
 function queuePreview(){
  ++revision;clearTimeout(timer);preview=null;dialog.querySelector('.map-export-save').disabled=true;
  const status=dialog.querySelector('.map-export-status'),image=dialog.querySelector('.map-export-preview img');image.hidden=true;
  dialog.querySelector('.map-export-message').hidden=ready();
  if(!ready()&&!providers.get(activeSource)?.placeholder){status.textContent='Select an image to preview its export settings.';return}
  status.textContent='Updating preview…';timer=setTimeout(renderPreview,120);
 }
 async function renderPreview(){
  const turn=revision,provider=providers.get(activeSource),choice=settings(),status=dialog.querySelector('.map-export-status'),isPlaceholder=!ready();
  try{
   const rendered=await (isPlaceholder?provider.placeholder(choice):provider.render(choice));const image=new Image();image.src=rendered.url;await image.decode();
   if(!dialog.open||turn!==revision)return;
   if(isPlaceholder===ready()){queuePreview();return}
   image.alt=isPlaceholder?'Current image with placeholder export legend':'TEM map PNG export preview';dialog.querySelector('.map-export-preview img').replaceWith(image);preview={...rendered,placeholder:isPlaceholder};status.textContent=`${image.naturalWidth} × ${image.naturalHeight} px`;dialog.querySelector('.map-export-save').disabled=isPlaceholder||!ready();
  }catch(error){if(dialog.open&&turn===revision){status.textContent='Preview unavailable: '+error.message;preview=null;dialog.querySelector('.map-export-message').hidden=true}}
 }
 function open(source='main',button){
  if(!dialog||saving)return;activeSource=source;opener=button;syncControls();dialog.showModal();queuePreview();
  lastKey=previewKey();
  clearInterval(poll);poll=setInterval(()=>{const key=previewKey();if(key!==lastKey&&!saving){lastKey=key;syncIntensity();queuePreview()}},750);
 }
 function initialize(){
  const saved=readPreference('tem-map-png-style',{});mode=saved.mode==='paper'?'paper':'standard';
  for(const key of ['standard','paper']){if(themes[saved.backgrounds?.[key]])backgrounds[key]=saved.backgrounds[key];if(typeof saved.names?.[key]==='boolean')names[key]=saved.names[key]}
  const restored=normalize(saved.options||{});for(const key of Object.keys(defaults))options[key]=restored[key];
  dialog=document.createElement('dialog');dialog.id='map-export-dialog';dialog.className='map-export-dialog';dialog.setAttribute('aria-labelledby','map-export-title');
  const positions=(key,label)=>[['horizontal',['left','right'],1],['vertical',['top','bottom'],0]].map(([axis,values,index])=>`<span class="signal-toggle inspector-layout" role="group" aria-label="${label} ${axis} position">${values.map(value=>`<button type="button" data-map-position="${key}_position" data-axis="${index}" data-value="${value}" data-overlay="${key}">${value[0].toUpperCase()+value.slice(1)}</button>`).join('')}</span>`).join('');
  dialog.innerHTML=`<header class="map-export-heading"><h2 id="map-export-title">Map export settings</h2><button type="button" class="map-export-close" aria-label="Close map export settings">×</button></header>
   <div class="map-export-body"><div class="map-export-options">
   <div class="map-export-fields"><label>Mode<select data-map-setting="mode"><option value="standard">Standard</option><option value="paper">Paper</option></select></label><label>Background<select data-map-setting="background"><option value="transparent">Transparent</option><option value="white">White</option><option value="dark">Dark</option></select></label></div>
   <div class="map-export-fields"><label>Text size<span><input data-map-setting="text_scale" aria-label="Export text size, percent" type="number" required min="50" max="150" step="10"> %</span></label><label class="check"><input type="checkbox" data-map-setting="show_name">Sample name</label></div>
   <div class="map-export-intensity"><label for="map-export-intensity">Overlay intensity</label><input id="map-export-intensity" type="range" min="0" max="100" step="1"><output for="map-export-intensity">0%</output></div>
   <section><div class="map-export-fields"><label class="check"><input type="checkbox" data-map-setting="legend">Legend</label>${positions('legend','Legend')}</div>
   <div class="map-export-fields"><label>Text<input aria-label="Legend text colour" type="color" data-map-setting="legend_colour" data-overlay="legend"></label><label>Shade<input aria-label="Legend shade colour" type="color" data-map-setting="legend_shade" data-overlay="legend"></label><label>Shading<span><input aria-label="Legend shading, percent" type="number" required min="0" max="100" step="1" data-map-setting="legend_opacity" data-overlay="legend"> %</span></label></div></section>
   <section><div class="map-export-fields"><label class="check"><input type="checkbox" data-map-setting="scale_bar">Scale bar</label>${positions('scale_bar','Scale bar')}</div><div class="map-export-fields"><label>Colour<input aria-label="Scale bar colour" type="color" data-map-setting="scale_bar_colour" data-overlay="scale_bar"></label></div></section>
   <span class="settings-help"><button type="button" class="settings-help-button" aria-label="About map export settings">ⓘ</button><span class="settings-help-popup" role="tooltip">Shared by TEM maps, PCA/NMF and batch exports. Paper uses larger text and starts with the sample name hidden. Phase colours follow the displayed map. Hex maps use hexagonal legend keys. Legends sit on the image with adjustable shading; scale bars use the image calibration. Overlays sharing a corner are separated automatically. The preview shows the actual PNG layout; checkerboard areas export as transparent.</span></span>
   </div><div class="map-export-preview"><img alt="TEM map PNG export preview" hidden><span class="map-export-message" role="status" hidden>Complete a grid and finish updating the map to preview its export.</span></div></div>
   <footer><span class="map-export-status" role="status" aria-live="polite"></span><button type="button" class="map-export-save" disabled>Export PNG</button></footer>`;
  document.body.append(dialog);
  dialog.querySelector('.map-export-intensity input').oninput=event=>setIntensity(Number(event.target.value));
  document.addEventListener('input',event=>{if(dialog.open&&!saving&&event.target===intensitySource()){lastKey=previewKey();syncIntensity();queuePreview()}});
  for(const id of ['map-export-settings','pca-export-settings']){const button=document.getElementById(id);if(button)button.onclick=()=>open(id.startsWith('pca')?'detail':'main',button)}
  dialog.querySelector('.map-export-close').onclick=()=>dialog.close();
  dialog.addEventListener('cancel',event=>{if(saving)event.preventDefault()});
  dialog.addEventListener('close',()=>{++revision;clearTimeout(timer);clearInterval(poll);preview=null;opener?.focus({preventScroll:true})});
  for(const button of dialog.querySelectorAll('[data-map-position]'))button.onclick=()=>{
   const key=button.dataset.mapPosition,corner=settings()[key].split('-');corner[Number(button.dataset.axis)]=button.dataset.value;options[key]=corner.join('-');persist();syncControls();queuePreview();
  };
  for(const input of dialog.querySelectorAll('[data-map-setting]'))input.addEventListener('input',()=>{
   if(!input.checkValidity()){dialog.querySelector('.map-export-status').textContent=input.validationMessage;++revision;clearTimeout(timer);preview=null;dialog.querySelector('.map-export-save').disabled=true;return}
   const key=input.dataset.mapSetting,value=input.type==='checkbox'?input.checked:['text_scale','legend_opacity'].includes(key)?Number(input.value)/100:input.value;
   if(key==='mode')mode=value;else if(key==='background')backgrounds[mode]=value;else if(key==='show_name')names[mode]=value;else options[key]=value;
   persist();syncControls();queuePreview();
  });
  dialog.querySelector('.map-export-save').onclick=async()=>{
   if(!preview||preview.placeholder||saving||!ready())return;const rendered=preview;saving=true;const status=dialog.querySelector('.map-export-status');status.textContent='Saving PNG…';
   for(const input of dialog.querySelectorAll('input,select,button'))input.disabled=true;
   try{if(settings().background==='transparent'&&!config.map_export_styles)throw new Error('Restart TEM Workbench, then reload to save transparent maps.');const saved=await api('export-spectrum',{file_id:rendered.file_id,image_kind:'real_space_map',format:'png',frames:[rendered.url]});status.textContent='Saved: '+saved.path}
   catch(error){status.textContent='Export failed: '+error.message}
   finally{saving=false;for(const input of dialog.querySelectorAll('input,select,button'))input.disabled=false;syncControls();dialog.querySelector('.map-export-save').disabled=!preview||preview.placeholder||!ready()}
  };
 }
 document.addEventListener('DOMContentLoaded',initialize);
 return {settings,normalize,theme,compose,paper:compose,placeholder,scaleBar,wrap,legendLayout,legendEntries,overlayBoxes,register,open};
})();

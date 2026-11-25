window.aztecKamLegend={selected(result,options){if(!result.kam||options.ebsd_layout==='ipf'||options.kam_legend==='none')return [];const available=result.rows.filter(row=>{const tile=row.tiles?.find(t=>t.channel==='KAM');return !row.error&&tile?.image&&!tile.error&&tile.image_limits});return options.kam_legend==='one'?(options.kam_legend_target?available.filter(row=>row.acquisition===options.kam_legend_target):available.slice(0,1)):available}};
window.aztecPanelLabels={
 visible:(options,kind)=>options.panel_labels?.[kind]!==false,
 position:(options,kind)=>window.aztecOverlayPlacement.corner(options.panel_label_positions?.[kind],'top-left'),
 kind:(column,result)=>column.electron?'overview':result.kam?(column.channel==='IPF'?'ipf':'kam'):'eds'
};
/* Export the same displayed images/plots, keeping numerical data separate. */
window.aztecMapLayout={
 columns(result,signals,options){
  const count=Math.max(0,...result.rows.map(row=>Array.isArray(row.overviews)?row.overviews.length:1));
  const columns=Array.from({length:count},(_,index)=>({label:count===1?'Electron image':`Overview ${index+1}`,electron:true,overview:index}));
  if(result.kam){
   const layout=options.ebsd_layout||'ipf-kam';
   if(layout!=='kam')columns.push({channel:'IPF',label:'IPF '+(result.ipf_direction||'Z')});
   if(layout!=='ipf')columns.push({channel:'KAM',label:'KAM (°)'});
  }else{
   const layered=options.eds_layout&&options.eds_layout!=='separate';
   if(layered){
    if(result.mode!=='ratio')columns.push({layered:'signal',label:'Layered elements'});
    if(result.mode!=='signal')columns.push({layered:'ratio',label:'Layered ratios'});
   }
   if(!layered||options.eds_layout==='both'){
    for(const channel of signals)columns.push({channel,label:result.mode==='ratio'&&channel!==options.denominator?`${channel} / ${options.denominator}`:channel});
    if(result.mode==='both')for(const channel of signals)if(channel!==options.denominator)columns.push({channel,ratio:true,label:`${channel} / ${options.denominator}`});
   }
  }
  return columns;
 },
 tile(row,column){return column.layered?row.layered?.[column.layered]:row.tiles.find(tile=>tile.channel===column.channel)},
 layerLabel(layer){return layer.label+(layer.strength===1?'':` ${Math.round(layer.strength*100)}%`)},
 overview(row,column){return Array.isArray(row.overviews)?row.overviews[column.overview||0]:row.electron?{image:row.electron,label:'Electron image'}:null},
 sourceRect(overview,width,height){const points=overview?.full_resolution&&overview.crop_points;return points?{x:points[0][0],y:points[0][1],width:points[1][0]-points[0][0],height:points[1][1]-points[0][1]}:{x:0,y:0,width,height}},
 grid(rows,columns,transpose=false){return {rows:transpose?columns:rows,columns:transpose?rows:columns,position:(row,column)=>transpose?[column,row]:[row,column]}},
 aspect(result,options={}){
  if(!result.kam&&options.spatial==='crop')return 1;
  const rows=result.rows.filter(row=>row.width>0&&row.height>0&&!row.error);let ratios=rows.map(row=>row.width/row.height);
  if(!result.kam&&options.spatial==='physical'&&rows.length){const fields=new Map();for(const row of rows){const field=fields.get(row.distance_unit)||{width:0,height:0};field.width=Math.max(field.width,row.width);field.height=Math.max(field.height,row.height);fields.set(row.distance_unit,field)}ratios=[...fields.values()].map(field=>field.width/field.height)}
  if(!ratios.length)ratios=result.rows.flatMap(row=>(row.tiles||[]).filter(tile=>tile.shape?.length===2&&tile.shape[0]>0&&tile.shape[1]>0).map(tile=>tile.shape[1]/tile.shape[0]));
  return Math.max(.25,Math.min(4,...(ratios.length?ratios:[1])));
 }
};
window.aztecMapColours={
 black:result=>result.normalisation!=='none'&&(result.map_palette||'black')==='black',
 bands(result){
  if(!this.black(result))return [['#053061','#2166ac','#4393c3','#92c5de','#d1e5f0','#f7f7f7','#fddbc7','#f4a582','#d6604d','#b2182b','#67001f']];
  const colours=[...new Set(result.rows.flatMap(row=>row.tiles.filter(tile=>!tile.error&&tile.colour).map(tile=>tile.colour)))];
  return (colours.length?colours:['#fff']).map(colour=>['#000',colour]);
 },
 label(result){return `Relative to each map’s ${result.normalisation==='p20'?'P20':result.normalisation} (${this.black(result)?'black = minimum':'shared limits'})`}
};
/* Figures' nearest 1/2/5 bar at 17% of the visible field, with its standard
   filled white rectangle, black outline and centred label proportions. */
window.aztecOverlayPlacement={
 corners:['top-left','top-right','bottom-left','bottom-right'],
 corner(value,fallback){return this.corners.includes(value)?value:fallback},
 reserve(position,value){return typeof value==='number'?(position==='top-left'?value:0):value?.position===position?value.height:0},
 box(bounds,width,height,position,padding=5,topLeft=0){
  return {x:position.endsWith('right')?bounds.right-padding-width:bounds.left+padding,
   y:position.startsWith('top')?bounds.top+padding+this.reserve(position,topLeft):bounds.bottom-padding-height-this.reserve(position,topLeft)};
 },
 style(position,topLeft=0){return {left:position.endsWith('left')?'5px':'auto',right:position.endsWith('right')?'5px':'auto',top:position.startsWith('top')?(5+this.reserve(position,topLeft))+'px':'auto',bottom:position.startsWith('bottom')?(5+this.reserve(position,topLeft))+'px':'auto'}}
};
window.aztecScaleBar={
 visible(options,electron,kam){return options.scale_bar_overlay!==false&&((options.scale_bar_scope||(kam?'overview':'all'))==='all'||!!electron)},
 geometry(width,fieldWidth,unit){
  if(!(width>0&&fieldWidth>0&&Number.isFinite(width+fieldWidth)))return null;
  const target=fieldWidth*.17,exponent=Math.floor(Math.log10(target)),candidates=[];
  for(let power=exponent-1;power<=exponent+1;power++)for(const step of [1,2,5])candidates.push(step*10**power);
  const value=candidates.reduce((best,candidate)=>Math.abs(Math.log(candidate/target))<Math.abs(Math.log(best/target))?candidate:best);
  const pixels=value/fieldWidth*width,scale=width/640;
  return {value,pixels,label:unit==='nm'&&value>=1000?`${Number((value/1000).toPrecision(6))} µm`:`${Number(value.toPrecision(6))} ${unit}`,
   margin:Math.max(16,Math.round(640*.035))*scale,height:Math.max(5,Math.round(640*.008))*scale,
   fontSize:Math.max(19,Math.round(640*14/320))*scale,border:2*scale,stroke:Math.max(2,Math.floor(640/300))*scale,gap:Math.max(7,Math.round(640*.008))*scale};
 },
 position(bar,bounds,labelWidth,position='bottom-left',topLeft=0){
  position=window.aztecOverlayPlacement.corner(position,'bottom-left');
  const x=position.endsWith('right')?bounds.right-bar.margin-bar.pixels:bounds.left+bar.margin;
  const y=position.startsWith('top')?bounds.top+bar.margin+bar.fontSize+bar.gap+window.aztecOverlayPlacement.reserve(position,topLeft):bounds.bottom-bar.margin-bar.height-window.aztecOverlayPlacement.reserve(position,topLeft);
  return {x,y,labelX:Math.max(bounds.left+bar.margin,Math.min(x+(bar.pixels-labelWidth)/2,bounds.right-bar.margin-labelWidth)),labelY:y-bar.gap};
 },
 draw(ctx,left,bottom,width,fieldWidth,unit,placement={}){
  const bar=this.geometry(width,fieldWidth,unit);if(!bar)return;
  ctx.save();ctx.font=`${bar.fontSize}px system-ui`;
  const {x,y,labelX,labelY}=this.position(bar,{left,right:left+width,top:placement.top||0,bottom},ctx.measureText(bar.label).width,placement.position,placement.topLeft);
  ctx.fillStyle='#000';ctx.fillRect(x-bar.border,y-bar.border,bar.pixels+2*bar.border,bar.height+2*bar.border);
  ctx.fillStyle='#fff';ctx.fillRect(x,y,bar.pixels,bar.height);
  ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.strokeStyle='#000';ctx.lineJoin='round';ctx.lineWidth=2*bar.stroke;
  ctx.strokeText(bar.label,labelX,labelY);ctx.fillText(bar.label,labelX,labelY);ctx.restore();
 }
};
window.aztecExport=(()=>{
 const themes={dark:{canvas:'#101c27',panel:'#0c131c',ink:'#e5edf7'},white:{canvas:'#fff',panel:'#fff',ink:'#263445'},transparent:{canvas:null,panel:null,ink:'#263445'}};
 const themeFor=options=>themes[options?.png_background]||themes.dark;
 const load=async source=>{const img=new Image();img.src=source;await img.decode();return img};
 const canvas=(w,h,theme)=>{if(w*h>64000000)throw new Error('Select fewer acquisitions for one PNG.');const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');if(theme.canvas){ctx.fillStyle=theme.canvas;ctx.fillRect(0,0,w,h)}return [c,ctx]};
 const labelInk=hex=>{const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722>.179?'#0b1520':'#fff'};
 function badge(ctx,label,x,y,maxWidth,colour='#fff',initialSize=18,backdrop=null,anchor=null){
  let size=initialSize;ctx.font=`600 ${size}px system-ui`;
  while(size>11&&ctx.measureText(label).width>maxWidth-16){size--;ctx.font=`600 ${size}px system-ui`}
  if(ctx.measureText(label).width>maxWidth-16){while(label.length&&ctx.measureText(label+'…').width>maxWidth-16)label=label.slice(0,-1);label+='…'}
  const width=ctx.measureText(label).width+14;if(anchor){const point=window.aztecOverlayPlacement.box(anchor.bounds,width,size+12,anchor.position,anchor.padding??5);x=point.x;y=point.y}
  ctx.fillStyle=backdrop||'rgba(5,10,16,.78)';ctx.beginPath();ctx.roundRect(x,y,width,size+12,4);ctx.fill();ctx.fillStyle=colour;ctx.textBaseline='top';ctx.fillText(label,x+7,y+5);ctx.textBaseline='alphabetic';return width;
 }
 function colourScale(ctx,x,top,height,result,theme){
  const {low,high}=result,bands=window.aztecMapColours.bands(result);
  bands.forEach((stops,index)=>{const gradient=ctx.createLinearGradient(0,top+height,0,top);stops.forEach((colour,i)=>gradient.addColorStop(i/(stops.length-1),colour));ctx.fillStyle=gradient;ctx.fillRect(x+20*index/bands.length,top,20/bands.length,height)});
  ctx.font='13px system-ui';ctx.fillStyle=theme.ink;
  for(let i=0;i<=6;i++){const y=top+height*i/6,value=high-(high-low)*i/6;ctx.fillText(Number(value.toPrecision(3)).toString(),x+26,Math.max(top+12,Math.min(top+height,y+4)))}
  ctx.save();ctx.translate(x+86,top+height/2);ctx.rotate(-Math.PI/2);ctx.textAlign='center';ctx.font='14px system-ui';ctx.fillText(window.aztecMapColours.label(result),0,0);ctx.restore();
 }
 function layerLegend(ctx,tile,x,y,width){
  let left=x,top=y;const parts=tile.layers.filter(layer=>layer.strength>0).map(layer=>({label:window.aztecMapLayout.layerLabel(layer),colour:layer.colour}));
  if(tile.missing?.length)parts.push({label:'Missing: '+tile.missing.join(', '),colour:'#fff'});
  for(const part of parts){ctx.font='600 12px system-ui';const wanted=Math.min(width,ctx.measureText(part.label).width+14);if(left>x&&left+wanted>x+width){left=x;top+=26}left+=badge(ctx,part.label,left,top,wanted,part.colour,12)+5}
 }
 function valueLegend(ctx,bounds,limits,reserve){
  const text=limits.map(value=>Number(value.toPrecision(3))).join(' – ');
  ctx.save();ctx.font='12px system-ui';
  const width=ctx.measureText(text).width+8,{x,y}=window.aztecOverlayPlacement.box(bounds,width,22,'bottom-right',5,reserve);
  ctx.fillStyle='#080e14bf';ctx.beginPath();ctx.roundRect(x,y,width,22,3);ctx.fill();
  ctx.fillStyle='#fff';ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.fillText(text,x+4,y+16);ctx.restore();
 }
 function kamLegend(ctx,bounds,limits,stops,position,topLeft){
  const labels=limits.map(value=>Number(value.toPrecision(3))+'°');
  ctx.save();ctx.font='12px system-ui';
  const width=Math.max(60,ctx.measureText(labels[0]).width+ctx.measureText(labels[1]).width+12),{x:left,y:top}=window.aztecOverlayPlacement.box(bounds,width+8,34,position,5,topLeft);
  ctx.fillStyle='#080e14bf';ctx.beginPath();ctx.roundRect(left,top,width+8,34,3);ctx.fill();
  const gradient=ctx.createLinearGradient(left+4,0,left+4+width,0);stops.forEach((colour,index)=>gradient.addColorStop(index/(stops.length-1),colour));
  ctx.fillStyle=gradient;ctx.fillRect(left+4,top+3,width,8);
  ctx.fillStyle='#fff';ctx.textBaseline='alphabetic';ctx.textAlign='left';ctx.fillText(labels[0],left+4,top+27);
  ctx.textAlign='right';ctx.fillText(labels[1],left+4+width,top+27);ctx.restore();
 }
 async function maps({result,options,comparison,signals,names,colours={},crops,maxSize}){
  const theme=themeFor(options);
  const kamLegends=new Set(window.aztecKamLegend.selected(result,options).map(row=>row.acquisition));
  const ipfLegends=new Map((window.aztecIpfLegend?.selected(result,options)||[]).map(row=>[row.acquisition,window.aztecIpfLegend.svg(row,options)]));
  const columns=window.aztecMapLayout.columns(result,signals,options),layout=window.aztecMapLayout.grid(result.rows.length,columns.length,options.transpose);
  const aspect=window.aztecMapLayout.aspect(result,options),overviewPixels=result.rows.flatMap(row=>(row.overviews||[]).filter(image=>image.full_resolution&&image.image).map(image=>{const region=window.aztecMapLayout.sourceRect(image,...image.source_shape.slice().reverse());return Math.max(region.width,region.height*aspect)}));
  const mapPixels=result.rows.flatMap(row=>columns.filter(column=>!column.electron).map(column=>window.aztecMapLayout.tile(row,column)?.shape).filter(Boolean).map(shape=>Math.max(shape[1],shape[0]*aspect)));
  // Keep annotations in the original 320 px panel coordinates. Increasing the
  // raster resolution must scale the labels and padding along with the images.
  const tileSize=320,nativeScale=Math.max(2,Math.ceil(Math.max(0,...overviewPixels,...mapPixels))/tileSize),gap=5,margin=8,legend=options.show_colour_scale!==false&&result.normalisation!=='none'&&options.eds_layout!=='layered'&&(!comparison||result.scale_scope==='all');
  const tileHeight=tileSize/aspect;
  const mapWidth=margin*2+layout.columns*tileSize+(layout.columns-1)*gap+(legend?100:0),mapHeight=margin*2+layout.rows*tileHeight+(layout.rows-1)*gap;
  const exportScale=maxSize>0?Math.min(nativeScale,maxSize/Math.max(mapWidth,mapHeight)):nativeScale;
  const [out,ctx]=canvas(Math.ceil(mapWidth*exportScale),Math.ceil(mapHeight*exportScale),theme);ctx.scale(exportScale,exportScale);
  const sizes=new Map(),minimum=new Map();
  for(const r of result.rows)if(r.width&&r.height){sizes.set(r.distance_unit,Math.max(sizes.get(r.distance_unit)||0,r.width));minimum.set(r.distance_unit,Math.min(minimum.get(r.distance_unit)||Infinity,r.width,r.height))}
  for(const [j,row] of result.rows.entries())for(const [i,column] of columns.entries()){
   const [displayRow,displayColumn]=layout.position(j,i),x=margin+displayColumn*(tileSize+gap),y=margin+displayRow*(tileHeight+gap),tile=window.aztecMapLayout.tile(row,column);
   const overview=column.electron?window.aztecMapLayout.overview(row,column):null;
   const source=column.electron?overview?.image:tile?.[column.ratio?'ratio_image':'image'];
   const labelKind=window.aztecPanelLabels.kind(column,result),labelPosition=window.aztecPanelLabels.position(options,labelKind),showLabel=window.aztecPanelLabels.visible(options,labelKind);
   const label=column.electron?names[row.acquisition]:result.kam?(column.channel==='KAM'?'KAM':column.label):tile?.[column.ratio?'ratio_label':'label']||column.label;
   if(source){
    const img=await load(source),region=window.aztecMapLayout.sourceRect(overview,img.naturalWidth,img.naturalHeight),spatial=result.kam?'fit':comparison?options.spatial:'fit';let w=tileSize,h=tileHeight,cx=.5,cy=.5;
    if(row.width&&['physical','crop'].includes(spatial)){const field=(spatial==='crop'?minimum:sizes).get(row.distance_unit);w=tileSize*row.width/field;h=tileSize*row.height/field;
     if(spatial==='crop'){const centre=crops[row.acquisition]||[.5,.5];cx=Math.max(tileSize/(2*w),Math.min(1-tileSize/(2*w),centre[0]));cy=Math.max(tileSize/(2*h),Math.min(1-tileSize/(2*h),centre[1]))}
    }else{const fit=Math.min(tileSize/region.width,tileHeight/region.height);w=region.width*fit;h=region.height*fit}
    const left=x+tileSize/2-cx*w,top=y+tileHeight/2-cy*h;
    ctx.save();ctx.beginPath();ctx.rect(x,y,tileSize,tileHeight);ctx.clip();
    if(!column.electron&&result.normalisation==='none')ctx.filter=`brightness(${options.brightness})`;
    // EBSD pixels are measured cells: enlargement must not blend their colours.
    ctx.imageSmoothingEnabled=!(result.kam&&!column.electron);
    ctx.drawImage(img,region.x,region.y,region.width,region.height,left,top,w,h);ctx.filter='none';
    const start=Math.max(x,left),end=Math.min(x+tileSize,left+w),bottom=Math.min(y+tileHeight,top+h);
    const labelColour=column.electron?colours[row.acquisition]:null;
    const labelBounds={left:start,right:end,top:Math.max(y,top),bottom};
    if(showLabel)badge(ctx,label,0,0,Math.min(tileSize,w)-10,labelColour?labelInk(labelColour):'#fff',18,labelColour,{bounds:labelBounds,position:labelPosition});
    const reserve=showLabel?{position:labelPosition,height:Number(ctx.font.match(/([\d.]+)px/)[1])+17}:0,placement=window.aztecOverlayPlacement,bounds={left:x,right:x+tileSize,top:Math.max(y,top),bottom};
    if(window.aztecScaleBar.visible(options,column.electron,result.kam))window.aztecScaleBar.draw(ctx,start,bottom,end-start,row.width*(end-start)/w,row.distance_unit,{position:options.scale_bar_position,top:Math.max(y,top),topLeft:reserve});
    if(result.kam&&column.channel==='KAM'&&tile.image_limits){if(kamLegends.has(row.acquisition))kamLegend(ctx,bounds,tile.image_limits,result.kam_colour_stops,placement.corner(options.kam_legend_position,'bottom-right'),reserve);}
    else if(!column.electron&&options.show_colour_scale!==false&&(result.scale_scope!=='all'||result.normalisation==='none')){const limits=tile[column.ratio?'ratio_image_limits':'image_limits'];if(limits)valueLegend(ctx,labelBounds,limits,reserve)}
    if(column.channel==='IPF'&&ipfLegends.has(row.acquisition)){
     const svg=ipfLegends.get(row.acquisition),size=window.aztecIpfLegend.geometry(tileSize,tileHeight,svg);
     svg.setAttribute('width',Math.ceil(size.width*exportScale));svg.setAttribute('height',Math.ceil(size.height*exportScale));
     const image=await load('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(svg)));
     const anchor=placement.box(bounds,size.width,size.height,placement.corner(options.ipf_legend_position,'top-right'),5,reserve);
     ctx.imageSmoothingEnabled=true;ctx.drawImage(image,anchor.x,anchor.y,size.width,size.height);
    }
    if(column.layered)layerLegend(ctx,tile,x+5,Math.max(y,top)+38,tileSize-10);ctx.restore();
   }else{const labelColour=column.electron?colours[row.acquisition]:null;if(showLabel)badge(ctx,label,0,0,tileSize-10,labelColour?labelInk(labelColour):'#fff',18,labelColour,{bounds:{left:x,right:x+tileSize,top:y,bottom:y+tileHeight},position:labelPosition});ctx.fillStyle=theme.ink;ctx.font='14px system-ui';ctx.fillText(column.electron&&!overview?'No overview selected':'Unavailable',x+12,y+tileHeight/2)}
  }
  if(legend)colourScale(ctx,mapWidth-92,margin,mapHeight-2*margin,result,theme);
  return out;
 }
 async function distribution({result,options,names,colours={}}){
  const theme=themeFor(options),group=window.aztecDistributions.selected(result,options.distribution_channel);
  if(!group||!group.series.some(curve=>curve.pixels>0))throw new Error('There are no valid pixels to export in this distribution.');
  if(result.kam&&options.distribution_view==='exceedance'&&!group.exceedance_thresholds)throw new Error('Restart TEM Workbench, then reload to export the exceedance chart.');
  const svg=window.aztecDistributions.svg(group,result.rows,names,{view:result.kam?options.distribution_view:'histogram',xMin:result.kam?options.distribution_x_min:null,xMax:result.kam?options.distribution_x_max:null,ink:theme.ink,panel:theme.panel,grid:theme===themes.dark?'#3b4c5c':'#ccd5df',markers:options.distribution_markers,colours});
  const [, ,width,height]=svg.getAttribute('viewBox').split(' ').map(Number),margin=8;
  const scale=8; // Four times the previous PNG width and height.
  svg.setAttribute('width',width*scale);svg.setAttribute('height',height*scale);
  for(const node of svg.querySelectorAll('[vector-effect]'))node.removeAttribute('vector-effect');
  const [out,ctx]=canvas((width+2*margin)*scale,(height+2*margin)*scale,theme);ctx.scale(scale,scale);
  const source='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(svg));
  ctx.drawImage(await load(source),margin,margin,width,height);return out;
 }
 function svgSnapshot(svg,theme){
  const copy=svg.cloneNode(true),box=svg.getBoundingClientRect(),view=svg.viewBox.baseVal;
  copy.setAttribute('xmlns','http://www.w3.org/2000/svg');copy.setAttribute('width',view.width||box.width);copy.setAttribute('height',view.height||box.height);
  copy.style.background=theme===themes.dark?getComputedStyle(svg).backgroundColor:theme.panel||'transparent';copy.style.fontFamily='system-ui';copy.style.color=theme.ink;
  if(theme!==themes.dark&&svg.closest('.eds-line-tile')){
   for(const node of copy.querySelectorAll('text[fill="#becbda"]'))node.setAttribute('fill',theme.ink);
   for(const node of copy.querySelectorAll('path[stroke="#fff"][stroke-width="3.5"]'))node.setAttribute('stroke','#263445');
  }
  // Hover cursors are temporary UI, not part of the selected data.
  for(const n of copy.querySelectorAll('[visibility]'))n.setAttribute('visibility','hidden');
  return {node:copy,width:box.width||view.width,height:box.height||view.height};
 }
 function svgSource(snapshot,acquisition){
  const copy=snapshot.node.cloneNode(true);
  if(acquisition)for(const node of copy.querySelectorAll('[data-acquisition]'))if(node.getAttribute('data-acquisition')!==acquisition)node.remove();
  return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(copy));
 }
 function captureLines({root,names,colours={},result,options,comparison}){
  // Capture the current plots before any asynchronous image decoding or saving.
  const theme=themeFor(options);
  const references=new Map();
  for(const figure of root.querySelectorAll('.eds-line-reference')){
   const svg=figure.querySelector('.eds-reference-drawing');if(svg)references.set(figure.dataset.acquisition,svgSnapshot(svg,theme));
  }
  const groups=[];
  for(const section of root.querySelectorAll('.eds-compare-line-section,.eds-map-row')){
   const acquisition=section.dataset.acquisition||null,heading=names[acquisition]||section.querySelector(':scope > h3')?.textContent||'';
   const figures=[...section.querySelectorAll('.eds-line-tile')].map(figure=>{
    const svg=figure.querySelector('svg');if(!svg)return null;
    const viewHeight=svg.viewBox.baseVal.height||svg.getBoundingClientRect().height||1;
    return {showLabels:window.aztecPanelLabels.visible(options,'line'),labelPosition:window.aztecPanelLabels.position(options,'line'),labelBounds:figure.dataset.labelBounds?JSON.parse(figure.dataset.labelBounds):null,image:svgSnapshot(svg,theme),cropTop:(Number(svg.dataset.cropTop)||0)/viewHeight,cropHeight:(Number(svg.dataset.cropHeight)||viewHeight)/viewHeight,metric:figure.dataset.metric||'',labelX:Number(figure.dataset.labelX),labelY:Number(figure.dataset.labelY),labelWidth:Number(figure.dataset.labelWidth),metricRight:Number(figure.dataset.metricRight),legend:[...figure.querySelectorAll('figcaption > span:not(.eds-line-quantity)')].map(node=>({label:node.dataset.acquisition?names[node.dataset.acquisition]||node.textContent:node.textContent,acquisition:node.dataset.acquisition||null,colour:node.style.color||theme.ink}))};
   }).filter(Boolean);
   if(figures.length)groups.push({acquisition,heading,figures});
  }
  if(!groups.length)throw new Error('There are no line plots to export.');
  return {groups,references,layout:comparison&&options.layout==='overlay'?'overlay':'rows',names,colours,acquisitions:result.rows.filter(row=>!row.error&&row.tiles?.some(tile=>!tile.error)).map(row=>row.acquisition)};
 }
 function plotBadges(ctx,parts,x,y,width,anchor=null){
  const rows=[[]];let used=0;
  for(const part of parts){ctx.font='600 14px system-ui';const wanted=Math.min(300,width,ctx.measureText(part.label).width+14);if(used&&used+wanted>width){rows.push([]);used=0}rows.at(-1).push({...part,width:wanted});used+=wanted+6}
  const totalWidth=Math.max(0,...rows.map(row=>row.reduce((sum,part)=>sum+part.width+6,0)-6)),height=rows.length*28-2;
  if(anchor){const point=window.aztecOverlayPlacement.box(anchor.bounds,totalWidth,height,anchor.position);x=point.x;y=point.y}
  for(const [i,row]of rows.entries()){let left=x+(anchor?.position.endsWith('right')?totalWidth-(row.reduce((sum,p)=>sum+p.width+6,0)-6):0);for(const part of row)left+=badge(ctx,part.label,left,y+i*28,part.width,part.background?labelInk(part.background):part.colour,14,part.background)+6}
  return height;
 }
 const lineWidth=1400,linePad=8,columnGap=6,rowGap=0;
 const plotHeight=(figure,width)=>Math.max(105,Math.round(width*figure.image.height/Math.max(1,figure.image.width)));
 const plotCrop=(figure,width)=>{const height=plotHeight(figure,width);return {top:height*figure.cropTop,height:height*figure.cropHeight}};
 function stackedCrop(figures,width){
  let y=0,top=0,bottom=0;
  for(const [index,figure] of figures.entries()){const crop=plotCrop(figure,width);if(!index)top=crop.top;bottom=y+crop.top+crop.height;y+=plotHeight(figure,width)+rowGap}
  return {top,height:bottom-top};
 }
 function lineColumns(captured,comparison,onlyAcquisition){
  if(!comparison)return {referenceWidth:0,plotWidth:lineWidth-linePad*2,panelInset:0};
  const groups=onlyAcquisition?captured.groups.filter(group=>group.acquisition===onlyAcquisition):captured.groups;
  const figure=groups[0].figures[0],aspects=[...captured.references.values()].map(ref=>ref.width/ref.height),aspect=aspects.length?Math.max(...aspects):1;
  const ratio=Math.max(...groups.map(group=>stackedCrop(group.figures,group.figures[0].image.width).height/group.figures[0].image.width*aspect));
  const widths=inset=>{const usable=lineWidth-linePad*2-inset*2-columnGap,referenceWidth=Math.max(120,Math.min(usable*.6,Math.round(usable*ratio/(1+ratio))));return {referenceWidth,plotWidth:usable-referenceWidth}};
  let panelInset=4;
  for(let i=0;i<3;i++)panelInset=Math.max(4,Math.round(plotCrop(figure,widths(panelInset).plotWidth).top));
  return {...widths(panelInset),panelInset};
 }
 async function drawReference(ctx,reference,label,x,y,width,height,theme,labelColour,showLabel=true,labelPosition='top-left'){
  if(theme.panel){ctx.fillStyle=theme.panel;ctx.fillRect(x,y,width,height)}
  if(reference){const image=await load(svgSource(reference)),scale=Math.min(width/reference.width,height/reference.height),w=reference.width*scale,h=reference.height*scale,left=x+(width-w)/2,top=y+(height-h)/2;ctx.drawImage(image,left,top,w,h);if(showLabel)badge(ctx,label||'Acquisition',left+6,top+6,Math.max(30,w-12),labelColour?labelInk(labelColour):'#fff',18,labelColour,{bounds:{left,right:left+w,top,bottom:top+h},position:labelPosition,padding:6})}
  else{ctx.fillStyle=theme.ink;ctx.font='15px system-ui';ctx.fillText('Reference image unavailable',x+12,y+height/2);if(showLabel)badge(ctx,label||'Acquisition',x+6,y+6,width-12,labelColour?labelInk(labelColour):'#fff',18,labelColour,{bounds:{left:x,right:x+width,top:y,bottom:y+height},position:labelPosition,padding:6})}
  return height;
 }
 async function drawPlot(ctx,figure,x,y,width,acquisition,heading='',headingColour=null){
  const height=plotHeight(figure,width),image=await load(svgSource(figure.image,acquisition));ctx.drawImage(image,x,y,width,height);
  const legend=figure.legend.filter(part=>!acquisition||!part.acquisition||part.acquisition===acquisition);
  const labelX=x+width*(Number.isFinite(figure.labelX)?figure.labelX:.05),labelY=y+height*(Number.isFinite(figure.labelY)?figure.labelY:.04),labelWidth=width*(Number.isFinite(figure.labelWidth)?figure.labelWidth:.68);
  const values=figure.labelBounds,bounds=values?{left:x+width*values[0],right:x+width*values[1],top:y+height*values[2],bottom:y+height*values[3]}:{left:labelX-5,right:x+width-5,top:labelY-5,bottom:y+height-5};
  const labelsHeight=figure.showLabels!==false?plotBadges(ctx,[...(heading?[{label:heading,colour:'#fff',background:headingColour}]:[]),...legend],labelX,labelY,labelWidth,{bounds,position:figure.labelPosition||'top-left'}):0;
  if(figure.metric){ctx.font='600 14px system-ui';const maxWidth=width*.28,wanted=Math.min(maxWidth,ctx.measureText(figure.metric).width+14),right=width*(Number.isFinite(figure.metricRight)?figure.metricRight:.02);badge(ctx,figure.metric,x+width-right-wanted,labelY+(figure.labelPosition==='top-right'?labelsHeight+4:0),maxWidth,'#fff',14)}
  return height;
 }
 async function lines({snapshot,root,names,result,options,comparison,onlyAcquisition}){
  const theme=themeFor(options);
  const captured=snapshot||captureLines({root,names,result,options,comparison});
  if(onlyAcquisition&&!captured.acquisitions.includes(onlyAcquisition))throw new Error('The selected acquisition has no line plots.');
  const references=options?.background===false?[]:onlyAcquisition?captured.acquisitions.filter(id=>id===onlyAcquisition):captured.acquisitions;
  if(captured.layout==='overlay'){
   const panels=captured.groups.flatMap(group=>group.figures.map(figure=>({figure,heading:group.heading})))
    .filter(panel=>!onlyAcquisition||panel.figure.legend.some(part=>part.acquisition===onlyAcquisition));
   if(!panels.length)throw new Error('The selected acquisition has no line plots.');
   let panelInset=4;
   for(let i=0;i<3;i++)panelInset=Math.max(4,Math.round(plotCrop(panels[0].figure,lineWidth-linePad*2-panelInset*2).top));
   const plotWidth=lineWidth-linePad*2-panelInset*2,referenceHeight=220,gap=6,startX=linePad+panelInset;
   let nextX=startX,nextY=linePad+panelInset;
   const cards=references.map(id=>{
    const reference=captured.references.get(id),aspect=reference?reference.width/reference.height:1,width=Math.min(plotWidth,Math.max(60,Math.round(referenceHeight*aspect)));
    if(nextX>startX&&nextX+width>startX+plotWidth){nextX=startX;nextY+=referenceHeight+gap}
    const card={id,x:nextX,y:nextY,width};nextX+=width+gap;return card;
   });
   const referencesHeight=cards.length?cards.at(-1).y+referenceHeight-(linePad+panelInset):0;
   const plotOffset=panelInset+(cards.length?referencesHeight+gap:0);
   const height=plotOffset+panels.reduce((sum,panel)=>sum+plotHeight(panel.figure,plotWidth)+rowGap,0);
   const [out,ctx]=canvas(lineWidth*2,Math.ceil((linePad*2+height)*2),theme);ctx.scale(2,2);if(theme.panel){ctx.fillStyle=theme.panel;ctx.fillRect(linePad,linePad,lineWidth-linePad*2,height)}
   for(const card of cards)await drawReference(ctx,captured.references.get(card.id),captured.names[card.id],card.x,card.y,card.width,referenceHeight,theme,captured.colours?.[card.id],window.aztecPanelLabels.visible(options,'overview'),window.aztecPanelLabels.position(options,'overview'));
   let y=linePad+plotOffset;for(const panel of panels)y+=await drawPlot(ctx,panel.figure,linePad+panelInset,y,plotWidth,onlyAcquisition,panel.heading)+rowGap;
   return out;
  }
  const {referenceWidth,plotWidth,panelInset}=lineColumns(captured,comparison,onlyAcquisition);
  const groups=onlyAcquisition?captured.groups.filter(group=>group.acquisition===onlyAcquisition):captured.groups;
  const rows=groups.map(group=>{
   const reference=captured.references.get(group.acquisition),available=!!reference||comparison;
   const width=available?plotWidth:lineWidth-linePad*2;
   const plots=group.figures.reduce((sum,figure)=>sum+plotHeight(figure,width)+rowGap,0);
   const crop=stackedCrop(group.figures,width);
   return {group,reference,showReference:available,width,referenceTop:crop.top,referenceHeight:crop.height,height:plots};
  });
  const [out,ctx]=canvas(lineWidth*2,Math.ceil((linePad*2+rows.reduce((sum,row)=>sum+row.height+rowGap,0))*2),theme);ctx.scale(2,2);
  let y=linePad;for(const row of rows){
   if(theme.panel){ctx.fillStyle=theme.panel;ctx.fillRect(linePad,y,lineWidth-linePad*2,row.height)}
   const {group,reference,width}=row,x=row.showReference?linePad+panelInset+referenceWidth+columnGap:linePad;
   if(row.showReference)await drawReference(ctx,reference,captured.names[group.acquisition]||group.heading,linePad+panelInset,y+row.referenceTop,referenceWidth,row.referenceHeight,theme,captured.colours?.[group.acquisition],window.aztecPanelLabels.visible(options,'overview'),window.aztecPanelLabels.position(options,'overview'));
   let plotY=y;for(const figure of group.figures)plotY+=await drawPlot(ctx,figure,x,plotY,width,null,row.showReference?'':group.heading,row.showReference?null:captured.colours?.[group.acquisition])+rowGap;
   y+=row.height+rowGap;
  }
  return out;
 }
 async function png(settings){
  let output=await (settings.kind==='map'?maps:settings.kind==='distribution'?distribution:lines)(settings);
  if(settings.maxSize>0&&Math.max(output.width,output.height)>settings.maxSize){const scale=settings.maxSize/Math.max(output.width,output.height),[small,ctx]=canvas(Math.max(1,Math.round(output.width*scale)),Math.max(1,Math.round(output.height*scale)),themes.transparent);ctx.drawImage(output,0,0,small.width,small.height);output=small}
  const blob=await new Promise(resolve=>output.toBlob(resolve,'image/png'));if(!blob)throw new Error('PNG export could not be created.');
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('PNG export could not be read.'));reader.readAsDataURL(blob)});
 }
 return {png,captureLines};
})();

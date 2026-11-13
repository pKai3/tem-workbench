/* Export the same displayed images/plots, keeping numerical data separate. */
window.aztecExport=(()=>{
 const background='#101c27',ink='#e5edf7';
 const load=async source=>{const img=new Image();img.src=source;await img.decode();return img};
 const canvas=(w,h)=>{if(w*h>64000000)throw new Error('Select fewer acquisitions for one PNG.');const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');ctx.fillStyle=background;ctx.fillRect(0,0,w,h);return [c,ctx]};
 function badge(ctx,label,x,y,maxWidth,colour='#fff',initialSize=18){
  let size=initialSize;ctx.font=`600 ${size}px system-ui`;
  while(size>11&&ctx.measureText(label).width>maxWidth-16){size--;ctx.font=`600 ${size}px system-ui`}
  if(ctx.measureText(label).width>maxWidth-16){while(label.length&&ctx.measureText(label+'…').width>maxWidth-16)label=label.slice(0,-1);label+='…'}
  const width=ctx.measureText(label).width+14;
  ctx.fillStyle='rgba(5,10,16,.78)';ctx.fillRect(x,y,width,size+12);ctx.fillStyle=colour;ctx.textBaseline='top';ctx.fillText(label,x+7,y+5);ctx.textBaseline='alphabetic';return width;
 }
 function scaleBar(ctx,x,y,visibleWidth,fieldWidth,unit){
  if(!(fieldWidth>0&&visibleWidth>0))return;
  const target=fieldWidth*.25,power=10**Math.floor(Math.log10(target)),value=([5,2,1].find(n=>n*power<=target)||1)*power;
  const pixels=visibleWidth*value/fieldWidth,label=unit==='nm'&&value>=1000?`${Number((value/1000).toPrecision(3))} µm`:`${Number(value.toPrecision(3))} ${unit}`;
  ctx.lineCap='butt';for(const [colour,width] of [['#000',6],['#fff',3]]){ctx.strokeStyle=colour;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+pixels,y);ctx.stroke()}
  ctx.font='14px system-ui';ctx.lineWidth=3;ctx.strokeStyle='#000';ctx.fillStyle='#fff';ctx.strokeText(label,x,y-9);ctx.fillText(label,x,y-9);
 }
 function colourScale(ctx,x,top,height,low,high,normalisation){
  const gradient=ctx.createLinearGradient(0,top+height,0,top);
  ['#053061','#2166ac','#4393c3','#92c5de','#d1e5f0','#f7f7f7','#fddbc7','#f4a582','#d6604d','#b2182b','#67001f'].forEach((c,i)=>gradient.addColorStop(i/10,c));
  ctx.fillStyle=gradient;ctx.fillRect(x,top,20,height);ctx.font='13px system-ui';ctx.fillStyle=ink;
  for(let i=0;i<=6;i++){const y=top+height*i/6,value=high-(high-low)*i/6;ctx.fillText(Number(value.toPrecision(3)).toString(),x+26,Math.max(top+12,Math.min(top+height,y+4)))}
  ctx.save();ctx.translate(x+86,top+height/2);ctx.rotate(-Math.PI/2);ctx.textAlign='center';ctx.font='14px system-ui';ctx.fillText(`Relative to each map’s ${normalisation==='p20'?'P20':normalisation} (shared limits)`,0,0);ctx.restore();
 }
 async function maps({result,options,comparison,signals,names,crops}){
  const columns=[{electron:true}];
  for(const channel of signals)columns.push({channel});
  if(result.mode==='both')for(const channel of signals)if(channel!==options.denominator)columns.push({channel,ratio:true});
  const tileSize=320,gap=5,margin=8,legend=result.normalisation!=='none'&&(!comparison||result.scale_scope==='all');
  const width=margin*2+columns.length*tileSize+(columns.length-1)*gap+(legend?100:0),height=margin*2+result.rows.length*tileSize+(result.rows.length-1)*gap;
  const [out,ctx]=canvas(width*2,height*2);ctx.scale(2,2);const sizes=new Map(),minimum=new Map();
  for(const r of result.rows)if(r.width&&r.height){sizes.set(r.distance_unit,Math.max(sizes.get(r.distance_unit)||0,r.width,r.height));minimum.set(r.distance_unit,Math.min(minimum.get(r.distance_unit)||Infinity,r.width,r.height))}
  for(const [j,row] of result.rows.entries())for(const [i,column] of columns.entries()){
   const x=margin+i*(tileSize+gap),y=margin+j*(tileSize+gap),tile=row.tiles.find(t=>t.channel===column.channel);
   const source=column.electron?row.electron:tile?.[column.ratio?'ratio_image':'image'];
   const label=column.electron?names[row.acquisition]:tile?.[column.ratio?'ratio_label':'label']||column.channel;
   if(source){
    const img=await load(source),spatial=comparison?options.spatial:'fit';let w=tileSize,h=tileSize,cx=.5,cy=.5;
    if(row.width&&['physical','crop'].includes(spatial)){const field=(spatial==='crop'?minimum:sizes).get(row.distance_unit);w=tileSize*row.width/field;h=tileSize*row.height/field;
     if(spatial==='crop'){const centre=crops[row.acquisition]||[.5,.5];cx=Math.max(tileSize/(2*w),Math.min(1-tileSize/(2*w),centre[0]));cy=Math.max(tileSize/(2*h),Math.min(1-tileSize/(2*h),centre[1]))}
    }else{const fit=Math.min(tileSize/img.naturalWidth,tileSize/img.naturalHeight);w=img.naturalWidth*fit;h=img.naturalHeight*fit}
    const left=x+tileSize/2-cx*w,top=y+tileSize/2-cy*h;
    ctx.save();ctx.beginPath();ctx.rect(x,y,tileSize,tileSize);ctx.clip();
    if(!column.electron&&result.normalisation==='none')ctx.filter=`brightness(${options.brightness})`;
    ctx.drawImage(img,left,top,w,h);ctx.filter='none';
    const start=Math.max(x,left),end=Math.min(x+tileSize,left+w),bottom=Math.min(y+tileSize,top+h);
    scaleBar(ctx,start+9,bottom-12,end-start,row.width*(end-start)/w,row.distance_unit);
    if(!column.electron&&(result.scale_scope!=='all'||result.normalisation==='none')){const limits=tile[column.ratio?'ratio_image_limits':'image_limits'];if(limits){ctx.font='12px system-ui';ctx.fillStyle='#fff';ctx.textAlign='right';ctx.strokeStyle='#000';ctx.lineWidth=3;const text=limits.map(v=>Number(v.toPrecision(3))).join(' – ');ctx.strokeText(text,x+tileSize-8,bottom-12);ctx.fillText(text,x+tileSize-8,bottom-12);ctx.textAlign='left'}}
    badge(ctx,label,Math.max(x,left)+5,Math.max(y,top)+5,Math.min(tileSize,w)-10);ctx.restore();
   }else{badge(ctx,label,x+5,y+5,tileSize-10);ctx.fillStyle=ink;ctx.font='14px system-ui';ctx.fillText('Unavailable',x+12,y+tileSize/2)}
  }
  if(legend)colourScale(ctx,width-92,margin,height-2*margin,result.low,result.high,result.normalisation);
  return out;
 }
 function svgSnapshot(svg){
  const copy=svg.cloneNode(true),box=svg.getBoundingClientRect(),view=svg.viewBox.baseVal;
  copy.setAttribute('xmlns','http://www.w3.org/2000/svg');copy.setAttribute('width',view.width||box.width);copy.setAttribute('height',view.height||box.height);
  copy.style.background=getComputedStyle(svg).backgroundColor;copy.style.fontFamily='system-ui';copy.style.color=ink;
  // Hover cursors are temporary UI, not part of the selected data.
  for(const n of copy.querySelectorAll('[visibility]'))n.setAttribute('visibility','hidden');
  return {node:copy,width:box.width||view.width,height:box.height||view.height};
 }
 function svgSource(snapshot,acquisition){
  const copy=snapshot.node.cloneNode(true);
  if(acquisition)for(const node of copy.querySelectorAll('[data-acquisition]'))if(node.getAttribute('data-acquisition')!==acquisition)node.remove();
  return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(copy));
 }
 function captureLines({root,names,result,options,comparison}){
  // Capture the current plots before any asynchronous image decoding or saving.
  const references=new Map();
  for(const figure of root.querySelectorAll('.eds-line-reference')){
   const svg=figure.querySelector('.eds-reference-drawing');if(svg)references.set(figure.dataset.acquisition,svgSnapshot(svg));
  }
  const groups=[];
  for(const section of root.querySelectorAll('.eds-compare-line-section,.eds-map-row')){
   const acquisition=section.dataset.acquisition||null,heading=names[acquisition]||section.querySelector(':scope > h3')?.textContent||'';
   const figures=[...section.querySelectorAll('.eds-line-tile')].map(figure=>{
    const svg=figure.querySelector('svg');if(!svg)return null;
    const viewHeight=svg.viewBox.baseVal.height||svg.getBoundingClientRect().height||1;
    return {image:svgSnapshot(svg),cropTop:(Number(svg.dataset.cropTop)||0)/viewHeight,cropHeight:(Number(svg.dataset.cropHeight)||viewHeight)/viewHeight,metric:figure.dataset.metric||'',labelX:Number(figure.dataset.labelX),labelY:Number(figure.dataset.labelY),labelWidth:Number(figure.dataset.labelWidth),metricRight:Number(figure.dataset.metricRight),legend:[...figure.querySelectorAll('figcaption > span:not(.eds-line-quantity)')].map(node=>({label:node.dataset.acquisition?names[node.dataset.acquisition]||node.textContent:node.textContent,acquisition:node.dataset.acquisition||null,colour:node.style.color||ink}))};
   }).filter(Boolean);
   if(figures.length)groups.push({acquisition,heading,figures});
  }
  if(!groups.length)throw new Error('There are no line plots to export.');
  return {groups,references,layout:comparison&&options.layout==='overlay'?'overlay':'rows',names,acquisitions:result.rows.filter(row=>!row.error&&row.tiles?.some(tile=>!tile.error)).map(row=>row.acquisition)};
 }
 function plotBadges(ctx,parts,x,y,width){
  let left=x,top=y;
  for(const part of parts){
   ctx.font='600 14px system-ui';const wanted=Math.min(width,ctx.measureText(part.label).width+14);
   if(left>x&&left+wanted>x+width){left=x;top+=28}
   left+=badge(ctx,part.label,left,top,Math.min(300,x+width-left),part.colour,14)+6;
  }
 }
 const lineWidth=1400,linePad=14,lineGap=12,referenceWidth=280;
 const plotHeight=(figure,width)=>Math.max(105,Math.round(width*figure.image.height/Math.max(1,figure.image.width)));
 const plotCrop=(figure,width)=>{const height=plotHeight(figure,width);return {top:height*figure.cropTop,height:height*figure.cropHeight}};
 async function drawReference(ctx,reference,label,x,y,height){
  ctx.fillStyle=background;ctx.fillRect(x,y,referenceWidth,height);
  if(reference){const image=await load(svgSource(reference)),scale=Math.min(referenceWidth/reference.width,height/reference.height),w=reference.width*scale,h=reference.height*scale,left=x+(referenceWidth-w)/2,top=y+(height-h)/2;ctx.drawImage(image,left,top,w,h);badge(ctx,label||'Acquisition',left+6,top+6,Math.max(30,w-12))}
  else{ctx.fillStyle=ink;ctx.font='15px system-ui';ctx.fillText('Reference image unavailable',x+12,y+height/2);badge(ctx,label||'Acquisition',x+6,y+6,referenceWidth-12)}
  return height;
 }
 async function drawPlot(ctx,figure,x,y,width,acquisition,heading=''){
  const height=plotHeight(figure,width),image=await load(svgSource(figure.image,acquisition));ctx.drawImage(image,x,y,width,height);
  const legend=figure.legend.filter(part=>!acquisition||!part.acquisition||part.acquisition===acquisition);
  const labelX=x+width*(Number.isFinite(figure.labelX)?figure.labelX:.05),labelY=y+height*(Number.isFinite(figure.labelY)?figure.labelY:.04),labelWidth=width*(Number.isFinite(figure.labelWidth)?figure.labelWidth:.68);
  plotBadges(ctx,[...(heading?[{label:heading,colour:'#fff'}]:[]),...legend],labelX,labelY,labelWidth);
  if(figure.metric){ctx.font='600 14px system-ui';const maxWidth=width*.28,wanted=Math.min(maxWidth,ctx.measureText(figure.metric).width+14),right=width*(Number.isFinite(figure.metricRight)?figure.metricRight:.02);badge(ctx,figure.metric,x+width-right-wanted,labelY,maxWidth,'#fff',14)}
  return height;
 }
 async function lines({snapshot,root,names,result,options,comparison,onlyAcquisition}){
  const captured=snapshot||captureLines({root,names,result,options,comparison}),plotWidth=lineWidth-linePad*2-referenceWidth-lineGap;
  if(onlyAcquisition&&!captured.acquisitions.includes(onlyAcquisition))throw new Error('The selected acquisition has no line plots.');
  const references=onlyAcquisition?captured.acquisitions.filter(id=>id===onlyAcquisition):captured.acquisitions;
  if(captured.layout==='overlay'){
   const panels=captured.groups.flatMap(group=>group.figures.map(figure=>({figure,heading:group.heading})))
    .filter(panel=>!onlyAcquisition||panel.figure.legend.some(part=>part.acquisition===onlyAcquisition));
   const referenceCrop=panels.length?plotCrop(panels[0].figure,plotWidth):{top:0,height:180};
   const leftHeight=referenceCrop.top+references.length*(referenceCrop.height+lineGap);
   const rightHeight=panels.reduce((sum,panel)=>sum+plotHeight(panel.figure,plotWidth)+lineGap,0);
   const [out,ctx]=canvas(lineWidth*2,Math.ceil((linePad*2+Math.max(leftHeight,rightHeight))*2));ctx.scale(2,2);
   let y=linePad+referenceCrop.top;for(const id of references){y+=await drawReference(ctx,captured.references.get(id),captured.names[id],linePad,y,referenceCrop.height)+lineGap}
   y=linePad;for(const panel of panels)y+=await drawPlot(ctx,panel.figure,linePad+referenceWidth+lineGap,y,plotWidth,onlyAcquisition,panel.heading)+lineGap;
   return out;
  }
  const groups=onlyAcquisition?captured.groups.filter(group=>group.acquisition===onlyAcquisition):captured.groups;
  const rows=groups.map(group=>{
   const reference=captured.references.get(group.acquisition),available=!!reference||comparison;
   const width=available?plotWidth:lineWidth-linePad*2;
   const plots=group.figures.reduce((sum,figure)=>sum+plotHeight(figure,width)+lineGap,0);
   const crop=plotCrop(group.figures[0],width);
   return {group,reference,showReference:available,width,referenceTop:crop.top,referenceHeight:crop.height,height:plots};
  });
  const [out,ctx]=canvas(lineWidth*2,Math.ceil((linePad*2+rows.reduce((sum,row)=>sum+row.height+lineGap,0))*2));ctx.scale(2,2);
  let y=linePad;for(const row of rows){
   const {group,reference,width}=row,x=row.showReference?linePad+referenceWidth+lineGap:linePad;
   if(row.showReference)await drawReference(ctx,reference,captured.names[group.acquisition]||group.heading,linePad,y+row.referenceTop,row.referenceHeight);
   let plotY=y;for(const figure of group.figures)plotY+=await drawPlot(ctx,figure,x,plotY,width,null,row.showReference?'':group.heading)+lineGap;
   y+=row.height+lineGap;
  }
  return out;
 }
 async function png(settings){
  const output=await (settings.kind==='map'?maps:lines)(settings);
  const blob=await new Promise(resolve=>output.toBlob(resolve,'image/png'));if(!blob)throw new Error('PNG export could not be created.');
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('PNG export could not be read.'));reader.readAsDataURL(blob)});
 }
 return {png,captureLines};
})();

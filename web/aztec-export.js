/* Export the same displayed images/plots, keeping numerical data separate. */
window.aztecExport=(()=>{
 const background='#101c27',ink='#e5edf7';
 const load=async source=>{const img=new Image();img.src=source;await img.decode();return img};
 const canvas=(w,h)=>{if(w*h>64000000)throw new Error('Select fewer acquisitions for one PNG.');const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');ctx.fillStyle=background;ctx.fillRect(0,0,w,h);return [c,ctx]};
 function save(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)}
 function download(output){const bytes=Uint8Array.from(atob(output.data),c=>c.charCodeAt(0));save(new Blob([bytes],{type:output.mime}),output.filename)}
 function badge(ctx,label,x,y,maxWidth){
  let size=18;ctx.font=`600 ${size}px system-ui`;
  while(size>11&&ctx.measureText(label).width>maxWidth-16){size--;ctx.font=`600 ${size}px system-ui`}
  if(ctx.measureText(label).width>maxWidth-16){while(label.length&&ctx.measureText(label+'…').width>maxWidth-16)label=label.slice(0,-1);label+='…'}
  ctx.fillStyle='rgba(5,10,16,.65)';ctx.fillRect(x,y,ctx.measureText(label).width+14,size+12);ctx.fillStyle='#fff';ctx.textBaseline='top';ctx.fillText(label,x+7,y+5);ctx.textBaseline='alphabetic';
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
  const tileSize=320,gap=5,margin=8,legend=result.normalisation!=='none'&&result.shared_scales;
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
    if(!column.electron&&!result.shared_scales){const limits=tile[column.ratio?'ratio_image_limits':'image_limits'];if(limits){ctx.font='12px system-ui';ctx.fillStyle='#fff';ctx.textAlign='right';ctx.strokeStyle='#000';ctx.lineWidth=3;const text=limits.map(v=>Number(v.toPrecision(3))).join(' – ');ctx.strokeText(text,x+tileSize-8,bottom-12);ctx.fillText(text,x+tileSize-8,bottom-12);ctx.textAlign='left'}}
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
  return {source:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(copy)),width:box.width,height:box.height};
 }
 async function lines({root,names,result,options}){
  // Snapshot before awaiting image decoding so a later UI update cannot alter it.
  const blocks=[];
  for(const section of root.querySelectorAll('.eds-compare-line-section,.eds-map-row')){
   const heading=names[section.dataset.acquisition]||section.querySelector(':scope > h3')?.textContent||'';
   for(const figure of section.querySelectorAll('.eds-line-tile')){const svg=figure.querySelector('svg');if(svg)blocks.push({...svgSnapshot(svg),heading,legend:[...figure.querySelectorAll('figcaption > span')].map(n=>({label:n.textContent,colour:n.style.color||ink}))})}
  }
  if(!blocks.length)throw new Error('There are no line plots to export.');
  const refs=[...root.querySelectorAll('.eds-line-reference')].map(figure=>({acquisition:figure.dataset.acquisition,...svgSnapshot(figure.querySelector('.eds-reference-drawing'))})),width=1400,pad=12,refSize=180,perRow=Math.floor((width-pad*2)/(refSize+pad));
  let y=pad+Math.ceil(refs.length/perRow)*(refSize+pad);
  const measure=document.createElement('canvas').getContext('2d');measure.font='16px system-ui';
  for(const b of blocks){let x=pad,line=0;b.legend=b.legend.map(part=>{const width=measure.measureText(part.label).width+24;if(x>pad&&x+width>1400-pad){x=pad;line++}const value={...part,x,line};x+=width;return value});b.header=65+line*22}
  const heights=blocks.map(b=>Math.max(120,Math.round((width-pad*2)*b.height/Math.max(1,b.width))));
  const [out,ctx]=canvas(width*2,(y+heights.reduce((a,b,i)=>a+b+blocks[i].header,0)+pad)*2);ctx.scale(2,2);
  for(const [i,r] of refs.entries()){
   const img=await load(r.source),x=pad+(i%perRow)*(refSize+pad),top=pad+Math.floor(i/perRow)*(refSize+pad),fit=Math.min(refSize/r.width,refSize/r.height),w=r.width*fit,h=r.height*fit;
   ctx.drawImage(img,x,top,w,h);badge(ctx,names[r.acquisition],x+4,top+4,w-8);
  }
  for(const [i,b] of blocks.entries()){ctx.fillStyle=ink;ctx.font='16px system-ui';ctx.fillText(b.heading,pad,y+20);for(const part of b.legend){ctx.fillStyle=part.colour;ctx.fillText(part.label,part.x,y+42+part.line*22)}const img=await load(b.source);ctx.drawImage(img,pad,y+b.header-13,width-pad*2,heights[i]);y+=heights[i]+b.header}
  return out;
 }
 async function png(settings){const output=await (settings.kind==='map'?maps:lines)(settings);const blob=await new Promise(resolve=>output.toBlob(resolve,'image/png'));if(!blob)throw new Error('PNG export could not be created.');const name=settings.source.split(/[\\/]/).pop().replace(/\.[^.]+$/,'');save(blob,`${name}-${settings.kind}${settings.comparison?'-comparison':''}.png`)}
 return {png,download};
})();

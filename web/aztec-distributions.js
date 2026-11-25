/* The same processed-value distribution plot is used on screen and in PNGs. */
window.aztecDistributions=(()=>{
 let plotId=0;
 const palette=['#65cfff','#ffb14e','#db65ed','#49dba2','#fa7d8b','#c8a4ff'];
 const number=value=>Number.isFinite(value)?Number(value.toPrecision(4)).toString():'—';
 const selected=(result,id)=>result.distributions?.find(group=>group.id===id)||result.distributions?.find(group=>group.label.includes(' / '))||result.distributions?.[0];
 function axisRange(group,{xMin=null,xMax=null}={}){
  const ticks=group.exceedance_thresholds||group.edges;
  const bound=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value):null;
  const minimum=bound(xMin),maximum=bound(xMax);
  const p99=group.series.map(curve=>curve.p99).filter(Number.isFinite),autoHigh=group.exceedance_thresholds&&p99.length?Math.max(...p99):ticks.at(-1);
  let low=minimum??ticks[0],high=maximum??autoHigh;
  if(high<=low){if(minimum===null&&maximum!==null)low=Math.min(0,high-1);else high=low+1}
  return [low,high];
 }
 function markers(group,curve,visible={}){
  const pair=group.percentiles||[10,90];
  return [
   {key:'median',label:'Median',value:curve.median,dash:'4 3',show:visible.median!==false},
   {key:'mean',label:'Mean',value:curve.mean,dash:'9 3',show:visible.mean!==false},
   {key:'percentile_low',label:'P'+number(pair[0]),value:curve.percentile_low,dash:'2 3',show:visible.percentiles!==false},
   {key:'percentile_high',label:'P'+number(pair[1]),value:curve.percentile_high,dash:'2 3',show:visible.percentiles!==false}
  ].filter(marker=>marker.show&&Number.isFinite(marker.value));
 }
 function series(group,rows,names,colours={}){
  const labels=rows.map(row=>names[row.acquisition]||row.short_label||row.label||row.acquisition);
  return group.series.map(item=>{
   const index=rows.findIndex(row=>row.acquisition===item.acquisition),row=rows[index];
   const label=labels[index]||item.acquisition,name=labels.filter(value=>value===label).length>1?`${index+1} · ${row?.short_label||label}`:label;
   return {...item,name,
    colour:/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(colours[item.acquisition]||'')?colours[item.acquisition]:palette[Math.max(0,index)%palette.length],dash:index>=palette.length?'5 3':'',
    percent:item.counts.map(count=>item.pixels?100*count/item.pixels:0)};
  });
 }
 function svg(group,rows,names,{ink='#becbda',panel='#0c131c',grid='#3b4c5c',markers:visible={},colours={},view='histogram',xMin=null,xMax=null}={}){
  const ns='http://www.w3.org/2000/svg',root=document.createElementNS(ns,'svg'),curves=series(group,rows,names,colours);
  const exceedance=view==='exceedance',thresholds=group.exceedance_thresholds;
  const interior=group.pixel_scope==='normalization_interior',pixelLabel=interior?'valid interior pixels':'valid pixels';
  const width=360,height=302+curves.length*44,left=47,right=344,top=44,bottom=212;
  root.setAttribute('viewBox',`0 0 ${width} ${height}`);root.setAttribute('width',width);root.setAttribute('height',height);root.setAttribute('role','img');
  root.setAttribute('aria-label',`${group.label}: ${exceedance?'exceedance curves':'pixel intensity distributions'}, ${group.unit}. ${curves.map(c=>`${c.name}, ${c.pixels} ${pixelLabel}, ${markers(group,c,visible).map(m=>m.label+' '+number(m.value)).join(', ')}, maximum ${number(c.maximum)}`).join('; ')}`);
  root.setAttribute('xmlns',ns);root.style.fontFamily='system-ui';
  const add=(tag,attrs={},text,parent=root)=>{const node=document.createElementNS(ns,tag);for(const [key,value]of Object.entries(attrs))node.setAttribute(key,value);if(text!==undefined)node.textContent=text;parent.append(node);return node};
  const text=(x,y,label,attrs={})=>add('text',{x,y,fill:ink,'font-size':11,...attrs},label);
  if(panel)add('rect',{width,height,fill:panel,rx:5});
  if(exceedance&&!thresholds){text(left,40,'Restart Workbench to show exceedance.');return root}
  text(left,18,group.label,{'font-weight':600,'font-size':13});
  text(left,33,exceedance?'Pixels above angle (%)':interior?'Interior pixels per bin (%)':'Pixels per bin (%)',{'font-size':10});
  const [lo,hi]=axisRange(group,{view,xMin,xMax}),peak=Math.max(1,...curves.flatMap(c=>c.percent)),ymax=exceedance?100:peak*1.08;
  root.setAttribute('data-x-min',lo);root.setAttribute('data-x-max',hi);
  const clipId='eds-distribution-clip-'+(++plotId),defs=add('defs'),clip=add('clipPath',{id:clipId},undefined,defs);
  add('rect',{x:left,y:top,width:right-left,height:bottom-top},undefined,clip);
  const x=value=>left+(value-lo)/(hi-lo)*(right-left),y=value=>bottom-value/ymax*(bottom-top);
  for(let i=0;i<=4;i++){
   const value=ymax*i/4,py=y(value);add('line',{x1:left,x2:right,y1:py,y2:py,stroke:grid,'stroke-width':.6});text(left-6,py+3,number(value),{'text-anchor':'end','font-size':10});
   const vx=lo+(hi-lo)*i/4,px=x(vx);text(px,bottom+16,number(vx),{'text-anchor':i===0?'start':i===4?'end':'middle','font-size':10});
  }
  text((left+right)/2,bottom+34,group.unit,{'text-anchor':'middle'});
  for(const curve of curves)for(const marker of markers(group,curve,visible)){
   if(marker.value<lo||marker.value>hi)continue;
   const label=`${curve.name} · ${marker.label}: ${marker.value}`,px=x(marker.value);
   const line=add('line',{x1:px,x2:px,y1:top,y2:bottom,stroke:curve.colour,'stroke-width':1.1,'stroke-dasharray':marker.dash,opacity:.8,'data-statistic':marker.key,'data-acquisition':curve.acquisition,tabindex:0,role:'img','aria-label':label,'vector-effect':'non-scaling-stroke'});
   add('title',{},label,line);
  }
  for(const curve of curves){
   if(!curve.pixels)continue;
   let path;
   if(exceedance){
    path=curve.exceedance_percent.map((value,i)=>`${i?'L':'M'} ${x(thresholds[i])} ${y(value)}`).join(' ');
    if(hi>thresholds.at(-1))path+=` L ${x(hi)} ${y(0)}`;
   }
   else{
    path=`M ${x(group.edges[0])} ${bottom}`;
    for(const [i,value]of curve.percent.entries())path+=` L ${x(group.edges[i])} ${y(value)} L ${x(group.edges[i+1])} ${y(value)}`;
    path+=` L ${x(group.edges.at(-1))} ${bottom}`;
   }
   const line=add('path',{d:path,fill:'none',stroke:curve.colour,'stroke-width':1.7,'stroke-dasharray':curve.dash,'vector-effect':'non-scaling-stroke','clip-path':`url(#${clipId})`});
   add('title',{},`${curve.name}: ${curve.pixels.toLocaleString()} ${pixelLabel}; ${curve.excluded.toLocaleString()} excluded; median ${number(curve.median)}; mean ${number(curve.mean)}; max ${number(curve.maximum)}`,line);
  }
  const pair=group.percentiles||[10,90],columns=[[70,'median','Median'],[139,'mean','Mean'],[208,'percentile_low','P'+number(pair[0])],[278,'percentile_high','P'+number(pair[1])],[348,'maximum','Max']];
  for(const [px,key,label,dash]of [[12,'median','Median','4 3'],[118,'mean','Mean','9 3'],[218,'percentiles',`P${number(pair[0])} / P${number(pair[1])}`,'2 3']]){
   if(visible[key]===false)continue;
   add('line',{x1:px,x2:px+22,y1:266,y2:266,stroke:ink,'stroke-width':1.2,'stroke-dasharray':dash});text(px+27,270,label,{'font-size':10});
  }
  const header=291;for(const [position,,label]of columns)text(position,header,label,{'text-anchor':'end','font-size':10});
  for(const [i,curve]of curves.entries()){
   const py=header+20+i*44;
   add('line',{x1:12,x2:26,y1:py-4,y2:py-4,stroke:curve.colour,'stroke-width':2,'stroke-dasharray':curve.dash});
   const name=text(32,py,curve.name.length>48?curve.name.slice(0,23)+'…'+curve.name.slice(-24):curve.name,{'font-size':10,fill:curve.colour});add('title',{},curve.name,name);
   for(const [position,key,label]of columns){const value=text(position,py+16,number(curve[key]),{'text-anchor':'end','font-size':10});add('title',{},curve.pixels?`${curve.name} · ${label}: ${curve[key]}`:curve.reason,value)}
  }
  return root;
 }
 return {number,selected,series,markers,axisRange,svg};
})();

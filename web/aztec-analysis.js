/* Live views of the existing EDX report operations. Native inputs stay read-only. */
window.createAztecAnalysis=({$,el,state,api,highlightRegions})=>{
 let current=null,version=0;
 const preferences={};
 function groups(){
  const found=new Map();for(const a of state.file?.catalogue.acquisitions||[])for(const l of a.layers)for(const d of l.signals){
   const kind=d.path.startsWith('/XrayMapImages/')?'map':d.path.startsWith('/XrayLinescans/')?'line':null,id=d.attributes['Acquisition ID'];if(!kind||!id)continue;
   if(!found.has(id))found.set(id,{id,kind,label:[a.specimen,a.label,d.attributes.Acquisition].filter(Boolean).join(' / '),signals:[],paths:[]});const g=found.get(id);g.signals.push(d.attributes.Label);g.paths.push(d.path);
  }return [...found.values()];
 }
 function close(){++version;current=null;$('eds-analysis-tools').hidden=true;$('eds-analysis-views').hidden=true;$('eds-preview').hidden=false}
 function open(id,comparison=false){
  const available=groups(),chosen=available.find(g=>g.id===id)||available.find(g=>g.kind==='map');if(!chosen)return;
  ++state.previewVersion;const kind=comparison?'map':chosen.kind,all=available.filter(g=>g.kind===kind);
  const channelNames=[...new Set((comparison?all:[chosen]).flatMap(g=>g.signals))].sort((a,b)=>{const order=['Ti','V','Fe','Al'];const rank=x=>{const n=order.indexOf(x.split(' ')[0]);return n<0?99:n};return rank(a)-rank(b)||a.localeCompare(b)});
  const defaults={mode:'signal',denominator:channelNames.find(s=>s.startsWith('Ti '))||channelNames[0],normalisation:'none',smoothing:kind==='map'?6:10,low:.7,high:1.3,upper:.5,background:true,raw:false};
  current={kind,all,comparison,ids:comparison?all.map(g=>g.id):[chosen.id],signals:channelNames,options:{...defaults,...preferences[kind],...(comparison?{mode:'ratio',normalisation:'median'}:{})}};
  $('eds-dataset-title').textContent=comparison?'Map comparison':chosen.label;$('eds-dataset-info').textContent=kind==='map'?'Element maps':'Element traces · horizontal scan overlays';
  $('eds-preview').hidden=true;$('eds-preview').replaceChildren();$('eds-dataset-details').hidden=true;$('eds-preview-tools').hidden=true;$('eds-preview-note').textContent='';$('eds-preview-error').hidden=true;$('eds-analysis-tools').hidden=false;$('eds-analysis-views').hidden=false;$('eds-analysis-views').replaceChildren();
  if(comparison){state.dataset=null;highlightRegions()}else{state.dataset=state.file.catalogue.datasets.find(d=>d.attributes['Acquisition ID']===chosen.id&&/^\/(SmartLines|SmartMaps)\//.test(d.path))||state.file.catalogue.datasets.find(d=>chosen.paths.includes(d.path));highlightRegions()}
  controls(channelNames);update();
 }
 function controls(channels){
  const root=$('eds-analysis-tools');root.replaceChildren();const row=el('div',undefined,'eds-analysis-controls');root.append(row);
  const control=(label,key,choices)=>{const wrap=el('label',label),node=el('select');node.setAttribute('aria-label',label);for(const [value,text] of choices){const o=el('option',text);o.value=value;node.append(o)}node.value=current.options[key];node.onchange=()=>{current.options[key]=node.value;updateVisibility();update()};wrap.append(node);row.append(wrap);return wrap};
  control('View','mode',[['signal','Element signals'],['ratio','Element ratios']]);const denominator=control('Divide by','denominator',channels.map(s=>[s,s]));
  control('Normalize','normalisation',[['none','None'],['median','Median'],['mean','Mean (average)'],['p20','P20']]);
  const numeric=(label,key)=>{const wrap=el('label',label),input=el('input');input.type='number';input.step='any';input.min=key==='low'?'':0;input.value=current.options[key];input.setAttribute('aria-label',label);input.onchange=()=>{const v=Number(input.value);if(Number.isFinite(v)){current.options[key]=v;update()}};wrap.append(input);row.append(wrap);return wrap};
  numeric(current.kind==='map'?'Smoothing σ, px':'Smoothing FWHM, nm','smoothing');
  const low=numeric('Colour min','low'),high=numeric('Colour max','high'),upper=numeric('Ratio max','upper');
  const updateVisibility=()=>{denominator.hidden=current.options.mode!=='ratio';low.hidden=high.hidden=current.kind!=='map'||current.options.normalisation==='none';upper.hidden=current.kind!=='line'||current.options.mode!=='ratio'||current.options.normalisation!=='none'};updateVisibility();
  const picks=el('div',undefined,'eds-channel-picks');root.append(picks);
  for(const signal of channels){const label=el('label'),input=el('input');input.type='checkbox';input.checked=true;input.onchange=()=>{current.signals=[...picks.querySelectorAll('input:checked')].map(n=>n.value);update()};input.value=signal;label.append(input,el('span',signal));picks.append(label)}
  if(current.kind==='line'){const options=el('div',undefined,'eds-channel-picks');for(const [key,text] of [['background','Show electron image'],['raw','Show unsmoothed trace']]){const label=el('label'),input=el('input');input.type='checkbox';input.checked=current.options[key];input.onchange=()=>{current.options[key]=input.checked;if(current.result)render(current.result)};label.append(input,el('span',text));options.append(label)}root.append(options)}
  if(current.comparison){const details=el('details');details.open=true;details.append(el('summary','Maps'));const list=el('div',undefined,'eds-channel-picks');for(const group of current.all){const label=el('label'),input=el('input');input.type='checkbox';input.value=group.id;input.checked=true;input.onchange=()=>{current.ids=[...list.querySelectorAll('input:checked')].map(n=>n.value);update()};label.append(input,el('span',group.label));list.append(label)}details.append(list);root.append(details)}
  const help=el('details');help.append(el('summary','Processing details'),el('p','The same smoothing, ratios and image rotation used by the EDX reports. Signals are smoothed separately before division. Map normalization uses the interior, excluding a 3σ rim. Normalization divides each smoothed signal or ratio by its own median, mean or P20, making that baseline 1. Median is less affected by a few enriched peaks; mean includes their full contribution. These are relative signals, not composition.','hint'));root.append(help);
 }
 async function update(){
  const v=++version;if(!current)return;preferences[current.kind]={...current.options};$('eds-preview-error').hidden=true;
  if(!current.ids.length||!current.signals.length){$('eds-analysis-views').replaceChildren(el('p','Select an acquisition and at least one element.','hint'));$('eds-preview-busy').hidden=true;return}
  $('eds-preview-busy').hidden=false;
  try{const result=await api('process',{id:state.file.id,acquisitions:current.ids,signals:current.signals,...current.options});if(v!==version)return;current.result=result;render(result)}catch(error){if(v===version){$('eds-preview-error').textContent=error.message;$('eds-preview-error').hidden=false}}finally{if(v===version)$('eds-preview-busy').hidden=true}
 }
 function render(result){
  const root=$('eds-analysis-views');root.replaceChildren();
  if(current.kind==='map'&&result.normalisation!=='none'){const scale=el('div',undefined,'eds-scale');scale.append(el('span',String(result.low)),el('span',undefined,'eds-scale-bar'),el('span',`${result.high} · relative to ${({median:'median',mean:'mean',p20:'P20'})[result.normalisation]}`));root.append(scale)}
  for(const row of result.rows){const section=el('section',undefined,'eds-map-row');if(current.comparison)section.append(el('h3',row.label));root.append(section);
   if(row.kind==='map'){const tiles=el('div',undefined,'eds-map-tiles');section.append(tiles);if(current.comparison&&row.electron)imageTile(tiles,'Electron image',row.electron);for(const tile of row.tiles)imageTile(tiles,tile.label,tile.image,tile.colour)}
   else{for(const tile of row.tiles)lineTile(section,row,tile);section.append(el('p',`${row.length.toFixed(1)} ${row.distance_unit} · ${row.calibration}. Start → end, left to right.`,'hint'))}
  }
  $('eds-preview-note').textContent=result.note;
 }
 function imageTile(root,label,source,colour){const figure=el('figure',undefined,'eds-map-tile'),caption=el('figcaption',label),img=el('img');if(colour)caption.style.color=colour;img.src=source;img.alt=label;figure.append(caption,img);root.append(figure)}
 function lineTile(root,row,tile){
  const figure=el('figure',undefined,'eds-line-tile'),caption=el('figcaption',tile.label);caption.style.color=tile.colour;figure.append(caption);root.append(figure);
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),w=800,h=390,left=58,top=10,pw=725,ph=312;svg.setAttribute('viewBox',`0 0 ${w} ${h}`);svg.setAttribute('aria-label',`${tile.label} over scan image`);figure.append(svg);
  const add=(tag,attrs,text)=>{const n=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;svg.append(n);return n};
  if(current.options.background)add('image',{href:row.background,x:left,y:top,width:pw,height:ph,preserveAspectRatio:'none'});
  const X=x=>left+pw*(x/row.length+.035)/1.07,Y=y=>top+ph*(.36-.32*y/tile.maximum)/.46,baseline=Y(0);
  add('line',{x1:left,y1:baseline,x2:left+pw,y2:baseline,stroke:'#000','stroke-width':4});add('line',{x1:left,y1:baseline,x2:left+pw,y2:baseline,stroke:'#fff','stroke-width':1.5,'stroke-dasharray':'6 4'});add('circle',{cx:X(0),cy:baseline,r:4,fill:'#fff',stroke:'#000'});add('path',{d:`M${X(row.length)-10},${baseline-5} L${X(row.length)},${baseline} L${X(row.length)-10},${baseline+5}Z`,fill:'#fff',stroke:'#000'});
  if(current.options.normalisation!=='none'){add('line',{x1:X(0),x2:X(row.length),y1:Y(1),y2:Y(1),stroke:'#fff',opacity:.55,'stroke-width':1,'stroke-dasharray':'3 4'});add('text',{x:left+pw-5,y:Y(1)-5,fill:'#fff',stroke:'#000','stroke-width':2,'paint-order':'stroke','text-anchor':'end','font-size':11},`${({median:'Median',mean:'Mean',p20:'P20'})[current.options.normalisation]} = 1`)}
  const path=values=>{let d='',move=true;values.forEach((y,i)=>{if(y===null){move=true;return}d+=`${move?'M':'L'}${X(tile.x[i])},${Y(y)} `;move=false});return d};
  if(current.options.raw)add('path',{d:path(tile.raw),fill:'none',stroke:tile.colour,opacity:.25,'stroke-width':1});const d=path(tile.y);add('path',{d,fill:'none',stroke:'#fff','stroke-width':4,'stroke-linejoin':'round'});add('path',{d,fill:'none',stroke:tile.colour,'stroke-width':2,'stroke-linejoin':'round'});
  for(let i=0;i<=4;i++){const x=row.length*i/4;add('text',{x:X(x),y:top+ph+23,fill:'#becbda','text-anchor':'middle','font-size':12},x.toFixed(0));const y=tile.maximum*i/4;add('text',{x:left-7,y:Y(y)+4,fill:'#becbda','text-anchor':'end','font-size':12},Number(y.toPrecision(3)))}add('text',{x:left+pw/2,y:h-12,fill:'#becbda','text-anchor':'middle','font-size':13},`Distance from scan start, ${row.distance_unit}`);add('text',{x:left+5,y:top+16,fill:'#fff',stroke:'#000','stroke-width':2,'paint-order':'stroke','font-size':12},tile.unit);
  const cursor=add('line',{x1:X(0),x2:X(0),y1:top,y2:top+ph,stroke:'#fff','stroke-dasharray':'3 3',visibility:'hidden'}),readout=el('p','Hover along the scan to inspect values.','hint eds-plot-readout');figure.append(readout);
  svg.onpointermove=e=>{const box=svg.getBoundingClientRect(),sx=(e.clientX-box.left)*w/box.width,frac=((sx-left)/pw*1.07-.035),i=Math.max(0,Math.min(tile.x.length-1,Math.round(frac*(tile.x.length-1))));cursor.setAttribute('x1',X(tile.x[i]));cursor.setAttribute('x2',X(tile.x[i]));cursor.setAttribute('visibility','visible');readout.textContent=`${tile.x[i].toFixed(1)} ${row.distance_unit} · ${tile.y[i]===null?'No ratio':Number(tile.y[i].toPrecision(5))} ${tile.unit}`};svg.onpointerleave=()=>cursor.setAttribute('visibility','hidden');
 }
 return {open,close,groups};
};

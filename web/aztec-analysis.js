/* Live views of the existing EDX report operations. Native inputs stay read-only. */
window.createAztecAnalysis=({$,el,state,api,highlightRegions})=>{
 let current=null,version=0,smoothingTimer=null,plotObservers=[];
 const preferences={};
 function clearPlotObservers(){for(const observer of plotObservers)observer.disconnect();plotObservers=[]}
 function groups(){
  const found=new Map();for(const a of state.file?.catalogue.acquisitions||[])for(const l of a.layers)for(const d of l.signals){
   const table=d.path.split('/')[1],kind=table==='XrayMapImages'?'map':['XrayLinescans','QuantLinescans'].includes(table)?'line':null,id=d.attributes['Acquisition ID'];if(!kind||!id)continue;
   const key=id+':'+table;if(!found.has(key))found.set(key,{id,table,kind,label:[a.specimen,a.label,d.attributes.Acquisition].filter(Boolean).join(' / '),signals:[],paths:[]});const g=found.get(key);g.signals.push(d.attributes.Label);g.paths.push(d.path);
  }return [...found.values()].sort((a,b)=>(a.table==='QuantLinescans')-(b.table==='QuantLinescans'));
 }
 function close(){clearTimeout(smoothingTimer);clearPlotObservers();++version;current=null;$('eds-analysis-tools').hidden=true;$('eds-analysis-views').hidden=true;$('eds-preview').hidden=false}
 function open(id,comparison=false,channelTable){
  const available=groups(),chosen=available.find(g=>g.id===id&&(!channelTable||g.table===channelTable))||available.find(g=>g.kind==='map');if(!chosen)return;
  clearPlotObservers();
  ++state.previewVersion;const kind=comparison?'map':chosen.kind,all=available.filter(g=>g.kind===kind);
  const channelNames=[...new Set((comparison?all:[chosen]).flatMap(g=>g.signals))].sort((a,b)=>{const order=['Ti','V','Fe','Al'];const rank=x=>{const n=order.indexOf(x.split(' ')[0]);return n<0?99:n};return rank(a)-rank(b)||a.localeCompare(b)});
  const defaults={mode:kind==='map'?'both':'signal',denominator:channelNames.find(s=>s.startsWith('Ti '))||channelNames[0],normalisation:'none',smoothing:kind==='map'?1:10,brightness:1.5,low:.7,high:1.3,upper:.5,background:true,raw:false,layout:'stacked'};
  current={kind,table:chosen.table,all,comparison,ids:comparison?all.map(g=>g.id):[chosen.id],signals:channelNames,options:{...defaults,...preferences[kind],...(comparison?{mode:'both',normalisation:'median'}:{})}};
  if(!channelNames.includes(current.options.denominator))current.options.denominator=defaults.denominator;
  $('eds-dataset-title').textContent=comparison?'Map comparison':chosen.label;$('eds-dataset-info').textContent=kind==='map'?'Element maps':chosen.table==='QuantLinescans'?'Saved composition profiles · AZtec quantification':'';
  $('eds-preview').hidden=true;$('eds-preview').replaceChildren();$('eds-dataset-details').hidden=true;$('eds-preview-tools').hidden=true;$('eds-preview-note').textContent='';$('eds-preview-error').hidden=true;$('eds-analysis-tools').hidden=false;$('eds-analysis-views').hidden=false;$('eds-analysis-views').replaceChildren();
  if(comparison){state.dataset=null;highlightRegions()}else{state.dataset=state.file.catalogue.datasets.find(d=>d.attributes['Acquisition ID']===chosen.id&&/^\/(SmartLines|SmartMaps)\//.test(d.path))||state.file.catalogue.datasets.find(d=>chosen.paths.includes(d.path));highlightRegions()}
  controls(channelNames);update();
 }
 function controls(channels){
  const root=$('eds-analysis-tools');root.replaceChildren();const row=el('div',undefined,'eds-analysis-controls');root.append(row);
  const changed=key=>{updateVisibility();if(key==='layout'){preferences[current.kind]={...current.options};if(current.result)render(current.result)}else update()};
  const toggle=(label,key,choices)=>{const wrap=el('div',undefined,'eds-control');wrap.append(el('span',label));const group=el('div',undefined,'signal-toggle inspector-layout');group.setAttribute('role','group');group.setAttribute('aria-label',label);for(const [value,text] of choices){const b=el('button',text);b.type='button';b.setAttribute('aria-pressed',String(current.options[key]===value));b.onclick=()=>{current.options[key]=value;for(const n of group.children)n.setAttribute('aria-pressed',String(n===b));changed(key)};group.append(b)}wrap.append(group);row.append(wrap);return wrap};
  if(current.kind==='line')toggle('Plots','layout',[['stacked','Stacked'],['overlay','Overlay']]);
  toggle('View','mode',current.kind==='map'?[['signal','Signals'],['ratio','Ratios'],['both','Both']]:[['signal',current.table==='QuantLinescans'?'Composition':'Signals'],['ratio','Ratios']]);
  const denominator=el('label','Divide by'),denSelect=el('select');denSelect.setAttribute('aria-label','Divide by');for(const channel of channels){const option=el('option',channel);option.value=channel;denSelect.append(option)}denSelect.value=current.options.denominator;denSelect.onchange=()=>{current.options.denominator=denSelect.value;update()};denominator.append(denSelect);row.append(denominator);
  toggle('Normalize','normalisation',[['none','Off'],['median','Median'],['mean','Mean'],['p20','P20']]);
  const numeric=(label,key)=>{const wrap=el('label',label),input=el('input');input.type='number';input.step='any';input.min=key==='low'?'':0;input.value=current.options[key];input.setAttribute('aria-label',label);input.onchange=()=>{const v=Number(input.value);if(Number.isFinite(v)){current.options[key]=v;update()}};wrap.append(input);row.append(wrap);return wrap};
  const smoothing=el('label',current.kind==='map'?'Smoothing σ, px':'Smoothing FWHM, nm','eds-smoothing');
  const smoothingInputs=el('span',undefined,'eds-smoothing-inputs'),range=el('input'),amount=el('input');
  range.type='range';range.min='0';range.max=String(Math.max(current.kind==='map'?32:50,current.options.smoothing));range.step='.5';range.value=current.options.smoothing;range.setAttribute('aria-label','Smoothing');
  amount.type='number';amount.min='0';amount.step='.5';amount.value=current.options.smoothing;amount.setAttribute('aria-label','Smoothing value');
  const smoothChange=(value,immediate)=>{const n=Number(value);if(!Number.isFinite(n)||n<0)return;current.options.smoothing=n;range.max=String(Math.max(Number(range.max),n));range.value=n;amount.value=n;clearTimeout(smoothingTimer);++version;$('eds-preview-busy').hidden=false;if(immediate)update();else smoothingTimer=setTimeout(update,140)};
  range.oninput=()=>smoothChange(range.value,false);range.onchange=()=>smoothChange(range.value,true);amount.oninput=()=>smoothChange(amount.value,false);amount.onchange=()=>smoothChange(amount.value,true);
  smoothingInputs.append(range,amount);smoothing.append(smoothingInputs);row.append(smoothing);
  let brightness;
  if(current.kind==='map'){
   brightness=el('label','Map brightness ×','eds-smoothing');const inputs=el('span',undefined,'eds-smoothing-inputs'),slider=el('input'),value=el('input');
   slider.type='range';slider.min='.25';slider.max='8';slider.step='.05';slider.value=current.options.brightness;slider.setAttribute('aria-label','Map brightness');
   value.type='number';value.min='.25';value.max='8';value.step='.05';value.value=current.options.brightness;value.setAttribute('aria-label','Map brightness value');
   const brighten=n=>{n=Number(n);if(!Number.isFinite(n)||n<.25||n>8)return;current.options.brightness=n;slider.value=value.value=n;preferences[current.kind]={...current.options};applyMapBrightness()};
   slider.oninput=()=>brighten(slider.value);value.oninput=()=>brighten(value.value);value.onchange=()=>brighten(value.value);inputs.append(slider,value);brightness.append(inputs);row.append(brightness);
  }
  const low=numeric('Colour min','low'),high=numeric('Colour max','high'),upper=numeric('Ratio max','upper');
  const updateVisibility=()=>{denominator.hidden=current.options.mode==='signal';low.hidden=high.hidden=current.kind!=='map'||current.options.normalisation==='none';if(brightness)brightness.hidden=current.options.normalisation!=='none';upper.hidden=current.kind!=='line'||current.options.mode!=='ratio'||current.options.normalisation!=='none'};updateVisibility();
  const footer=el('div',undefined,'eds-analysis-options');root.append(footer);const picks=el('div',undefined,'eds-channel-picks');footer.append(picks);
  for(const signal of channels){const label=el('label'),input=el('input');input.type='checkbox';input.checked=true;input.onchange=()=>{current.signals=[...picks.querySelectorAll('input:checked')].map(n=>n.value);update()};input.value=signal;label.append(input,el('span',signal));picks.append(label)}
  if(current.kind==='line'){const options=el('div',undefined,'eds-channel-picks');const imageToggle=el('div',undefined,'signal-toggle inspector-layout'),imageButton=el('button','Image');imageButton.type='button';imageButton.setAttribute('aria-label','Show electron image');imageButton.setAttribute('aria-pressed',String(current.options.background));imageButton.onclick=()=>{current.options.background=!current.options.background;imageButton.setAttribute('aria-pressed',String(current.options.background));preferences[current.kind]={...current.options};if(current.result)render(current.result)};imageToggle.append(imageButton);options.append(imageToggle);for(const [key,text] of [['raw','Underlying data']]){const label=el('label'),input=el('input');input.type='checkbox';input.checked=current.options[key];input.onchange=()=>{current.options[key]=input.checked;preferences[current.kind]={...current.options};if(current.result)render(current.result)};label.append(input,el('span',text));options.append(label)}footer.append(options)}
  if(current.comparison){const details=el('details');details.open=true;details.append(el('summary','Maps'));const list=el('div',undefined,'eds-channel-picks');for(const group of current.all){const label=el('label'),input=el('input');input.type='checkbox';input.value=group.id;input.checked=true;input.onchange=()=>{current.ids=[...list.querySelectorAll('input:checked')].map(n=>n.value);update()};label.append(input,el('span',group.label));list.append(label)}details.append(list);root.append(details)}
  const help=el('span',undefined,'eds-analysis-help'),helpButton=el('button','ⓘ'),helpText=el('span','Signals are smoothed separately before division. Normalization divides each smoothed signal or ratio by its own median, mean or P20. In line views that reference value (1) lies on the physical scan path, at the centre of the image crop. Unnormalized traces use 0 on the scan path. Overlay uses one shared vertical scale for every channel. Map normalization excludes a 3σ rim. Smoothing is optional; sparse channels with a zero median need Mean or Off. Map brightness changes display only, leaving zero black and the electron image unchanged. Each unnormalized map keeps the intensity range of its unsmoothed data when smoothing changes. Normalized maps use Colour min/max instead. '+(current.table==='QuantLinescans'?'Composition values are saved AZtec quantification; ratios divide these values, not raw X-ray counts.':'Ratios are recorded signals, not concentrations.'),'eds-help-content');
  helpButton.type='button';helpButton.setAttribute('aria-label','Processing and plot help');helpButton.setAttribute('aria-expanded','false');helpButton.onclick=()=>helpButton.setAttribute('aria-expanded',String(helpButton.getAttribute('aria-expanded')!=='true'));helpButton.onkeydown=e=>{if(e.key==='Escape')helpButton.setAttribute('aria-expanded','false')};helpText.setAttribute('role','tooltip');help.append(helpButton,helpText);footer.append(help);

 }
 async function update(){
  clearTimeout(smoothingTimer);const v=++version;if(!current)return;preferences[current.kind]={...current.options};$('eds-preview-error').hidden=true;
  if(!current.ids.length||!current.signals.length){clearPlotObservers();current.result=null;$('eds-analysis-views').replaceChildren(el('p','Select an acquisition and at least one element.','hint'));$('eds-preview-busy').hidden=true;return}
  $('eds-preview-busy').hidden=false;
  try{const result=await api('process',{id:state.file.id,acquisitions:current.ids,signals:current.signals,channel_table:current.table,...current.options});if(v!==version)return;current.result=result;render(result)}catch(error){if(v===version){$('eds-preview-error').textContent=error.message;$('eds-preview-error').hidden=false}}finally{if(v===version)$('eds-preview-busy').hidden=true}
 }
 function render(result){
  clearPlotObservers();
  const root=$('eds-analysis-views');root.replaceChildren();
  if(current.kind==='map'&&result.normalisation!=='none'){const scale=el('div',undefined,'eds-scale');scale.append(el('span',String(result.low)),el('span',undefined,'eds-scale-bar'),el('span',`${result.high} · relative to ${({median:'median',mean:'mean',p20:'P20'})[result.normalisation]}`));root.append(scale)}
  for(const row of result.rows){const section=el('section',undefined,'eds-map-row');if(current.comparison)section.append(el('h3',row.label));root.append(section);
   if(row.kind==='map'){
    const tiles=el('div',undefined,'eds-map-tiles');section.append(tiles);if(current.comparison&&row.electron&&result.mode!=='both')imageTile(tiles,'Electron image',row.electron);
    for(const tile of row.tiles){const column=el('div',undefined,'eds-map-pair');tiles.append(column);imageTile(column,tile.label,tile.image,tile.colour,tile.error);if(result.mode==='both'){if(tile.ratio_label)imageTile(column,tile.ratio_label,tile.ratio_image,tile.colour,tile.ratio_error);else if(row.electron)imageTile(column,'Electron image',row.electron)}}
   }
   else linePlots(section,row,result)
  }
  applyMapBrightness();
  $('eds-preview-note').textContent=current.kind==='line'?'':result.note;
 }
 function imageTile(root,label,source,colour,error){const figure=el('figure',undefined,'eds-map-tile'),caption=el('figcaption',label);if(colour)caption.style.color=colour;figure.append(caption);if(error)figure.append(el('p',error,'eds-channel-error'));else{const img=el('img');img.src=source;img.alt=label;if(colour)img.dataset.intensityMap='';figure.append(img)}root.append(figure)}
 function applyMapBrightness(){const gain=current?.result?.normalisation==='none'?current.options.brightness:1;for(const img of $('eds-analysis-views').querySelectorAll('img[data-intensity-map]'))img.style.filter=`brightness(${gain})`}

 function linePlots(root,row,result){
  for(const tile of row.tiles.filter(t=>t.error))root.append(el('p',`${tile.label}: ${tile.error}`,'eds-channel-error'));row={...row,tiles:row.tiles.filter(t=>!t.error)};
  if(!row.tiles.length){root.append(el('p','Select an element other than the ratio denominator.','hint'));return}
  const display={...current.options},overlay=display.layout==='overlay',normalized=result.normalisation!=='none',baseline=normalized?1:0;
  const stack=el('div',undefined,`eds-line-plots${overlay?' eds-line-overlay':''}`);root.append(stack);
  const readout=el('p',`${row.length.toFixed(1)} ${row.distance_unit} · start → end`,'eds-line-readout');readout.title=row.calibration;root.append(readout);
  const normalLabel=({median:'Median',mean:'Mean',p20:'P20'})[result.normalisation];
  const rangeFor=tiles=>{
   if(!normalized&&result.mode==='ratio')return Math.max(...tiles.map(t=>t.maximum));
   // Underlying data is a display overlay; it must never change the plot scale.
   let delta=normalized?.2:1e-12;for(const tile of tiles)for(const value of tile.y)if(Number.isFinite(value))delta=Math.max(delta,Math.abs(value-baseline));return delta*1.12;
  };
  // Normalized panels share the same scale, so relative enrichment remains comparable.
  const sharedRange=normalized||overlay?rangeFor(row.tiles):null;
  const panels=overlay?[row.tiles]:row.tiles.map(t=>[t]);
  panels.forEach((tiles,index)=>{
   const figure=el('figure',undefined,'eds-line-tile');stack.append(figure);
   const caption=el('figcaption',undefined,'eds-line-caption');for(const tile of tiles){const label=el('span',tile.label);label.style.color=tile.colour;caption.append(label)}figure.append(caption);
   const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('role','img');svg.setAttribute('aria-label',`${tiles.map(t=>t.label).join(', ')} over centred scan image`);figure.append(svg);
   const range=sharedRange??rangeFor(tiles),showX=index===panels.length-1;
   const observer=new ResizeObserver(draw);plotObservers.push(observer);observer.observe(svg);
   function draw(){
    if(!svg.isConnected){observer.disconnect();return}
    svg.replaceChildren();const w=Math.max(150,svg.clientWidth),h=svg.clientHeight,left=w<400?40:48,right=8,top=4,bottom=showX?21:6,pw=Math.max(60,w-left-right),ph=h-top-bottom,centre=top+ph/2;
    svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
    const extent=row.image_extent||[-.035,1.035,-.23,.23],span=extent[1]-extent[0];
    const X=x=>left+pw*(x/row.length-extent[0])/span,Y=y=>centre-(y-baseline)*(ph/2-7)/range;
    const add=(tag,attrs,text,parent=svg)=>{const n=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;parent.append(n);return n};
    const clipId=`eds-line-clip-${index}`,defs=add('defs',{}),clip=add('clipPath',{id:clipId},undefined,defs);add('rect',{x:left,y:top,width:pw,height:ph},undefined,clip);const plot=add('g',{'clip-path':`url(#${clipId})`});
    if(display.background){const scale=pw/span;add('image',{href:row.background,x:left,y:centre+extent[2]*scale,width:pw,height:(extent[3]-extent[2])*scale,preserveAspectRatio:'xMidYMid meet'},undefined,plot)}
    add('line',{x1:left,y1:centre,x2:left+pw,y2:centre,stroke:'#000','stroke-width':3,opacity:.8},undefined,plot);
    add('line',{x1:left,y1:centre,x2:left+pw,y2:centre,stroke:'#fff','stroke-width':1,'stroke-dasharray':'5 4',opacity:.8},undefined,plot);
    add('circle',{cx:X(0),cy:centre,r:3,fill:'#fff',stroke:'#000'},undefined,plot);add('path',{d:`M${X(row.length)-7},${centre-4} L${X(row.length)},${centre} L${X(row.length)-7},${centre+4}Z`,fill:'#fff',stroke:'#000'},undefined,plot);
    const path=(tile,values)=>{let d='',move=true;values.forEach((y,i)=>{if(!Number.isFinite(y)){move=true;return}d+=`${move?'M':'L'}${X(tile.x[i])},${Y(y)} `;move=false});return d};
    if(display.raw)for(const tile of tiles){const d=path(tile,tile.raw);add('path',{d,fill:'none',stroke:'#07101b',opacity:.7,'stroke-width':2.5},undefined,plot);add('path',{d,fill:'none',stroke:tile.colour,opacity:.85,'stroke-width':1.2},undefined,plot)}
    for(const tile of tiles){const d=path(tile,tile.y);add('path',{d,fill:'none',stroke:'#fff',opacity:.9,'stroke-width':3.5,'stroke-linejoin':'round'},undefined,plot);add('path',{d,fill:'none',stroke:tile.colour,'stroke-width':2,'stroke-linejoin':'round'},undefined,plot)}
    const fmt=v=>Number(v.toPrecision(3)).toString();for(const value of [baseline+range,baseline,baseline-range])if(value>=0)add('text',{x:left-5,y:Y(value)+3,fill:'#becbda','text-anchor':'end','font-size':10},fmt(value));
    if(showX){for(let i=0;i<=4;i++){const x=row.length*i/4;add('text',{x:X(x),y:h-5,fill:'#becbda','text-anchor':'middle','font-size':10},`${x.toFixed(0)}${i===4?' '+row.distance_unit:''}`)}}
    add('text',{x:left+5,y:top+11,fill:'#fff',stroke:'#000','stroke-width':2,'paint-order':'stroke','font-size':10},normalized?`${normalLabel} = 1 on scan`:tiles[0].unit);
    const cursor=add('line',{x1:X(0),x2:X(0),y1:top,y2:top+ph,stroke:'#fff','stroke-dasharray':'3 3',visibility:'hidden'});
    svg.onpointermove=e=>{const box=svg.getBoundingClientRect(),sx=(e.clientX-box.left)*w/box.width,frac=(sx-left)/pw*span+extent[0],i=Math.max(0,Math.min(tiles[0].x.length-1,Math.round(frac*(tiles[0].x.length-1))));cursor.setAttribute('x1',X(tiles[0].x[i]));cursor.setAttribute('x2',X(tiles[0].x[i]));cursor.setAttribute('visibility','visible');readout.textContent=`${tiles[0].x[i].toFixed(1)} ${row.distance_unit} · `+tiles.map(t=>`${t.label}: ${Number.isFinite(t.y[i])?fmt(t.y[i]):'—'}`).join(' · ')};svg.onpointerleave=()=>cursor.setAttribute('visibility','hidden');
   }
   draw();
  });
 }

 return {open,close,groups};
};

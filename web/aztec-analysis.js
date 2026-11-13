/* Shared line view geometry; source coordinates and sampled arrays stay unchanged. */
window.aztecLineGeometry={
 ranges(rows,options){
  const valid=rows.filter(r=>r.length>0&&!r.error),compatible=new Set(valid.map(r=>r.distance_unit)).size===1;
  const shortest=valid.length?Math.min(...valid.map(r=>r.length)):0,equal=compatible&&options.trim_mode==='equal';
  const requested=Number(options.trim_length),length=equal?Math.min(shortest,requested>0?requested:shortest):0;
  return Object.fromEntries(valid.map(r=>{const size=equal?length:r.length,offset=equal?Math.max(0,Math.min(r.length-size,Number(options.line_offsets?.[r.acquisition])||0)):0;return [r.acquisition,{start:offset,length:size,trimmed:equal}]}));
 },
 reference(row,orientation){
  const width=1000,height=width/(row.electron_aspect||1),[a,b]=row.line_points.map(([x,y])=>[x*width,y*height]);
  const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),turn=orientation==='right'?((Math.round(-Math.atan2(dy,dx)/(Math.PI/2))%4)+4)%4:0;
  const point=([x,y])=>turn===1?[height-y,x]:turn===2?[width-x,height-y]:turn===3?[y,width-x]:[x,y];
  const crop=extent=>[[extent[0],extent[2]],[extent[1],extent[2]],[extent[1],extent[3]],[extent[0],extent[3]]].map(([u,v])=>point([a[0]+dx*u-dy*v,a[1]+dy*u+dx*v]));
  return {width:turn%2?height:width,height:turn%2?width:height,nativeWidth:width,nativeHeight:height,turn,point,crop,a:point(a),b:point(b),length,transform:['','translate('+height+' 0) rotate(90)','translate('+width+' '+height+') rotate(180)','translate(0 '+width+') rotate(270)'][turn]};
 }
};
/* Comparisons belong to the workspace, not to whichever file is being inspected. */
window.aztecComparisonState={
 key:table=>'compare:'+table,
 identity:(source,id)=>JSON.stringify([source,id]),
 target(id,source=''){try{const pair=JSON.parse(id);if(Array.isArray(pair)&&pair.length===2)return {source:pair[0],acquisition:pair[1]}}catch{}return {source,acquisition:id}},
 migrate(saved,preferredSource=''){
  if(saved.comparisonScope===2)return saved;
  const result=structuredClone(saved),object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  for(const key of ['preferences','selections','presets','aliases','crops'])result[key]=object(result[key]);
  const keys=[...new Set([...Object.keys(result.selections),...Object.keys(result.presets),...Object.keys(result.preferences)])]
   .map(key=>({key,match:key.match(/^compare-(.*):(XrayMapImages|XrayLinescans|QuantLinescans)$/)})).filter(x=>x.match)
   .sort((a,b)=>(b.match[1]===preferredSource)-(a.match[1]===preferredSource));
  for(const {key,match:[,source,table]} of keys){
   const destination=this.key(table),qualify=id=>{const ref=this.target(id,source);return this.identity(ref.source,ref.acquisition)};
   const convert=item=>{
    const copy=structuredClone(item),ids=item.ids||[];copy.ids=ids.map(qualify);
    copy.files=[...new Set([...(item.files||[]),...ids.map(id=>this.target(id,source).source)])];
    for(const field of ['aliases','crops'])copy[field]=Object.fromEntries(Object.entries(item[field]||{}).map(([id,value])=>[qualify(id),value]));
    if(copy.options?.line_offsets)copy.options.line_offsets=Object.fromEntries(Object.entries(copy.options.line_offsets).map(([id,value])=>[qualify(id),value]));
    return copy;
   };
   if(!result.selections[destination]&&result.selections[key]){
    const item=convert({...result.selections[key],options:result.preferences[key]||{}});
    result.selections[destination]={ids:item.ids,files:item.files,signals:item.signals};result.preferences[destination]=item.options;
    for(const id of result.selections[key].ids||[])for(const field of ['aliases','crops']){
     const value=result[field][source+':'+id];if(value!==undefined)result[field]['compare:'+qualify(id)]=value;
    }
   }
   const items=result.presets[destination]||[];result.presets[destination]=items;
   for(const original of result.presets[key]||[]){
    const item=convert(original),name=item.name;let suffix=1;
    while(items.some(p=>p.name===item.name))item.name=`${name} (${source.split(/[\\/]/).pop()}${suffix++>1?' · '+(suffix-1):''})`;
    items.push(item);
   }
   delete result.selections[key];delete result.preferences[key];delete result.presets[key];
  }
  result.comparisonScope=2;return result;
 }
};
/* Live views of the existing EDX report operations. Native inputs stay read-only. */
window.createAztecAnalysis=({$,el,state,api,highlightRegions,setLineCrop,setLineCursor,setMapCursor,remember})=>{
 let current=null,version=0,smoothingTimer=null,plotObservers=[],plotSerial=0,referenceCursors=[],layoutVersion=0;
 let savedViews={};try{const saved=JSON.parse(WorkbenchWorkspace.readRaw('tem-eds-comparison-v1')||'{}');if(saved&&typeof saved==='object')savedViews=saved}catch{}
 let previousFile='';try{previousFile=JSON.parse(WorkbenchWorkspace.readRaw('tem-eds-browser')||'{}').file||''}catch{}
 const comparisonState=window.aztecComparisonState;savedViews=comparisonState.migrate(savedViews,previousFile);
 const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 const preferences=object(savedViews.preferences),selections=object(savedViews.selections),cropCentres=new Map(Object.entries(object(savedViews.crops))),aliases=object(savedViews.aliases),presets=object(savedViews.presets),structureCache=new Map();
 let persistTimer=null,openVersion=0;
 const catalogues=new Map(),sourceErrors=new Map();
 const projectKey=()=>state.file?.catalogue.source.path||'';
 const target=id=>comparisonState.target(id,projectKey());
 const viewKey=table=>comparisonState.key(table);
 const itemKey=id=>current?.comparison?'compare:'+id:projectKey()+':'+id;
 const acquisitionRequest=(context,ids=context.ids)=>context.comparison?{targets:ids.map(target)}:{acquisitions:ids};
 const fileName=path=>path.split(/[\\/]/).pop();
 const channelNamesFor=all=>[...new Set(all.flatMap(g=>g.signals))].sort((a,b)=>{const order=['Ti','V','Fe','Al'],rank=x=>{const n=order.indexOf(x.split(' ')[0]);return n<0?99:n};return rank(a)-rank(b)||a.localeCompare(b)});
 function persist(){
  if(current){preferences[current.preferenceKey]={...current.options};selections[current.preferenceKey]={ids:[...current.ids],signals:[...current.signals],files:[...(current.files||[])]}}
  clearTimeout(persistTimer);
  try{WorkbenchWorkspace.writeRaw('tem-eds-comparison-v1',JSON.stringify({comparisonScope:2,preferences,selections,aliases,presets,crops:Object.fromEntries([...cropCentres].slice(-200))}))}
  catch(error){console.warn('AZtec comparison settings could not be saved:',error.message)}
 }
 function imageScaleAvailability(result){
  const control=$('eds-analysis-tools').querySelector('[aria-label="Image scale"]');if(!control)return;
  const rows=result?.rows.filter(r=>r.width>0&&r.height>0)||[],first=rows[0];
  const different=rows.some(r=>r.distance_unit!==first.distance_unit||Math.abs(r.width-first.width)>1e-5*Math.max(r.width,first.width)||Math.abs(r.height-first.height)>1e-5*Math.max(r.height,first.height));
  for(const b of control.querySelectorAll('button'))b.disabled=!different;
  control.title=different?'':'Selected maps have the same field size.';
 }
 let structureQueue=Promise.resolve();
 function navigation(kind=null){
  state.comparisonKind=kind;
  $('eds-status').hidden=!!kind;
  $('eds-compare').setAttribute('aria-pressed',String(kind==='map'));
  $('eds-compare-lines').setAttribute('aria-pressed',String(kind==='line'));
  for(const button of $('eds-acquisitions').querySelectorAll('.eds-site'))button.setAttribute('aria-current',String(!kind&&button.dataset.index===String(state.acquisition?.index)));
 }
 function clearPlotObservers(){for(const observer of plotObservers)observer.disconnect();plotObservers=[];referenceCursors=[];setLineCursor(null);setMapCursor(null)}
 function groups(catalogue=state.file?.catalogue){
  const found=new Map();for(const a of catalogue?.acquisitions||[])for(const l of a.layers)for(const d of l.signals){
   const table=d.path.split('/')[1],kind=table==='XrayMapImages'?'map':['XrayLinescans','QuantLinescans'].includes(table)?'line':null,id=d.attributes['Acquisition ID'];if(!kind||!id)continue;
   const key=id+':'+table;if(!found.has(key))found.set(key,{id,table,kind,sample:a.specimen||a.label,site:[a.specimen,a.label].filter(Boolean).join(' / '),name:d.attributes.Acquisition,label:[a.specimen,a.label,d.attributes.Acquisition].filter(Boolean).join(' / '),signals:[],paths:[]});const g=found.get(key);g.signals.push(d.attributes.Label);g.paths.push(d.path);
  }return [...found.values()].sort((a,b)=>(a.table==='QuantLinescans')-(b.table==='QuantLinescans'));
 }
 function comparisonGroups(paths){return paths.flatMap(source=>(catalogues.has(source)?groups(catalogues.get(source)):[]).map(g=>({...g,id:comparisonState.identity(source,g.id),source,site:fileName(source)+' / '+g.site,label:fileName(source)+' / '+g.label}))) }
 async function loadCatalogue(path){if(catalogues.has(path))return;try{catalogues.set(path,await api('comparison-catalogue',{path}));sourceErrors.delete(path)}catch(error){sourceErrors.set(path,error.message)}}
 function close(){navigation();document.querySelector('.eds-content-layout').classList.remove('eds-comparing');$('eds-file').classList.remove('eds-file-comparing');clearTimeout(smoothingTimer);clearPlotObservers();setLineCrop(null);++openVersion;++version;++layoutVersion;current=null;state.analysisGroup=null;$('eds-analysis-tools').hidden=true;$('eds-analysis-views').hidden=true;$('eds-analysis-views').style.minHeight='';$('eds-preview').hidden=false}
 async function open(id,comparison=false,channelTable){
  const turn=++openVersion,source=projectKey();clearTimeout(smoothingTimer);++version;current=null;
  if(!comparison){show(id,false,channelTable);return}
  if(state.file?.catalogue.file_type==='OIPX')catalogues.set(source,state.file.catalogue);
  const kind=comparison===true?'map':comparison,table=channelTable||(kind==='map'?'XrayMapImages':'XrayLinescans');
  const key=viewKey(table),selection=selections[key],initialFiles=state.file?.catalogue.file_type==='OIPX'?[source]:[];
  const files=[...new Set([...(selection?.files||initialFiles),...(selection?.ids||[]).map(id=>target(id).source)])];
  $('eds-empty').hidden=true;$('eds-file').hidden=false;
  $('eds-preview-busy').hidden=false;
  await Promise.allSettled(files.map(loadCatalogue));
  if(turn!==openVersion||source!==projectKey())return;
  show(id,comparison,table,files);
 }
 function show(id,comparison=false,channelTable,files=[]){
  const available=comparison?comparisonGroups(files):groups(),compareKind=comparison===true?'map':comparison;
  const chosen=comparison?(available.find(g=>g.kind===compareKind&&(!channelTable||g.table===channelTable))||{kind:compareKind,table:channelTable,signals:[]}):available.find(g=>g.id===id&&(!channelTable||g.table===channelTable));if(!chosen){$('eds-preview-error').textContent='No viewable element channels for this acquisition.';$('eds-preview-error').hidden=false;return}
  clearPlotObservers();document.querySelector('.eds-content-layout').classList.toggle('eds-comparing',!!comparison);$('eds-file').classList.toggle('eds-file-comparing',!!comparison);
  ++state.previewVersion;const kind=chosen.kind,all=available.filter(g=>g.kind===kind&&g.table===chosen.table);
  navigation(comparison?kind:null);
  const channelNames=channelNamesFor(comparison?all:[chosen]);
  const preferenceKey=comparison?viewKey(chosen.table):projectKey()+':'+chosen.table,selection=selections[preferenceKey];
  const defaults={mode:kind==='map'?(comparison?'ratio':'both'):'signal',denominator:channelNames.find(s=>s.startsWith('Ti '))||channelNames[0],normalisation:'none',smoothing:kind==='map'?1:10,smoothing_unit:comparison?'nm':'px',brightness:1.5,low:.7,high:1.3,upper:.5,background:true,raw:false,layout:'stacked',spatial:'physical',scale_scope:'element',show_denominator:true,reference_orientation:'native',trim_mode:'full',trim_length:null,line_offsets:{}};
  current={kind,table:chosen.table,all,files,comparison:!!comparison,preferenceKey,ids:comparison?(selection?.ids||all.slice(0,2).map(g=>g.id)):[chosen.id],signals:comparison&&selection?(selection.signals||channelNames):channelNames,options:{...defaults,...preferences[preferenceKey]}};
  if(!channelNames.includes(current.options.denominator))current.options.denominator=defaults.denominator;
  $('eds-dataset-title').textContent=comparison?(kind==='map'?'Map comparison':'Line comparison'):chosen.label;$('eds-dataset-info').textContent=kind==='map'?'Element maps':chosen.table==='QuantLinescans'?'Saved composition profiles · AZtec quantification':'';
  $('eds-preview').hidden=true;$('eds-preview').replaceChildren();$('eds-dataset-details').hidden=true;$('eds-preview-tools').hidden=true;$('eds-preview-note').textContent='';$('eds-preview-error').hidden=true;$('eds-analysis-tools').hidden=false;$('eds-analysis-views').hidden=false;$('eds-analysis-views').replaceChildren();
  state.analysisGroup=comparison?null:chosen.id+':'+chosen.table;
  if(comparison){state.dataset=null;highlightRegions()}else{state.dataset=state.file.catalogue.datasets.find(d=>d.attributes['Acquisition ID']===chosen.id&&/^\/(SmartLines|SmartMaps)\//.test(d.path))||state.file.catalogue.datasets.find(d=>chosen.paths.includes(d.path));highlightRegions()}
  state.comparisonTable=comparison?chosen.table:null;remember();controls(channelNames);imageScaleAvailability();update();
 }
 function controls(channels){
  const root=$('eds-analysis-tools');root.replaceChildren();if(current.comparison)presetControls(root);const row=el('div',undefined,'eds-analysis-controls');root.append(row);
  const changed=key=>{if(key==='smoothing_unit')smoothing.firstChild.textContent=`Smoothing σ, ${current.options.smoothing_unit}`;keepScroll(updateVisibility);if(['layout','spatial','reference_orientation','trim_mode'].includes(key)){persist();if(current.result)render(current.result)}else update()};
  const toggle=(label,key,choices)=>{const wrap=el('div',undefined,'eds-control');wrap.append(el('span',label));const group=el('div',undefined,'signal-toggle inspector-layout');group.setAttribute('role','group');group.setAttribute('aria-label',label);for(const [value,text] of choices){const b=el('button',text);b.type='button';b.setAttribute('aria-pressed',String(current.options[key]===value));b.onclick=()=>{current.options[key]=value;for(const n of group.children)n.setAttribute('aria-pressed',String(n===b));changed(key)};group.append(b)}wrap.append(group);row.append(wrap);return wrap};
  if(current.comparison&&current.kind==='line'&&comparisonGroups(current.files).some(g=>g.table==='QuantLinescans')){const family=el('div',undefined,'eds-control');family.append(el('span','Profiles'));const buttons=el('div',undefined,'signal-toggle inspector-layout');for(const [table,label] of [['XrayLinescans','Intensity'],['QuantLinescans','Composition']]){const button=el('button',label);button.type='button';button.setAttribute('aria-pressed',String(current.table===table));button.disabled=!comparisonGroups(current.files).some(g=>g.table===table);button.onclick=()=>{const key=viewKey(table);selections[key]={...(selections[key]||{}),files:[...current.files]};open(null,'line',table)};buttons.append(button)}family.append(buttons);row.append(family)}
  if(current.kind==='line')toggle('Plots','layout',current.comparison?[['stacked','Stacked'],['elements','Overlay elements'],['overlay','Overlay scans']]:[['stacked','Stacked'],['overlay','Overlay']]);
  if(current.comparison&&current.kind==='line'){toggle('Reference image','reference_orientation',[['native','Original'],['right','Arrow right']]);toggle('Scan length','trim_mode',[['full','Full'],['equal','Equal']])}
  toggle('View','mode',current.kind==='map'?[['signal','Signals'],['ratio','Ratios'],['both','Both']]:[['signal',current.table==='QuantLinescans'?'Composition':'Signals'],['ratio','Ratios']]);
  const denominator=el('label','Divide by'),denSelect=el('select');denSelect.setAttribute('aria-label','Divide by');for(const channel of channels){const option=el('option',channel);option.value=channel;denSelect.append(option)}denSelect.value=current.options.denominator;denSelect.onchange=()=>{current.options.denominator=denSelect.value;updateVisibility();update()};denominator.append(denSelect);row.append(denominator);
  if(current.comparison)toggle('Shared scales','scale_scope',[['all','All'],['element','Per Element'],['off','Off']]);
  toggle(current.comparison?'Normalize each acquisition':'Normalize','normalisation',[['none','Off'],['median','Median'],['mean','Mean'],['p20','P20']]);
  const numeric=(label,key)=>{const wrap=el('label',label),input=el('input');input.type='number';input.step='any';input.min=key==='low'?'':0;input.value=current.options[key];input.setAttribute('aria-label',label);input.onchange=()=>{const v=Number(input.value);if(Number.isFinite(v)){current.options[key]=v;update()}};wrap.append(input);row.append(wrap);return wrap};
  if(current.comparison&&current.kind==='map'){toggle('Image scale','spatial',[['physical','Equal distance'],['fit','Fit tiles'],['crop','Crop tiles']]);toggle('Smoothing units','smoothing_unit',[['nm','nm'],['px','px']])}
  const smoothing=el('label',current.kind==='map'?`Smoothing σ, ${current.options.smoothing_unit}`:'Smoothing FWHM, nm','eds-smoothing');
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
   const brighten=n=>{n=Number(n);if(!Number.isFinite(n)||n<.25||n>8)return;current.options.brightness=n;slider.value=value.value=n;persist();applyMapBrightness()};
   slider.oninput=()=>brighten(slider.value);value.oninput=()=>brighten(value.value);value.onchange=()=>brighten(value.value);inputs.append(slider,value);brightness.append(inputs);row.append(brightness);
  }
  const low=numeric('Colour min','low'),high=numeric('Colour max','high'),upper=numeric('Ratio max','upper');
  const colourActions=el('div',undefined,'eds-colour-actions'),autoColour=el('button','Auto'),resetColour=el('button','↺');
  autoColour.type=resetColour.type='button';autoColour.title='Set shared limits from the current maps’ 5th–95th percentiles, symmetric around 1.';resetColour.setAttribute('aria-label','Reset colour limits');resetColour.title='Reset colour limits to 0.7–1.3';colourActions.append(autoColour,resetColour);row.append(colourActions);
  const setColourLimits=limits=>{if(!limits)return;[current.options.low,current.options.high]=limits;low.querySelector('input').value=limits[0];high.querySelector('input').value=limits[1];update()};
  autoColour.onclick=()=>{const limits=current.result?.suggested_colour_limits;if(limits)setColourLimits([Math.floor(limits[0]*100)/100,Math.ceil(limits[1]*100)/100])};
  resetColour.onclick=()=>setColourLimits([.7,1.3]);
  const updateVisibility=()=>{
   colourActions.hidden=current.kind!=='map'||current.options.normalisation==='none'||current.comparison&&current.options.scale_scope==='off';
   denominator.hidden=current.options.mode==='signal';low.hidden=high.hidden=current.kind!=='map'||current.options.normalisation==='none'||current.comparison&&current.options.scale_scope==='off';if(brightness)brightness.hidden=current.options.normalisation!=='none';upper.hidden=current.kind!=='line'||current.options.mode!=='ratio'||current.options.normalisation!=='none'||current.comparison&&current.options.scale_scope==='off';
   for(const input of picks.querySelectorAll('input')){const denominatorPick=current.options.mode==='ratio'&&input.value===current.options.denominator;input.disabled=denominatorPick&&current.kind!=='map';input.checked=denominatorPick?(current.kind==='map'&&current.options.show_denominator):current.signals.includes(input.value);input.parentElement.classList.toggle('eds-channel-inactive',input.disabled);input.parentElement.title=input.disabled?(current.comparison&&current.kind==='map'?'Denominator; shown as the reference signal.':'Used as the denominator; not plotted against itself.'):''}
  };
  const footer=el('div',undefined,'eds-analysis-options');root.append(footer);const picks=el('div',undefined,'eds-channel-picks');footer.append(picks);
  for(const signal of channels){const label=el('label'),input=el('input');input.type='checkbox';input.checked=true;input.onchange=()=>{if(current.kind==='map'&&current.options.mode==='ratio'&&signal===current.options.denominator)current.options.show_denominator=input.checked;else current.signals=input.checked?[...current.signals,signal]:current.signals.filter(s=>s!==signal);update()};input.value=signal;label.append(input,el('span',signal));picks.append(label)}
  updateVisibility();
  if(current.kind==='line'){const options=el('div',undefined,'eds-channel-picks');const imageToggle=el('div',undefined,'signal-toggle inspector-layout'),imageButton=el('button','Image');imageButton.type='button';imageButton.setAttribute('aria-label','Show electron image');imageButton.setAttribute('aria-pressed',String(current.options.background));imageButton.onclick=()=>{current.options.background=!current.options.background;imageButton.setAttribute('aria-pressed',String(current.options.background));persist();if(current.result)render(current.result)};imageToggle.append(imageButton);options.append(imageToggle);for(const [key,text] of [['raw','Underlying data']]){const label=el('label'),input=el('input');input.type='checkbox';input.checked=current.options[key];input.onchange=()=>{current.options[key]=input.checked;persist();if(current.result)render(current.result)};label.append(input,el('span',text));options.append(label)}footer.append(options)}
  if(current.comparison){
   sourceControls(root);
   const details=el('details',undefined,'eds-comparison-selection');details.open=true;
   const summary=el('summary',`Acquisitions · ${current.ids.length} selected`);details.append(summary);
   const list=el('div',undefined,'eds-acquisition-picks');const sites=new Map();
   for(const group of current.all){if(!sites.has(group.source+'|'+group.site)){const section=el('div');const heading=el('strong',group.site);heading.title=group.source+' / '+group.site;section.append(heading);list.append(section);sites.set(group.source+'|'+group.site,section)}const label=el('label'),input=el('input');input.type='checkbox';input.value=group.id;input.checked=current.ids.includes(group.id);input.setAttribute('aria-label',group.label);input.onchange=()=>{current.ids=input.checked?[...current.ids,group.id]:current.ids.filter(id=>id!==group.id);summary.textContent=`Acquisitions · ${current.ids.length} selected`;update()};label.append(input,el('span',group.name));sites.get(group.source+'|'+group.site).append(label)}details.append(list);root.append(details);
  }
  if(current.comparison&&current.kind==='line')lineTrimControls(root);
  exportControls(root,footer);
  const help=el('span',undefined,'eds-analysis-help'),helpButton=el('button','ⓘ'),helpText=el('span',(current.comparison?'All links colour or plot limits across selected quantities with compatible units. Per Element links each quantity across acquisitions. Normalized maps use the explicit Colour min/max for either linked setting. Off uses each acquisition’s own range; normalized maps then use a symmetric 1st–99th percentile range around 1. Stacked keeps each element separate within each acquisition. Overlay elements puts selected elements together, one plot per acquisition. Overlay scans compares acquisitions, one plot per element. Traces in an overlay always share one axis. Distance scales stay linked. Normalization independently divides each acquisition by its own baseline. Equal distance preserves field sizes; Fit tiles fits whole images; Crop tiles shows a common field of view; drag any tile to pan all channels from that acquisition, or use arrow keys. Centre crop resets the position. Scale bars describe the displayed magnification. ':'')+'Channels are smoothed before division. Median, Mean or P20 become 1 on the line path; Off places 0 there. Underlying data only changes trace visibility. Map exposure uses unsmoothed P99, fixed while smoothing changes; Linked scales use the largest reference in the selected scale group. Near-empty ratio denominators fade below 10% of their map mean, a display safeguard rather than confidence. Normalized maps use Colour min/max unless independent comparison scales are selected. '+(current.table==='QuantLinescans'?'Composition profiles are saved AZtec quantification.':'Ratios describe recorded signals, not concentration.'),'eds-help-content');
  helpButton.type='button';helpButton.setAttribute('aria-label','Processing and plot help');helpButton.setAttribute('aria-expanded','false');helpButton.onclick=()=>helpButton.setAttribute('aria-expanded',String(helpButton.getAttribute('aria-expanded')!=='true'));helpButton.onkeydown=e=>{if(e.key==='Escape')helpButton.setAttribute('aria-expanded','false')};helpText.setAttribute('role','tooltip');help.append(helpButton,helpText);footer.append(help);
  for(const input of root.querySelectorAll('input,select,button')){const group=input.closest('[role=group]')?.getAttribute('aria-label'),label=input.getAttribute('aria-label')||input.closest('label')?.textContent||input.textContent;input.dataset.diagnosticControl=`aztec.${current.kind}.${group?group+': ':''}${label.trim()}`}


 }
 function lineTrimControls(root){
  const controls=el('div',undefined,'eds-line-trimming');controls.hidden=true;
  const lengthLabel=el('label'),text=el('span','Length'),input=el('input');input.type='number';input.min='.001';input.step='any';input.setAttribute('aria-label','Common scan length');lengthLabel.append(text,input);controls.append(lengthLabel);
  const reset=el('button','Shortest scan');reset.type='button';controls.append(reset);
  const note=el('span','Smoothing and normalization use the full scan. PNG and selected-data exports use the chosen segment.','hint');controls.append(note);
  const positions=el('div',undefined,'eds-trim-positions');controls.append(positions);root.append(controls);
  input.oninput=input.onchange=()=>{const value=Number(input.value);if(!(value>0))return;current.options.trim_length=Math.min(Number(input.max),value);persist();if(current.result)render(current.result)};
  reset.onclick=()=>{current.options.trim_length=null;persist();if(current.result)render(current.result)};
 }
 function updateLineTrimControls(result){
  const controls=$('eds-analysis-tools').querySelector('.eds-line-trimming');if(!controls)return;
  const rows=result.rows.filter(r=>r.length>0&&!r.error),compatible=rows.length>0&&new Set(rows.map(r=>r.distance_unit)).size===1;
  controls.hidden=current.options.trim_mode!=='equal'||!compatible;
  const toggle=$('eds-analysis-tools').querySelector('[aria-label="Scan length"]');if(toggle)toggle.querySelectorAll('button').forEach(b=>b.disabled=!compatible);
  if(controls.hidden)return;
  const ranges=window.aztecLineGeometry.ranges(rows,current.options),shortest=Math.min(...rows.map(r=>r.length));
  const input=controls.querySelector('[aria-label="Common scan length"]');input.max=shortest;if(document.activeElement!==input)input.value=Number(ranges[rows[0].acquisition].length.toFixed(3));controls.querySelector('label > span').textContent='Length, '+rows[0].distance_unit;
  const positions=controls.querySelector('.eds-trim-positions'),key=rows.map(r=>r.acquisition).join('|');
  if(positions.dataset.rows!==key){positions.dataset.rows=key;positions.replaceChildren();for(const row of rows){
   const wrap=el('label'),heading=el('span',row.short_label||row.label);heading.title=row.label;wrap.append(heading);wrap.dataset.acquisition=row.acquisition;
   const slider=el('input'),number=el('input');slider.type='range';number.type='number';for(const field of [slider,number]){field.min='0';field.step='.1';field.setAttribute('aria-label','Trim start for '+row.label)}
   slider.setAttribute('aria-label','Trim position for '+row.label);
   const move=raw=>{const value=Number(raw);if(!Number.isFinite(value))return;const start=Math.max(0,Math.min(Number(slider.max),value));current.options.line_offsets={...current.options.line_offsets,[row.acquisition]:start};persist();if(current.result)render(current.result)};
   slider.oninput=()=>move(slider.value);number.oninput=number.onchange=()=>move(number.value);wrap.append(slider,number);positions.append(wrap);
  }}
  for(const row of rows){const fields=[...positions.children].find(n=>n.dataset.acquisition===row.acquisition).querySelectorAll('input'),range=ranges[row.acquisition];for(const field of fields){field.max=Math.max(0,row.length-range.length);if(field.type==='range'||document.activeElement!==field)field.value=Number(range.start.toFixed(3));field.disabled=row.length-range.length<.001}}
 }
 function sourceControls(root){
  const context=current,details=el('details',undefined,'eds-comparison-selection eds-source-selection');details.open=context.sourcePickerOpen??!context.all.length;
  const summary=el('summary',`Project files · ${context.files.length}`),list=el('div',undefined,'eds-source-picks'),status=el('p',undefined,'hint');
  const refresh=el('button','Rescan projects');refresh.type='button';
  details.append(summary,list,refresh,status);root.append(details);
  let discovered=[],scanned=false;
  function draw(){
   list.replaceChildren();
   const paths=[...new Set([...context.files,...discovered.map(f=>f.path)])];
   for(const path of paths){
    const file=discovered.find(f=>f.path===path),label=el('label'),input=el('input'),caption=el('span',file?`${file.project} / ${file.relative_path}`:fileName(path));
    input.type='checkbox';input.checked=context.files.includes(path);input.setAttribute('aria-label','Include '+path);caption.title=path;label.append(input,caption);list.append(label);
    if(sourceErrors.has(path)){const error=el('span',sourceErrors.get(path),'eds-channel-error');label.append(error)}
    input.onchange=async()=>{
     const include=input.checked;input.disabled=true;status.textContent=include?'Reading file contents…':'';++version;
     if(include){catalogues.delete(path);await loadCatalogue(path)}
     if(current!==context)return;
     if(include&&sourceErrors.has(path)){input.checked=false;input.disabled=false;status.textContent=sourceErrors.get(path);update();return}
     const oldChannels=channelNamesFor(context.all);
     context.files=include?[...context.files,path]:context.files.filter(p=>p!==path);
     context.all=comparisonGroups(context.files).filter(g=>g.kind===context.kind&&g.table===context.table);
     if(include){const first=context.all.find(g=>g.source===path);if(first&&!context.ids.includes(first.id)&&context.ids.length<32)context.ids.push(first.id)}
     else context.ids=context.ids.filter(id=>target(id).source!==path);
     const channels=channelNamesFor(context.all);context.signals=[...new Set([...context.signals,...channels.filter(s=>!oldChannels.includes(s))])];
     if(!context.options.denominator&&channels.length)context.options.denominator=channels.find(s=>s.startsWith('Ti '))||channels[0];
     context.sourcePickerOpen=true;persist();keepScroll(()=>controls(channels));update();
    };
   }
  }
  async function scan(){
   refresh.disabled=true;status.textContent='Scanning configured projects…';
   try{const result=await api('files',{});if(current!==context)return;discovered=result.files.filter(f=>f.kind==='OIPX');scanned=true;draw();status.textContent=result.errors?.length?result.errors.join(' · '):discovered.length?'':'No other native OIPX files found in configured projects.'}
   catch(error){status.textContent=error.message}finally{refresh.disabled=false}
  }
  details.ontoggle=()=>{context.sourcePickerOpen=details.open;if(details.open&&!scanned&&!refresh.disabled)scan()};refresh.onclick=scan;draw();
 }
 function presetControls(root){
  const context=current,key=context.preferenceKey,items=Array.isArray(presets[key])?presets[key]:[];presets[key]=items;
  const families=[['XrayMapImages','Maps'],['XrayLinescans','Lines · intensity'],['QuantLinescans','Lines · composition']];
  let entries=[];
  const row=el('div',undefined,'eds-preset-controls'),select=el('select'),name=el('input'),save=el('button','Save comparison'),remove=el('button','Delete'),status=el('span',undefined,'hint');
  select.setAttribute('aria-label','Saved comparisons');name.type='text';name.maxLength=80;name.placeholder='Comparison name';name.setAttribute('aria-label','Comparison name');save.type=remove.type='button';status.setAttribute('role','status');remove.disabled=true;
  const populate=selected=>{select.replaceChildren();entries=[];const placeholder=el('option','Saved comparisons…');placeholder.value='';select.append(placeholder);for(const [table,label] of families){const group=el('optgroup');group.label=label;for(const item of presets[viewKey(table)]||[]){const entry={item,table,key:viewKey(table),value:table+':'+item.name};entries.push(entry);const option=el('option',item.name);option.value=entry.value;group.append(option)}if(group.childElementCount)select.append(group)}select.value=selected?context.table+':'+selected:'';remove.disabled=!select.value};populate();
  select.onchange=async()=>{const entry=entries.find(p=>p.value===select.value);if(!entry)return;const {item,table,key:destination}=entry;
   preferences[destination]=structuredClone(item.options);selections[destination]={ids:[...item.ids],signals:[...item.signals],files:item.files};
   for(const id of item.ids){const cropKey='compare:'+id;if(item.crops?.[id])cropCentres.set(cropKey,[...item.crops[id]]);else cropCentres.delete(cropKey);if(item.aliases?.[id])aliases[cropKey]=item.aliases[id];else delete aliases[cropKey]}
   // open() reads the saved selection; do not overwrite it with the old view.
   const kind=table==='XrayMapImages'?'map':'line';current=null;persist();const views=$('eds-analysis-views');views.style.minHeight=views.getBoundingClientRect().height+'px';const top=window.scrollY,left=window.scrollX,pending=open(null,kind,table),turn=openVersion;await pending;if(turn!==openVersion||current?.preferenceKey!==destination)return;window.scrollTo({top,left,behavior:'instant'});
   const chosen=$('eds-analysis-tools').querySelector('[aria-label="Saved comparisons"]'),input=$('eds-analysis-tools').querySelector('[aria-label="Comparison name"]');chosen.value=entry.value;input.value=item.name;$('eds-analysis-tools').querySelector('.eds-preset-delete').disabled=false;
  };
  save.onclick=()=>{const label=name.value.trim();if(!label){status.textContent='Enter a name.';name.focus({preventScroll:true});return}
   const item={name:label,options:structuredClone(context.options),files:[...context.files],ids:[...context.ids],signals:[...context.signals],aliases:{},crops:{}};
   for(const id of item.ids){const p=itemKey(id);if(aliases[p])item.aliases[id]=aliases[p];if(cropCentres.has(p))item.crops[id]=[...cropCentres.get(p)]}
   const index=items.findIndex(p=>p.name===label);if(index<0)items.push(item);else items[index]=item;persist();populate(label);status.textContent='Saved';
  };
  remove.className='eds-preset-delete';remove.onclick=()=>{const entry=entries.find(p=>p.value===select.value);if(!entry)return;const index=items.indexOf(entry.item);if(index<0)return;const [removed]=items.splice(index,1);persist();populate();name.value='';status.replaceChildren(el('span','Deleted '));const undo=el('button','Undo');undo.type='button';undo.onclick=()=>{items.splice(index,0,removed);persist();populate(removed.name);name.value=removed.name;status.textContent='Restored'};status.append(undo)};
  row.append(select,name,save,remove,status);root.append(row);
 }
 function exportLabel(row){return aliases[itemKey(row.acquisition)]||row.sample_name||current.all.find(g=>g.id===row.acquisition)?.sample||row.short_label||row.label}
 function exportControls(root,footer){
  const buttons=el('div',undefined,'eds-export-actions'),png=el('button','Export PNG'),data=el('button','Export data'),status=el('span',undefined,'hint');status.setAttribute('role','status');
  for(const b of [png,data])b.type='button';buttons.append(png,data,status);footer.append(buttons);
  if(current.comparison)for(const b of [png,data])b.title='Save to the configured output folder for the first selected acquisition’s project.';
  const labels=el('details',undefined,'eds-export-labels');labels.append(el('summary','Export labels'));const list=el('div',undefined,'eds-export-aliases');labels.append(list);root.append(labels);
  for(const group of current.all){const label=el('label'),caption=el('span',group.label),input=el('input');caption.title=(group.source?group.source+' / ':'')+group.label;label.append(caption);input.type='text';input.maxLength=120;input.placeholder=group.sample;input.value=aliases[itemKey(group.id)]||'';input.setAttribute('aria-label','Export label for '+group.label);input.onchange=()=>{const key=itemKey(group.id),value=input.value.trim();if(value)aliases[key]=value;else delete aliases[key];persist()};label.append(input);list.append(label)}
  async function run(kind){
   if(!current?.result||current.resultVersion!==version){status.textContent='Wait for the current view to finish updating.';return}
   const context=current,result=context.result,options={...context.options},fileId=state.file?.id,source=context.comparison?result.rows[0].source:projectKey();
   const names=Object.fromEntries(result.rows.map(r=>[r.acquisition,exportLabel(r)]));
   const lineRanges=context.kind==='line'&&context.comparison?window.aztecLineGeometry.ranges(result.rows,options):{};
   png.disabled=data.disabled=true;status.textContent=kind==='png'?'Preparing PNG…':'Preparing data…';
   try{
    if(!window.aztecExport)throw new Error('Restart TEM Workbench and reload to load the export tools.');
    let saved;
    if(kind==='png'){
     const image=await window.aztecExport.png({result,options,kind:context.kind,comparison:context.comparison,signals:selectedSignals(),names,source,crops:Object.fromEntries(result.rows.map(r=>[r.acquisition,cropCentres.get(itemKey(r.acquisition))])),root:$('eds-analysis-views')});
     saved=await api('export',{id:fileId,...acquisitionRequest(context),format:'png',kind:context.kind,comparison:context.comparison,image});
    }else saved=await api('export',{id:fileId,...acquisitionRequest(context),signals:selectedSignals(),channel_table:context.table,comparison:context.comparison,...options,export_labels:names,export_line_ranges:lineRanges,format:'data'});
    status.textContent='Saved: '+saved.path;status.title=saved.path;
   }catch(error){status.textContent=error.message;console.error('AZtec export failed:',error)}finally{png.disabled=data.disabled=false}
  }
  png.onclick=()=>run('png');data.onclick=()=>run('data');
 }
 async function update(){
  clearTimeout(smoothingTimer);const v=++version;if(!current)return;persist();$('eds-preview-error').hidden=true;
  selections[current.preferenceKey]={ids:[...current.ids],signals:[...current.signals],files:[...(current.files||[])]};
  const signals=selectedSignals();
  if(!current.ids.length||!signals.length){clearPlotObservers();setLineCrop(null);current.result=null;$('eds-analysis-views').replaceChildren(el('p','Select an acquisition and at least one element.','hint'));$('eds-preview-busy').hidden=true;return}
  $('eds-preview-busy').hidden=false;
  try{const result=await api('process',{id:state.file?.id,...acquisitionRequest(current),signals,channel_table:current.table,comparison:current.comparison,...current.options});if(v!==version)return;if(current.comparison&&result.scale_scope!==current.options.scale_scope)throw new Error('This running server has not loaded the three scale options. Restart TEM Workbench, then reload this page.');current.result=result;current.resultVersion=v;render(result)}catch(error){if(v===version){$('eds-preview-error').textContent=error.message;$('eds-preview-error').hidden=false}}finally{if(v===version)$('eds-preview-busy').hidden=true}
 }
 function keepScroll(change){
  const left=window.scrollX,top=window.scrollY;change();window.scrollTo({left,top,behavior:'instant'});
 }
 function render(result){
  // Retain the old height until replacement images have dimensions. Otherwise a
  // temporarily shorter document clamps scroll position before images load.
  imageScaleAvailability(result);
  const root=$('eds-analysis-views'),layout=++layoutVersion;
  root.style.minHeight=`${root.getBoundingClientRect().height}px`;
  keepScroll(()=>renderContent(result));
  Promise.all([...root.querySelectorAll('img')].map(img=>img.decode().catch(()=>{}))).then(()=>requestAnimationFrame(()=>{if(layout===layoutVersion)keepScroll(()=>{root.style.minHeight=''})}));
 }
 function renderContent(result){
  clearPlotObservers();
  setLineCrop(null);
  if(current.comparison&&current.kind==='line')updateLineTrimControls(result);
  const root=$('eds-analysis-views');root.replaceChildren();
  if(current.comparison){renderComparison(root,result);applyMapBrightness();$('eds-preview-note').textContent='';return}
  if(current.kind==='map'&&result.normalisation!=='none'){const scale=el('div',undefined,'eds-scale');scale.append(el('span',String(result.low)),el('span',undefined,'eds-scale-bar'),el('span',`${result.high} · relative to ${({median:'median',mean:'mean',p20:'P20'})[result.normalisation]}`));root.append(scale)}
  for(const row of result.rows){const section=el('section',undefined,'eds-map-row');section.dataset.acquisition=row.acquisition;if(current.comparison)section.append(el('h3',row.label));root.append(section);
   if(row.kind==='map'){
    const tiles=el('div',undefined,'eds-map-tiles'),linked=[];section.append(tiles);
    for(const tile of row.tiles){const column=el('div',undefined,'eds-map-pair');tiles.append(column);
     const stat=(result.mode==='both'?row.signal_statistics:row.statistics)?.spreads?.find(s=>s.channel===tile.channel);
     linked.push(imageTile(column,tile.label,tile.image,tile.colour,tile.error,row,stat));
     if(result.mode==='both'){if(tile.ratio_label)linked.push(imageTile(column,tile.ratio_label,tile.ratio_image,tile.colour,tile.ratio_error,row,row.statistics?.spreads?.find(s=>s.channel===tile.channel)));else if(row.electron)linked.push(imageTile(column,'Electron image',row.electron,null,null,row))}
    }linkMapHover(linked.filter(Boolean),row.tiles[0]?.path);
   }
   else linePlots(section,row,result)
  }
  applyMapBrightness();
  if(current.kind==='map')mapStatistics(root,result,result.mode==='both'?[{electron:true},...selectedSignals().map(channel=>({channel,label:channel})),...selectedSignals().filter(channel=>channel!==current.options.denominator).map(channel=>({channel,ratio:true,label:channel+' / '+current.options.denominator}))]:null);
  $('eds-preview-note').textContent=current.kind==='line'?'':result.note;
 }
 function selectedSignals(){const signals=current.signals.filter(s=>current.options.mode!=='ratio'||s!==current.options.denominator);if(current.kind==='map'&&current.options.mode==='ratio'&&current.options.show_denominator)signals.unshift(current.options.denominator);return signals}
 function renderComparison(root,result){
  const normalized=result.normalisation!=='none';
  if(current.kind==='line'&&current.options.layout==='overlay'&&current.options.scale_scope==='off')root.append(el('p','Overlaid traces share an axis; separate scales apply when stacked.','hint'));
  if(current.kind==='map'){
   const columns=[{label:'Electron image',electron:true}];
   for(const channel of selectedSignals()){
    columns.push({channel,label:result.mode==='ratio'&&channel!==current.options.denominator?`${channel} / ${current.options.denominator}`:channel});
   }
   if(result.mode==='both')for(const channel of selectedSignals())if(channel!==current.options.denominator)columns.push({channel,ratio:true,label:`${channel} / ${current.options.denominator}`});
   const wrap=el('div',undefined,'eds-comparison-maps'),grid=el('div',undefined,'eds-comparison-grid');wrap.append(grid);root.append(wrap);grid.style.setProperty('--columns',columns.length);
   for(const col of columns){const head=el('div',col.label,'eds-comparison-column');
    if(!col.electron&&!normalized&&result.shared_scales){const tile=result.rows.flatMap(r=>r.tiles).find(t=>t.channel===col.channel&&!t.error),limits=tile?.[col.ratio?'ratio_image_limits':'image_limits'];if(limits)head.append(el('small',`${limits[0]} – ${Number(limits[1].toPrecision(3))} ${col.ratio?tile.ratio_unit:tile.unit}`))}
    grid.append(head);
   }
   const sizes=new Map(),crops=new Map();for(const r of result.rows)if(r.width&&r.height){sizes.set(r.distance_unit,Math.max(sizes.get(r.distance_unit)||0,r.width,r.height));crops.set(r.distance_unit,Math.min(crops.get(r.distance_unit)||Infinity,r.width,r.height))}
   for(const row of result.rows){
    const label=el('div',row.label,'eds-comparison-row-title');label.style.gridColumn='1 / -1';label.title=(row.source?row.source+' / ':'')+row.label;
    label.append(el('small',row.width?` · ${row.width.toFixed(1)} × ${row.height.toFixed(1)} ${row.distance_unit}`:' · physical calibration unavailable'));grid.append(label);
    const cropTiles=[];
    for(const col of columns){const tile=row.tiles.find(t=>t.channel===col.channel),error=row.error||(!col.electron?(tile?.[col.ratio?'ratio_error':'error']||(!tile?'Channel unavailable':null)):(!row.electron?'Electron image unavailable':null));
     const cell=el('figure',undefined,'eds-comparison-cell');grid.append(cell);
     if(error){cell.append(el('p',error,'eds-channel-error'));continue}
     const img=el('img');img.src=col.electron?row.electron:tile[col.ratio?'ratio_image':'image'];img.alt=`${row.label} · ${col.label}`;
     if(!col.electron)img.dataset.intensityMap='';
     if(['physical','crop'].includes(current.options.spatial)&&row.width){const size=(current.options.spatial==='crop'?crops:sizes).get(row.distance_unit);img.style.width=`${100*row.width/size}%`;img.style.height=`${100*row.height/size}%`}
     cell.classList.toggle('eds-crop-tile',current.options.spatial==='crop');cell.append(img);
     const redrawScale=mapScaleBar(cell,img,row);cropTiles.push({cell,img,redrawScale});
     if(!col.electron&&!result.shared_scales){const limits=tile[col.ratio?'ratio_image_limits':'image_limits'];if(limits){const key=el('span',limits.map(v=>Number(v.toPrecision(3))).join(' – '),'eds-tile-value-limits');key.title=normalized?'Independent colour limits; white = 1':`Independent colour limits (${col.ratio?tile.ratio_unit:tile.unit})`;cell.append(key)}}
    }
    if(current.options.spatial==='crop')panMapRow(cropTiles,row,label);
    linkMapHover(cropTiles);
   }
   if(normalized&&result.shared_scales)comparisonColourScale(wrap,grid,result);
   mapStatistics(root,result,columns,normalized&&result.shared_scales);
  }else{
   const rows=result.rows.filter(r=>!r.error);
   for(const row of result.rows.filter(r=>r.error))root.append(el('p',`${row.label}: ${row.error}`,'eds-channel-error'));
   const lineRanges=window.aztecLineGeometry.ranges(rows,current.options);
   for(const row of rows){row.viewStart=lineRanges[row.acquisition]?.start||0;row.viewLength=lineRanges[row.acquisition]?.length||row.length;row.trimmed=lineRanges[row.acquisition]?.trimmed||false;for(const tile of row.tiles){tile.viewStart=row.viewStart;tile.viewLength=row.viewLength;tile.acquisition=row.acquisition}}
   const ranges=new Map(),lengths=new Map(),baseline=normalized?1:0;
   for(const row of rows){lengths.set(row.distance_unit,Math.max(lengths.get(row.distance_unit)||0,row.viewLength));for(const t of row.tiles.filter(t=>!t.error)){
    t.quantityKey=JSON.stringify([t.channel,t.unit,result.mode]);t.scaleKey=current.options.scale_scope==='all'?JSON.stringify([t.unit,result.mode]):t.quantityKey;let range=normalized?.2:1e-12;
    if(!normalized&&result.mode==='ratio')range=t.maximum;
    else{for(const y of t.y)if(Number.isFinite(y))range=Math.max(range,Math.abs(y-baseline));range*=1.12}
    ranges.set(t.scaleKey,Math.max(ranges.get(t.scaleKey)||0,range));
   }}
   if(current.options.layout==='overlay'){
    const refs=el('div',undefined,'eds-line-references');root.append(refs);const colours=['#da85ef','#55d4e9','#ffb658','#67e6a1','#f78595','#adb4ff','#e1db66','#f7faff','#e09868','#5fa8fb','#c5eea1','#f793c3'];
    rows.forEach((r,i)=>{r.compareColour=colours[i%colours.length];if(current.options.background)lineReference(refs,r,r.compareColour)});
    const byQuantity=new Map();for(const row of rows)for(const tile of row.tiles.filter(t=>!t.error)){const key=tile.quantityKey+row.distance_unit;if(!byQuantity.has(key))byQuantity.set(key,{tiles:[],row});byQuantity.get(key).tiles.push({...tile,label:row.short_label||row.label,source:row.label,colour:row.compareColour})}
    for(const {tiles,row} of byQuantity.values()){
     const section=el('section',undefined,'eds-compare-line-section');section.append(el('h3',row.tiles.find(t=>t.quantityKey===tiles[0].quantityKey).label));root.append(section);
     linePlots(section,{...row,background:null,overlay:true,axisLength:lengths.get(row.distance_unit),sharedRanges:current.options.scale_scope!=='off'?ranges:null,tiles},result);
    }
   }else for(const row of rows){
    const section=el('section',undefined,'eds-compare-line-section');section.dataset.acquisition=row.acquisition;section.append(el('h3',row.label));root.append(section);
    const body=el('div',undefined,'eds-compare-line-body'),ref=el('div'),plots=el('div');section.append(body);body.append(ref,plots);lineReference(ref,row);
    linePlots(plots,{...row,overlay:current.options.layout==='elements',axisLength:lengths.get(row.distance_unit),sharedRanges:current.options.scale_scope!=='off'?ranges:null},result);
   }
  }
 }
 function comparisonColourScale(wrap,grid,result){
  const scale=el('div',undefined,'eds-comparison-colour-scale'),ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');scale.append(svg);wrap.append(scale);
  const baseline={median:'median',mean:'mean',p20:'20th percentile'}[result.normalisation]||result.normalisation;
  const label=`Relative to each map’s ${baseline} (shared limits)`,id=`eds-colour-scale-${++plotSerial}`;
  svg.setAttribute('role','img');svg.setAttribute('aria-label',`${label}: ${result.low} to ${result.high}`);
  const draw=()=>{
   const cells=grid.querySelectorAll('.eds-comparison-cell');if(!cells.length||!grid.isConnected)return;
   const rect=grid.getBoundingClientRect(),first=cells[0].getBoundingClientRect(),last=cells[cells.length-1].getBoundingClientRect();
   const top=first.top-rect.top,bottom=last.bottom-rect.top,height=bottom-top;if(height<=0)return;
   svg.replaceChildren();svg.setAttribute('viewBox',`0 0 80 ${rect.height}`);svg.style.height=`${rect.height}px`;
   const add=(tag,attrs,text,parent=svg)=>{const n=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;parent.append(n);return n};
   const defs=add('defs',{}),gradient=add('linearGradient',{id,x1:0,y1:1,x2:0,y2:0},undefined,defs);
   ['#053061','#2166ac','#4393c3','#92c5de','#d1e5f0','#f7f7f7','#fddbc7','#f4a582','#d6604d','#b2182b','#67001f'].forEach((colour,i)=>add('stop',{offset:`${i*10}%`,'stop-color':colour},undefined,gradient));
   add('rect',{x:2,y:top,width:18,height,fill:`url(#${id})`,stroke:'#8b9aaa','stroke-width':.6});
   const range=result.high-result.low,target=range/6,power=10**Math.floor(Math.log10(target));
   const step=([1,2,2.5,5,10].find(n=>n*power>=target-1e-12)||10)*power,ticks=[result.low];
   for(let v=Math.ceil((result.low+step*.05)/step)*step;v<result.high-step*.05;v+=step)ticks.push(v);
   ticks.push(result.high);
   for(const v of ticks){const y=bottom-(v-result.low)/range*height;add('line',{x1:20,x2:25,y1:y,y2:y,stroke:'currentColor'});const atBottom=v===result.low,atTop=v===result.high;add('text',{x:29,y:y+(atBottom?-2:atTop?2:0),'dominant-baseline':atBottom?'auto':atTop?'hanging':'middle','font-size':10,fill:'currentColor'},Number(v.toPrecision(4)).toString())}
   add('text',{x:70,y:(top+bottom)/2,transform:`rotate(-90 70 ${(top+bottom)/2})`,'text-anchor':'middle',fill:'currentColor','font-size':11,...(height<260?{textLength:Math.max(80,height-10),lengthAdjust:'spacingAndGlyphs'}:{})},label);
  };
  const observer=new ResizeObserver(draw);observer.observe(grid);plotObservers.push(observer);draw();
 }
 function mapStatistics(root,result,columns=null,colourScale=false){
  const rows=result.rows.filter(r=>r.statistics);if(!rows.length)return;
  const section=el('section',undefined,'eds-map-statistics'),heading=el('div',undefined,'eds-statistics-heading');
  heading.append(el('h3','Descriptive comparison'));
  const help=el('span',undefined,'eds-analysis-help'),button=el('button','ⓘ'),content=el('span','P90/P10 compares a high value (90th percentile) with a low value (10th percentile), excluding the most extreme pixels. For example, 1.4 means the high value is 40% above the low value; 1 means no spread between these percentiles. It describes signal heterogeneity, not elemental enrichment or noise-corrected segregation. Correlations range from −1 (opposite ordering) through 0 (no monotonic association) to +1 (same ordering); they are not percentages. Correlations are Spearman coefficients between the first selected quantity and the others, over their common valid pixels. A 3σ rim is excluded on each axis. These describe smoothed, unclipped values across the full acquisition; crop position, brightness and normalization do not change them. Shared denominators can create correlations. Smoothed pixels are not independent observations; these are not significance tests or proof of segregation. A dash means insufficient valid pixels, a zero lower percentile or a constant channel.','eds-help-content');
  button.type='button';button.setAttribute('aria-label','Map statistics help');button.setAttribute('aria-expanded','false');button.onclick=()=>button.setAttribute('aria-expanded',String(button.getAttribute('aria-expanded')!=='true'));button.onkeydown=e=>{if(e.key==='Escape')button.setAttribute('aria-expanded','false')};content.setAttribute('role','tooltip');help.append(button,content);heading.append(help);section.append(heading);root.append(section);
  const unit=current.comparison?result.smoothing_unit:'px';section.append(el('p',`Gaussian σ ${result.smoothing} ${unit} · full acquisition interiors`,'hint'));
  const channels=[...new Set(rows.flatMap(r=>(r.statistics.spreads||[]).map(s=>s.channel)))];
  const pairs=new Map();for(const r of rows)for(const c of r.statistics.correlations||[])pairs.set(JSON.stringify([c.first,c.second]),c);
  const den=rows.find(r=>r.statistics.denominator)?.statistics.denominator,short=s=>s.split(' ')[0],quantity=s=>short(s)+(den?`/${short(den)}`:'');
  const number=v=>Number.isFinite(v)?v.toFixed(2):'—';
  function table(parent,secondary=false){
   const t=el('table',undefined,'eds-map-statistics-table'),head=el('thead'),tr=el('tr');tr.append(el('th','Map'));
   const shownPairs=secondary&&!den?[]:[...pairs.values()];
   for(const ch of (current.comparison&&!secondary?[]:channels)){const th=el('th');th.append(el('span',quantity(ch)),el('small',`${secondary?'2×σ · ':''}P90/P10`));th.title=ch+(den?` / ${den}`:'');tr.append(th)}
   for(const c of shownPairs){const th=el('th');th.append(el('span',secondary?`${short(c.first)} vs ${short(c.second)}`:`${quantity(c.first)} vs ${quantity(c.second)}`),el('small',secondary?'Adjusted r':'Spearman ρ'));th.title=secondary?'Pearson correlation after removing log denominator and a planar position trend':`${c.first} compared with ${c.second}. Spearman correlation: +1 means values rise together, 0 means no monotonic association, −1 means they move oppositely. This is not a percentage or subtraction.`;tr.append(th)}
   head.append(tr);t.append(head);const body=el('tbody');
   for(const r of rows){const line=el('tr'),name=el('td',r.short_label||r.label);name.title=r.label;line.append(name);
    const stats=secondary?r.statistics.double_smoothing:r.statistics;
    for(const ch of (current.comparison&&!secondary?[]:channels)){const spread=stats?.spreads?.find(s=>s.channel===ch),td=el('td',number(spread?.p90_p10));td.title=spread?`${spread.pixels.toLocaleString()} valid interior pixels`:stats?.reason||'Unavailable';line.append(td)}
    for(const c of shownPairs){const pair=r.statistics.correlations?.find(p=>p.first===c.first&&p.second===c.second),td=el('td',number(pair?.[secondary?'adjusted':'spearman']));td.title=pair?`${pair.pixels.toLocaleString()} common interior pixels`:r.statistics.reason||'Unavailable';line.append(td)}
    body.append(line);
   }t.append(body);parent.append(t);
  }
  if(columns){
   const wrap=el('div',undefined,'eds-aligned-statistics');wrap.classList.toggle('eds-with-colour-scale',colourScale);section.append(wrap);
   const t=el('table',undefined,'eds-map-statistics-table eds-aligned-table'),head=el('thead'),headers=el('tr');
   for(const col of columns)headers.append(el('th',col.electron?'Map':col.label));head.append(headers);t.append(head);wrap.append(t);
   const statsFor=(r,col)=>col.ratio||result.mode==='ratio'&&col.channel!==current.options.denominator||result.mode==='signal'?r.statistics:r.signal_statistics;
   for(const r of rows){const body=el('tbody'),spreadRow=el('tr'),correlationRow=el('tr');t.append(body);body.append(spreadRow,correlationRow);
    const name=el('td',r.short_label||r.label);name.append(el('small','P90/P10'));spreadRow.append(name);correlationRow.append(el('td','Spearman ρ','hint'));
    for(const col of columns.slice(1)){
     const stats=statsFor(r,col),spread=stats?.spreads?.find(v=>v.channel===col.channel),value=el('td',number(spread?.p90_p10));
     value.title=spread?`${spread.pixels.toLocaleString()} valid interior pixels`:stats?.reason||'Unavailable';spreadRow.append(value);
     const pair=stats?.correlations?.find(v=>v.second===col.channel),correlation=el('td',number(pair?.spearman),'eds-correlation-cell');
     if(pair){const reference=short(pair.first)+(stats.denominator?'/'+short(stats.denominator):'');correlation.append(el('span',' vs '+reference,'eds-correlation-reference'));correlation.title=`${col.label} compared with ${reference} · ${pair.pixels.toLocaleString()} common interior pixels`}
     else correlation.title='Reference quantity; no self-correlation shown.';
     correlationRow.append(correlation);
    }
   }
  }else table(section);
  for(const r of rows.filter(r=>!r.statistics.available))section.append(el('p',`${r.short_label||r.label}: ${r.statistics.reason}`,'hint'));
  mapStructure(section,result);
  if(rows.some(r=>r.statistics.double_smoothing||r.statistics.denominator)){
   const more=el('details'),summary=el('summary',den?'Smoothing and shared-denominator checks':'Smoothing check');more.append(summary);section.append(more);table(more,true);
   more.append(el('p','Spread is recalculated at twice the smoothing width, excluding its wider 3σ rim. '+(den?'Adjusted r uses the original smoothing: log element intensity with log denominator and a planar x/y trend removed, then Pearson correlation of the residuals. ':'')+'These exploratory checks do not correct for counting precision or establish a phase.','hint'));
  }
 }
 function mapStructure(root,result){
  const context=current,details=el('details',undefined,'eds-noise-check eds-map-structure');
  const summary=el('summary','Spatial structure and smoothing response'),body=el('div');details.append(summary,body);root.append(details);
  const request={id:state.file?.id,signals:selectedSignals(),channel_table:current.table,comparison:current.comparison,
   mode:result.mode==='signal'?'signal':'ratio',denominator:current.options.denominator,smoothing:result.smoothing,smoothing_unit:result.smoothing_unit,
   structure_only:true};
  const key=JSON.stringify({...request,acquisitions:current.ids});context.structureKey=key;
  details.open=!!context.structureOpen;
  let started=false;
  async function run(){
   if(started||!details.open)return;started=true;
   const progress=el('p',undefined,'eds-structure-progress');progress.setAttribute('role','status');
   const spinner=el('span',undefined,'eds-structure-spinner'),status=el('span');progress.append(spinner,status);body.append(progress);
   const ids=[...context.ids];
   for(let i=0;i<ids.length;i++){
    if(current!==context||context.structureKey!==key||!details.isConnected)return;
    status.textContent=`Checking map ${i+1} of ${ids.length} · 256 shuffles…`;
    const options={...request,...acquisitionRequest(context,[ids[i]])},cacheKey=JSON.stringify(options);
    if(!structureCache.has(cacheKey)){
     const pending=structureQueue.then(()=>{
      if(current!==context||context.structureKey!==key)throw new Error('Settings changed');
      return api('process',options);
     });
     structureQueue=pending.catch(()=>{});structureCache.set(cacheKey,pending);
     pending.catch(()=>{if(structureCache.get(cacheKey)===pending)structureCache.delete(cacheKey)});
     if(structureCache.size>32)structureCache.delete(structureCache.keys().next().value);
    }
    try{
     const data=await structureCache.get(cacheKey);
     if(current!==context||context.structureKey!==key||!details.isConnected)return;
     if(!data.structure_only)throw new Error('Restart TEM Workbench to load the map spatial check.');
     for(const row of data.rows){
      const section=el('section',undefined,'eds-map-structure-row');section.append(el('h4',row.short_label||row.label));body.insertBefore(section,progress);
      if(row.error){section.append(el('p',row.error,'eds-channel-error'));continue}
      const plots=el('div',undefined,'eds-structure-plots'),variation=el('div'),sweep=el('div');plots.append(variation,sweep);section.append(plots);
      variation.append(el('strong','Variation vs shuffled pixels'));noisePlot(variation,row.tiles);
      const table=el('table',undefined,'eds-noise-table'),head=el('tr');
      for(const text of ['Quantity','Observed','Shuffle median','Shuffle 95th','Structure'])head.append(el('th',text));table.append(head);
      for(const tile of row.tiles){const c=tile.noise_check,tr=el('tr');tr.append(el('td',tile.label));
       if(c?.available){for(const v of [c.observed_cv,c.shuffled_cv,c.shuffled_95])tr.append(el('td',(100*v).toFixed(1)+'%'));
        const score=el('td',c.structure_ratio.toFixed(2)+'×');score.title=c.above_shuffled_95?'Observed variation exceeds the shuffled 95th percentile.':'Observed variation does not exceed the shuffled 95th percentile.';tr.append(score)
       }else{const td=el('td',c?.reason||'Unavailable');td.colSpan=4;tr.append(td)}table.append(tr)
      }variation.append(table);
      sweep.append(el('strong','P90/P10 vs smoothing · log scale'));smoothingPlot(sweep,row,result);
     }
    }catch(error){if(details.isConnected){progress.classList.add('eds-channel-error');spinner.hidden=true;status.textContent=error.message}return}
   }
   progress.remove();
  }
  const help=el('span',undefined,'eds-analysis-help'),button=el('button','ⓘ'),text=el('span',
   'Observed variation is standard deviation ÷ mean inside a 3σ rim. Each of 256 paired pixel shuffles preserves the channels at each pixel but randomizes their spatial positions; smoothing and division are then repeated on the full-resolution map. Structure is observed variation ÷ shuffled median: around 1× is similar to random ordering. The shuffled 95th percentile is a reference for this model, not a confidence interval or proof of segregation. Spatially correlated noise, drift and thickness can also create structure. Normalization, brightness and crop position do not change these results. The smoothing curve uses ten widths from 0.2× to 2× the current σ, with a fixed interior excluding 3σ at the largest width (6× current σ). Consequently its value at 1× may differ slightly from the tile readout, which uses the current 3σ rim. Missing curve values mean too few valid pixels or a zero lower percentile. In Both mode these checks use the ratios.', 'eds-help-content');
  button.type='button';button.setAttribute('aria-label','Map spatial structure help');button.setAttribute('aria-expanded','false');button.onclick=()=>button.setAttribute('aria-expanded',String(button.getAttribute('aria-expanded')!=='true'));button.onkeydown=e=>{if(e.key==='Escape')button.setAttribute('aria-expanded','false')};text.setAttribute('role','tooltip');help.append(button,text);summary.append(help);
  details.ontoggle=()=>{context.structureOpen=details.open;run()};run();
 }
 function smoothingPlot(root,row,result){
  const available=row.tiles.filter(t=>t.spread.some(Number.isFinite));
  if(!available.length){root.append(el('p',row.sweep_reason,'hint'));return}
  const ns='http://www.w3.org/2000/svg',figure=el('figure',undefined,'eds-noise-plot'),svg=document.createElementNS(ns,'svg');root.append(figure);figure.append(svg);
  const width=650,height=255,left=52,right=20,top=12,bottom=45,maximum=Math.max(1.01,...available.flatMap(t=>t.spread.filter(Number.isFinite)));
  const high=maximum**1.08,logHigh=Math.log(high),X=v=>left+(v-.2)/1.8*(width-left-right),Y=v=>height-bottom-Math.log(Math.max(1,v))/logHigh*(height-top-bottom);
  svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('role','img');svg.setAttribute('aria-label','P90/P10 at ten smoothing widths, logarithmic vertical scale');
  const add=(tag,attrs,text)=>{const n=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;svg.append(n);return n};
  for(let i=0;i<=4;i++){const value=Math.exp(logHigh*i/4),y=Y(value);add('line',{x1:left,x2:width-right,y1:y,y2:y,stroke:'#314454'});add('text',{x:left-8,y:y+4,fill:'#a7b8c9','text-anchor':'end','font-size':11},value.toFixed(2))}
  for(const factor of row.factors){const x=X(factor);add('text',{x,y:height-bottom+18,fill:'#a7b8c9','text-anchor':'middle','font-size':11},factor.toFixed(1)+'×')}
  add('line',{x1:X(1),x2:X(1),y1:top,y2:height-bottom,stroke:'#b5c5d4','stroke-dasharray':'4 4'});
  for(const tile of available){let path='',joined=false;tile.spread.forEach((value,i)=>{if(!Number.isFinite(value)){joined=false;return}const x=X(row.factors[i]),y=Y(value);path+=`${joined?'L':'M'}${x},${y} `;joined=true;
    const dot=add('circle',{cx:x,cy:y,r:3,fill:tile.colour}),tip=document.createElementNS(ns,'title');tip.textContent=`${tile.label} · ${row.factors[i].toFixed(1)}×σ · P90/P10 ${value.toFixed(3)}`;dot.append(tip)
   });add('path',{d:path,fill:'none',stroke:tile.colour,'stroke-width':2})}
  add('text',{x:(left+width-right)/2,y:height-5,fill:'#a7b8c9','text-anchor':'middle','font-size':12},`Smoothing · 1×σ = ${result.smoothing} ${current.comparison?result.smoothing_unit:'px'}`);
  const legend=el('figcaption',undefined,'eds-line-caption');for(const tile of available){const label=el('span',tile.label);label.style.color=tile.colour;legend.append(label)}figure.append(legend);
 }

 function lineReference(root,row,colour='#d88aff'){
  if(!row.electron||!row.line_points)return;
  const geometry=window.aztecLineGeometry.reference(row,current.options.reference_orientation),{width,height,a,b,length}=geometry;
  if(!(length>0))return;
  const figure=el('figure',undefined,'eds-line-reference');figure.dataset.acquisition=row.acquisition;
  const caption=el('figcaption',row.short_label||row.label);caption.title=row.label;figure.append(caption);root.append(figure);
  const stage=el('div',undefined,'eds-line-reference-stage'),ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
  svg.classList.add('eds-reference-drawing');svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('role','img');svg.setAttribute('aria-label',row.label+' · scan location and crop');stage.append(svg);figure.append(stage);
  const add=(tag,attrs,text)=>{const n=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text)n.textContent=text;svg.append(n);return n};
  add('image',{href:row.electron,width:geometry.nativeWidth,height:geometry.nativeHeight,transform:geometry.transform});
  const crop=add('polygon',{class:'eds-reference-crop',fill:'none',stroke:'#fff','stroke-width':1,'stroke-dasharray':'4 4',opacity:.65,'vector-effect':'non-scaling-stroke'});
  const dx=b[0]-a[0],dy=b[1]-a[1],nx=-dy/length,ny=dx/length;
  add('line',{x1:a[0],y1:a[1],x2:b[0],y2:b[1],stroke:colour,'stroke-width':2,'vector-effect':'non-scaling-stroke'});
  add('circle',{cx:a[0],cy:a[1],r:7,fill:colour});
  add('path',{d:`M${b[0]-dx/length*20+nx*10},${b[1]-dy/length*20+ny*10} L${b} L${b[0]-dx/length*20-nx*10},${b[1]-dy/length*20-ny*10}`,fill:'none',stroke:colour,'stroke-width':2,'vector-effect':'non-scaling-stroke'});
  const cursor=add('line',{stroke:'#fff','stroke-width':2,'vector-effect':'non-scaling-stroke',visibility:'hidden'});
  const fieldWidth=row.length*width/length,target=fieldWidth*.25,power=10**Math.floor(Math.log10(target)),barLength=([5,2,1].find(n=>n*power<=target)||1)*power;
  const bar=barLength/fieldWidth*width,x=width*.04,y=height-width*.045;
  for(const [stroke,sw] of [['#000',5],['#fff',2]])add('line',{x1:x,x2:x+bar,y1:y,y2:y,stroke,'stroke-width':sw,'vector-effect':'non-scaling-stroke'});
  const label=row.distance_unit==='nm'&&barLength>=1000?`${Number((barLength/1000).toPrecision(3))} µm`:`${Number(barLength.toPrecision(3))} ${row.distance_unit}`;
  add('text',{x,y:y-width*.035,fill:'#fff',stroke:'#000','stroke-width':width*.012,'paint-order':'stroke','font-size':width*.05},label);
  referenceCursors.push({row,acquisition:row.acquisition,unit:row.distance_unit,
   updateCrop:extent=>{crop.setAttribute('points',geometry.crop(extent).map(p=>p.join(',')).join(' '));svg.dataset.cropExtent=JSON.stringify(extent)},
   update:distance=>{if(distance===null||distance<0||distance>(row.viewLength||row.length)){cursor.setAttribute('visibility','hidden');return}const f=(distance+(row.viewStart||0))/row.length,x=a[0]+dx*f,y=a[1]+dy*f,size=7*width/Math.max(1,svg.clientWidth);for(const [key,value]of Object.entries({x1:x-nx*size,y1:y-ny*size,x2:x+nx*size,y2:y+ny*size,visibility:'visible'}))cursor.setAttribute(key,value)}
  });
 }

 function mapScaleBar(cell,img,row){
  if(!(row?.width>0&&row.distance_unit)){cell.title='Image scale unavailable';return ()=>{}}
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.classList.add('eds-image-scale');svg.setAttribute('role','img');cell.append(svg);
  const draw=()=>{
   if(!cell.isConnected||!img.naturalWidth)return;
   const box=cell.getBoundingClientRect(),rect=img.getBoundingClientRect();if(!box.width||!rect.width)return;
   // Account for the real image inside object-fit: contain, not its padded box.
   const factor=Math.min(rect.width/img.naturalWidth,rect.height/img.naturalHeight),width=img.naturalWidth*factor,height=img.naturalHeight*factor;
   const left=rect.left-box.left+(rect.width-width)/2,top=rect.top-box.top+(rect.height-height)/2;
   const x=Math.max(0,left),y=Math.max(0,top),right=Math.min(box.width,left+width),bottom=Math.min(box.height,top+height);
   const unitsPerPixel=row.width/width,target=Math.max(0,right-x)*.28*unitsPerPixel;
   if(!(target>0&&bottom>y))return;
   const power=10**Math.floor(Math.log10(target)),length=([5,2,1].find(n=>n*power<=target)||1)*power,pixels=length/unitsPerPixel;
   const label=row.distance_unit==='nm'&&length>=1000?`${Number((length/1000).toPrecision(3))} µm`:`${Number(length.toPrecision(3))} ${row.distance_unit}`;
   svg.replaceChildren();svg.setAttribute('viewBox',`0 0 ${box.width} ${box.height}`);svg.setAttribute('aria-label',label+' scale bar');svg.dataset.length=length;svg.dataset.pixels=pixels;
   const add=(tag,attrs,text)=>{const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text)n.textContent=text;svg.append(n)};
   const start=x+Math.min(8,(right-x)*.06),base=bottom-Math.min(9,(bottom-y)*.1);
   for(const [stroke,sw] of [['#000',5],['#fff',3]])add('line',{x1:start,x2:start+pixels,y1:base,y2:base,stroke,'stroke-width':sw});
   add('text',{x:start,y:base-7,fill:'#fff',stroke:'#000','stroke-width':3,'paint-order':'stroke','stroke-linejoin':'round','font-size':10},label);
  };
  img.addEventListener('load',draw,{once:true});const observer=new ResizeObserver(draw);observer.observe(cell);plotObservers.push(observer);draw();return draw;
 }
 function panMapRow(tiles,row,label){
  if(!tiles.length)return;
  const key=itemKey(row.acquisition);
  let centre=cropCentres.get(key)||[.5,.5];if(!Array.isArray(centre)||centre.length!==2||!centre.every(Number.isFinite))centre=[.5,.5];
  const factors=tiles[0].img.style;const sx=parseFloat(factors.width)/100||1,sy=parseFloat(factors.height)/100||1;
  if(sx<=1&&sy<=1)return;
  const clamp=(value,scale)=>scale>1?Math.max(.5/scale,Math.min(1-.5/scale,value)):.5;
  const move=(x,y)=>{centre=[clamp(x,sx),clamp(y,sy)];cropCentres.set(key,centre);clearTimeout(persistTimer);persistTimer=setTimeout(persist,200);for(const {img,redrawScale} of tiles){img.style.transform=`translate(${-100*centre[0]}%,${-100*centre[1]}%)`;redrawScale()}};
  const reset=el('button','Centre crop','eds-crop-reset');reset.type='button';reset.onclick=()=>move(.5,.5);label.append(reset);
  for(const {cell,img} of tiles){
   cell.classList.add('eds-pannable');cell.tabIndex=0;cell.setAttribute('role','group');cell.setAttribute('aria-label',img.alt+' · drag or use arrow keys to pan; Home to centre');img.draggable=false;
   let drag=null;
   cell.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();cell.focus({preventScroll:true});const rect=img.getBoundingClientRect();drag={id:e.pointerId,x:e.clientX,y:e.clientY,centre:[...centre],width:rect.width,height:rect.height};cell.setPointerCapture(e.pointerId);cell.classList.add('eds-panning')};
   cell.onpointermove=e=>{if(drag&&e.pointerId===drag.id)move(drag.centre[0]-(e.clientX-drag.x)/drag.width,drag.centre[1]-(e.clientY-drag.y)/drag.height)};
   const end=e=>{if(drag&&e.pointerId===drag.id){drag=null;cell.classList.remove('eds-panning');if(cell.hasPointerCapture(e.pointerId))cell.releasePointerCapture(e.pointerId)}};
   cell.onpointerup=end;cell.onpointercancel=end;cell.onlostpointercapture=end;cell.ondblclick=()=>move(.5,.5);
   cell.onkeydown=e=>{const step=e.shiftKey?.1:.025;const delta={ArrowLeft:[-step/sx,0],ArrowRight:[step/sx,0],ArrowUp:[0,-step/sy],ArrowDown:[0,step/sy]}[e.key];if(delta){e.preventDefault();move(centre[0]+delta[0],centre[1]+delta[1])}else if(e.key==='Home'){e.preventDefault();move(.5,.5)}};
  }
  move(...centre);
 }
 function imageTile(root,label,source,colour,error,row,stat){
  const figure=el('figure',undefined,'eds-map-tile'),caption=el('figcaption',label);if(colour)caption.style.color=colour;figure.append(caption);root.append(figure);
  if(error){figure.append(el('p',error,'eds-channel-error'));return null}
  const cell=el('div',undefined,'eds-map-image'),img=el('img');img.src=source;img.alt=label;if(colour)img.dataset.intensityMap='';cell.append(img);figure.append(cell);mapScaleBar(cell,img,row);
  return {cell,img};
 }
 function linkMapHover(tiles,path=null){
  // Coordinates belong to an acquisition, never to unrelated specimen fields.
  const marked=tiles.map(tile=>{const cursor=el('span',undefined,'eds-map-crosshair');cursor.hidden=true;cursor.setAttribute('aria-hidden','true');tile.cell.append(cursor);return {...tile,cursor}});
  const imageBox=img=>{const r=img.getBoundingClientRect(),scale=Math.min(r.width/img.naturalWidth,r.height/img.naturalHeight),width=img.naturalWidth*scale,height=img.naturalHeight*scale;return {left:r.left+(r.width-width)/2,top:r.top+(r.height-height)/2,width,height}};
  const hide=()=>{for(const {cursor} of marked)cursor.hidden=true;if(path)setMapCursor(null)};
  for(const source of marked){source.cell.addEventListener('pointermove',event=>{
    const b=imageBox(source.img),u=(event.clientX-b.left)/b.width,v=(event.clientY-b.top)/b.height;
    if(!Number.isFinite(u+v)||u<0||u>1||v<0||v>1){hide();return}
    if(path)setMapCursor(path,u,v);
    for(const {cell,img,cursor} of marked){const box=imageBox(img),r=cell.getBoundingClientRect(),x=box.left+u*box.width-r.left,y=box.top+v*box.height-r.top;
     cursor.hidden=!(x>=0&&y>=0&&x<=r.width&&y<=r.height);cursor.style.left=x+'px';cursor.style.top=y+'px';
    }
   });source.cell.addEventListener('pointerleave',hide)
  }
 }
 function applyMapBrightness(){const gain=current?.result?.normalisation==='none'?current.options.brightness:1;for(const img of $('eds-analysis-views').querySelectorAll('img[data-intensity-map]'))img.style.filter=`brightness(${gain})`}

 function noisePlot(root,tiles){
  const available=tiles.filter(t=>t.noise_check?.available);if(!available.length)return;
  const figure=el('figure',undefined,'eds-noise-plot');root.append(figure);
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),width=650,height=available.length*32+30,left=180,right=45,span=width-left-right;
  svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('role','img');svg.setAttribute('aria-label','Observed variation compared with shuffled median and 95th percentile');figure.append(svg);
  const add=(tag,attrs,text)=>{const n=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;svg.append(n);return n};
  const max=Math.max(...available.flatMap(t=>[t.noise_check.observed_cv,t.noise_check.shuffled_95]))*1.12,X=v=>left+span*v/max;
  for(let i=0;i<=4;i++){const x=left+span*i/4;add('line',{x1:x,x2:x,y1:0,y2:height-22,stroke:'#314454','stroke-width':1});add('text',{x,y:height-6,'text-anchor':'middle',fill:'#a7b8c9','font-size':11},(100*max*i/4).toFixed(1)+'%')}
  available.forEach((tile,i)=>{const c=tile.noise_check,y=16+i*32;
   const text=add('text',{x:0,y:y+4,fill:tile.colour,'font-size':12},tile.label.length>25?tile.label.slice(0,24)+'…':tile.label);const title=document.createElementNS(ns,'title');title.textContent=tile.label;text.append(title);
   add('line',{x1:X(0),x2:X(c.shuffled_95),y1:y,y2:y,stroke:'#63798b','stroke-width':6});
   add('line',{x1:X(c.shuffled_cv),x2:X(c.shuffled_cv),y1:y-7,y2:y+7,stroke:'#e5edf7','stroke-width':2});
   add('line',{x1:X(c.shuffled_95),x2:X(c.shuffled_95),y1:y-7,y2:y+7,stroke:'#8fa4b7','stroke-width':2});
   const point=add('circle',{cx:X(c.observed_cv),cy:y,r:5,fill:tile.colour,stroke:'#07101b','stroke-width':1});const tip=document.createElementNS(ns,'title');tip.textContent=`${tile.label}: observed ${(100*c.observed_cv).toFixed(1)}%; shuffled median ${(100*c.shuffled_cv).toFixed(1)}%; 95th ${(100*c.shuffled_95).toFixed(1)}%`;point.append(tip);
  });
  figure.append(el('figcaption','● Observed · white tick: shuffled median · grey bar ends at shuffled 95th','hint'));
 }

 function linePlots(root,row,result){
  for(const tile of row.tiles.filter(t=>t.error))root.append(el('p',`${tile.label}: ${tile.error}`,'eds-channel-error'));row={...row,tiles:row.tiles.filter(t=>!t.error)};
  if(!row.tiles.length){root.append(el('p','Select an element other than the ratio denominator.','hint'));return}
  const display={...current.options},overlay=row.overlay??display.layout==='overlay',normalized=result.normalisation!=='none',baseline=normalized?1:0;
  const stack=el('div',undefined,`eds-line-plots${overlay?' eds-line-overlay':''}`);root.append(stack);
  const readout=el('p',row.trimmed?`${row.viewStart.toFixed(1)}–${(row.viewStart+row.viewLength).toFixed(1)} ${row.distance_unit} of scan · axis starts at selection`:`${row.length.toFixed(1)} ${row.distance_unit} · start → end`,'eds-line-readout');readout.title=row.calibration;root.append(readout);
  const normalLabel=({median:'Median',mean:'Mean',p20:'P20'})[result.normalisation];
  const noise=el('details',undefined,'eds-noise-check'),summary=el('summary','Spatial structure');
  const checks=row.tiles.filter(t=>t.noise_check?.available);
  if(checks.length)summary.append(el('span',' · '+checks.map(t=>`${t.label}: ${t.noise_check.structure_ratio.toFixed(1)}×`).join(' · '),'hint'));
  noise.append(summary);root.append(noise);
  noisePlot(noise,row.tiles);
  noise.append(el('p','Smoothed variation compared with 256 paired shuffles of the same measurements. Around 1× means random ordering produces similar variation. Larger values indicate spatial structure, which can also come from drift, thickness or correlated noise; this is not a segregation test or a percentage of noise.','hint'));
  const table=el('table',undefined,'eds-noise-table'),head=el('tr');for(const text of ['Profile','Variation','Shuffled median','Shuffled 95th'])head.append(el('th',text));table.append(head);
  for(const tile of row.tiles){const check=tile.noise_check,tr=el('tr');tr.append(el('td',tile.label));if(check?.available){for(const value of [check.observed_cv,check.shuffled_cv,check.shuffled_95])tr.append(el('td',(100*value).toFixed(1)+'%'))}else{const cell=el('td',check?.reason||'Unavailable');cell.colSpan=3;tr.append(cell)}table.append(tr)}noise.append(table);
  noise.append(el('p','Full acquisition: variation = standard deviation ÷ mean of the smoothed profile, excluding 3σ at each end. The 95th percentile is a reference for this shuffle model, not a confidence interval. Numerator/denominator stay paired; channels are smoothed before division. Display normalization does not affect the result. Spatially correlated errors and instrument/systematic uncertainty are not estimated.','hint'));
  const rangeFor=tiles=>{
   if(!normalized&&result.mode==='ratio'&&(!current.comparison||display.scale_scope!=='off'))return Math.max(...tiles.map(t=>t.maximum));
   // Underlying data is a display overlay; it must never change the plot scale.
   let delta=normalized?.2:1e-12;for(const tile of tiles)for(const value of tile.y)if(Number.isFinite(value))delta=Math.max(delta,Math.abs(value-baseline));return delta*1.12;
  };
  // Normalized panels share the same scale, so relative enrichment remains comparable.
  const sharedRange=normalized||overlay?rangeFor(row.tiles):null;
  const panels=overlay?[row.tiles]:row.tiles.map(t=>[t]);
  panels.forEach((tiles,index)=>{
   const figure=el('figure',undefined,'eds-line-tile');stack.append(figure);
   const caption=el('figcaption',undefined,'eds-line-caption');for(const tile of tiles){const label=el('span',tile.label);label.style.color=tile.colour;label.title=tile.source||tile.label;caption.append(label)}figure.append(caption);
   const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('role','img');svg.setAttribute('aria-label',`${tiles.map(t=>t.label).join(', ')} over centred scan image`);figure.append(svg);
   const linkedRange=row.sharedRanges?Math.max(...tiles.map(t=>row.sharedRanges.get(t.scaleKey)||0)):0;
   const range=linkedRange||sharedRange||rangeFor(tiles),showX=index===panels.length-1;
   const observer=new ResizeObserver(draw);plotObservers.push(observer);observer.observe(svg);
   function draw(){
    if(!svg.isConnected){observer.disconnect();return}
    svg.replaceChildren();const w=Math.max(150,svg.clientWidth),h=svg.clientHeight,left=w<400?40:48,right=8,top=4,bottom=showX?21:6,pw=Math.max(60,w-left-right),ph=h-top-bottom,centre=top+ph/2;
    svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
    const nativeExtent=row.image_extent||[-.035,1.035,-.23,.23],axisLength=row.axisLength||row.length,extent=row.axisLength?[-.035,1.035,nativeExtent[2],nativeExtent[3]]:nativeExtent,span=extent[1]-extent[0],viewStart=row.viewStart||0,viewLength=row.viewLength||row.length;
    if(index===0&&current.comparison){for(const ref of referenceCursors){if(ref.unit!==row.distance_unit||(!row.overlay||current.options.layout!=='overlay')&&ref.acquisition!==row.acquisition)continue;const length=ref.row.length,halfHeight=ph/2/(pw/span)*axisLength/length;ref.updateCrop([Math.max(ref.row.image_extent[0],(ref.row.viewStart+(ref.row.trimmed?0:extent[0]*axisLength))/length),Math.min(ref.row.image_extent[1],(ref.row.viewStart+(ref.row.trimmed?ref.row.viewLength:extent[1]*axisLength))/length),Math.max(ref.row.image_extent[2],-halfHeight),Math.min(ref.row.image_extent[3],halfHeight)])}}
    if(index===0&&!current.comparison){const halfHeight=ph/2/(pw/span);setLineCrop(tiles[0].path,[extent[0],extent[1],Math.max(extent[2],-halfHeight),Math.min(extent[3],halfHeight)])}
    const X=x=>left+pw*(x/axisLength-extent[0])/span,Y=y=>centre-(y-baseline)*(ph/2-7)/range;
    const add=(tag,attrs,text,parent=svg)=>{const n=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;parent.append(n);return n};
    const clipId=`eds-line-clip-${++plotSerial}`,defs=add('defs',{}),clip=add('clipPath',{id:clipId},undefined,defs);add('rect',{x:row.trimmed?X(0):left,y:top,width:row.trimmed?X(viewLength)-X(0):pw,height:ph},undefined,clip);const plot=add('g',{'clip-path':`url(#${clipId})`});
    if(display.background&&row.background){const scale=pw/span*row.length/axisLength;add('image',{href:row.background,x:X(nativeExtent[0]*row.length-viewStart),y:centre+nativeExtent[2]*scale,width:(nativeExtent[1]-nativeExtent[0])*scale,height:(nativeExtent[3]-nativeExtent[2])*scale,preserveAspectRatio:'xMidYMid meet'},undefined,plot)}
    add('line',{x1:left,y1:centre,x2:left+pw,y2:centre,stroke:'#000','stroke-width':3,opacity:.8},undefined,plot);
    add('line',{x1:left,y1:centre,x2:left+pw,y2:centre,stroke:'#fff','stroke-width':1,'stroke-dasharray':'5 4',opacity:.8},undefined,plot);
    add('circle',{cx:X(0),cy:centre,r:3,fill:'#fff',stroke:'#000'},undefined,plot);add('path',{d:`M${X(viewLength)-7},${centre-4} L${X(viewLength)},${centre} L${X(viewLength)-7},${centre+4}Z`,fill:'#fff',stroke:'#000'},undefined,plot);
    const path=(tile,values)=>{let d='',move=true;values.forEach((y,i)=>{if(!Number.isFinite(y)){move=true;return}d+=`${move?'M':'L'}${X(tile.x[i]-(tile.viewStart||0))},${Y(y)} `;move=false});return d};
    if(display.raw)for(const tile of tiles){const d=path(tile,tile.raw);add('path',{d,fill:'none',stroke:'#07101b',opacity:.7,'stroke-width':2.5},undefined,plot);add('path',{d,fill:'none',stroke:tile.colour,opacity:.85,'stroke-width':1.2},undefined,plot)}
    for(const tile of tiles){const d=path(tile,tile.y);add('path',{d,fill:'none',stroke:'#fff',opacity:.9,'stroke-width':3.5,'stroke-linejoin':'round'},undefined,plot);add('path',{d,fill:'none',stroke:tile.colour,'stroke-width':2,'stroke-linejoin':'round'},undefined,plot)}
    const fmt=v=>Number(v.toPrecision(3)).toString();for(const value of [baseline+range,baseline,baseline-range])if(value>=0)add('text',{x:left-5,y:Y(value)+3,fill:'#becbda','text-anchor':'end','font-size':10},fmt(value));
    if(showX){for(let i=0;i<=4;i++){const x=axisLength*i/4;add('text',{x:X(x),y:h-5,fill:'#becbda','text-anchor':'middle','font-size':10},`${x.toFixed(0)}${i===4?' '+row.distance_unit:''}`)}}
    add('text',{x:left+5,y:top+11,fill:'#fff',stroke:'#000','stroke-width':2,'paint-order':'stroke','font-size':10},normalized?`${normalLabel} = 1 on scan`:tiles[0].unit);
    const cursor=add('line',{x1:X(0),x2:X(0),y1:top,y2:top+ph,stroke:'#fff','stroke-dasharray':'3 3',visibility:'hidden'});
    svg.onpointermove=e=>{const box=svg.getBoundingClientRect(),sx=(e.clientX-box.left)*w/box.width,distance=((sx-left)/pw*span+extent[0])*axisLength;cursor.setAttribute('x1',X(distance));cursor.setAttribute('x2',X(distance));cursor.setAttribute('visibility','visible');
     const readings=tiles.map(t=>{const length=t.x.at(-1),i=Math.round((distance+(t.viewStart||0))/length*(t.x.length-1));return `${t.label}: ${i>=0&&i<t.y.length&&Number.isFinite(t.y[i])?fmt(t.y[i]):'—'}`});
     if(!current.comparison)setLineCursor(tiles[0].path,Math.max(0,Math.min(1,distance/row.length)));
     for(const ref of referenceCursors)ref.update(ref.unit===row.distance_unit?distance:null);
     readout.textContent=`${distance.toFixed(1)} ${row.distance_unit} · `+readings.join(' · ')};svg.onpointerleave=()=>{cursor.setAttribute('visibility','hidden');setLineCursor(null);for(const ref of referenceCursors)ref.update(null)};

   }
   draw();
  });
 }

 return {open,close,groups};
};

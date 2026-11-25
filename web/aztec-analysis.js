window.aztecAcquisitionDimensions={text(value,kind){
 if(!value)return '';const numbers=kind==='line'?[value.length]:[value.width,value.height];if(!numbers.every(n=>Number.isFinite(n)&&n>0))return '';
 const microns=value.distance_unit==='nm'&&Math.max(...numbers)>=1000,scale=microns?1000:1,unit=microns?'µm':value.distance_unit;
 return numbers.map(n=>Number((n/scale).toPrecision(4)).toString()).join(' × ')+' '+unit;
}};
/* Shared colour memory across AZtec map/line comparisons; no automatic assignment. */
(() => {
 'use strict';
 const storageKey='tem-aztec-label-colours-v1',limit=128;
 const normalise=value=>{const hex=String(value||'').trim().replace(/^#/,'');return /^(?:[\da-f]{3}|[\da-f]{6})$/i.test(hex)?'#'+(hex.length===3?[...hex].map(c=>c+c).join(''):hex).toLowerCase():null};
 const name=value=>String(value||'').trim().replace(/\s+/g,' ').toLowerCase();
 const clean=entry=>({colour:normalise(entry?.colour),label:String(entry?.label||'').trim().slice(0,120),sample:String(entry?.sample||'').trim().slice(0,120),used:Number(entry?.used)||0});
 const identity=entry=>[entry.colour,name(entry.label),name(entry.sample)].join('|');
 function suggestions(history,inUse,context){
  const wantedLabel=name(context.label),wantedSample=name(context.sample),colours=new Map();
  for(const entry of [...history.map(e=>({...e,inUse:false})),...inUse.map(e=>({...e,inUse:true}))]){
   const item={...clean(entry),inUse:entry.inUse};if(!item.colour)continue;
   const names=[name(item.label),name(item.sample)].filter(Boolean);
   const labelMatch=!!wantedLabel&&names.includes(wantedLabel),sampleMatch=!!wantedSample&&names.includes(wantedSample);
   item.rank=labelMatch?0:sampleMatch?1:item.inUse?2:3;
   item.reason=labelMatch?'Matches '+context.label:sampleMatch?'Matches '+context.sample:item.inUse?'In use':'Recent';
   const previous=colours.get(item.colour);
   if(!previous||item.rank<previous.rank||item.rank===previous.rank&&(item.inUse>previous.inUse||item.inUse===previous.inUse&&item.used>previous.used))colours.set(item.colour,item);
  }
  return [...colours.values()].sort((a,b)=>a.rank-b.rank||Number(b.inUse)-Number(a.inUse)||b.used-a.used||a.colour.localeCompare(b.colour)).slice(0,24);
 }
 function create(storage){
  let history=[];try{const stored=JSON.parse(storage.readRaw(storageKey)||'[]');if(Array.isArray(stored))history=stored.map(clean).filter(e=>e.colour).sort((a,b)=>b.used-a.used).slice(0,limit)}catch{}
  const save=()=>storage.writeRaw(storageKey,JSON.stringify(history));
  function remember(entry){const item=clean(entry);if(!item.colour)return;item.used=Math.max(Date.now(),(history[0]?.used||0)+1);history=[item,...history.filter(e=>identity(e)!==identity(item))].slice(0,limit);save()}
  function seed(entries){let changed=false;for(const entry of entries){const item=clean(entry);if(item.colour&&!history.some(e=>identity(e)===identity(item))){history.push(item);changed=true}}if(changed){history=history.slice(0,limit);save()}}
  return {remember,seed,suggestions:(inUse,context)=>suggestions(history,inUse,context)};
 }
 let active=null;
 function open({anchor,title,colour,choices,onSelect,focus=true}){
  if(active){active.close();active=null}
  const make=(tag,text,cls)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(cls)node.className=cls;return node};
  const dialog=make('dialog',null,'eds-colour-palette'),head=make('div',null,'eds-colour-palette-head'),heading=make('strong','Label colour'),close=make('button','×');
  dialog.setAttribute('aria-label','Label colours for '+title);close.type='button';close.setAttribute('aria-label','Close colour suggestions');close.onclick=()=>dialog.close();head.append(heading,close);dialog.append(head);
  let section=null,grid=null;
  for(const choice of choices){
   const group=choice.rank<2?'Suggested':choice.rank===2?'In use':'Recent';
   if(group!==section){section=group;dialog.append(make('span',group,'eds-colour-palette-heading'));grid=make('div',null,'eds-colour-swatches');dialog.append(grid)}
   const button=make('button'),swatch=make('span',null,'eds-colour-swatch'),caption=make('span',choice.colour);button.type='button';swatch.style.backgroundColor=choice.colour;
   button.title=choice.reason+(choice.label?' · '+choice.label:'');button.setAttribute('aria-label',choice.colour+' · '+choice.reason);button.setAttribute('aria-pressed',String(choice.colour===normalise(colour)));button.append(swatch,caption);button.onclick=()=>{onSelect(choice.colour);dialog.close()};grid.append(button);
  }
  if(!choices.length)dialog.append(make('p','Your chosen colours will appear here.','hint'));
  const custom=make('label','Custom colour'),picker=make('input');picker.type='color';picker.value=normalise(colour)||'#0c131c';picker.setAttribute('aria-label','Custom label colour');picker.onchange=()=>{onSelect(picker.value);dialog.close()};custom.append(picker);dialog.append(custom);
  dialog.addEventListener('close',()=>{if(active===dialog)active=null;anchor.setAttribute('aria-expanded','false');dialog.remove();if(anchor.isConnected)anchor.focus({preventScroll:true})},{once:true});
  document.body.append(dialog);dialog.show();active=dialog;anchor.setAttribute('aria-expanded','true');
  const box=anchor.getBoundingClientRect(),size=dialog.getBoundingClientRect();
  dialog.style.left=Math.max(8,Math.min(box.left,innerWidth-size.width-8))+'px';
  dialog.style.top=Math.max(8,Math.min(box.bottom+6,innerHeight-size.height-8))+'px';
  (focus?(dialog.querySelector('.eds-colour-swatches button')||picker):anchor).focus({preventScroll:true});
 }
 window.aztecLabelColours={normalise,create,suggestions,open};
})();

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
 snapshot(context,{aliases={},labelColours={},crops={}}={}){
  const item={options:context.options,files:context.files||[],ids:context.ids,signals:context.signals,aliases:{},labelColours:{},crops:{}};
  for(const id of context.ids){const key='compare:'+id;for(const [field,values]of Object.entries({aliases,labelColours,crops}))if(values[key]!==undefined)item[field][id]=values[key]}
  return structuredClone(item);
 },
 saveActive(presets,active,key,snapshot){
  const item=(presets[key]||[]).find(item=>item.name===active[key]);
  if(item)Object.assign(item,structuredClone(snapshot));return item;
 },
 saveAs(presets,active,key,snapshot,name){
  name=String(name||'').trim();if(!name)throw new Error('Enter a name.');
  const items=presets[key]??=[];if(items.some(item=>item.name===name))throw new Error('That name is already used. Choose a different name.');
  const item={...structuredClone(snapshot),name};items.push(item);active[key]=name;return item;
 },
 rename(presets,active,key,name){
  name=String(name||'').trim();if(!name)throw new Error('Enter a name.');
  const items=presets[key]||[],item=items.find(item=>item.name===active[key]);if(!item)throw new Error('Select a saved comparison.');
  if(items.some(other=>other!==item&&other.name===name))throw new Error('That name is already used. Choose a different name.');
  item.name=name;active[key]=name;return item;
 },
 compatibleUnit:unit=>({'Window-count ratio':'Signal ratio','Relative window count':'Relative signal'})[unit]||unit,
 identity:(source,id)=>JSON.stringify([source,id]),
 relocations(known,files){
  const current=new Map(files.filter(file=>file.kind==='OIPX'&&file.project_id).map(file=>[file.path,file.project_id]));
  const missing=new Map(),available=new Map();
  for(const [path,id] of current){const paths=available.get(id)||[];paths.push(path);available.set(id,paths)}
  for(const [path,id] of Object.entries(known))if(!current.has(path)){const paths=missing.get(id)||[];paths.push(path);missing.set(id,paths)}
  const moves={};
  for(const [id,paths] of missing)if(available.get(id)?.length===1)for(const path of paths)moves[path]=available.get(id)[0];
  return moves;
 },
 relocate(saved,moves){
  const copy=structuredClone(saved),changeSource=path=>moves[path]||path;
  const changeId=id=>{try{const pair=JSON.parse(id);if(Array.isArray(pair)&&pair.length===2&&moves[pair[0]])return this.identity(moves[pair[0]],pair[1])}catch{}return id};
  const changeKey=key=>{
   if(key.startsWith('compare:'))return 'compare:'+changeId(key.slice(8));
   for(const [oldPath,newPath] of Object.entries(moves))if(key.startsWith(oldPath+':'))return newPath+key.slice(oldPath.length);
   return key;
  };
  const rekey=(entries,rename,change=value=>value)=>{
   const result={};for(const [key,value] of Object.entries(entries||{})){const next=rename(key);result[next!==key&&Object.hasOwn(entries,next)?key:next]=change(value)}return result;
  };
  const options=value=>{for(const key of ['ipf_legend_target','kam_legend_target'])if(value?.[key])value[key]=changeId(value[key]);for(const key of ['line_offsets','overview_images','kam_sources'])if(value?.[key])value[key]=rekey(value[key],changeId);return value};
  const selection=value=>{
   if(Array.isArray(value?.ids))value.ids=[...new Set(value.ids.map(changeId))];
   if(Array.isArray(value?.files))value.files=[...new Set(value.files.map(changeSource))];
   if(value?.aliases)value.aliases=rekey(value.aliases,changeId);
   if(value?.labelColours)value.labelColours=rekey(value.labelColours,changeId);
   if(value?.crops)value.crops=rekey(value.crops,changeId);
   if(value?.options)options(value.options);
   return value;
  };
  copy.preferences=rekey(copy.preferences,changeKey,options);
  copy.selections=rekey(copy.selections,changeKey,selection);
  copy.presets=rekey(copy.presets,changeKey,items=>items.map(selection));
  copy.aliases=rekey(copy.aliases,changeKey);
  copy.labelColours=rekey(copy.labelColours,changeKey);
  copy.crops=rekey(copy.crops,changeKey);
  return copy;
 },
 reconcileChannels(signals,denominator,available,previous=available){
  const selected=new Set(signals),before=new Set(previous);
  return {signals:available.filter(s=>selected.has(s)||!before.has(s)),denominator:available.includes(denominator)?denominator:available.find(s=>s.startsWith('Ti '))||available[0]||''};
 },
 target(id,source=''){try{const pair=JSON.parse(id);if(Array.isArray(pair)&&pair.length===2)return {source:pair[0],acquisition:pair[1]}}catch{}return {source,acquisition:id}},
 migrate(saved,preferredSource=''){
  if(saved.comparisonScope===2)return saved;
  const result=structuredClone(saved),object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  for(const key of ['preferences','selections','presets','aliases','labelColours','crops'])result[key]=object(result[key]);
  const keys=[...new Set([...Object.keys(result.selections),...Object.keys(result.presets),...Object.keys(result.preferences)])]
   .map(key=>({key,match:key.match(/^compare-(.*):(XrayMapImages|QuantMapImages|AtomicMapImages|KamMapImages|XrayLinescans|QuantLinescans)$/)})).filter(x=>x.match)
   .sort((a,b)=>(b.match[1]===preferredSource)-(a.match[1]===preferredSource));
  for(const {key,match:[,source,table]} of keys){
   const destination=this.key(table),qualify=id=>{const ref=this.target(id,source);return this.identity(ref.source,ref.acquisition)};
   const convert=item=>{
    const copy=structuredClone(item),ids=item.ids||[];copy.ids=ids.map(qualify);
    copy.files=[...new Set([...(item.files||[]),...ids.map(id=>this.target(id,source).source)])];
    for(const field of ['aliases','labelColours','crops'])copy[field]=Object.fromEntries(Object.entries(item[field]||{}).map(([id,value])=>[qualify(id),value]));
    for(const key of ['ipf_legend_target','kam_legend_target'])if(copy.options?.[key])copy.options[key]=qualify(copy.options[key]);
    for(const field of ['line_offsets','overview_images','kam_sources'])if(copy.options?.[field])copy.options[field]=Object.fromEntries(Object.entries(copy.options[field]).map(([id,value])=>[qualify(id),value]));
    return copy;
   };
   if(!result.selections[destination]&&result.selections[key]){
    const item=convert({...result.selections[key],options:result.preferences[key]||{}});
    result.selections[destination]={ids:item.ids,files:item.files,signals:item.signals};result.preferences[destination]=item.options;
    for(const id of result.selections[key].ids||[])for(const field of ['aliases','labelColours','crops']){
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
window.aztecKamSources={
 choices:[['native','Native OIPX'],['h5_processed','H5OINA · Recalculate KAM'],['h5_saved','H5OINA · Saved KAM']],
 mode:(options,id)=>options.kam_sources?.[id]||options.kam_source||'native',
 allSaved:(options,ids)=>ids.length>0&&ids.every(id=>window.aztecKamSources.mode(options,id)==='h5_saved'),
 accepted:(options,ids,result)=>ids.every(id=>window.aztecKamSources.mode(options,id)==='native'||result.kam_sources?.[id]===window.aztecKamSources.mode(options,id)),
 configuration(kam){if(!kam?.kernel_size)return 'Settings unavailable';return `${kam.kernel_size}×${kam.kernel_size} ${(kam.kernel_shape||'square').toLowerCase()} · ${kam.only_periphery?'periphery':'all neighbours'} · max ${kam.maximum_angle_degrees}° · min ${kam.minimum_angle_degrees==null?'not stored':kam.minimum_angle_degrees+'°'}`}
};
/* Preview work is serialized, bounded and independent of the active comparison. */
window.aztecComparisonPreviews={
 serial:0,
 create(render){
  const cache=new Map();let queue=Promise.resolve();
  return (entry,wanted=()=>true)=>{
   const snapshot=structuredClone(entry),key=JSON.stringify([snapshot.table,snapshot.item]);
   const task=queue.then(async()=>{
    if(!wanted())return null;
    const hit=cache.get(key);if(hit&&Date.now()-hit.time<60000){cache.delete(key);cache.set(key,hit);return hit.image}
    const image=await render(snapshot);cache.set(key,{image,time:Date.now()});while(cache.size>8)cache.delete(cache.keys().next().value);return image;
   });queue=task.catch(()=>{});return task;
  };
 }
};
window.aztecComparisonPicker={
 open({anchor,entries,selected,preview,onSelect}){
  const make=(tag,text,cls)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(cls)node.className=cls;return node};
  const dialog=make('dialog',null,'eds-comparison-picker'),head=make('div',null,'eds-comparison-picker-head'),close=make('button','×');
  dialog.setAttribute('aria-label','Saved comparison previews');close.type='button';close.setAttribute('aria-label','Close comparison picker');close.onclick=()=>dialog.close();head.append(make('strong','Saved comparisons'),close);
  const body=make('div',null,'eds-comparison-picker-body'),list=make('div',null,'eds-comparison-picker-list'),pane=make('div',null,'eds-comparison-picker-preview'),title=make('strong'),stage=make('div',null,'eds-comparison-picker-image'),status=make('p','Hover or focus a comparison to preview it.','hint'),open=make('button','Open comparison');
  list.setAttribute('aria-label','Comparisons');status.setAttribute('role','status');open.type='button';open.disabled=true;pane.append(title,stage,status,open);body.append(list,pane);dialog.append(head,body);
  let active=null,timer=null,revision=0;const buttons=[];
  const choose=()=>{if(!active)return;const value=active.value;dialog.close();onSelect(value)};open.onclick=choose;
  function show(entry,button){
   if(active===entry)return;active=entry;clearTimeout(timer);const turn=++revision;
   for(const item of buttons)item.classList.toggle('eds-preview-active',item===button);
   title.textContent=entry.item.name;stage.replaceChildren();status.textContent='Loading preview…';open.disabled=false;
   timer=setTimeout(async()=>{
    const wanted=()=>dialog.open&&turn===revision;
    try{const source=await preview(entry,wanted);if(!wanted()||!source)return;const image=make('img');image.alt=entry.item.name+' comparison preview';image.src=source;await image.decode();if(!wanted())return;stage.replaceChildren(image);status.textContent='';}
    catch(error){if(wanted())status.textContent='Preview unavailable: '+error.message}
   },160);
  }
  let family=null;
  for(const entry of entries){
   if(entry.family!==family){family=entry.family;list.append(make('div',family,'eds-comparison-picker-group'))}
   const button=make('button',entry.item.name);button.type='button';button.setAttribute('aria-current',String(entry.value===selected));buttons.push(button);list.append(button);
   button.onmouseenter=()=>show(entry,button);button.onfocus=()=>show(entry,button);
   button.onclick=event=>{show(entry,button);if(event.pointerType!=='touch')choose()};
   button.onkeydown=event=>{const index=buttons.indexOf(button),next=event.key==='ArrowDown'?Math.min(buttons.length-1,index+1):event.key==='ArrowUp'?Math.max(0,index-1):event.key==='Home'?0:event.key==='End'?buttons.length-1:null;if(next!==null){event.preventDefault();buttons[next].focus()}};
  }
  if(!entries.length){list.append(make('p','No saved comparisons yet.','hint'));status.textContent='Save a comparison to preview it here.'}
  const dismiss=()=>dialog.close();
  dialog.addEventListener('close',()=>{++revision;clearTimeout(timer);window.removeEventListener('resize',dismiss);anchor.setAttribute('aria-expanded','false');dialog.remove();if(anchor.isConnected)anchor.focus({preventScroll:true})},{once:true});
  document.body.append(dialog);dialog.showModal();anchor.setAttribute('aria-expanded','true');window.addEventListener('resize',dismiss);
  const box=anchor.getBoundingClientRect(),size=dialog.getBoundingClientRect();dialog.style.left=Math.max(8,Math.min(box.left,innerWidth-size.width-8))+'px';dialog.style.top=Math.max(8,Math.min(box.bottom+6,innerHeight-size.height-8))+'px';
  (buttons.find(button=>button.getAttribute('aria-current')==='true')||buttons[0]||close).focus({preventScroll:true});
 }
};
/* Live views of the existing EDX report operations. Inputs stay read-only. */
window.createAztecAnalysis=({$,el,state,api,highlightRegions,setLineCrop,setLineCursor,setMapCursor,remember,projectOverviewStrip,isSourceVisible=()=>true,ensureSourcesVisible=()=>{},previewOnly=false})=>{
 const workspace=previewOnly?{readRaw:()=>null,writeRaw:()=>{}}:WorkbenchWorkspace;
 const plotNamespace=previewOnly?'eds-preview-'+(++window.aztecComparisonPreviews.serial):'eds';
 let current=null,version=0,smoothingTimer=null,plotObservers=[],overviewObservers=[],plotSerial=0,referenceCursors=[],linePlotCursors=new Map(),linePanDrag=null,layoutVersion=0,mapHover=null;
 let savedViews={};try{const saved=JSON.parse(workspace.readRaw('tem-eds-comparison-v1')||'{}');if(saved&&typeof saved==='object')savedViews=saved}catch{}
 let previousFile='';try{previousFile=JSON.parse(workspace.readRaw('tem-eds-browser')||'{}').file||''}catch{}
 const comparisonState=window.aztecComparisonState;savedViews=comparisonState.migrate(savedViews,previousFile);
 const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 const preferences=object(savedViews.preferences),selections=object(savedViews.selections),cropCentres=new Map(Object.entries(object(savedViews.crops))),aliases=object(savedViews.aliases),labelColours=object(savedViews.labelColours),presets=object(savedViews.presets),structureCache=new Map();
 const lastTables=object(savedViews.lastTables),activePresets=object(savedViews.activePresets);
 const colourMemory=window.aztecLabelColours.create(workspace);
 const comparisonPreview=window.aztecComparisonPreviews.create(renderSavedComparison);
 let persistTimer=null,openVersion=0;
 const catalogues=new Map(),catalogueRequests=new Map(),sourceErrors=new Map(),thumbnailRequests=new Map();let thumbnailObserver=null;
 const projectKey=()=>state.file?.catalogue.source.path||'';
 const target=id=>comparisonState.target(id,projectKey());
 const viewKey=table=>comparisonState.key(table);
 const itemKey=id=>current?.comparison?'compare:'+id:projectKey()+':'+id;
 const acquisitionRequest=(context,ids=context.ids)=>context.comparison?{targets:ids.map(target)}:{acquisitions:ids};
 const fileName=path=>path.split(/[\\/]/).pop();
 const channelNamesFor=all=>[...new Set(all.flatMap(g=>g.signals))].sort((a,b)=>{const order=['Ti','V','Fe','Al'],rank=x=>{const n=order.indexOf(x.split(' ')[0]);return n<0?99:n};return rank(a)-rank(b)||a.localeCompare(b)});
 const selectedChannelNames=context=>channelNamesFor(context.all.filter(group=>context.ids.includes(group.id)));
 function reconcileSelectedChannels(context,previous){
  const channels=selectedChannelNames(context),selection=comparisonState.reconcileChannels(context.signals,context.options.denominator,channels,previous);
  context.signals=selection.signals;context.options.denominator=selection.denominator;return channels;
 }
 function persist(){
  if(current){preferences[current.preferenceKey]={...current.options};selections[current.preferenceKey]={ids:[...current.ids],signals:[...current.signals],files:[...(current.files||[])]}}
  const blocked=current?.comparison&&current.files.some(path=>sourceErrors.has(path));
  if(current?.comparison&&!blocked)comparisonState.saveActive(presets,activePresets,current.preferenceKey,comparisonSnapshot(current));
  clearTimeout(persistTimer);
  const status=$('eds-analysis-tools').querySelector('.eds-comparison-save-status');
  try{WorkbenchWorkspace.writeRaw('tem-eds-comparison-v1',JSON.stringify({comparisonScope:2,lastTables,activePresets,preferences,selections,aliases,labelColours,presets,crops:Object.fromEntries([...cropCentres].slice(-200))}));if(status){status.textContent=current?.comparison&&activePresets[current.preferenceKey]?(blocked?'Autosave paused: a project could not be read.':'Autosave on'):'';status.classList.toggle('eds-channel-error',!!blocked)}}
  catch(error){if(status){status.textContent='Could not save comparison: '+error.message;status.classList.add('eds-channel-error')}console.warn('AZtec comparison settings could not be saved:',error.message)}
 }
 function comparisonSnapshot(context){return comparisonState.snapshot(context,{aliases,labelColours,crops:Object.fromEntries(cropCentres)})}
 function restorePreset(item,key){
  preferences[key]=structuredClone(item.options);selections[key]={ids:[...item.ids],signals:[...item.signals],files:[...(item.files||[])]};
  for(const id of item.ids){const cropKey='compare:'+id;if(item.crops?.[id])cropCentres.set(cropKey,[...item.crops[id]]);else cropCentres.delete(cropKey);if(item.aliases?.[id])aliases[cropKey]=item.aliases[id];else delete aliases[cropKey];if(item.labelColours?.[id])labelColours[cropKey]=item.labelColours[id];else delete labelColours[cropKey]}
 }
 function relocateSources(moves){
  if(!Object.keys(moves).length)return null;
  persist();
  const reopen=current?.comparison?{kind:current.kind,table:current.table}:null;
  if(reopen||moves[projectKey()])current=null;
  const changed=comparisonState.relocate({preferences,selections,presets,aliases,labelColours,crops:Object.fromEntries(cropCentres)},moves);
  for(const [name,target] of [['preferences',preferences],['selections',selections],['presets',presets],['aliases',aliases],['labelColours',labelColours]]){
   for(const key of Object.keys(target))delete target[key];Object.assign(target,changed[name]);
  }
  cropCentres.clear();for(const [key,value] of Object.entries(changed.crops))cropCentres.set(key,value);
  for(const path of Object.keys(moves)){catalogues.delete(path);sourceErrors.delete(path)}
  persist();return reopen;
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
  document.body.classList.toggle('eds-comparison-mode',!!kind);
  $('eds-mode-browse').setAttribute('aria-pressed',String(!kind));$('eds-mode-compare').setAttribute('aria-pressed',String(!!kind));$('eds-compare-kinds').hidden=!kind;
  $('eds-status').hidden=!!kind;
  $('eds-compare').setAttribute('aria-pressed',String(kind==='map'));
  $('eds-compare-lines').setAttribute('aria-pressed',String(kind==='line'));
  for(const button of $('eds-acquisitions').querySelectorAll('.eds-site'))button.setAttribute('aria-current',String(!kind&&button.dataset.source===state.file?.catalogue.source.path&&button.dataset.index===String(state.acquisition?.index)));
  for(const button of $('eds-acquisitions').querySelectorAll('.eds-export-entry'))button.setAttribute('aria-current',String(!kind&&button.dataset.source===state.file?.catalogue.source.path));
 }
 function clearPlotObservers(){hideMapHover();for(const observer of plotObservers)observer.disconnect();plotObservers=[];referenceCursors=[];linePlotCursors.clear();setLineCursor(null);setMapCursor(null)}
 function groups(catalogue=state.file?.catalogue){
  const sampleOrder=new Map();for(const a of catalogue?.acquisitions||[]){const sample=a.specimen||a.label;if(!sampleOrder.has(sample))sampleOrder.set(sample,sampleOrder.size)}
  const found=new Map();for(const a of catalogue?.acquisitions||[])for(const l of a.layers)for(const d of l.signals){
   const table=d.path.split('/')[1],kind=['XrayMapImages','QuantMapImages','AtomicMapImages','KamMapImages'].includes(table)?'map':['XrayLinescans','QuantLinescans'].includes(table)?'line':null,id=d.attributes['Acquisition ID'];if(!kind||!id)continue;
   const key=id+':'+table;if(!found.has(key))found.set(key,{id,table,kind,dimensions:catalogue.acquisition_dimensions?.[id],sample:a.specimen||a.label,siteName:a.label,site:[a.specimen,a.label].filter(Boolean).join(' / '),name:d.attributes.Acquisition,label:[a.specimen,a.label,d.attributes.Acquisition].filter(Boolean).join(' / '),derived:d.attributes['Record type']==='Reconstructed Kα1 window',signals:[],paths:[]});const g=found.get(key);g.signals.push(d.attributes.Label);g.paths.push(d.path);
  }return [...found.values()].sort((a,b)=>(a.table==='QuantLinescans')-(b.table==='QuantLinescans')||sampleOrder.get(a.sample)-sampleOrder.get(b.sample)||a.siteName.localeCompare(b.siteName,undefined,{numeric:true})||a.name.localeCompare(b.name,undefined,{numeric:true}));
 }
 function comparisonGroups(paths){return paths.flatMap(source=>(catalogues.has(source)?groups(catalogues.get(source)):[]).map(g=>({...g,id:comparisonState.identity(source,g.id),source,label:fileName(source)+' / '+g.label}))) }
 async function loadCatalogue(path){if(catalogues.get(path)?.acquisition_dimensions)return;if(!catalogueRequests.has(path))catalogueRequests.set(path,(async()=>{try{catalogues.set(path,await api('comparison-catalogue',{path}));sourceErrors.delete(path)}catch(error){sourceErrors.set(path,error.message)}finally{catalogueRequests.delete(path)}})());return catalogueRequests.get(path)}
 function close(){persist();for(const observer of overviewObservers)observer.disconnect();overviewObservers=[];linePanDrag?.stop();navigation();document.querySelector('.eds-content-layout').classList.remove('eds-comparing');$('eds-file').classList.remove('eds-file-comparing');clearTimeout(smoothingTimer);clearPlotObservers();thumbnailObserver?.disconnect();thumbnailObserver=null;setLineCrop(null);++openVersion;++version;++layoutVersion;current=null;state.analysisGroup=null;$('eds-analysis-tools').hidden=true;$('eds-analysis-views').hidden=true;$('eds-analysis-views').style.minHeight='';$('eds-preview').hidden=false}
 async function open(id,comparison=false,channelTable,fileOverride=null){
  persist();const turn=++openVersion,source=projectKey();clearTimeout(smoothingTimer);++version;current=null;
  if(!comparison){show(id,false,channelTable);return}
  if(state.file?.catalogue.file_type==='OIPX')catalogues.set(source,state.file.catalogue);
  const kind=comparison===true?'map':comparison,table=channelTable||lastTables[kind]||(kind==='map'?'XrayMapImages':'XrayLinescans');
  const key=viewKey(table),savedItem=(presets[key]||[]).find(item=>item.name===activePresets[key]);if(savedItem){restorePreset(savedItem,key);ensureSourcesVisible([...(savedItem.files||[]),...savedItem.ids.map(id=>target(id).source)])}
  const selection=selections[key],initialFiles=state.file?.catalogue.file_type==='OIPX'?[source]:[];
  const files=[...new Set(fileOverride||[...(selection?.files||initialFiles),...(selection?.ids||[]).map(id=>target(id).source)])].filter(isSourceVisible);
  $('eds-empty').hidden=true;$('eds-file').hidden=false;
  $('eds-preview-busy').hidden=false;
  await Promise.allSettled(files.map(loadCatalogue));
  if(turn!==openVersion||source!==projectKey())return;
  show(id,comparison,!savedItem&&!channelTable&&!comparisonGroups(files).some(g=>g.table===table)?comparisonGroups(files).find(g=>g.kind===kind)?.table||table:table,files);
 }
 function show(id,comparison=false,channelTable,files=[]){
  const available=comparison?comparisonGroups(files):groups(),compareKind=comparison===true?'map':comparison;
  const chosen=comparison?(available.find(g=>g.kind===compareKind&&(!channelTable||g.table===channelTable))||{kind:compareKind,table:channelTable,signals:[]}):available.find(g=>g.id===id&&(!channelTable||g.table===channelTable));if(!chosen){$('eds-preview-error').textContent='No viewable element channels for this acquisition.';$('eds-preview-error').hidden=false;return}
  clearPlotObservers();document.querySelector('.eds-content-layout').classList.toggle('eds-comparing',!!comparison);$('eds-file').classList.toggle('eds-file-comparing',!!comparison);
  ++state.previewVersion;const kind=chosen.kind,all=available.filter(g=>g.kind===kind&&g.table===chosen.table);
  if(comparison)lastTables[kind]=chosen.table;
  navigation(comparison?kind:null);
  const channelNames=channelNamesFor(comparison?all:[chosen]);
  const preferenceKey=comparison?viewKey(chosen.table):projectKey()+':'+chosen.table,selection=selections[preferenceKey];
  const kam=chosen.table==='KamMapImages',compositionMap=['QuantMapImages','AtomicMapImages'].includes(chosen.table);
  const defaults={eds_layout:'separate',eds_layers:{},mode:kind==='map'?(compositionMap?'signal':comparison?'ratio':'both'):'signal',denominator:channelNames.find(s=>s.startsWith('Ti '))||channelNames[0],normalisation:'none',map_palette:'black',smoothing:kind==='map'?1:10,smoothing_unit:comparison&&!compositionMap?'nm':'px',brightness:1.5,match_overview_tone:false,hover_detail:true,low:.7,high:1.3,upper:.5,background:true,raw:false,layout:'stacked',spatial:'physical',scale_scope:'element',show_denominator:true,reference_orientation:'native',trim_mode:'full',trim_length:null,line_offsets:{}};
  current={kind,table:chosen.table,all,files,comparison:!!comparison,preferenceKey,overviewPickerOpen:false,ids:comparison?(selection?.ids?.filter(id=>all.some(group=>group.id===id))||all.slice(0,2).map(g=>g.id)):[chosen.id],signals:comparison&&selection?(selection.signals||channelNames):channelNames,options:{...defaults,...preferences[preferenceKey]}};
  if(kam)current.options={...current.options,kam_kernel:current.options.kam_kernel??3,kam_min_angle:current.options.kam_min_angle??0,kam_max_angle:current.options.kam_max_angle??5,kam_periphery:current.options.kam_periphery??true,mode:'signal',normalisation:'none',smoothing:0,smoothing_unit:'px',brightness:1,spatial:'fit',ebsd_layout:current.options.ebsd_layout||'ipf-kam',ipf_direction:current.options.ipf_direction||'Z',kam_palette:current.options.kam_palette||'aztec',png_background:current.options.png_background||'white',low:preferences[preferenceKey]?.low??0,high:preferences[preferenceKey]?.high??5,scale_scope:preferences[preferenceKey]?.scale_scope??'all'};
  const activeChannels=selectedChannelNames(current),channelSelection=comparisonState.reconcileChannels(current.signals,current.options.denominator,activeChannels);
  current.signals=channelSelection.signals;current.options.denominator=channelSelection.denominator;
  $('eds-dataset-title').textContent=comparison?(kind==='map'?'Map comparison':'Line comparison'):chosen.label;$('eds-dataset-info').textContent=kind==='map'?(kam?'Recalculated KAM · acquired native orientations · degrees':chosen.table==='QuantMapImages'?'Saved composition maps · wt%':chosen.table==='AtomicMapImages'?'Saved composition maps · at%':'Element intensity maps'):chosen.derived?'Reconstructed Kα1 window counts/s · native raw spectra':chosen.table==='QuantLinescans'?'Saved composition profiles · AZtec quantification':'';
  $('eds-preview').hidden=true;$('eds-preview').replaceChildren();$('eds-dataset-details').hidden=true;$('eds-preview-tools').hidden=true;$('eds-preview-note').textContent='';$('eds-preview-error').hidden=true;$('eds-analysis-tools').hidden=false;$('eds-analysis-views').hidden=false;$('eds-analysis-views').replaceChildren();
  state.analysisGroup=comparison?null:chosen.id+':'+chosen.table;
  if(comparison){state.dataset=null;highlightRegions()}else{state.dataset=state.file.catalogue.datasets.find(d=>d.attributes['Acquisition ID']===chosen.id&&/^\/(SmartLines|SmartMaps)\//.test(d.path))||state.file.catalogue.datasets.find(d=>chosen.paths.includes(d.path));highlightRegions()}
  state.comparisonTable=comparison?chosen.table:null;remember();controls(activeChannels);imageScaleAvailability();update();
 }
 function controls(channels){
  for(const observer of overviewObservers)observer.disconnect();overviewObservers=[];
  const kam=current.table==='KamMapImages';
  current.options.hover_detail??=true;if(kam){current.options.kam_min_angle??=0;current.options.kam_source??='native'}
  const root=$('eds-analysis-tools');root.replaceChildren();if(current.comparison){presetControls(root);sourceControls(root);acquisitionControls(root)}
  else if(kam)kamSourceControls(root,current.ids[0],'this acquisition');
  if(current.kind==='map')overviewPicker(root);
  let row=el('div',undefined,'eds-analysis-controls');root.append(row);
  const changed=key=>{keepScroll(updateVisibility);if(key==='hover_detail'){hideMapHover();persist();return}if(['layout','spatial','reference_orientation','trim_mode','transpose','ebsd_layout','map_preview','show_colour_scale'].includes(key)){persist();if(current.result)render(current.result)}else update()};
  const toggle=(label,key,choices)=>{const wrap=el('div',undefined,'eds-control');wrap.dataset.setting=key;wrap.append(el('span',label));const group=el('div',undefined,'signal-toggle inspector-layout');group.setAttribute('role','group');group.setAttribute('aria-label',label);for(const [value,text] of choices){const b=el('button',text);b.type='button';b.setAttribute('aria-pressed',String(current.options[key]===value));b.onclick=()=>{current.options[key]=value;for(const n of group.children)n.setAttribute('aria-pressed',String(n===b));changed(key)};group.append(b)}wrap.append(group);row.append(wrap);return wrap};
  const families=current.kind==='map'?[['XrayMapImages','Intensity'],['QuantMapImages','Weight %'],['AtomicMapImages','Atomic %'],['KamMapImages','KAM / IPF']]:[['XrayLinescans','Intensity'],['QuantLinescans','Composition']];
  if(current.comparison){const family=el('div',undefined,'eds-control');family.dataset.setting='family';family.append(el('span',current.kind==='map'?'Maps':'Profiles'));const buttons=el('div',undefined,'signal-toggle inspector-layout');for(const [table,label] of families){const button=el('button',label);button.type='button';button.setAttribute('aria-pressed',String(current.table===table));button.onclick=()=>{const key=viewKey(table);selections[key]={...(selections[key]||{}),files:[...current.files]};open(null,current.kind,table,[...current.files])};buttons.append(button)}buttons.setAttribute('role','group');buttons.setAttribute('aria-label',current.kind==='map'?'Maps':'Profiles');family.append(buttons);root.insertBefore(family,root.querySelector('.eds-source-selection'))}
  if(current.kind==='line')toggle('Plots','layout',current.comparison?[['stacked','Stacked'],['elements','Overlay elements'],['overlay','Overlay scans']]:[['stacked','Stacked'],['overlay','Overlay']]);
  if(current.comparison&&current.kind==='line'){toggle('Reference image','reference_orientation',[['native','Original'],['right','Arrow right']]);toggle('Scan length','trim_mode',[['full','Full'],['equal','Equal']])}
  if(current.comparison&&current.kind==='map'&&!kam)toggle('Image scale','spatial',[['physical','Equal distance'],['fit','Fit tiles'],['crop','Crop tiles']]);
  if(current.kind==='map'){
   toggle('Hover detail','hover_detail',[[true,'On'],[false,'Off']]);if(current.comparison){current.options.map_preview??='current';toggle('Preview','map_preview',[['current','Live'],['exported','As Exported']])}
   if(kam){toggle('Columns','ebsd_layout',[['ipf','IPF'],['kam','KAM'],['ipf-kam','IPF + KAM']]);toggle('IPF direction','ipf_direction',[['X','X'],['Y','Y'],['Z','Z']]);toggle('KAM colours','kam_palette',[['aztec','AZtec'],['spectrum','Spectrum'],['viridis','Viridis'],['inferno','Inferno'],['gray','Greyscale'],['cyan','Cyan']])}
   if(kam)ipfLegendControls(row);
   else toggle('EDS layout','eds_layout',[['separate','Separate'],['layered','Layered'],['both','Both']]);
   const label=el('label',undefined,'check'),input=el('input');input.type='checkbox';input.checked=!!current.options.transpose;label.dataset.setting='transpose';input.onchange=()=>{current.options.transpose=input.checked;changed('transpose')};label.append(input,el('span','Transpose'));label.title='Swap acquisition rows and map columns; image pixels stay upright.';row.append(label);
   overlayPositionControls(row,kam);
  }
  if(current.comparison){const label=el('label',undefined,'check eds-overview-tone'),input=el('input');input.type='checkbox';input.checked=!!current.options.match_overview_tone;input.setAttribute('aria-label','Match overview tone');input.onchange=()=>{current.options.match_overview_tone=input.checked;changed('match_overview_tone')};label.append(input,el('span','Match overview tone'));row.append(label)}
  if(row.childElementCount){row=el('div',undefined,'eds-analysis-controls');root.append(row)}
  if(current.kind==='map'&&!kam){current.options.show_colour_scale??=true;toggle('Colour scale','show_colour_scale',[[false,'Off'],[true,'On']])}
  if(!kam)toggle('View','mode',current.kind==='map'?[['signal','Signals'],['ratio','Ratios'],['both','Both']]:[['signal',current.table==='QuantLinescans'?'Composition':'Signals'],['ratio','Ratios']]);
  const denominator=el('label','Divide by'),denSelect=el('select');denSelect.setAttribute('aria-label','Divide by');for(const channel of channels){const option=el('option',channel);option.value=channel;denSelect.append(option)}denSelect.value=current.options.denominator;denSelect.onchange=()=>{current.options.denominator=denSelect.value;updateVisibility();update()};denominator.append(denSelect);row.append(denominator);
  if(current.comparison)toggle('Shared scales','scale_scope',kam?[['all','Shared'],['off','Independent']]:[['all','All'],['element','Per Element'],['off','Off']]);
  if(!kam)toggle(current.comparison?'Normalize each acquisition':'Normalize','normalisation',[['none','Off'],['median','Median'],['mean','Mean'],['p20','P20']]);
  const mapPalette=current.kind==='map'&&!kam?toggle('Normalized colours','map_palette',[['black','Black–colour'],['diverging','Diverging']]):null;
  row=el('div',undefined,'eds-analysis-controls');root.append(row);
  const numeric=(label,key)=>{const wrap=el('label',label),input=el('input');wrap.dataset.setting=key;input.type='number';input.step='any';input.min=key==='low'?'':0;input.value=current.options[key];input.setAttribute('aria-label',label);
   if(key==='kam_min_angle')input.max='179';if(key==='kam_max_angle')input.max='180';
   input.onchange=()=>{const v=Number(input.value);if(!Number.isFinite(v))return;current.options[key]=v;
    if(key==='kam_min_angle'||key==='kam_max_angle'){
     current.options[key]=Math.max(0,Math.min(key==='kam_min_angle'?179:180,v));
     if(current.options.kam_min_angle>=current.options.kam_max_angle)current.options.kam_max_angle=current.options.kam_min_angle+1;
     for(const [setting,name] of [['kam_min_angle','Min angle, °'],['kam_max_angle','Max angle, °']])root.querySelector(`input[aria-label="${name}"]`).value=current.options[setting];
    }
    update();
   };wrap.append(input);row.append(wrap);return wrap};
  const smoothing=el('div',undefined,'eds-smoothing eds-smoothing-control'),smoothingHeader=el('div',undefined,'eds-smoothing-header');
  smoothingHeader.append(el('span',current.kind==='map'?(current.comparison?'Smoothing σ':'Smoothing σ, px'):'Smoothing FWHM, nm'));
  if(current.comparison&&current.kind==='map'){
   const unitControl=el('div',undefined,'eds-smoothing-units'),units=el('div',undefined,'signal-toggle inspector-layout');
   units.setAttribute('role','group');units.setAttribute('aria-label','Smoothing units');unitControl.append(el('span','Units'),units);
   for(const unit of ['nm','px']){const button=el('button',unit);button.type='button';button.setAttribute('aria-pressed',String(current.options.smoothing_unit===unit));button.onclick=()=>{current.options.smoothing_unit=unit;for(const option of units.children)option.setAttribute('aria-pressed',String(option===button));changed('smoothing_unit')};units.append(button)}
   smoothingHeader.append(unitControl);
  }
  const smoothingInputs=el('span',undefined,'eds-smoothing-inputs'),range=el('input'),amount=el('input');
  range.type='range';range.min='0';range.max=String(Math.max(current.kind==='map'?32:50,current.options.smoothing));range.step='.5';range.value=current.options.smoothing;range.setAttribute('aria-label','Smoothing');
  amount.type='number';amount.min='0';amount.step='.5';amount.value=current.options.smoothing;amount.setAttribute('aria-label','Smoothing value');
  const smoothChange=(value,immediate)=>{const n=Number(value);if(!Number.isFinite(n)||n<0)return;current.options.smoothing=n;range.max=String(Math.max(Number(range.max),n));range.value=n;amount.value=n;clearTimeout(smoothingTimer);++version;$('eds-preview-busy').hidden=false;if(immediate)update();else smoothingTimer=setTimeout(update,140)};
  range.oninput=()=>smoothChange(range.value,false);range.onchange=()=>smoothChange(range.value,true);amount.oninput=()=>smoothChange(amount.value,false);amount.onchange=()=>smoothChange(amount.value,true);
  smoothingInputs.append(range,amount);smoothing.append(smoothingHeader,smoothingInputs);smoothing.hidden=kam;row.append(smoothing);
  let brightness;
  if(current.kind==='map'){
   brightness=el('label','Map brightness ×','eds-smoothing');brightness.dataset.setting='brightness';const inputs=el('span',undefined,'eds-smoothing-inputs'),slider=el('input'),value=el('input');
   slider.type='range';slider.min='.25';slider.max='8';slider.step='.05';slider.value=current.options.brightness;slider.setAttribute('aria-label','Map brightness');
   value.type='number';value.min='.25';value.max='8';value.step='.05';value.value=current.options.brightness;value.setAttribute('aria-label','Map brightness value');
   const brighten=n=>{n=Number(n);if(!Number.isFinite(n)||n<.25||n>8)return;current.options.brightness=n;slider.value=value.value=n;persist();applyMapBrightness();refreshExportPreview()};
   slider.oninput=()=>brighten(slider.value);value.oninput=()=>brighten(value.value);value.onchange=()=>brighten(value.value);inputs.append(slider,value);brightness.append(inputs);row.append(brightness);
  }
  if(kam){
   toggle('Kernel','kam_kernel',[[3,'3×3'],[5,'5×5'],[7,'7×7'],[9,'9×9']]);
   toggle('Neighbours','kam_periphery',[[true,'Periphery'],[false,'All']]);
   numeric('Min angle, °','kam_min_angle');numeric('Max angle, °','kam_max_angle');
  }
  const low=numeric('Colour min','low'),high=numeric('Colour max','high'),upper=numeric('Ratio max','upper');
  const colourActions=el('div',undefined,'eds-colour-actions'),autoColour=el('button','Auto'),resetColour=el('button','↺');
  autoColour.type=resetColour.type='button';autoColour.title='Set shared limits from the current maps’ 5th–95th percentiles, symmetric around 1.';resetColour.setAttribute('aria-label','Reset colour limits');resetColour.title='Reset colour limits to 0.7–1.3';colourActions.append(autoColour,resetColour);row.append(colourActions);
  const setColourLimits=limits=>{if(!limits)return;[current.options.low,current.options.high]=limits;low.querySelector('input').value=limits[0];high.querySelector('input').value=limits[1];update()};
  autoColour.onclick=()=>{const limits=current.result?.suggested_colour_limits;if(limits)setColourLimits([Math.floor(limits[0]*100)/100,Math.ceil(limits[1]*100)/100])};
  resetColour.onclick=()=>setColourLimits([.7,1.3]);
  const updateVisibility=()=>{
   updateMapSettingsVisibility();
   if(mapPalette)mapPalette.hidden=current.options.normalisation==='none'||current.options.eds_layout==='layered';
   colourActions.hidden=kam||current.kind!=='map'||current.options.normalisation==='none'||current.comparison&&current.options.scale_scope!=='all';
   denominator.hidden=current.options.mode==='signal';low.hidden=high.hidden=kam?current.options.scale_scope==='off':current.kind!=='map'||current.options.normalisation==='none'||current.comparison&&current.options.scale_scope!=='all';if(brightness)brightness.hidden=kam||current.options.normalisation!=='none';upper.hidden=current.kind!=='line'||current.options.mode!=='ratio'||current.options.normalisation!=='none'||current.comparison&&current.options.scale_scope==='off';
   for(const input of picks.querySelectorAll('input')){const denominatorPick=current.options.mode==='ratio'&&input.value===current.options.denominator;input.disabled=denominatorPick&&current.kind!=='map';input.checked=denominatorPick?(current.kind==='map'&&current.options.show_denominator):current.signals.includes(input.value);input.parentElement.classList.toggle('eds-channel-inactive',input.disabled);input.parentElement.title=input.disabled?(current.comparison&&current.kind==='map'?'Denominator; shown as the reference signal.':'Used as the denominator; not plotted against itself.'):''}
  };
  const footer=el('div',undefined,'eds-analysis-options');if(current.comparison)footer.classList.add('eds-comparison-options');root.append(footer);const picks=el('div',undefined,'eds-channel-picks');picks.hidden=kam;footer.append(picks);
  for(const signal of channels){const label=el('label'),input=el('input');input.type='checkbox';input.checked=true;input.onchange=()=>{if(current.kind==='map'&&current.options.mode==='ratio'&&signal===current.options.denominator)current.options.show_denominator=input.checked;else current.signals=input.checked?[...current.signals,signal]:current.signals.filter(s=>s!==signal);update()};input.value=signal;label.append(input,el('span',signal));picks.append(label)}
  if(current.kind==='map'&&!kam){const layers=el('div',undefined,'eds-layer-controls');layers.setAttribute('aria-label','EDS layers');footer.append(layers)}
  updateVisibility();
  if(current.kind==='line'){const options=el('div',undefined,'eds-channel-picks');const imageToggle=el('div',undefined,'signal-toggle inspector-layout'),imageButton=el('button','Image');imageButton.type='button';imageButton.setAttribute('aria-label','Show electron image');imageButton.setAttribute('aria-pressed',String(current.options.background));imageButton.onclick=()=>{current.options.background=!current.options.background;imageButton.setAttribute('aria-pressed',String(current.options.background));persist();if(current.result)render(current.result)};imageToggle.append(imageButton);options.append(imageToggle);for(const [key,text] of [['raw','Underlying data']]){const label=el('label'),input=el('input');input.type='checkbox';input.checked=current.options[key];input.onchange=()=>{current.options[key]=input.checked;persist();if(current.result)render(current.result)};label.append(input,el('span',text));options.append(label)}footer.append(options)}
  if(current.comparison&&current.kind==='line')lineTrimControls(root);
  exportControls(root,footer);
  const help=el('span',undefined,'eds-analysis-help'),helpButton=el('button','ⓘ'),helpText=el('span',(current.comparison?'All links colour or plot limits across selected quantities with compatible units. Per Element links each quantity across acquisitions. For normalized maps, All uses Colour min/max (Auto fits the 5th–95th percentiles). Per Element automatically shares a separate 5th–95th percentile range for each element or ratio across acquisitions, centred on 1; the tile shows its limits. Off uses each acquisition’s own range; normalized maps then use a symmetric 1st–99th percentile range around 1. Stacked keeps each element separate within each acquisition. Overlay elements puts selected elements together, one plot per acquisition. Overlay scans compares acquisitions, one plot per element. Traces in an overlay always share one axis. Distance scales stay linked. Normalization independently divides each acquisition by its own baseline. Equal distance preserves field sizes; Fit tiles fits whole images; Crop tiles shows a common field of view; drag any tile to pan all channels from that acquisition, or use arrow keys. Centre crop resets the position. Scale bars describe the displayed magnification. ':'')+'Match overview tone uses the same 5th/95th-percentile brightness and contrast matching as Figures across two or more selected overview images. It also applies the same adjustment to line-image backgrounds and PNG exports; elemental values and numerical exports stay unchanged. Channels are smoothed before division. Median, Mean or P20 become 1 on the line path; Off places 0 there. Underlying data only changes trace visibility. Map exposure uses unsmoothed P99, fixed while smoothing changes; Linked scales use the largest reference in the selected scale group. Near-empty ratio denominators fade below 10% of their map mean, a display safeguard rather than confidence. Colour min/max applies to direct normalized maps and comparison All scales. Black–colour maps the colour minimum to black and the maximum to full element colour, with linear intensity between them. This subtracts the lower display bound only for rendering; normalized values, statistics and numerical exports retain their original baseline. The same shared or independent limits apply to both palettes. '+(['QuantLinescans','QuantMapImages','AtomicMapImages'].includes(current.table)?'Composition values are saved AZtec quantification; wt% and at% stay separate. Ratios divide those stored concentrations.':current.all.some(g=>g.derived)?'Reconstructed Kα1 windows use only native raw spectra and approximate channel edges calibrated against a saved line. They retain background and overlap; ratios are window-count ratios, not concentration.':'Ratios describe recorded signals, not concentration.'),'eds-help-content');
  if(current.kind==='map'&&!kam)helpText.textContent+=' Layered EDS images add the selected elements’ colours on black. Strength changes each layer’s display contribution only. Each layer uses its channel’s current smoothing, normalization and colour limits, always with a black-to-element ramp; the Diverging palette applies only to separate maps. Overlapping colours may saturate. Signals and ratios are separate composites, and the denominator reference is excluded from the ratio composite. Missing channels are listed. Native pixel grids, distributions, statistics and numerical exports are unchanged.';
  if(kam)helpText.textContent='EBSD source applies to both IPF and KAM. Native OIPX calculates KAM from acquired native phase IDs and orientations. H5OINA · Recalculate KAM calculates it from the matched export’s processed phase IDs and orientations, using the same kernel, neighbour and inclusive angle controls. Both support validated hexagonal and cubic symmetry and apply no additional cleanup. H5OINA · Saved KAM reads the existing exported map without KAM recalculation; each acquisition shows its stored settings. Shared kernel and angle controls apply only to recalculated acquisitions and are disabled when all selected acquisitions use saved maps. A minimum angle absent from the export is labelled not stored. Nearby H5OINA exports are matched by acquisition UUID and verified against the native acquired phase and Euler grids; missing, ambiguous or mismatched sources are explicit. Both H5OINA choices use saved processed IPF colours only for directions present in the export. The acquisition card lists those directions; unexported axes remain unavailable and are not recalculated. Overviews remain the selected native electron images. Calculation edges do not wrap; unindexed or neighbourless calculation pixels are unavailable. Saved maps exclude unindexed processed pixels and retain finite indexed zeros. KAM values and statistics are degrees; unavailable pixels are white and excluded from statistics. Source files, settings and missing-value handling are recorded in numerical exports. Colour limits and palettes only affect display. AZtec uses blue–green–yellow–red, while Spectrum includes cyan; Viridis, Inferno, Greyscale and Cyan are also available. Transpose swaps acquisitions and quantities without rotating pixels.';
  helpButton.type='button';helpButton.setAttribute('aria-label','Processing and plot help');helpButton.setAttribute('aria-expanded','false');helpButton.onclick=()=>helpButton.setAttribute('aria-expanded',String(helpButton.getAttribute('aria-expanded')!=='true'));helpButton.onkeydown=e=>{if(e.key==='Escape')helpButton.setAttribute('aria-expanded','false')};helpText.setAttribute('role','tooltip');help.append(helpButton,helpText);footer.append(help);
  for(const input of root.querySelectorAll('input,select,button')){const group=input.closest('[role=group]')?.getAttribute('aria-label'),label=input.getAttribute('aria-label')||input.closest('label')?.textContent||input.textContent;input.dataset.diagnosticControl=`aztec.${current.kind}.${group?group+': ':''}${label.trim()}`}
  if(kam)updateKamSourceControls(current.result);
  if(current.kind==='map')organiseMapSettings(root,kam);
  else if(current.comparison){const labels=el('fieldset',undefined,'eds-panel-label-controls');labels.append(el('legend','Panel labels'),panelLabelControl('overview','Reference images'),panelLabelControl('line','Plots'));footer.prepend(labels)}
 }
 function panelLabelControl(kind,label='Panel label'){
  const wrap=el('div',undefined,'eds-panel-label-setting'),field=el('label',undefined,'check eds-panel-label-control'),check=el('input');check.type='checkbox';check.checked=window.aztecPanelLabels.visible(current.options,kind);check.setAttribute('aria-label','Show '+kind+' panel labels');field.append(check,el('span',label));wrap.append(field);
  const redraw=()=>{persist();if(current.result)render(current.result)},buttons=[];
  check.onchange=()=>{current.options.panel_labels={...current.options.panel_labels,[kind]:check.checked};for(const button of buttons)button.disabled=!check.checked;redraw()};
  for(const [axis,values,index]of [['horizontal',['left','right'],1],['vertical',['top','bottom'],0]]){
   const group=el('span',undefined,'signal-toggle');group.setAttribute('role','group');group.setAttribute('aria-label',kind+' panel label '+axis+' position');
   for(const value of values){const button=el('button',value[0].toUpperCase()+value.slice(1));button.type='button';button.disabled=!check.checked;button.setAttribute('aria-pressed',String(window.aztecPanelLabels.position(current.options,kind).split('-')[index]===value));button.onclick=()=>{const corner=window.aztecPanelLabels.position(current.options,kind).split('-');corner[index]=value;current.options.panel_label_positions={...current.options.panel_label_positions,[kind]:corner.join('-')};for(const peer of group.children)peer.setAttribute('aria-pressed',String(peer===button));redraw()};buttons.push(button);group.append(button)}wrap.append(group);
  }
  return wrap;
 }
 function updateMapSettingsVisibility(){
  const root=$('eds-analysis-tools'),ipf=root.querySelector('[data-settings-column="ipf"]'),kam=root.querySelector('[data-settings-column="kam"]');
  if(ipf)ipf.hidden=current.options.ebsd_layout==='kam';if(kam){kam.hidden=current.options.ebsd_layout==='ipf';kam.style.gridColumn=current.options.ebsd_layout==='kam'?'2 / span 1':'3 / span 1'}
 }
 function organiseMapSettings(root,kam){
  const grid=el('div',undefined,'eds-map-settings'),columns={};
  for(const [key,title,index,span]of [['general','General & overview',1,1],...(kam?[['ipf','IPF',2,1],['kam','KAM',3,1]]:[['eds','EDS maps',2,2]])]){
   const column=el('section',undefined,'eds-map-settings-column');column.dataset.settingsColumn=key;column.style.gridColumn=index+' / span '+span;column.setAttribute('aria-label',title+' settings');column.append(el('h4',title));columns[key]={};
   for(const name of ['compute','labels','scale','display','position']){const row=el('div',undefined,'eds-analysis-controls eds-settings-row');row.dataset.settingsRow=name;columns[key][name]=row;column.append(row)}grid.append(column);
  }
  const first=root.querySelector('.eds-overview-selection')||root.querySelector('.eds-analysis-controls');root.insertBefore(grid,first);
  const move=(selector,column,row)=>{const node=root.querySelector(selector);if(node)columns[column][row].append(node);return node};
  const setting=(key,column,row)=>move('[data-setting="'+key+'"]',column,row);
  columns.general.labels.append(panelLabelControl('overview','Overview labels'));
  setting('ebsd_layout','general','compute');
  setting('spatial','general','display');for(const key of ['hover_detail','map_preview']){const control=root.querySelector('[data-setting="'+key+'"]');if(control)root.querySelector('.eds-export-actions').append(control)}
  move('.eds-overview-tone','general','labels');setting('transpose','general','labels');move('.eds-overview-selection','general','compute');
  const physical=setting('scale_bar_position','general','position');
  if(physical){columns.general.scale.append(physical.querySelector('.eds-scale-visibility'));physical.prepend(el('span','Scale bar'))}
  const kind=kam?'kam':'eds';columns[kind].labels.append(panelLabelControl(kind));
  if(kam){
   columns.ipf.labels.append(panelLabelControl('ipf'));setting('ipf_direction','ipf','compute');move('.eds-ipf-options','ipf','scale');setting('ipf_legend_position','ipf','position');
   setting('kam_legend_position','kam','position');setting('kam_palette','kam','position');kamLegendControls(columns.kam.scale);
  }else{setting('show_colour_scale','eds','scale');for(const key of ['mode','normalisation'])setting(key,'eds','compute');for(const key of ['eds_layout','map_palette'])setting(key,'eds','display');}
  for(const key of ['scale_scope','low','high'])setting(key,kind,'scale');move('.eds-colour-actions',kind,'scale');
  for(const row of [...root.children].filter(node=>node.classList.contains('eds-analysis-controls'))){
   for(const node of [...row.children]){if(node.classList.contains('eds-overlay-positions')){for(const field of [...node.querySelectorAll('.eds-overlay-position')])columns[kind].position.append(field)}else columns[kind][node.dataset.setting==='brightness'?'display':'compute'].append(node)}row.remove();
  }
  if(!kam)for(const selector of ['.eds-channel-picks','.eds-layer-controls'])move(selector,'eds','compute');
  updateMapSettingsVisibility();
 }
 function kamSourceControls(root,id,name){
  const wrap=el('div',undefined,'eds-kam-source-controls'),group=el('div',undefined,'signal-toggle inspector-layout');wrap.dataset.acquisition=id;group.setAttribute('role','group');group.setAttribute('aria-label','EBSD source for '+name);
  const heading=el('span',undefined,'eds-ebsd-source-heading'),help=el('span',undefined,'eds-analysis-help'),helpButton=el('button','ⓘ'),helpText=el('span','This choice applies to both IPF and KAM. Native OIPX uses saved native IPF and recalculates KAM. Both H5OINA choices use its saved processed IPF; Recalculate KAM uses processed orientations and your settings, while Saved KAM reads the existing map. Only IPF directions saved in the export are available; other directions are not recalculated or replaced with native colours.','eds-help-content');
  helpButton.type='button';helpButton.setAttribute('aria-label','EBSD source help for '+name);helpButton.setAttribute('aria-expanded','false');helpButton.onclick=()=>helpButton.setAttribute('aria-expanded',String(helpButton.getAttribute('aria-expanded')!=='true'));helpButton.onkeydown=e=>{if(e.key==='Escape')helpButton.setAttribute('aria-expanded','false')};helpText.setAttribute('role','tooltip');help.append(helpButton,helpText);heading.append(el('span','EBSD source'),help);wrap.append(heading,group);
  for(const [mode,label] of window.aztecKamSources.choices){const button=el('button',label);button.type='button';button.dataset.kamSource=mode;button.onclick=()=>{current.options.kam_sources={...current.options.kam_sources,[id]:mode};updateKamSourceControls(current.result);update()};group.append(button)}
  wrap.append(el('small',undefined,'eds-kam-source-note'),el('small',undefined,'eds-ipf-source-note'));root.append(wrap);
 }
 function updateKamSourceControls(result){
  if(current.table!=='KamMapImages')return;
  const root=$('eds-analysis-tools'),sources=window.aztecKamSources,saved=sources.allSaved(current.options,current.ids);
  const rows=(result?.rows||[]).filter(row=>current.ids.includes(row.acquisition));
  for(const wrap of root.querySelectorAll('.eds-kam-source-controls')){
   const id=wrap.dataset.acquisition,mode=sources.mode(current.options,id),row=rows.find(row=>row.acquisition===id),selected=current.ids.includes(id),ready=row?.kam?.source_mode===mode;
   for(const button of wrap.querySelectorAll('[data-kam-source]')){const value=button.dataset.kamSource;button.setAttribute('aria-pressed',String(value===mode));button.disabled=!selected||(value!==mode&&value!=='native'&&!!row?.h5oina&&!row.h5oina[value==='h5_saved'?'saved':'processed'])}
   const note=wrap.querySelector('.eds-kam-source-note');
   note.textContent=!selected?'Select to check H5OINA':ready&&row.error?row.error:ready&&mode==='h5_saved'?'Saved: '+sources.configuration(row.kam):mode==='native'?(row?.h5oina?.path?'H5OINA found':row?.h5oina?.reason||'Checking H5OINA…'):ready?'Recalculated from processed orientations':'Loading selected source…';
   note.classList.toggle('eds-channel-error',!!(ready&&row.error));note.title=row?.h5oina?.path||'';
   const ipfNote=wrap.querySelector('.eds-ipf-source-note'),axes=ready?row?.ipf?.exported_directions:null;ipfNote.hidden=!selected;
   ipfNote.textContent=mode==='native'?'IPF: saved native maps':axes?'IPF exported: '+(axes.join(', ')+(axes.length===1?' only':'')||'none'):'IPF: saved export directions only';
   if(ready&&row?.ipf?.error)ipfNote.textContent+=' · '+(current.options.ipf_direction||'Z')+' unavailable';
   ipfNote.title=ready?row?.ipf?.error||'':'';ipfNote.classList.toggle('eds-channel-error',!!(ready&&row?.ipf?.error));
  }
  const valid=rows.filter(row=>!row.error&&row.kam?.source_mode===sources.mode(current.options,row.acquisition)),configurations=[...new Set(valid.map(row=>JSON.stringify({kernel_size:row.kam.kernel_size,kernel_shape:row.kam.kernel_shape,only_periphery:row.kam.only_periphery,maximum_angle_degrees:row.kam.maximum_angle_degrees,minimum_angle_degrees:row.kam.minimum_angle_degrees})))];
  const configuration=valid.length===current.ids.length&&configurations.length===1?JSON.parse(configurations[0]):null;
  for(const [label,key] of [['Min angle, °','kam_min_angle'],['Max angle, °','kam_max_angle']]){const input=root.querySelector(`input[aria-label="${label}"]`);if(!input)continue;input.disabled=saved;input.value=saved?(configuration?.[key==='kam_min_angle'?'minimum_angle_degrees':'maximum_angle_degrees']??''):current.options[key];input.placeholder=saved?(configuration?'Not stored':'See acquisition'):''}
  for(const [label,key,values] of [['Kernel','kam_kernel',[3,5,7,9]],['Neighbours','kam_periphery',[true,false]]]){const buttons=root.querySelectorAll(`[role=group][aria-label="${label}"] button`);buttons.forEach((button,index)=>{button.disabled=saved;const value=saved?configuration?.[key==='kam_kernel'?'kernel_size':'only_periphery']:current.options[key];button.setAttribute('aria-pressed',String(value===values[index]))})}
  const modes=[...new Set(current.ids.map(id=>sources.mode(current.options,id)))];
  $('eds-dataset-info').textContent=(modes.length===1?sources.choices.find(choice=>choice[0]===modes[0])?.[1]:'Mixed EBSD sources')+' · KAM in degrees';
 }
 function overlayPositionControls(root,kam){
  const wrap=el('fieldset',undefined,'eds-overlay-positions');wrap.append(el('legend','Overlays'));
  const redraw=()=>{persist();if(current.result)render(current.result)};
  for(const [key,label,fallback]of [['scale_bar_position','Scale bar','bottom-left'],...(kam?[['ipf_legend_position','IPF key','top-right'],['kam_legend_position','KAM scale','bottom-right']]:[])]){
   const field=el('div',undefined,'eds-overlay-position'),position=el('span','Position','eds-overlay-position-label'),toggles=[];field.dataset.setting=key;
   if(key==='scale_bar_position'){
    const visibility=el('div',undefined,'eds-control eds-scale-visibility'),scope=el('span',undefined,'signal-toggle');scope.setAttribute('role','group');scope.setAttribute('aria-label','Scale bar images');visibility.append(el('span','Scale bar'),scope);field.append(visibility);
    const selected=()=>current.options.scale_bar_overlay===false?'off':current.options.scale_bar_scope||(kam?'overview':'all');
    for(const [value,text]of [['off','Off'],['overview','Overviews only'],['all','All images']]){const button=el('button',text);button.type='button';button.setAttribute('aria-pressed',String(selected()===value));button.onclick=()=>{current.options.scale_bar_overlay=value!=='off';if(value!=='off')current.options.scale_bar_scope=value;for(const peer of scope.children)peer.setAttribute('aria-pressed',String(peer===button));for(const position of toggles)position.disabled=value==='off';redraw()};scope.append(button)}
   }else field.append(el('span',label));
   field.append(position);
   for(const [axis,values,index]of [['horizontal',['left','right'],1],['vertical',['top','bottom'],0]]){
    const group=el('span',undefined,'signal-toggle');group.setAttribute('role','group');group.setAttribute('aria-label',label+' '+axis+' position');
    for(const value of values){const button=el('button',value[0].toUpperCase()+value.slice(1));button.type='button';button.setAttribute('aria-pressed',String(window.aztecOverlayPlacement.corner(current.options[key],fallback).split('-')[index]===value));button.disabled=key==='scale_bar_position'&&current.options.scale_bar_overlay===false;button.onclick=()=>{const corner=window.aztecOverlayPlacement.corner(current.options[key],fallback).split('-');corner[index]=value;current.options[key]=corner.join('-');for(const peer of group.children)peer.setAttribute('aria-pressed',String(peer===button));redraw()};toggles.push(button);group.append(button)}
    field.append(group);
   }
   wrap.append(field);
  }
  root.append(wrap);
 }
 function placeMapOverlay(node,cell,position){
  const caption=cell.querySelector('.eds-map-label'),reserve=panelLabelReserve(caption);
  Object.assign(node.style,window.aztecOverlayPlacement.style(position,reserve));
 }
 function ipfLegendControls(root){
  const context=current,wrap=el('div',undefined,'eds-ipf-options'),placement=el('div',undefined,'eds-control'),group=el('div',undefined,'signal-toggle inspector-layout');
  context.options.ipf_legend??='one';group.setAttribute('role','group');group.setAttribute('aria-label','IPF legend');placement.append(el('span','IPF legend'),group);wrap.append(placement);
  const redraw=()=>{persist();updateIpfLegendControls(context.result);if(context.result)render(context.result)};
  for(const [value,label]of [['none','Off'],['one','One map'],['all','All maps']]){const button=el('button',label);button.type='button';button.dataset.ipfLegend=value;button.setAttribute('aria-pressed',String(context.options.ipf_legend===value));button.onclick=()=>{context.options.ipf_legend=value;redraw()};group.append(button)}
  const target=el('label','Legend map'),select=el('select');select.setAttribute('aria-label','IPF legend map');const first=el('option','First available IPF map');first.value='';select.append(first);
  for(const id of context.ids){const row=context.result?.rows.find(row=>row.acquisition===id)||{acquisition:id,label:context.all.find(item=>item.id===id)?.label||id},option=el('option',exportLabel(row));option.value=id;select.append(option)}
  if(context.options.ipf_legend_target&&!context.ids.includes(context.options.ipf_legend_target)){const missing=el('option','Selected map unavailable');missing.value=context.options.ipf_legend_target;select.append(missing)}
  select.value=context.options.ipf_legend_target||'';select.onchange=()=>{context.options.ipf_legend_target=select.value;redraw()};target.append(select);wrap.append(target);
  for(const [family,label]of [['hexagonal','Hexagonal'],['cubic','Cubic']]){const field=el('label',undefined,'check'),input=el('input');input.type='checkbox';input.checked=context.options['ipf_legend_'+family]!==false;input.setAttribute('aria-label','Show '+label.toLowerCase()+' IPF key');input.onchange=()=>{context.options['ipf_legend_'+family]=input.checked;redraw()};field.append(input,el('span',label));wrap.append(field)}
  const help=el('span',undefined,'eds-analysis-help'),button=el('button','ⓘ'),text=el('span','Show AZtec colour keys on one chosen IPF map or every IPF map. Hexagonal and Cubic control the legend only; keys use the phase names and symmetries present in each map. The supplied AZtec colour artwork is retained, with clear phase/direction labels. Unsupported or unavailable keys are reported, not substituted. One shared key is appropriate only for maps with the same colour convention and phase symmetries.','eds-help-content');button.type='button';button.setAttribute('aria-label','IPF legend help');button.setAttribute('aria-expanded','false');button.onclick=()=>button.setAttribute('aria-expanded',String(button.getAttribute('aria-expanded')!=='true'));button.onkeydown=e=>{if(e.key==='Escape')button.setAttribute('aria-expanded','false')};text.setAttribute('role','tooltip');help.append(button,text);wrap.append(help,el('span',undefined,'eds-ipf-legend-status eds-channel-error'));root.append(wrap);updateIpfLegendControls(context.result);
 }
 function updateIpfLegendControls(result){
  const wrap=$('eds-analysis-tools').querySelector('.eds-ipf-options');if(!wrap)return;
  const options=current.options,off=options.ebsd_layout==='kam'||options.ipf_legend==='none';wrap.hidden=options.ebsd_layout==='kam';
  for(const button of wrap.querySelectorAll('[data-ipf-legend]'))button.setAttribute('aria-pressed',String(button.dataset.ipfLegend===options.ipf_legend));
  const select=wrap.querySelector('select');select.disabled=off||options.ipf_legend!=='one';
  let scope=select.querySelector('[data-legend-scope]');if(!scope){scope=el('option');scope.dataset.legendScope='true';scope.value='__scope__';select.append(scope)}
  scope.hidden=options.ipf_legend==='one';scope.textContent=options.ipf_legend==='all'?'All maps':'Off';select.value=options.ipf_legend==='one'?(options.ipf_legend_target||''):'__scope__';
  for(const input of wrap.querySelectorAll('input'))input.disabled=off;
  for(const button of $('eds-analysis-tools').querySelectorAll('[data-setting="ipf_legend_position"] button'))button.disabled=off;
  const status=wrap.querySelector('.eds-ipf-legend-status'),enabled=options.ipf_legend_hexagonal!==false||options.ipf_legend_cubic!==false;
  const rows=result?.rows||[],targets=options.ipf_legend==='one'&&options.ipf_legend_target?rows.filter(row=>row.acquisition===options.ipf_legend_target):rows;
  const errors=targets.flatMap(row=>{const ipf=row.tiles?.find(tile=>tile.channel==='IPF');return ipf?.image?(ipf.legend_error?[ipf.legend_error]:!Array.isArray(ipf.phases)?['Restart Workbench to load IPF phase keys.']:[]):[]});
  if(options.ipf_legend==='one'&&options.ipf_legend_target&&result&&!window.aztecIpfLegend.selected(result,options).length)errors.push('The selected map has no available enabled IPF key.');
  status.textContent=!off&&enabled?[...new Set(errors)].join(' '):'';status.hidden=!status.textContent;
 }
 function kamLegendControls(root){
  const wrap=el('div',undefined,'eds-kam-legend-options'),field=el('div',undefined,'eds-control'),group=el('div',undefined,'signal-toggle');current.options.kam_legend??='all';group.setAttribute('role','group');group.setAttribute('aria-label','KAM scale');field.append(el('span','KAM scale'),group);wrap.append(field);
  const redraw=()=>{persist();updateKamLegendControls(current.result);if(current.result)render(current.result)};
  for(const [value,label]of [['none','Off'],['one','One map'],['all','All maps']]){const button=el('button',label);button.type='button';button.dataset.kamLegend=value;button.onclick=()=>{current.options.kam_legend=value;redraw()};group.append(button)}
  const target=el('label','Scale map'),select=el('select');select.setAttribute('aria-label','KAM scale map');const first=el('option','First available KAM map');first.value='';select.append(first);
  for(const id of current.ids){const row=current.result?.rows.find(row=>row.acquisition===id)||{acquisition:id,label:current.all.find(item=>item.id===id)?.label||id},option=el('option',exportLabel(row));option.value=id;select.append(option)}
  if(current.options.kam_legend_target&&!current.ids.includes(current.options.kam_legend_target)){const missing=el('option','Selected map unavailable');missing.value=current.options.kam_legend_target;select.append(missing)}
  const scope=el('option');scope.dataset.legendScope='true';scope.value='__scope__';select.append(scope);select.onchange=()=>{current.options.kam_legend_target=select.value;redraw()};target.append(select);wrap.append(target,el('span',undefined,'eds-kam-legend-status eds-channel-error'));root.append(wrap);updateKamLegendControls(current.result);
 }
 function updateKamLegendControls(result){
  const root=$('eds-analysis-tools'),wrap=root.querySelector('.eds-kam-legend-options');if(!wrap)return;const options=current.options,mode=options.kam_legend||'all',off=mode==='none';
  for(const button of wrap.querySelectorAll('[data-kam-legend]'))button.setAttribute('aria-pressed',String(button.dataset.kamLegend===mode));
  const select=wrap.querySelector('select'),scope=select.querySelector('[data-legend-scope]');scope.hidden=mode==='one';scope.textContent=off?'Off':'All maps';select.value=mode==='one'?(options.kam_legend_target||''):'__scope__';select.disabled=mode!=='one';
  for(const button of root.querySelectorAll('[data-setting="kam_legend_position"] button'))button.disabled=off;
  const status=wrap.querySelector('.eds-kam-legend-status');status.textContent=mode==='one'&&options.kam_legend_target&&result&&!window.aztecKamLegend.selected(result,options).length?'The selected map has no available KAM scale.':'';status.hidden=!status.textContent;
 }
 function layerControls(result){
  const body=$('eds-analysis-tools').querySelector('.eds-layer-controls');if(!body)return;
  body.hidden=current.options.eds_layout==='separate';if(body.hidden)return;
  const channels=selectedSignals().filter(channel=>current.options.mode!=='ratio'||channel!==current.options.denominator);
  // Keep active inputs in place when a pending map request finishes.
  const key=JSON.stringify(channels);if(body.dataset.key===key)return;body.dataset.key=key;body.replaceChildren();
  body.append(el('strong','Layers'));
  for(const channel of channels){
   const tile=result.rows.flatMap(row=>row.tiles).find(tile=>tile.channel===channel),saved=current.options.eds_layers?.[channel]||{};
   const layer=el('div',undefined,'eds-layer-setting'),colourLabel=el('label'),colour=el('input'),strengthLabel=el('label','Strength, %'),strength=el('input');
   colour.type='color';colour.value=saved.colour||tile?.colour||'#ffffff';colour.setAttribute('aria-label',channel+' layer colour');
   strength.type='number';strength.min='0';strength.max='100';strength.step='5';strength.value=String(Math.round((saved.strength??1)*100));strength.setAttribute('aria-label',channel+' layer strength');
   const change=(immediate=true)=>{const value=Number(strength.value);if(!Number.isFinite(value)||value<0||value>100){strength.reportValidity();return}current.options.eds_layers={...current.options.eds_layers,[channel]:{colour:colour.value,strength:value/100}};clearTimeout(smoothingTimer);++version;$('eds-preview-busy').hidden=false;persist();if(immediate)update();else smoothingTimer=setTimeout(update,140)};
   colour.onchange=strength.onchange=()=>change();strength.oninput=()=>change(false);colourLabel.append(colour,el('span',channel));strengthLabel.append(strength);layer.append(colourLabel,strengthLabel);body.append(layer);
  }
 }
 function overviewPicker(root){
  const wrap=el('div',undefined,'eds-overview-selection'),button=el('button','Overview images'),dialog=el('dialog',undefined,'eds-overview-popup'),head=el('div',undefined,'eds-overview-popup-head'),close=el('button','Done');button.type=close.type='button';button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');dialog.setAttribute('aria-label','Overview images');head.append(el('strong','Overview images'),close);dialog.append(head,el('div',undefined,'eds-overview-choices'));wrap.append(button,dialog);root.append(wrap);
  button.onclick=()=>{if(dialog.open)return;dialog.showModal();button.setAttribute('aria-expanded','true');overviewControls(current.result);close.focus()};close.onclick=()=>dialog.close();dialog.onclose=()=>{button.setAttribute('aria-expanded','false');hideMapHover();button.focus({preventScroll:true})};
 }
 function overviewControls(result){
  const context=current,details=$('eds-analysis-tools').querySelector('.eds-overview-selection');if(!details)return;
  const body=details.querySelector('.eds-overview-choices'),rows=(result?.rows||[]).filter(row=>context.ids.includes(row.acquisition));
  const selected=row=>context.options.overview_images?.[row.acquisition]??(row.overviews||[]).map(image=>image.path);
  details.querySelector('button').textContent='Overview images'+(rows.length?` · ${rows.reduce((count,row)=>count+selected(row).length,0)} selected`:'');
  if(!details.querySelector('dialog').open)return;
  const key=JSON.stringify(rows.map(row=>[row.acquisition,row.overview_choices,selected(row),exportLabel(row)]));if(body.dataset.key===key)return;body.dataset.key=key;for(const observer of overviewObservers)observer.disconnect();overviewObservers=[];body.replaceChildren();
  if(!rows.length){body.append(el('p','Select acquisitions to choose their overview images.','hint'));return}
  body.append(el('p','Tick images to add overview columns. Numbers show their display order.','hint'));
  for(const row of rows){
   const section=el('section',undefined,'eds-overview-acquisition'),heading=el('div',undefined,'eds-overview-heading'),title=el('strong',exportLabel(row)+' · '+row.short_label);title.title=[row.source,row.label].join(' / ');heading.append(title);section.append(heading);body.append(section);
   const set=paths=>{context.options.overview_images={...context.options.overview_images};if(paths===null)delete context.options.overview_images[row.acquisition];else context.options.overview_images[row.acquisition]=paths;body.dataset.key='';overviewControls(result);update()};
   for(const [caption,paths] of [['Default',null],['None',[]]]){const button=el('button',caption);button.type='button';button.setAttribute('aria-label',`${caption} overview images for ${row.label}`);button.onclick=()=>set(paths);heading.append(button)}
   const grid=el('div',undefined,'eds-overview-grid');section.append(grid);
   const choices=[...(row.overview_choices||[])];for(const image of row.overviews||[])if(!choices.some(choice=>choice.path===image.path))choices.push(image);
   if(!choices.length)grid.append(el('p','No saved electron images at this site.','hint'));
   for(const choice of choices){
    const card=el('div',undefined,'eds-overview-choice'),label=el('label'),input=el('input'),image=el('img'),name=el('span'),order=selected(row).indexOf(choice.path);input.type='checkbox';input.checked=order>=0;input.disabled=!!choice.error&&order<0;
    input.setAttribute('aria-label',`Overview ${choice.label} for ${row.label}`);image.alt=choice.label+' with the acquired map field marked';image.hidden=true;name.textContent=(order>=0?(order+1)+' · ':'')+choice.label;
    const preview=el('span',undefined,'eds-overview-preview');preview.hidden=true;preview.setAttribute('role','button');preview.setAttribute('aria-label',`Preview ${choice.label} for ${row.label}`);preview.append(image);
    preview.onclick=event=>{event.preventDefault();event.stopPropagation();preview.focus({preventScroll:true})};
    input.onchange=()=>set(input.checked?[...selected(row),choice.path]:selected(row).filter(path=>path!==choice.path));label.append(input,name);card.append(preview,label);grid.append(card);
    if(choice.error){card.append(el('p',choice.error,'eds-channel-error'));continue}
    const cacheKey=row.source+'|'+row.native_acquisition+'|overview|'+choice.path;
    if(!thumbnailRequests.has(cacheKey))thumbnailRequests.set(cacheKey,api('comparison-thumbnail',{path:row.source,acquisition:row.native_acquisition,kind:'map',image:choice.path}));
    thumbnailRequests.get(cacheKey).then(result=>{if(image.isConnected&&result.full_resolution&&result.image){image.src=result.image;image.hidden=false;preview.hidden=false;linkMapHover([{cell:preview,img:image,fullPreview:true}],null,choice.label,overviewObservers);const outline=el('span',undefined,'eds-overview-field');preview.append(outline);const draw=()=>{if(!image.naturalWidth)return;const box=mapImageBox(image),outer=preview.getBoundingClientRect(),points=result.crop_points;outline.style.left=box.left-outer.left+points[0][0]/image.naturalWidth*box.width+'px';outline.style.top=box.top-outer.top+points[0][1]/image.naturalHeight*box.height+'px';outline.style.width=(points[1][0]-points[0][0])/image.naturalWidth*box.width+'px';outline.style.height=(points[1][1]-points[0][1])/image.naturalHeight*box.height+'px'};image.onload=draw;const observer=new ResizeObserver(draw);observer.observe(preview);overviewObservers.push(observer);draw()}else if(image.isConnected)card.append(el('p','Restart Workbench for full-resolution previews.','eds-channel-error'))}).catch(error=>{thumbnailRequests.delete(cacheKey);if(card.isConnected)card.append(el('p',error.message,'eds-channel-error'))});
    if(order>=0){const actions=el('div',undefined,'eds-overview-order');for(const [direction,mark] of [[-1,'←'],[1,'→']]){const button=el('button',mark);button.type='button';button.disabled=order+direction<0||order+direction>=selected(row).length;button.setAttribute('aria-label',`Move ${choice.label} ${direction<0?'earlier':'later'} for ${row.label}`);button.onclick=()=>{const paths=[...selected(row)],index=paths.indexOf(choice.path);[paths[index],paths[index+direction]]=[paths[index+direction],paths[index]];set(paths)};actions.append(button)}card.append(actions)}
   }
  }
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
 function acquisitionDimensions(group){
  const field=el('small',undefined,'eds-acquisition-dimensions'),measurement=group.dimensions;
  const text=window.aztecAcquisitionDimensions.text(measurement,group.kind);field.textContent=text||'Dimensions unavailable';field.title=measurement?.distance_unit==='px'?'Reference image pixels; physical calibration unavailable.':group.kind==='line'?'Full acquired scan length, before trimming.':'Full acquired map width × height, before display cropping.';return field;
 }
 function acquisitionControls(root){
  const context=current,details=el('details',undefined,'eds-comparison-selection eds-acquisition-selection');details.open=context.acquisitionPickerOpen??true;
  const summary=el('summary',`Acquisitions · ${context.ids.length} selected`);details.append(summary);
  const selected=el('div',undefined,'eds-selected-order');
  const files=el('div',undefined,'eds-acquisition-files');
  thumbnailObserver?.disconnect();
  thumbnailObserver=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver((entries,observer)=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);entry.target.loadThumbnail()}},{rootMargin:'200px'});
  const preview=(group,compact=false,immediate=false)=>{
   const box=el('span',undefined,'eds-acquisition-thumb'+(compact?' eds-acquisition-thumb-small':'')),image=el('img'),zoom=el('img',undefined,'eds-thumb-expanded'),status=el('span','…','hint');image.alt=`${group.name} ${group.kind} highlighted on its reference image`;image.hidden=true;zoom.alt='';zoom.hidden=true;zoom.setAttribute('aria-hidden','true');box.tabIndex=0;box.setAttribute('role','button');box.setAttribute('aria-label',`Enlarge ${group.name} reference image`);box.setAttribute('aria-expanded','false');box.append(image,status,zoom);
   const showZoom=()=>{if(!zoom.src)return;const rect=box.getBoundingClientRect(),width=Math.min(280,innerWidth-16),height=Math.min(260,innerHeight-16);zoom.style.width=width+'px';zoom.style.height=height+'px';zoom.style.left=(rect.right+10+width<=innerWidth-8?rect.right+10:Math.max(8,rect.left-width-10))+'px';zoom.style.top=Math.max(8,Math.min(rect.top,innerHeight-height-8))+'px';zoom.hidden=false;box.setAttribute('aria-expanded','true')};
   const hideZoom=()=>{zoom.hidden=true;box.setAttribute('aria-expanded','false')};
   box.onpointerenter=showZoom;box.onpointerleave=()=>{if(document.activeElement!==box)hideZoom()};box.onfocus=showZoom;box.onblur=hideZoom;box.onclick=e=>{e.preventDefault();e.stopPropagation();box.focus({preventScroll:true});showZoom()};box.onkeydown=e=>{if(e.key==='Escape'){hideZoom();box.blur()}else if(e.key==='Enter'||e.key===' '){e.preventDefault();showZoom()}};
   box.loadThumbnail=()=>{
    const key=group.source+'|'+JSON.stringify(catalogues.get(group.source)?.source||{})+'|'+group.id+'|'+group.kind;
    if(!thumbnailRequests.has(key))thumbnailRequests.set(key,api('comparison-thumbnail',{path:group.source,acquisition:target(group.id).acquisition,kind:group.kind}));
    thumbnailRequests.get(key).then(result=>{if(!image.isConnected)return;if(result.image){image.src=zoom.src=result.image;image.hidden=false;status.hidden=true;if(box.matches(':hover')||document.activeElement===box)showZoom()}else status.textContent='No image';box.setAttribute('aria-description',result.note||image.alt)}).catch(()=>{thumbnailRequests.delete(key);if(status.isConnected)status.textContent='No image'});
   };
   if(immediate||!thumbnailObserver)box.loadThumbnail();else thumbnailObserver.observe(box);return box;
  };
  const drawSelected=()=>{
   for(const box of selected.querySelectorAll('.eds-acquisition-thumb'))thumbnailObserver?.unobserve(box);
   selected.replaceChildren();const ordered=context.ids.map(id=>context.all.find(g=>g.id===id)).filter(Boolean);
   if(!ordered.length){selected.append(el('p','Choose acquisitions above.','hint'));return}
   selected.append(el('h4','Display order and export labels'));
   ordered.forEach((group,index)=>{
    const card=el('div',undefined,'eds-selected-acquisition'),number=el('span',String(index+1),'eds-order-number'),name=el('div',undefined,'eds-selected-acquisition-name'),title=el('strong',[group.site,group.name].filter(Boolean).join(' / ')),details=el('small',fileName(group.source));
    title.title=group.label;details.title=group.source;name.append(title,details,acquisitionDimensions(group));
    const alias=el('label','Export label','eds-order-alias'),input=el('input');input.type='text';input.maxLength=120;input.placeholder=group.sample;input.value=aliases[itemKey(group.id)]||'';input.setAttribute('aria-label','Export label for '+group.label);input.oninput=input.onchange=()=>{const key=itemKey(group.id),value=input.value.trim();if(value)aliases[key]=value;else delete aliases[key];if(labelColours[key])colourMemory.remember({colour:labelColours[key],...colourContext(group)});persist();updateMapLabels();updateLineLabels()};alias.append(input);name.append(alias,labelColourControl(group));
    const actions=el('div',undefined,'eds-order-actions');for(const [direction,mark] of [[-1,'↑'],[1,'↓']]){
     const button=el('button',mark);button.type='button';button.disabled=index+direction<0||index+direction>=ordered.length;button.setAttribute('aria-label',`Move ${group.label} ${direction<0?'up':'down'}`);button.title=direction<0?'Move earlier':'Move later';
     button.onclick=()=>{const i=context.ids.indexOf(group.id),j=i+direction;[context.ids[i],context.ids[j]]=[context.ids[j],context.ids[i]];drawSelected();update()};actions.append(button)
    }
    card.append(number,preview(group,false,true),name,actions);selected.append(card);
   });
  };
  for(const source of context.files){
   const groups=context.all.filter(g=>g.source===source);if(!groups.length)continue;
   const section=el('section',undefined,'eds-acquisition-file'),heading=el('h4',fileName(source));
   heading.title=source;heading.tabIndex=0;heading.setAttribute('aria-label',fileName(source)+' · '+source);section.append(heading);
   const list=el('div',undefined,'eds-acquisition-picks'),samples=new Map(),sites=new Map();section.append(list);files.append(section);
   for(const group of groups){
    if(!samples.has(group.sample)){const sample=el('section',undefined,'eds-acquisition-sample'),title=el('h5',group.sample),grid=el('div',undefined,'eds-acquisition-sites');sample.append(title,grid);list.append(sample);samples.set(group.sample,grid)}
    const siteKey=group.sample+' / '+group.siteName;
    if(!sites.has(siteKey)){const site=el('div',undefined,'eds-acquisition-site'),name=el('strong',group.siteName);name.title=group.site;site.append(name);samples.get(group.sample).append(site);sites.set(siteKey,site)}
    const label=el('label',undefined,'eds-acquisition-choice'),input=el('input');input.type='checkbox';input.value=group.id;input.checked=context.ids.includes(group.id);input.setAttribute('aria-label',group.label);
    input.onchange=()=>{const before=selectedChannelNames(context);context.ids=input.checked?[...context.ids,group.id]:context.ids.filter(id=>id!==group.id);const channels=reconcileSelectedChannels(context,before);keepScroll(()=>controls(channels));update()};
    const name=el('span',undefined,'eds-acquisition-name');name.append(el('span',group.name),acquisitionDimensions(group));label.append(input,preview(group,true),name);sites.get(siteKey).append(label);
    if(context.table==='KamMapImages'&&context.ids.includes(group.id))kamSourceControls(sites.get(siteKey),group.id,group.label)
   }
  }
  drawSelected();details.ontoggle=()=>{context.acquisitionPickerOpen=details.open};details.append(files,selected);root.append(details);
 }
 function sourceCaption(file,path){
  const caption=el('span',undefined,'eds-source-caption'),relative=file?.relative_path||fileName(path),split=Math.max(relative.lastIndexOf('/'),relative.lastIndexOf('\\'));
  caption.title=path;
  if(file?.project)caption.append(el('strong',file.project,'eds-source-project'),el('span','/','eds-source-separator'));
  const tail=el('span',undefined,'eds-source-path');
  if(split>=0)tail.append(WorkbenchProjectTools.pathText(el('span',undefined,'eds-source-folders'),relative.slice(0,split+1)));
  tail.append(WorkbenchProjectTools.pathText(el('span',undefined,'eds-source-filename'),relative.slice(split+1)));
  for(const part of tail.children)part.title=path;
  caption.append(tail);return caption;
 }
 function sourceControls(root){
  const context=current,details=el('details',undefined,'eds-comparison-selection eds-source-selection');details.open=context.sourcePickerOpen??true;
  const summary=el('summary',`Project files · ${context.files.length} selected`),list=el('div',undefined,'eds-source-picks'),status=el('p',undefined,'hint');
  const refresh=el('button','Rescan projects');refresh.type='button';
  details.append(summary,list,refresh,status);root.append(details);
  let discovered=context.discoveredFiles||[],scanned=!!context.sourceScanned;
  function draw(){
   list.replaceChildren();
   const relevant=path=>catalogues.has(path)&&groups(catalogues.get(path)).some(group=>group.kind===context.kind&&group.table===context.table);
   const paths=[...new Set([...context.files,...discovered.map(f=>f.path)])].sort((a,b)=>Number(relevant(b))-Number(relevant(a))||Number(context.files.includes(b))-Number(context.files.includes(a)));
   for(const path of paths){
    const file=discovered.find(f=>f.path===path),label=el('label',undefined,'eds-source-pick'),input=el('input'),content=el('span',undefined,'eds-source-pick-main');
    input.type='checkbox';input.checked=context.files.includes(path);input.setAttribute('aria-label','Include '+path);content.append(sourceCaption(file,path),projectOverviewStrip(path));label.append(input,content);list.append(label);
    const ready=catalogues.has(path),available=relevant(path);input.disabled=!input.checked&&!available;label.classList.toggle('eds-source-unavailable',ready&&!available&&!input.checked);label.classList.toggle('eds-source-mismatch',ready&&!available&&input.checked);label.setAttribute('aria-disabled',String(!input.checked&&!available));if(!available){const note=el('span',ready?(context.table==='KamMapImages'?'No KAM / IPF acquisitions':'No '+({XrayMapImages:'intensity maps',QuantMapImages:'weight % maps',AtomicMapImages:'atomic % maps',XrayLinescans:'intensity profiles',QuantLinescans:'composition profiles'}[context.table]||'matching acquisitions')):sourceErrors.has(path)?'Could not read this file':'Checking available data…','eds-source-availability hint');if(ready&&input.checked)note.textContent='Selected · '+note.textContent;content.append(note);label.title=note.textContent}
    if(sourceErrors.has(path)){const error=el('span',sourceErrors.get(path),'eds-channel-error');label.append(error)}
    input.onchange=async()=>{
     const include=input.checked;if(include&&!relevant(path)){input.checked=false;return}input.disabled=true;status.textContent=include?'Reading file contents…':'';++version;
     if(include){catalogues.delete(path);await loadCatalogue(path)}
     if(current!==context)return;
     if(include&&sourceErrors.has(path)){input.checked=false;input.disabled=false;status.textContent=sourceErrors.get(path);update();return}
     const oldChannels=selectedChannelNames(context);
     context.files=include?[...context.files,path]:context.files.filter(p=>p!==path);
     context.all=comparisonGroups(context.files).filter(g=>g.kind===context.kind&&g.table===context.table);
     if(include){const first=context.all.find(g=>g.source===path);if(first&&!context.ids.includes(first.id)&&context.ids.length<32)context.ids.push(first.id)}
     else context.ids=context.ids.filter(id=>target(id).source!==path);
     const channels=reconcileSelectedChannels(context,oldChannels);
     context.sourcePickerOpen=true;persist();keepScroll(()=>controls(channels));update();
    };
   }
  }
  async function checkAvailability(){
   const pending=[...new Set([...context.files,...discovered.map(file=>file.path)])].filter(path=>!catalogues.has(path));
   await Promise.all(Array.from({length:Math.min(3,pending.length)},async()=>{while(pending.length&&current===context){await loadCatalogue(pending.shift());if(current===context)draw()}}));
  }
  async function scan(){
   refresh.disabled=true;status.textContent='Scanning configured projects…';
   try{const result=await api('files',{});if(current!==context)return;discovered=result.files.filter(f=>f.kind==='OIPX'&&isSourceVisible(f.path));scanned=true;context.discoveredFiles=discovered;context.sourceScanned=true;draw();await checkAvailability();if(current!==context)return;status.textContent=result.errors?.length?result.errors.join(' · '):discovered.length?'':'No other native OIPX files found in configured projects.'}
   catch(error){status.textContent=error.message}finally{refresh.disabled=false}
  }
  details.ontoggle=()=>{context.sourcePickerOpen=details.open;if(details.open&&!scanned&&!refresh.disabled)scan()};refresh.onclick=scan;draw();if(scanned)checkAvailability();
 }
 async function renderSavedComparison({item,table}){
  if(!item.ids?.length||!item.signals?.length)throw new Error('No acquisitions or quantities selected.');
  const kind=table.endsWith('Linescans')?'line':'map',options=structuredClone(item.options||{}),signals=item.signals.filter(signal=>options.mode!=='ratio'||signal!==options.denominator);
  if(kind==='map'&&options.mode==='ratio'&&options.show_denominator)signals.unshift(options.denominator);
  const result=await api('process',{...options,targets:item.ids.map(id=>comparisonState.target(id)),signals,channel_table:table,comparison:true,map_distributions:false});
  if(!result.rows?.length)throw new Error('No comparison data available.');
  const failed=result.rows.filter(row=>row.error);if(failed.length===result.rows.length)throw new Error(failed[0].error);
  const names=Object.fromEntries(result.rows.map(row=>[row.acquisition,(item.aliases?.[row.acquisition]||row.sample_name||row.short_label||row.label)+(row.data_kind==='reconstructed'?' · window cps':'')]));
  const settings={kind,result,options,comparison:true,signals,names,colours:item.labelColours||{},crops:item.crops||{},maxSize:1000};
  if(kind==='map')return window.aztecExport.png(settings);
  // Use a separate renderer and in-memory settings: no active-view swaps or saves.
  const root=el('div',undefined,'eds-comparison-preview-render');root.setAttribute('aria-hidden','true');root.inert=true;document.body.append(root);
  const noop=()=>{},renderer=window.createAztecAnalysis({$:()=>null,el,state:{},api,previewOnly:true,setLineCrop:noop,setLineCursor:noop,setMapCursor:noop});
  try{return await renderer.linePreview(root,item,settings)}finally{root.remove()}
 }
 async function linePreview(root,item,settings){
  current={kind:'line',comparison:true,all:[],options:settings.options};
  for(const [id,label]of Object.entries(item.aliases||{}))aliases['compare:'+id]=label;
  for(const [id,colour]of Object.entries(item.labelColours||{}))labelColours['compare:'+id]=colour;
  try{
   renderLineComparison(root,settings.result);
   redrawLinePlots(root);
   const snapshot=window.aztecExport.captureLines({...settings,root});
   return await window.aztecExport.png({...settings,snapshot});
  }finally{clearPlotObservers();current=null}
 }
 function presetControls(root){
  const context=current,key=context.preferenceKey,items=Array.isArray(presets[key])?presets[key]:[];presets[key]=items;
  const families=[['XrayMapImages','Maps · intensity'],['QuantMapImages','Maps · wt%'],['AtomicMapImages','Maps · at%'],['KamMapImages','Maps · KAM'],['XrayLinescans','Lines · intensity'],['QuantLinescans','Lines · composition']];
  let entries=[];
  const row=el('div',undefined,'eds-preset-controls'),select=el('select'),name=el('input'),save=el('button'),rename=el('button','Rename'),remove=el('button','Delete'),status=el('span',undefined,'hint eds-comparison-save-status');
  select.setAttribute('aria-label','Saved comparisons');select.hidden=true;select.tabIndex=-1;select.setAttribute('aria-hidden','true');
  const picker=el('button',undefined,'eds-comparison-picker-trigger');picker.type='button';picker.setAttribute('aria-label','Saved comparisons');picker.setAttribute('aria-haspopup','dialog');picker.setAttribute('aria-expanded','false');picker.onclick=()=>window.aztecComparisonPicker.open({anchor:picker,entries,selected:select.value,preview:comparisonPreview,onSelect:value=>{select.value=value;select.onchange()}});
  name.type='text';name.maxLength=80;name.placeholder='Comparison name';name.setAttribute('aria-label','Comparison name');for(const button of [save,rename,remove])button.type='button';status.setAttribute('role','status');
  const populate=()=>{select.replaceChildren();entries=[];const placeholder=el('option','Unsaved comparison');placeholder.value='';select.append(placeholder);for(const [table,label] of families){const group=el('optgroup');group.label=label;for(const item of presets[viewKey(table)]||[]){const entry={item,table,family:label,key:viewKey(table),value:table+':'+item.name};entries.push(entry);const option=el('option',item.name);option.value=entry.value;group.append(option)}if(group.childElementCount)select.append(group)}
   const active=items.find(item=>item.name===activePresets[key]);select.value=active?context.table+':'+active.name:'';picker.textContent=(active?.name||'Unsaved comparison')+' ▾';name.value=active?.name||'';rename.disabled=remove.disabled=!active;save.textContent=active?'Save as…':'Save comparison';status.textContent=active?'Autosave on':'';
  };populate();
  select.onchange=async()=>{const entry=entries.find(p=>p.value===select.value);if(!entry){populate();return}persist();const {item,table,key:destination}=entry;
   activePresets[destination]=item.name;current=null;restorePreset(item,destination);persist();
   // open restores the selected snapshot before rendering or autosaving it.
   const kind=['XrayMapImages','QuantMapImages','AtomicMapImages','KamMapImages'].includes(table)?'map':'line';const views=$('eds-analysis-views');views.style.minHeight=views.getBoundingClientRect().height+'px';const top=window.scrollY,left=window.scrollX,pending=open(null,kind,table),turn=openVersion;await pending;if(turn!==openVersion||current?.preferenceKey!==destination)return;window.scrollTo({top,left,behavior:'instant'});
  };
  const report=error=>{status.textContent=error.message;status.classList.add('eds-channel-error');name.focus({preventScroll:true})};
  save.onclick=()=>{try{
   let label=name.value.trim();const active=activePresets[key];
   if(active&&label===active){const base=active+' copy';label=base;let suffix=2;while(items.some(item=>item.name===label))label=base+' '+suffix++}
   comparisonState.saveAs(presets,activePresets,key,comparisonSnapshot(context),label);populate();persist();
  }catch(error){report(error)}};
  rename.onclick=()=>{try{comparisonState.rename(presets,activePresets,key,name.value);populate();persist()}catch(error){report(error)}};
  remove.className='eds-preset-delete';remove.onclick=()=>{const index=items.findIndex(item=>item.name===activePresets[key]);if(index<0)return;persist();const [removed]=items.splice(index,1);delete activePresets[key];persist();populate();status.replaceChildren(el('span','Deleted '));const undo=el('button','Undo');undo.type='button';undo.onclick=()=>{if(items.some(item=>item.name===removed.name)){status.textContent='That name is now used; rename it before restoring.';return}items.splice(index,0,removed);persist();populate();select.value=context.table+':'+removed.name;select.onchange()};status.append(undo)};
  const fresh=el('button','New comparison');fresh.type='button';fresh.onclick=()=>{persist();delete activePresets[key];context.ids=[];context.files=[];context.all=[];context.signals=[];context.options.overview_images={};context.overviewPickerOpen=false;context.sourcePickerOpen=true;context.acquisitionPickerOpen=true;context.result=null;persist();$('eds-analysis-views').replaceChildren();controls([]);update()};
  row.append(fresh,select,picker,name,save,rename,remove,status);root.append(row);
 }
 function normaliseLabelColour(value){const hex=String(value||'').trim().replace(/^#/,'');if(!/^(?:[\da-fA-F]{3}|[\da-fA-F]{6})$/.test(hex))return null;return '#'+(hex.length===3?[...hex].map(c=>c+c).join(''):hex).toLowerCase()}
 function labelInk(hex){const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722>.179?'#0b1520':'#fff'}
 function labelColour(row){return normaliseLabelColour(labelColours[itemKey(row.acquisition)])}
 function applyLabelColour(node,row){const colour=labelColour(row);node.style.backgroundColor=colour||'';node.style.color=colour?labelInk(colour):''}
 function exportLabel(row){const name=aliases[itemKey(row.acquisition)]||row.sample_name||current.all.find(g=>g.id===row.acquisition)?.sample||row.short_label||row.label;return row.data_kind==='reconstructed'?name+' · window cps':name}
 function updateMapLabels(){
  for(const caption of $('eds-analysis-views').querySelectorAll('.eds-map-label[data-acquisition]')){const row=current.result?.rows.find(r=>r.acquisition===caption.dataset.acquisition);if(row){caption.textContent=exportLabel(row);applyLabelColour(caption,row)}}
  const plot=$('eds-analysis-views').querySelector('.eds-distribution-plot'),result=current.result;
  if(result?.kam){const details=$('eds-analysis-views').querySelector('.eds-map-details-table');if(details)kamStatistics(details,result)}
  if(plot&&result){const group=window.aztecDistributions.selected(result,current.options.distribution_channel);if(group)plot.replaceChildren(window.aztecDistributions.svg(group,result.rows,Object.fromEntries(result.rows.map(row=>[row.acquisition,exportLabel(row)])),{view:result.kam?current.options.distribution_view:'histogram',xMin:result.kam?current.options.distribution_x_min:null,xMax:result.kam?current.options.distribution_x_max:null,markers:current.options.distribution_markers,colours:Object.fromEntries(result.rows.map(row=>[row.acquisition,labelColour(row)]))}))}
  refreshExportPreview();
 }
 function updateLineLabels(){
  for(const caption of $('eds-analysis-views').querySelectorAll('.eds-line-reference-label[data-acquisition],.eds-line-caption span[data-acquisition]')){const row=current.result?.rows.find(r=>r.acquisition===caption.dataset.acquisition);if(row){caption.textContent=exportLabel(row);if(caption.classList.contains('eds-line-reference-label'))applyLabelColour(caption,row)}}
 }
 function colourContext(group){return {label:aliases[itemKey(group.id)]||group.sample||group.label,sample:group.sample||''}}
 function inUseLabelColours(){
  const entries=Object.entries(labelColours).map(([key,colour])=>({colour,label:aliases[key]||''}));
  for(const group of current.all||[]){const colour=labelColours[itemKey(group.id)];if(colour)entries.push({colour,...colourContext(group)})}
  for(const items of Object.values(presets))for(const item of Array.isArray(items)?items:[])for(const [id,colour] of Object.entries(item.labelColours||{}))entries.push({colour,label:item.aliases?.[id]||''});
  return entries;
 }
 function labelColourControl(group){
  const key=itemKey(group.id),row=el('div',undefined,'eds-label-colour-controls'),picker=el('button'),hex=el('input'),reset=el('button','↺'),error=el('span',undefined,'eds-label-colour-error');
  picker.type='button';picker.className='eds-label-colour-picker';picker.style.backgroundColor=normaliseLabelColour(labelColours[key])||'#0c131c';picker.setAttribute('aria-label','Pick export label colour for '+group.label);picker.setAttribute('aria-haspopup','dialog');picker.setAttribute('aria-expanded','false');picker.title='Suggested, in-use and recent colours';
  hex.type='text';hex.inputMode='text';hex.maxLength=7;hex.placeholder='#RRGGBB';hex.value=normaliseLabelColour(labelColours[key])||'';hex.setAttribute('aria-label','Hex export label colour for '+group.label);hex.spellcheck=false;
  reset.type='button';reset.title='Reset label colour';reset.setAttribute('aria-label','Reset export label colour for '+group.label);
  const apply=(value,redraw=false)=>{const colour=normaliseLabelColour(value);if(colour)labelColours[key]=colour;else delete labelColours[key];picker.style.backgroundColor=colour||'#0c131c';if(colour&&redraw)colourMemory.remember({colour,...colourContext(group)});persist();updateMapLabels();updateLineLabels();if(redraw&&current?.kind==='line'&&current.result)render(current.result)};
  const validate=()=>{const raw=hex.value.trim(),valid=!raw||!!normaliseLabelColour(raw);hex.setAttribute('aria-invalid',String(!valid));error.textContent=valid?'':'Use #RGB or #RRGGBB';return valid};
  const openPalette=(anchor,focus=true)=>{const entries=inUseLabelColours();colourMemory.seed(entries);window.aztecLabelColours.open({anchor,focus,title:colourContext(group).label,colour:labelColours[key],choices:colourMemory.suggestions(entries,colourContext(group)),onSelect:colour=>{hex.value=colour;validate();apply(colour,true)}})};
  picker.onclick=()=>openPalette(picker);hex.setAttribute('aria-haspopup','dialog');hex.setAttribute('aria-expanded','false');hex.onclick=()=>openPalette(hex,false);hex.onkeydown=event=>{if(event.key==='ArrowDown'){event.preventDefault();openPalette(hex)}};
  hex.oninput=()=>{if(validate())apply(hex.value)};hex.onchange=()=>{if(validate()){hex.value=normaliseLabelColour(hex.value)||'';apply(hex.value,true)}};
  reset.onclick=()=>{hex.value='';validate();apply('',true)};
  row.append(picker,hex,reset,error);return row;
 }
 function renderExportLabels(){
  const list=$('eds-analysis-tools').querySelector('.eds-export-aliases');if(!list)return;list.replaceChildren();colourMemory.seed(inUseLabelColours());
  for(const group of current.ids.map(id=>current.all.find(g=>g.id===id)).filter(Boolean)){const entry=el('div',undefined,'eds-export-entry'),label=el('label'),caption=el('span',group.label),input=el('input');caption.title=(group.source?group.source+' / ':'')+group.label;label.append(caption);input.type='text';input.maxLength=120;input.placeholder=group.sample;input.value=aliases[itemKey(group.id)]||'';input.setAttribute('aria-label','Export label for '+group.label);input.onchange=()=>{const key=itemKey(group.id),value=input.value.trim();if(value)aliases[key]=value;else delete aliases[key];if(labelColours[key])colourMemory.remember({colour:labelColours[key],...colourContext(group)});persist();updateMapLabels();updateLineLabels()};label.append(input);entry.append(label,labelColourControl(group));list.append(entry)}
  list.parentElement.hidden=!list.childElementCount;
 }
 function exportControls(root,footer){
  const buttons=el('div',undefined,'eds-export-actions'),png=el('button',current.kind==='map'?'Export maps PNG':'Export PNG'),distribution=el('button','Export PNG'),data=el('button','Export data'),notice=window.WorkbenchExportNotice.show;
  distribution.setAttribute('aria-label','Export pixel distribution PNG');current.distributionExportButton=distribution;
  const exportButtons=[png,distribution,data],buttonTimers=new Map(),buttonLabels=new Map(exportButtons.map(button=>[button,button.textContent]));
  const buttonState=(button,state)=>{
   clearTimeout(buttonTimers.get(button));button.dataset.exportState=state;
   button.textContent=state==='busy'?'Exporting…':state==='saved'?'✓ Saved':'Export failed';
   button.setAttribute('aria-busy',String(state==='busy'));
   if(state!=='busy')buttonTimers.set(button,setTimeout(()=>{button.textContent=buttonLabels.get(button);delete button.dataset.exportState;button.removeAttribute('aria-busy')},5000));
  };
  for(const b of exportButtons)b.type='button';
  let pngMode;
  if(current.comparison&&current.kind==='line'){
   const label=el('label','PNG layout','eds-export-mode');pngMode=el('select');pngMode.setAttribute('aria-label','Line PNG export mode');
   for(const [value,name] of [['all','All in one image'],['individual','One per acquisition']]){const option=el('option',name);option.value=value;pngMode.append(option)}
   label.append(pngMode);buttons.append(label);
  }
  const backgroundLabel=el('label','PNG background','eds-export-mode'),backgroundSelect=el('select');
  backgroundSelect.setAttribute('aria-label','PNG background');
  for(const [value,name] of [['dark','Dark'],['white','White'],['transparent','Transparent']]){const option=el('option',name);option.value=value;backgroundSelect.append(option)}
  backgroundSelect.value=current.options.png_background||'dark';
  backgroundSelect.onchange=()=>{current.options.png_background=backgroundSelect.value;persist();refreshExportPreview()};
  backgroundLabel.append(backgroundSelect);buttons.append(backgroundLabel);
  buttons.append(png,data);footer.append(buttons);
  if(current.comparison){
   data.title=distribution.title='Save to the configured output folder for the first selected acquisition’s project.';
   const updatePngTitle=()=>{png.title=pngMode?.value==='individual'?'Save one PNG per acquisition to its source project’s output folder.':'Save to the configured output folder for the first selected acquisition’s project.'};
   if(pngMode)pngMode.onchange=updatePngTitle;updatePngTitle();
  }
  if(!current.comparison){const labels=el('details',undefined,'eds-export-labels');labels.append(el('summary','Export labels'));const list=el('div',undefined,'eds-export-aliases');labels.append(list);root.append(labels);renderExportLabels()}
  async function run(kind){
   if(!current?.result||current.resultVersion!==version){notice('Export unavailable','Wait for the current view to finish updating.','error');return}
   const context=current,result=context.result,options={...context.options},fileId=state.file?.id,source=context.comparison?result.rows[0].source:projectKey();
   const names=Object.fromEntries(result.rows.map(r=>[r.acquisition,exportLabel(r)])),colours=Object.fromEntries(result.rows.map(r=>[r.acquisition,labelColour(r)]).filter(([,colour])=>colour));
   const lineRanges=context.kind==='line'&&context.comparison?window.aztecLineGeometry.ranges(result.rows,options):{};
   const active=kind==='png'?png:kind==='distribution'?distribution:data;
   for(const button of exportButtons)button.disabled=true;backgroundSelect.disabled=true;if(pngMode)pngMode.disabled=true;buttonState(active,'busy');notice(kind==='data'?'Exporting data…':kind==='distribution'?'Exporting distribution PNG…':'Exporting PNG…','Preparing the file…');
   try{
    if(!window.aztecExport)throw new Error('Restart TEM Workbench and reload to load the export tools.');
    let saved;
    if(kind!=='data'){
     const settings={result,options,kind:kind==='distribution'?'distribution':context.kind,comparison:context.comparison,signals:selectedSignals(),names,colours,source,crops:Object.fromEntries(result.rows.map(r=>[r.acquisition,cropCentres.get(itemKey(r.acquisition))])),root:$('eds-analysis-views')};
     if(kind==='png'&&pngMode?.value==='individual'){
      const snapshot=window.aztecExport.captureLines(settings),ids=snapshot.acquisitions,paths=[];
      if(!ids.length)throw new Error('There are no line plots to export.');
      try{
       for(const [index,id] of ids.entries()){
        notice(`Saving PNG ${index+1} of ${ids.length}…`,names[id]);
        const image=await window.aztecExport.png({...settings,snapshot,onlyAcquisition:id});
        saved=await api('export',{id:fileId,...acquisitionRequest(context,[id]),format:'png',kind:'line',comparison:true,individual:true,export_label:names[id],image});
        paths.push(saved.path);
       }
      }catch(error){if(paths.length)error.message=`Saved ${paths.length} of ${ids.length} PNGs. ${error.message}`;throw error}
      notice(paths.length===1?'✓ Export saved · '+paths[0].split(/[\\/]/).at(-1):`✓ ${paths.length} PNGs saved`,paths.join('\n'),'saved');buttonState(active,'saved');return;
     }
     const snapshot=context.kind==='line'?window.aztecExport.captureLines(settings):null;
     const image=await window.aztecExport.png({...settings,snapshot});
     saved=await api('export',{id:fileId,...acquisitionRequest(context),format:'png',kind:settings.kind,comparison:context.comparison,image});
    }else{const {png_background,...processingOptions}=options;saved=await api('export',{id:fileId,...acquisitionRequest(context),signals:selectedSignals(),channel_table:context.table,comparison:context.comparison,...processingOptions,export_labels:names,export_line_ranges:lineRanges,format:'data'})}
    notice('✓ Export saved · '+saved.path.split(/[\\/]/).at(-1),saved.path,'saved');buttonState(active,'saved');
   }catch(error){notice('Export failed',error.message,'error');buttonState(active,'error');console.error('AZtec export failed:',error)}finally{for(const button of exportButtons)button.disabled=false;backgroundSelect.disabled=false;if(pngMode)pngMode.disabled=false}
  }
  png.onclick=()=>run('png');distribution.onclick=()=>run('distribution');data.onclick=()=>run('data');
 }
 async function update(){
  clearTimeout(smoothingTimer);const v=++version;if(!current)return;persist();$('eds-preview-error').hidden=true;
  selections[current.preferenceKey]={ids:[...current.ids],signals:[...current.signals],files:[...(current.files||[])]};
  const signals=selectedSignals();
  if(!current.ids.length||!signals.length){clearPlotObservers();setLineCrop(null);current.result=null;$('eds-analysis-views').replaceChildren(el('p',current.files?.length?'Select acquisitions and quantities to compare.':'Choose project files to start a comparison.','hint'));$('eds-preview-busy').hidden=true;return}
  $('eds-preview-busy').hidden=false;
  try{const result=await api('process',{id:state.file?.id,...acquisitionRequest(current),signals,channel_table:current.table,comparison:current.comparison,...current.options,map_distributions:current.kind==='map'});if(v!==version)return;if(current.table==='KamMapImages'&&!window.aztecKamSources.accepted(current.options,current.ids,result))throw new Error('Restart TEM Workbench, then reload to use H5OINA KAM sources.');if(current.table==='KamMapImages'&&['aztec','viridis','inferno','gray'].includes(current.options.kam_palette)&&result.kam_palette!==current.options.kam_palette)throw new Error('Restart TEM Workbench, then reload to use the new KAM colour schemes.');if(current.kind==='map'&&current.table!=='KamMapImages'&&current.options.eds_layout!=='separate'&&result.eds_layout!==current.options.eds_layout)throw new Error('Restart TEM Workbench, then reload this page to use layered EDS maps.');if(current.kind==='map'&&current.options.normalisation!=='none'&&current.options.map_palette==='black'&&result.map_palette!=='black')throw new Error('Restart TEM Workbench, then reload this page to use Black–colour maps.');if(current.comparison&&(result.scale_scope!==current.options.scale_scope||current.kind==='map'&&current.options.normalisation!=='none'&&current.options.scale_scope==='element'&&result.colour_scale_scope!=='element'))throw new Error('This running server has not loaded the current shared-scale rules. Restart TEM Workbench, then reload this page.');current.result=result;current.resultVersion=v;render(result)}catch(error){if(v===version){$('eds-preview-error').textContent=error.message;$('eds-preview-error').hidden=false}}finally{if(v===version)$('eds-preview-busy').hidden=true}
 }
 function keepScroll(change){
  const left=window.scrollX,top=window.scrollY;change();window.scrollTo({left,top,behavior:'instant'});
 }
 function render(result){
  // Retain the old height until replacement images have dimensions. Otherwise a
  // temporarily shorter document clamps scroll position before images load.
  imageScaleAvailability(result);
  if(current.kind==='map'){overviewControls(result);layerControls(result);updateKamSourceControls(result)}
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
  if(current.comparison||result.kam||current.options.transpose||current.kind==='map'&&(current.options.overview_images||current.options.eds_layout!=='separate')){renderComparison(root,result);applyMapBrightness();$('eds-preview-note').textContent='';return}
  const mapRoot=root;
  if(current.kind==='map'&&result.normalisation!=='none'){
   const scale=el('div',undefined,'eds-scale'),bar=el('span',undefined,'eds-scale-bar');
   if(window.aztecMapColours.black(result)){bar.classList.add('eds-scale-bands');for(const stops of window.aztecMapColours.bands(result)){const band=el('span');band.style.background=`linear-gradient(90deg,${stops.join(',')})`;bar.append(band)}scale.title='Black = colour minimum; full element colour = colour maximum. Values remain relative to the normalization baseline.'}
   scale.append(el('span',String(result.low)),bar,el('span',`${result.high} · relative to ${({median:'median',mean:'mean',p20:'P20'})[result.normalisation]}${window.aztecMapColours.black(result)?' · black = minimum':''}`));mapRoot.append(scale);
  }
  for(const row of result.rows){const section=el('section',undefined,'eds-map-row');section.dataset.acquisition=row.acquisition;if(current.comparison)section.append(el('h3',row.label));mapRoot.append(section);
   if(row.kind==='map'){
    const tiles=el('div',undefined,'eds-map-tiles'),linked=[];section.append(tiles);
    for(const tile of row.tiles){const column=el('div',undefined,'eds-map-pair');tiles.append(column);
     const stat=(result.mode==='both'?row.signal_statistics:row.statistics)?.spreads?.find(s=>s.channel===tile.channel);
     linked.push(imageTile(column,tile.label,tile.image,tile.colour,tile.error,row,stat));
     if(result.mode==='both'){if(tile.ratio_label)linked.push(imageTile(column,tile.ratio_label,tile.ratio_image,tile.colour,tile.ratio_error,row,row.statistics?.spreads?.find(s=>s.channel===tile.channel)));else if(row.electron)linked.push(imageTile(column,'Electron image',row.electron,null,null,row))}
    }linkMapHover(linked.filter(Boolean),row.tiles[0]?.path,exportLabel(row));
   }
   else linePlots(section,row,result)
  }
  applyMapBrightness();
  if(current.kind==='map')mapStatistics(mapDetails(root,result),result,result.mode==='both'?[{electron:true},...selectedSignals().map(channel=>({channel,label:channel})),...selectedSignals().filter(channel=>channel!==current.options.denominator).map(channel=>({channel,ratio:true,label:channel+' / '+current.options.denominator}))]:null);
  $('eds-preview-note').textContent=current.kind==='line'?result.rows.map(row=>row.profile_note).filter(Boolean).join(' '):result.note;
 }
 function selectedSignals(){const signals=current.signals.filter(s=>current.options.mode!=='ratio'||s!==current.options.denominator);if(current.kind==='map'&&current.options.mode==='ratio'&&current.options.show_denominator)signals.unshift(current.options.denominator);return signals}
 function mapDetails(root,result){
  const display=el('div',undefined,'eds-map-details'),details=el('div',undefined,'eds-map-details-table'),panel=el('aside',undefined,'eds-distributions');panel.setAttribute('aria-label','Pixel intensity distributions');display.append(panel,details);root.append(display);
  const heading=el('div',undefined,'eds-statistics-heading');heading.append(el('h3','Pixel distributions'));panel.append(heading);
  const help=el('span',undefined,'eds-analysis-help'),button=el('button','ⓘ'),content=el('span','Each curve uses the current smoothing, signal or ratio, and normalization settings, before colour clipping or brightness adjustment. Histograms and all statistics use the same valid interior pixels as normalization: a 3σ border is excluded when smoothing is on; with no smoothing, all valid pixels are included. Visual crop and pan do not select pixels. Invalid ratios are excluded; faded low-denominator pixels are included when valid and inside the mask. Acquisitions share the same 80 intensity bins for this quantity. The vertical axis is the percentage of included pixels in each bin, so different map sizes are comparable. Dashed lines mark each acquisition’s median, mean and complementary percentiles. Lower percentile X pairs with 100−X: the default 10 gives P10/P90, and 20 gives P20/P80. These percentiles are readouts, separate from the normalization baseline. Markers and table values are calculated from pixels, not histogram bins. Max is the largest included processed value. Distributions compare pixel values, not their spatial arrangement.','eds-help-content');
  if(result.kam){panel.setAttribute('aria-label','KAM distributions');content.textContent='Each curve uses finite KAM pixels from its acquisition’s selected source, before colour clipping. Histograms share 320 bins. Exceedance shows the percentage of valid pixels strictly above each angle, evaluated directly from pixels at up to 513 shared thresholds, with straight segments between them. No-data pixels are excluded; saved H5OINA retains indexed zeros because it has no separate KAM-validity mask. Mean, median, percentiles and maximum come from pixels, not bins. X min/max set the displayed angle range for either chart and its PNG export; blank means Auto. For both histogram and exceedance, Auto spans zero to the largest P99 angle across the selected maps (approximately 1% exceedance). Axis limits, visual crop and colour limits do not change the included pixels or statistics.';}
  button.type='button';button.setAttribute('aria-label','Pixel distributions help');button.setAttribute('aria-expanded','false');button.onclick=()=>button.setAttribute('aria-expanded',String(button.getAttribute('aria-expanded')!=='true'));button.onkeydown=e=>{if(e.key==='Escape')button.setAttribute('aria-expanded','false')};content.setAttribute('role','tooltip');help.append(button,content);heading.append(help);
  if(!result.distributions||result.distributions.some(group=>!group.pixel_scope)){panel.append(el('p','Restart TEM Workbench, then reload to show distributions using the normalization interior.','eds-channel-error'));return details}
  if(!result.distributions.length){panel.append(el('p','No processed maps are available.','hint'));return details}
  const label=el('label',result.kam?'Chart':'Quantity'),select=el('select');select.setAttribute('aria-label','Distribution quantity');if(result.kam){for(const [value,text]of [['histogram','KAM — histogram'],['exceedance','KAM — exceedance']]){const option=el('option',text);option.value=value;select.append(option)}}else for(const group of result.distributions){const option=el('option',group.label+' · '+group.unit);option.value=group.id;select.append(option)}label.append(select);panel.append(label);
  if(result.kam){
   const axis=el('div',undefined,'eds-distribution-axis'),fields={};panel.append(axis);
   for(const [key,caption]of [['distribution_x_min','X min, °'],['distribution_x_max','X max, °']]){
    const label=el('label',caption),input=el('input');input.type='number';input.min='0';input.step='any';input.placeholder='Auto';input.value=current.options[key]??'';input.setAttribute('aria-label',caption);fields[key]=input;label.append(input);axis.append(label);
    input.onchange=()=>{const value=input.value.trim()===''?null:Number(input.value),valid=value===null||Number.isFinite(value)&&value>=0;input.setCustomValidity(valid?'':'Use a nonnegative angle or leave blank for Auto.');if(!valid){input.reportValidity();return}current.options[key]=value;
     const low=current.options.distribution_x_min,high=current.options.distribution_x_max;
     if(low!=null&&high!=null&&low>=high){current.options.distribution_x_max=low+1;fields.distribution_x_max.value=low+1}
     persist();draw();
    };
   }
   const auto=el('button','Auto');auto.type='button';auto.setAttribute('aria-label','Auto X axis');auto.onclick=()=>{for(const [key,input]of Object.entries(fields)){current.options[key]=null;input.value='';input.setCustomValidity('')}persist();draw()};axis.append(auto);
  }
  const controls=el('div',undefined,'eds-distribution-markers');panel.append(controls);
  for(const [key,caption]of [['median','Median'],['mean','Mean'],['percentiles','Percentiles']]){const label=el('label',undefined,'check'),input=el('input');input.type='checkbox';input.checked=current.options.distribution_markers?.[key]!==false;input.setAttribute('aria-label','Show '+caption.toLowerCase()+' markers');input.onchange=()=>{current.options.distribution_markers={...current.options.distribution_markers,[key]:input.checked};persist();draw()};label.append(input,el('span',caption));controls.append(label)}
  const tailLabel=el('label','Lower percentile'),tail=el('input'),pair=el('span',undefined,'hint');tail.type='number';tail.min='0';tail.max='50';tail.step='any';tail.value=current.options.distribution_percentile??10;tail.setAttribute('aria-label','Lower percentile');tailLabel.append(tail,pair);controls.append(tailLabel);
  tail.onchange=()=>{const value=Number(tail.value),valid=tail.value.trim()!==''&&Number.isFinite(value)&&value>=0&&value<50;tail.setCustomValidity(valid?'':'Use a percentile from 0 up to 50 (exclusive).');if(!valid){tail.reportValidity();return}current.options.distribution_percentile=value;update()};
  const body=el('div',undefined,'eds-distribution-plot');panel.append(body);if(current.distributionExportButton)panel.append(current.distributionExportButton);panel.append(el('p',result.kam?'Valid indexed pixels · KAM in degrees · before colour clipping':'Normalization interior · current processing · before colour clipping','hint'));
  const draw=()=>{const group=window.aztecDistributions.selected(result,current.options.distribution_channel);select.value=result.kam?(current.options.distribution_view||'histogram'):group.id;pair.textContent=group.percentiles.map(value=>'P'+window.aztecDistributions.number(value)).join(' / ');const names=Object.fromEntries(result.rows.map(row=>[row.acquisition,exportLabel(row)]));body.replaceChildren(window.aztecDistributions.svg(group,result.rows,names,{view:result.kam?current.options.distribution_view:'histogram',xMin:result.kam?current.options.distribution_x_min:null,xMax:result.kam?current.options.distribution_x_max:null,markers:current.options.distribution_markers,colours:Object.fromEntries(result.rows.map(row=>[row.acquisition,labelColour(row)]))}))};
  select.onchange=()=>{current.options[result.kam?'distribution_view':'distribution_channel']=select.value;persist();draw()};draw();return details;
 }
 function refreshExportPreview(){const wrap=$('eds-analysis-views').querySelector('.eds-export-preview');if(wrap&&current?.result)renderExportPreview(wrap,current.result)}
 async function renderExportPreview(wrap,result){
  const context=current,request=String(Number(wrap.dataset.request||0)+1);wrap.dataset.request=request;wrap.classList.add('eds-export-preview');wrap.setAttribute('aria-busy','true');
  if(!wrap.previewObservers){wrap.previewObservers=[];plotObservers.push({disconnect(){for(const observer of wrap.previewObservers)observer.disconnect();wrap.previewObservers=[]}})}
  for(const observer of wrap.previewObservers)observer.disconnect();wrap.previewObservers=[];
  const status=el('p','Rendering export preview…','hint');status.setAttribute('role','status');wrap.replaceChildren(status);
  const options={...context.options},columns=window.aztecMapLayout.columns(result,selectedSignals(),options),layout=window.aztecMapLayout.grid(result.rows.length,columns.length,options.transpose);wrap.style.width=`min(100%,${layout.columns*360}px)`;
  const settings={kind:'map',result,options,comparison:context.comparison,signals:selectedSignals(),names:Object.fromEntries(result.rows.map(row=>[row.acquisition,exportLabel(row)])),colours:Object.fromEntries(result.rows.map(row=>[row.acquisition,labelColour(row)]).filter(([,colour])=>colour)),crops:Object.fromEntries(result.rows.map(row=>[row.acquisition,cropCentres.get(itemKey(row.acquisition))]))};
  try{
   const image=el('img');image.alt='Map comparison as exported';image.src=await window.aztecExport.png(settings);await image.decode();
   if(current!==context||!wrap.isConnected||wrap.dataset.request!==request)return;
   wrap.replaceChildren(image);wrap.setAttribute('aria-busy','false');linkMapHover([{cell:wrap,img:image}],null,'As exported',wrap.previewObservers);
  }catch(error){if(current!==context||!wrap.isConnected||wrap.dataset.request!==request)return;status.textContent=error.message;status.className='eds-channel-error';wrap.setAttribute('aria-busy','false')}
 }
 function renderComparison(root,result){
  const normalized=result.normalisation!=='none',legendRows=new Set(window.aztecIpfLegend.selected(result,current.options).map(row=>row.acquisition)),kamLegendRows=new Set(window.aztecKamLegend.selected(result,current.options).map(row=>row.acquisition));
  updateIpfLegendControls(result);updateKamLegendControls(result);
  if(result.kam)root.append(el('p',result.kam_caption||'Recalculated KAM · native OIPX','hint'));
  if(result.rows.some(row=>row.data_kind==='reconstructed'))root.append(el('p','Window cps rows are reconstructed from native raw spectra. Their channel edges are approximate for these acquisitions; background and overlapping peaks remain.','hint'));
  if(current.kind==='line'&&current.options.layout==='overlay'&&current.options.scale_scope==='off')root.append(el('p','Overlaid traces share an axis; separate scales apply when stacked.','hint'));
  if(current.kind==='map'){
   const columns=window.aztecMapLayout.columns(result,selectedSignals(),current.options),layout=window.aztecMapLayout.grid(result.rows.length,columns.length,current.options.transpose);
   const wrap=el('div',undefined,'eds-comparison-maps'),grid=el('div',undefined,'eds-comparison-grid');wrap.append(grid);root.append(wrap);grid.style.setProperty('--columns',layout.columns);if(result.kam)grid.classList.add('eds-ebsd-grid');
   const sizes=new Map(),crops=new Map();for(const r of result.rows)if(r.width&&r.height){sizes.set(r.distance_unit,Math.max(sizes.get(r.distance_unit)||0,r.width));crops.set(r.distance_unit,Math.min(crops.get(r.distance_unit)||Infinity,r.width,r.height))}
   if(current.options.map_preview==='exported')renderExportPreview(wrap,result);
   else{
   for(const [rowIndex,row] of result.rows.entries()){
    const cropTiles=[];
    for(const [columnIndex,col] of columns.entries()){const tile=window.aztecMapLayout.tile(row,col),overview=col.electron?window.aztecMapLayout.overview(row,col):null,error=row.error||(!col.electron?(tile?.[col.ratio?'ratio_error':'error']||(!tile?'Channel unavailable':null)):(overview?.error||(overview&&!overview.image?'Electron image unavailable':null)));
     const cell=el('figure',undefined,'eds-comparison-cell'),position=layout.position(rowIndex,columnIndex);cell.style.gridRow=String(position[0]+1);cell.style.gridColumn=String(position[1]+1);cell.style.aspectRatio=String(window.aztecMapLayout.aspect(result,current.options));grid.append(cell);
     mapLabel(cell,col.electron?exportLabel(row):tile?.[col.ratio?'ratio_label':'label']||col.label,col.electron?row:null,window.aztecPanelLabels.kind(col,result));
     if(col.electron&&!overview){cell.append(el('p','No overview selected','hint'));continue}
     if(error){cell.append(el('p',error,'eds-channel-error'));continue}
     const img=el('img');img.src=col.electron?overview.image:tile[col.ratio?'ratio_image':'image'];img.alt=`${row.label} · ${col.electron?overview.label:col.label}`;
     if(result.kam&&!col.electron)img.style.imageRendering='pixelated';
     if(col.channel==='IPF'&&legendRows.has(row.acquisition)){const key=window.aztecIpfLegend.svg(row,current.options);key.classList.add('eds-ipf-key');placeMapOverlay(key,cell,window.aztecOverlayPlacement.corner(current.options.ipf_legend_position,'top-right'));cell.append(key)}
     if(col.electron&&overview.path){cell.dataset.overviewPath=overview.path;cell.append(el('span',overview.label,'eds-overview-name'))}
     if(!col.electron)img.dataset.intensityMap='';
     if(col.layered){
      const legend=el('div',undefined,'eds-layer-legend');legend.setAttribute('aria-label','Layer colours');
      for(const layer of tile.layers.filter(layer=>layer.strength>0)){const entry=el('span',window.aztecMapLayout.layerLabel(layer));entry.style.color=layer.colour;entry.title=`${layer.label} · ${layer.limits.join(' – ')} ${layer.unit} · ${Math.round(layer.strength*100)}% strength`;legend.append(entry)}
      if(tile.missing?.length)legend.append(el('span','Missing: '+tile.missing.join(', '),'eds-layer-missing'));
      cell.append(legend);
     }
     const frame=overview?.full_resolution?registeredOverview(cell,img,overview,row):img;
     if(['physical','crop'].includes(current.options.spatial)&&row.width){const size=(current.options.spatial==='crop'?crops:sizes).get(row.distance_unit);frame.style.width=`${100*row.width/size}%`;frame.style.height=`${100*row.height/size*window.aztecMapLayout.aspect(result,current.options)}%`}
     cell.classList.toggle('eds-crop-tile',current.options.spatial==='crop');if(frame===img)cell.append(img);
     const redrawScale=window.aztecScaleBar.visible(current.options,col.electron,result.kam)?mapScaleBar(cell,img,row):()=>{};cropTiles.push({cell,img,redrawScale});
     if(!col.electron&&(result.kam||current.options.show_colour_scale!==false)&&(result.scale_scope!=='all'||!normalized)){const limits=tile[col.ratio?'ratio_image_limits':'image_limits'];if(limits){const key=el('span',limits.map(v=>Number(v.toPrecision(3))).join(' – ')+(result.kam?'°':''),'eds-tile-value-limits');if(result.kam&&col.channel==='KAM'){key.classList.add('eds-kam-key');key.hidden=!kamLegendRows.has(row.acquisition);placeMapOverlay(key,cell,window.aztecOverlayPlacement.corner(current.options.kam_legend_position,'bottom-right'));key.replaceChildren(...limits.map(value=>el('span',Number(value.toPrecision(3))+'°')));key.style.setProperty('--kam-ramp',`linear-gradient(90deg,${result.kam_colour_stops.join(',')})`)}else placeMapOverlay(key,cell,'bottom-right');key.title=normalized?`${result.scale_scope==='element'?'Shared across acquisitions for this quantity':'Independent'} colour limits; ${window.aztecMapColours.black(result)?'black = minimum; full element colour = maximum':'white = 1'}`:`${result.shared_scales?'Shared':'Independent'} colour limits (${col.ratio?tile.ratio_unit:tile.unit})`;cell.append(key)}}
    }
    if(current.options.spatial==='crop'&&cropTiles.length)panMapRow(cropTiles,row,cropTiles[0].cell);
    linkMapHover(cropTiles,null,exportLabel(row));
   }
   if(current.options.show_colour_scale!==false&&normalized&&result.scale_scope==='all'&&current.options.eds_layout!=='layered')comparisonColourScale(wrap,grid,result);
   }
   const statisticColumns=columns.some(column=>column.layered)?window.aztecMapLayout.columns(result,selectedSignals(),{...current.options,eds_layout:'separate'}):columns;
   mapStatistics(mapDetails(root,result),result,statisticColumns,normalized&&result.scale_scope==='all'&&current.options.eds_layout!=='layered');
  }else{
   renderLineComparison(root,result);
  }
 }
 function renderLineComparison(root,result){
  const normalized=result.normalisation!=='none';
   const rows=result.rows.filter(r=>!r.error);
   for(const row of result.rows.filter(r=>r.error))root.append(el('p',`${row.label}: ${row.error}`,'eds-channel-error'));
   const structure=el('details',undefined,'eds-noise-check eds-comparison-structure'),structureBody=el('div');
   structure.append(el('summary',`Spatial structure · ${rows.length} lines`),structureBody);
   const lineRanges=window.aztecLineGeometry.ranges(rows,current.options);
   for(const row of rows){row.viewStart=lineRanges[row.acquisition]?.start||0;row.viewLength=lineRanges[row.acquisition]?.length||row.length;row.trimmed=lineRanges[row.acquisition]?.trimmed||false;for(const tile of row.tiles){tile.viewStart=row.viewStart;tile.viewLength=row.viewLength;tile.acquisition=row.acquisition}}
   const ranges=new Map(),lengths=new Map(),baseline=normalized?1:0;
   for(const row of rows){lengths.set(row.distance_unit,Math.max(lengths.get(row.distance_unit)||0,row.viewLength));for(const t of row.tiles.filter(t=>!t.error)){
    const comparableUnit=comparisonState.compatibleUnit(t.unit);t.quantityKey=JSON.stringify([t.channel,comparableUnit,result.mode]);t.scaleKey=current.options.scale_scope==='all'?JSON.stringify([comparableUnit,result.mode]):t.quantityKey;let range=normalized?.2:1e-12;
    if(!normalized&&result.mode==='ratio')range=t.maximum;
    else{for(const y of t.y)if(Number.isFinite(y))range=Math.max(range,Math.abs(y-baseline));range*=1.12}
    ranges.set(t.scaleKey,Math.max(ranges.get(t.scaleKey)||0,range));
   }}
   if(current.options.layout==='overlay'){
    const body=el('div',undefined,'eds-overlay-line-body'),refs=el('div',undefined,'eds-line-references'),plots=el('div',undefined,'eds-overlay-line-plots');refs.hidden=!current.options.background;body.classList.toggle('eds-no-reference',refs.hidden);body.append(refs,plots);root.append(body);
    const colours=['#da85ef','#55d4e9','#ffb658','#67e6a1','#f78595','#adb4ff','#e1db66','#f7faff','#e09868','#5fa8fb','#c5eea1','#f793c3'];
    rows.forEach((r,i)=>{r.compareColour=labelColour(r)||colours[i%colours.length];lineReference(refs,r,r.compareColour)});
    const byQuantity=new Map();for(const row of rows)for(const tile of row.tiles.filter(t=>!t.error)){const key=tile.quantityKey+row.distance_unit;if(!byQuantity.has(key))byQuantity.set(key,{tiles:[],row});byQuantity.get(key).tiles.push({...tile,label:row.short_label||row.label,source:row.label,colour:row.compareColour})}
    for(const {tiles,row} of byQuantity.values()){
     const section=el('section',undefined,'eds-compare-line-section eds-overlay-scan-section');section.append(el('h3',row.tiles.find(t=>t.quantityKey===tiles[0].quantityKey).label));plots.append(section);
     linePlots(section,{...row,background:null,overlay:true,axisLength:lengths.get(row.distance_unit),sharedRanges:current.options.scale_scope!=='off'?ranges:null,tiles},result,structureBody,section.querySelector('h3').textContent);
     const caption=section.querySelector('.eds-line-caption');if(caption)caption.prepend(el('span',section.querySelector('h3').textContent,'eds-line-quantity'));
    }
    alignOverlayReferences(refs,plots);
   }else for(const row of rows){
    const section=el('section',undefined,'eds-compare-line-section');section.dataset.acquisition=row.acquisition;section.append(el('h3',row.label));root.append(section);
    const body=el('div',undefined,'eds-compare-line-body'),ref=el('div'),plots=el('div');section.append(body);body.append(ref,plots);lineReference(ref,row,labelColour(row)||undefined);
    section.classList.toggle('eds-has-line-reference',!!ref.querySelector('.eds-line-reference'));
    linePlots(plots,{...row,overlay:current.options.layout==='elements',axisLength:lengths.get(row.distance_unit),sharedRanges:current.options.scale_scope!=='off'?ranges:null},result,structureBody,row.label);
    alignLineReference(ref,plots);
   }
   if(structureBody.childElementCount){
    structure.append(el('p','Full acquisitions: smoothed variation is compared with 256 paired shuffles, excluding 3σ at each end. A larger observed/shuffled ratio can reflect spatial structure, drift, thickness or correlated noise; it is not a segregation test or confidence interval. Display normalization does not change this check.','hint'));
    root.append(structure);
   }
 }
 function comparisonColourScale(wrap,grid,result){
  const scale=el('div',undefined,'eds-comparison-colour-scale'),ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');scale.append(svg);wrap.append(scale);
  const label=window.aztecMapColours.label(result),id=`eds-colour-scale-${++plotSerial}`;
  svg.setAttribute('role','img');svg.setAttribute('aria-label',`${label}: ${result.low} to ${result.high}`);
  const draw=()=>{
   const cells=grid.querySelectorAll('.eds-comparison-cell');if(!cells.length||!grid.isConnected)return;
   const rect=grid.getBoundingClientRect(),first=cells[0].getBoundingClientRect(),last=cells[cells.length-1].getBoundingClientRect();
   const top=first.top-rect.top,bottom=last.bottom-rect.top,height=bottom-top;if(height<=0)return;
   svg.replaceChildren();svg.setAttribute('viewBox',`0 0 80 ${rect.height}`);svg.style.height=`${rect.height}px`;
   const add=(tag,attrs,text,parent=svg)=>{const n=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;parent.append(n);return n};
   const defs=add('defs',{}),bands=window.aztecMapColours.bands(result);
   bands.forEach((stops,index)=>{const gradientId=id+'-'+index,gradient=add('linearGradient',{id:gradientId,x1:0,y1:1,x2:0,y2:0},undefined,defs);stops.forEach((colour,i)=>add('stop',{offset:`${100*i/(stops.length-1)}%`,'stop-color':colour},undefined,gradient));add('rect',{x:2+18*index/bands.length,y:top,width:18/bands.length,height,fill:`url(#${gradientId})`})});
   add('rect',{x:2,y:top,width:18,height,fill:'none',stroke:'#8b9aaa','stroke-width':.6});
   const range=result.high-result.low,target=range/6,power=10**Math.floor(Math.log10(target));
   const step=([1,2,2.5,5,10].find(n=>n*power>=target-1e-12)||10)*power,ticks=[result.low];
   for(let v=Math.ceil((result.low+step*.05)/step)*step;v<result.high-step*.05;v+=step)ticks.push(v);
   ticks.push(result.high);
   for(const v of ticks){const y=bottom-(v-result.low)/range*height;add('line',{x1:20,x2:25,y1:y,y2:y,stroke:'currentColor'});const atBottom=v===result.low,atTop=v===result.high;add('text',{x:29,y:y+(atBottom?-2:atTop?2:0),'dominant-baseline':atBottom?'auto':atTop?'hanging':'middle','font-size':10,fill:'currentColor'},Number(v.toPrecision(4)).toString())}
   add('text',{x:70,y:(top+bottom)/2,transform:`rotate(-90 70 ${(top+bottom)/2})`,'text-anchor':'middle',fill:'currentColor','font-size':11,...(height<260?{textLength:Math.max(80,height-10),lengthAdjust:'spacingAndGlyphs'}:{})},label);
  };
  const observer=new ResizeObserver(draw);observer.observe(grid);plotObservers.push(observer);draw();
 }
 function kamStatistics(root,result){
  root.querySelector('.eds-kam-statistics')?.remove();
  const group=result.distributions?.find(group=>group.label==='KAM'),pair=group?.percentiles||[10,90],format=window.aztecDistributions.number;
  const section=el('section',undefined,'eds-map-statistics eds-kam-statistics'),heading=el('h3','KAM summary');section.append(heading);
  section.append(el('p',result.kam_caption||'KAM in degrees','hint'));
  const scroll=el('div',undefined,'eds-kam-table-scroll'),table=el('table'),head=el('thead'),labels=el('tr'),body=el('tbody');table.setAttribute('aria-label','KAM acquisition summary');
  for(const text of ['Acquisition','Source / settings','Mean, °','Median, °',`P${format(pair[0])}, °`,`P${format(pair[1])}, °`,'Max, °','Valid pixels','No data','Step']){const th=el('th',text);th.scope='col';labels.append(th)}
  head.append(labels);table.append(head,body);scroll.append(table);section.append(scroll);root.append(section);
  for(const row of result.rows){
   const stats=group?.series.find(item=>item.acquisition===row.acquisition)||{},tr=el('tr'),name=el('th',exportLabel(row));name.scope='row';name.title=[row.source,row.label].filter(Boolean).join(' / ');const colour=labelColour(row);if(colour)name.style.color=colour;tr.append(name);
   const source=el('td',row.source_label||'Native OIPX');source.title=row.kam?.source_file||row.source;source.append(el('small',row.error||window.aztecKamSources.configuration(row.kam)));tr.append(source);
   if(row.error){for(let i=0;i<8;i++)tr.append(el('td','—'));body.append(tr);continue}
   for(const key of ['mean','median','percentile_low','percentile_high','maximum'])tr.append(el('td',format(stats[key])));
   const valid=stats.pixels??row.valid_pixels??0,missing=stats.excluded??row.excluded_pixels??0,total=valid+missing,steps=row.kam?.step_nm;
   tr.append(el('td',valid.toLocaleString()),el('td',`${missing.toLocaleString()}${total?' ('+(100*missing/total).toFixed(1)+'%)':''}`),el('td',steps?(Math.abs(steps[0]-steps[1])<1e-8?format(steps[0]/1000):steps.map(value=>format(value/1000)).join(' × '))+' µm':'1 px'));
   body.append(tr);
  }
  section.append(el('p','Full maps from the selected source · no-data pixels excluded · before colour clipping','hint'));
 }
 function mapStatistics(root,result,columns=null,colourScale=false){
  if(result.kam){kamStatistics(root,result);return;}
  if(columns)columns=[{electron:true},...columns.filter(column=>!column.electron)];
  const rows=result.rows.filter(r=>r.statistics);if(!rows.length)return;
  const section=el('section',undefined,'eds-map-statistics'),heading=el('div',undefined,'eds-statistics-heading');
  heading.append(el('h3','Descriptive comparison'));
  const help=el('span',undefined,'eds-analysis-help'),button=el('button','ⓘ'),content=el('span','P90/P10 compares a high value (90th percentile) with a low value (10th percentile), excluding the most extreme pixels. For example, 1.4 means the high value is 40% above the low value; 1 means no spread between these percentiles. Although the ratio is unitless, counting variation depends on the acquisition time and collected X-rays. A shorter or lower-count map can have a larger P90/P10 without more spatial heterogeneity. These values are not acquisition-time or photon-noise corrected. Correlations range from −1 (opposite ordering) through 0 (no monotonic association) to +1 (same ordering); they are not percentages. Correlations are Spearman coefficients between the first selected quantity and the others, over their common valid pixels. A 3σ rim is excluded on each axis. These describe smoothed, unclipped values across the full acquisition; crop position, brightness and display normalization do not change them. Shared denominators can create correlations. Smoothed pixels are not independent observations; these are not significance tests or proof of segregation. A dash means insufficient valid pixels, a zero lower percentile or a constant channel.','eds-help-content');
  button.type='button';button.setAttribute('aria-label','Map statistics help');button.setAttribute('aria-expanded','false');button.onclick=()=>button.setAttribute('aria-expanded',String(button.getAttribute('aria-expanded')!=='true'));button.onkeydown=e=>{if(e.key==='Escape')button.setAttribute('aria-expanded','false')};content.setAttribute('role','tooltip');help.append(button,content);heading.append(help);section.append(heading);root.append(section);
  const unit=current.comparison?result.smoothing_unit:'px';section.append(el('p',`Gaussian σ ${result.smoothing} ${unit} · full acquisition interiors · P90/P10 depends on counting time`,'hint'));
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
      sweep.append(el('strong','Effect of smoothing on spread'));smoothingPlot(sweep,row,result);
     }
    }catch(error){if(details.isConnected){progress.classList.add('eds-channel-error');spinner.hidden=true;status.textContent=error.message}return}
   }
   progress.remove();
  }
  const help=el('span',undefined,'eds-analysis-help'),button=el('button','ⓘ'),text=el('span',
   'Observed variation is standard deviation ÷ mean inside a 3σ rim. Each of 256 paired pixel shuffles preserves the channels at each pixel but randomizes their spatial positions; smoothing and division are then repeated on the full-resolution map. Structure is observed variation ÷ shuffled median: around 1× is similar to random ordering. This compares spatial ordering within the same acquisition; it does not correct for photon counting uncertainty or make acquisitions with different counting times directly comparable. The shuffled 95th percentile is a reference for this model, not a confidence interval or proof of segregation. Spatially correlated noise, drift and thickness can also create structure. The separate smoothing curve divides each P90/P10 excess above 1 by its excess at the current smoothing width (1×). A value of 0.5 means half that spread remains; this shows the response to smoothing, not an acquisition-time correction. Its ten widths run from 0.2× to 2× the current σ, with a fixed interior excluding 3σ at the largest width (6× current σ). Consequently its raw P90/P10 at 1× may differ slightly from the tile readout, which uses the current 3σ rim. Missing curve values mean too few valid pixels, a zero lower percentile or no measurable spread at 1×. In Both mode these checks use the ratios.', 'eds-help-content');
  button.type='button';button.setAttribute('aria-label','Map spatial structure help');button.setAttribute('aria-expanded','false');button.onclick=()=>button.setAttribute('aria-expanded',String(button.getAttribute('aria-expanded')!=='true'));button.onkeydown=e=>{if(e.key==='Escape')button.setAttribute('aria-expanded','false')};text.setAttribute('role','tooltip');help.append(button,text);summary.append(help);
  details.ontoggle=()=>{context.structureOpen=details.open;run()};run();
 }
 function smoothingPlot(root,row,result){
  const baselineIndex=row.factors.findIndex(factor=>Math.abs(factor-1)<1e-6);
  const available=row.tiles.map(tile=>{
   const baseline=tile.spread[baselineIndex],excess=baseline-1;
   return {...tile,relative:tile.spread.map(value=>Number.isFinite(value)&&Number.isFinite(excess)&&excess>1e-8?Math.max(0,(value-1)/excess):null)};
  }).filter(tile=>tile.relative.some(Number.isFinite));
  if(!available.length){root.append(el('p',row.tiles.some(tile=>tile.spread.some(Number.isFinite))?'No measurable spread at the current smoothing width; a relative curve is unavailable.':row.sweep_reason,'hint'));return}
  const ns='http://www.w3.org/2000/svg',figure=el('figure',undefined,'eds-noise-plot'),svg=document.createElementNS(ns,'svg');root.append(figure);figure.append(svg);
  const width=650,height=255,left=52,right=20,top=12,bottom=45,values=available.flatMap(t=>t.relative.filter(Number.isFinite));
  const high=Math.max(1.1,...values)*1.08,logHigh=Math.log1p(high),X=v=>left+(v-.2)/1.8*(width-left-right),Y=v=>height-bottom-Math.log1p(Math.max(0,v))/logHigh*(height-top-bottom);
  svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('role','img');svg.setAttribute('aria-label','Spread above uniform relative to current smoothing, logarithmic one-plus vertical scale');
  const add=(tag,attrs,text)=>{const n=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;svg.append(n);return n};
  for(let i=0;i<=4;i++){const value=Math.expm1(logHigh*i/4),y=Y(value);add('line',{x1:left,x2:width-right,y1:y,y2:y,stroke:'#314454'});add('text',{x:left-8,y:y+4,fill:'#a7b8c9','text-anchor':'end','font-size':11},Number(value.toPrecision(3)).toString())}
  add('line',{x1:left,x2:width-right,y1:Y(1),y2:Y(1),stroke:'#b5c5d4','stroke-dasharray':'4 4'});
  add('text',{x:width-right-4,y:Y(1)-5,fill:'#b5c5d4','text-anchor':'end','font-size':10},'1× spread');
  for(const factor of row.factors){const x=X(factor);add('text',{x,y:height-bottom+18,fill:'#a7b8c9','text-anchor':'middle','font-size':11},factor.toFixed(1)+'×')}
  add('line',{x1:X(1),x2:X(1),y1:top,y2:height-bottom,stroke:'#b5c5d4','stroke-dasharray':'4 4'});
  for(const tile of available){let path='',joined=false;const points=[];
   tile.relative.forEach((value,i)=>{if(!Number.isFinite(value)){joined=false;return}const x=X(row.factors[i]);
    path+=`${joined?'L':'M'}${x},${Y(value)} `;joined=true;points.push({value,i,x});
   });
   add('path',{d:path,fill:'none',stroke:tile.colour,'stroke-width':2});
   for(const {value,i,x} of points){
    const dot=add('circle',{cx:x,cy:Y(value),r:3,fill:tile.colour}),tip=document.createElementNS(ns,'title');tip.textContent=`${tile.label} · ${row.factors[i].toFixed(1)}×σ · relative spread ${value.toFixed(3)} · raw P90/P10 ${tile.spread[i].toFixed(3)}`;dot.append(tip);
   }
  }
  add('text',{x:(left+width-right)/2,y:height-5,fill:'#a7b8c9','text-anchor':'middle','font-size':12},`Smoothing · 1×σ = ${result.smoothing} ${current.comparison?result.smoothing_unit:'px'}`);
  figure.append(el('p','Spread above 1 relative to 1× smoothing · 1 = current spread; 0.5 = half remains','hint'));
  const legend=el('figcaption',undefined,'eds-line-caption');for(const tile of available){const label=el('span',tile.label);label.style.color=tile.colour;legend.append(label)}figure.append(legend);
 }

 function beginLinePan(event,row,distanceForDrag){
  const available=row.length-(row.viewLength||row.length);
  if(event.button!==0||!current?.comparison||current.options.trim_mode!=='equal'||available<=1e-6)return;
  linePanDrag?.stop();event.preventDefault();
  const controller=new AbortController(),pointerId=event.pointerId,startX=event.clientX,startY=event.clientY;
  const start=Number(current.options.line_offsets?.[row.acquisition])||0;
  let pending=start,applied=start,frame=null;
  const apply=()=>{
   frame=null;if(!current?.result||Math.abs(pending-applied)<.02)return;
   applied=pending;current.options.line_offsets={...current.options.line_offsets,[row.acquisition]:applied};render(current.result);
  };
  const move=e=>{if(e.pointerId!==pointerId)return;e.preventDefault();pending=Math.max(0,Math.min(available,start-distanceForDrag(e.clientX-startX,e.clientY-startY)));if(frame===null)frame=requestAnimationFrame(apply)};
  const stop=()=>{if(frame!==null)cancelAnimationFrame(frame);apply();persist();controller.abort();document.documentElement.classList.remove('eds-line-dragging');linePanDrag=null};
  const finish=e=>{if(e.pointerId!==undefined&&e.pointerId!==pointerId)return;move(e.pointerId===undefined?{pointerId,clientX:startX,clientY:startY,preventDefault(){}}:e);stop()};
  document.addEventListener('pointermove',move,{signal:controller.signal,passive:false});
  document.addEventListener('pointerup',finish,{signal:controller.signal});
  document.addEventListener('pointercancel',finish,{signal:controller.signal});
  window.addEventListener('blur',()=>stop(),{signal:controller.signal});
  document.documentElement.classList.add('eds-line-dragging');linePanDrag={stop};
 }
 function lineReference(root,row,colour='#d88aff'){
  if(!row.electron||!row.line_points)return;
  const geometry=window.aztecLineGeometry.reference(row,current.options.reference_orientation),{width,height,a,b,length}=geometry;
  if(!(length>0))return;
  const figure=el('figure',undefined,'eds-line-reference');figure.dataset.acquisition=row.acquisition;
  root.append(figure);
  const stage=el('div',undefined,'eds-line-reference-stage'),ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
  svg.classList.add('eds-reference-drawing');svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('role','img');svg.setAttribute('aria-label',row.label+' · scan location and crop');stage.append(svg);figure.append(stage);
  const caption=el('span',exportLabel(row),'eds-line-reference-label');caption.dataset.labelKind='overview';caption.dataset.acquisition=row.acquisition;caption.title=row.label;caption.hidden=!window.aztecPanelLabels.visible(current.options,'overview');applyLabelColour(caption,row);stage.append(caption);
  if(current.comparison&&row.trimmed&&row.length>row.viewLength){
   stage.classList.add('eds-line-pannable');stage.title='Drag along the scan to move the selected crop';
   stage.onpointerdown=event=>{const box=stage.getBoundingClientRect(),scale=Math.min(box.width/width,box.height/height),vx=(b[0]-a[0])*scale,vy=(b[1]-a[1])*scale,size=vx*vx+vy*vy;if(size>0)beginLinePan(event,row,(dx,dy)=>(dx*vx+dy*vy)/size*row.length)};
  }
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
 function alignLineReference(referenceRoot,plots){
  const reference=referenceRoot.querySelector('.eds-line-reference'),plot=plots.querySelector('.eds-line-tile svg');if(!reference||!plot)return;
  const stage=reference.querySelector('.eds-line-reference-stage');
  const body=referenceRoot.parentElement;
  const align=()=>{
   if(!reference.isConnected)return;
   const plotSvgs=[...plots.querySelectorAll('.eds-line-tile svg')],count=plotSvgs.length;
   const bodyWidth=body.getBoundingClientRect().width,view=stage.querySelector('.eds-reference-drawing').viewBox.baseVal,aspect=view.width/view.height;
   const initialFirst=linePlotCropRect(plotSvgs[0]),initialLast=linePlotCropRect(plotSvgs.at(-1));
   const initialHeight=initialLast.top+initialLast.height-initialFirst.top;
   const maxWidth=Math.min(560,Math.max(220*aspect,bodyWidth*.55));
   const desiredHeight=Math.min(maxWidth/aspect,Math.max(220,initialHeight,(bodyWidth-50)/(aspect+5.5/count)));
   const plotHeight=Math.max(80,Math.round((desiredHeight+25)/count));
   for(const svg of plotSvgs)svg.style.height=plotHeight+'px';
   redrawLinePlots(plots);
   const first=linePlotCropRect(plotSvgs[0]),last=linePlotCropRect(plotSvgs.at(-1));
   const referenceHeight=last.top+last.height-first.top;
   const width=fitLineReferenceStage(stage,referenceHeight,maxWidth);
   body.style.gridTemplateColumns=`${width}px minmax(0,1fr)`;redrawLinePlots(plots);
   reference.style.marginTop=Math.max(0,linePlotCropRect(plot).top-plots.getBoundingClientRect().top)+'px';
  };
  const observer=new ResizeObserver(align);observer.observe(plot);plotObservers.push(observer);align();
 }
 function linePlotCropRect(plot){
  const box=plot.getBoundingClientRect(),view=plot.viewBox.baseVal,scale=box.height/(view.height||box.height);
  return {top:box.top+(Number(plot.dataset.cropTop)||0)*scale,height:(Number(plot.dataset.cropHeight)||view.height)*scale};
 }
 function redrawLinePlots(root){
  for(const plot of root.querySelectorAll('.eds-line-tile svg'))if(plot.redraw&&(Math.abs(plot.viewBox.baseVal.width-plot.clientWidth)>1||Math.abs(plot.viewBox.baseVal.height-plot.clientHeight)>1))plot.redraw();
 }
 function fitLineReferenceStage(stage,height,maxWidth){
  const svg=stage.querySelector('.eds-reference-drawing'),label=stage.querySelector('.eds-line-reference-label');if(!svg||!label)return 0;
  const view=svg.viewBox.baseVal,width=Math.max(80,Math.min(maxWidth,height*view.width/view.height));stage.style.width=width+'px';stage.style.height=height+'px';
  const box=stage.getBoundingClientRect(),scale=Math.min(box.width/view.width,box.height/view.height),imageWidth=view.width*scale;
  placePanelLabel(label,{left:(box.width-imageWidth)/2,right:(box.width+imageWidth)/2,top:(box.height-view.height*scale)/2,bottom:(box.height+view.height*scale)/2});return width;
 }
 function alignOverlayReferences(references,plots){
  const stages=[...references.querySelectorAll('.eds-line-reference-stage')];if(!stages.length)return;
  const body=references.parentElement;
  const align=()=>{if(!references.isConnected||references.hidden)return;for(const stage of stages){const view=stage.querySelector('.eds-reference-drawing').viewBox.baseVal;fitLineReferenceStage(stage,220,Math.min(references.clientWidth,220*view.width/view.height))}redrawLinePlots(plots)};
  const observer=new ResizeObserver(align);observer.observe(references);plotObservers.push(observer);align();
 }

 function panelLabelReserve(caption){return caption&&!caption.hidden?{position:window.aztecPanelLabels.position(current.options,caption.dataset.labelKind||'overview'),height:(caption.offsetHeight||24)+5}:0}
 function placePanelLabel(caption,bounds){
  const position=window.aztecPanelLabels.position(current.options,caption.dataset.labelKind||'overview');caption.style.maxWidth=Math.max(0,bounds.right-bounds.left-10)+'px';
  const point=window.aztecOverlayPlacement.box(bounds,caption.offsetWidth,caption.offsetHeight,position);Object.assign(caption.style,{left:point.x+'px',top:point.y+'px',right:'auto',bottom:'auto'});
 }
 function mapLabel(cell,text,row,kind=row?'overview':'eds'){
  const caption=el('span',text,'eds-map-label');caption.dataset.labelKind=kind;caption.hidden=!window.aztecPanelLabels.visible(current.options,kind);if(row){caption.dataset.acquisition=row.acquisition;applyLabelColour(caption,row)}cell.append(caption);
  const draw=()=>{if(!cell.isConnected)return;const box=cell.getBoundingClientRect(),img=cell.querySelector('img'),rect=img?.naturalWidth?mapFieldBox(img):box;placePanelLabel(caption,{left:Math.max(0,rect.left-box.left),right:Math.min(box.width,rect.left+rect.width-box.left),top:Math.max(0,rect.top-box.top),bottom:Math.min(box.height,rect.top+rect.height-box.top)})};
  let frame=null;const schedule=()=>{if(frame===null)frame=requestAnimationFrame(()=>{frame=null;draw()})},observer=new ResizeObserver(schedule);observer.observe(cell);observer.observe(caption);plotObservers.push({disconnect(){observer.disconnect();if(frame!==null)cancelAnimationFrame(frame)}});cell.addEventListener('load',schedule,true);draw();return caption;
 }
 function registeredOverview(cell,img,overview,row,fitOnly=false){
  const frame=el('div',undefined,'eds-registered-overview'),region=window.aztecMapLayout.sourceRect(overview,...overview.source_shape.slice().reverse());frame.append(img);cell.append(frame);img.registeredFrame=frame;
  Object.assign(img.style,{position:'absolute',transform:'none',objectFit:'fill',maxWidth:'none',maxHeight:'none',width:100*overview.source_shape[1]/region.width+'%',height:100*overview.source_shape[0]/region.height+'%',left:-100*region.x/region.width+'%',top:-100*region.y/region.height+'%'});
  if(fitOnly||!(['physical','crop'].includes(current.options.spatial)&&row.width)){const fit=()=>{const aspect=row.width&&row.height?row.width/row.height:region.width/region.height,width=Math.min(cell.clientWidth,cell.clientHeight*aspect);frame.style.width=width+'px';frame.style.height=width/aspect+'px'};const observer=new ResizeObserver(fit);observer.observe(cell);plotObservers.push(observer);fit()}
  return frame;
 }
 function mapScaleBar(cell,img,row){
  if(current.options.scale_bar_overlay===false)return ()=>{};
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.classList.add('eds-image-scale');svg.setAttribute('role','img');cell.append(svg);
  const draw=()=>{
   if(!cell.isConnected||!img.naturalWidth)return;
   const box=cell.getBoundingClientRect(),rect=mapFieldBox(img);if(!box.width||!rect.width)return;
   const width=rect.width,height=rect.height,left=rect.left-box.left,top=rect.top-box.top;
   const x=Math.max(0,left),y=Math.max(0,top),right=Math.min(box.width,left+width),bottom=Math.min(box.height,top+height);
   const caption=cell.querySelector('.eds-map-label');if(caption)placePanelLabel(caption,{left:x,right,top:y,bottom})
   const layers=cell.querySelector('.eds-layer-legend');if(layers){layers.style.left=(x+5)+'px';layers.style.top=(y+10+(caption?.offsetHeight||24))+'px';layers.style.right=Math.max(5,box.width-right+5)+'px'}
   if(!(row?.width>0&&row.distance_unit))return;
   const visible=right-x,bar=window.aztecScaleBar.geometry(visible,row.width*visible/width,row.distance_unit);
   if(!bar||!(bottom>y))return;
   svg.replaceChildren();svg.setAttribute('viewBox',`0 0 ${box.width} ${box.height}`);svg.setAttribute('aria-label',bar.label+' scale bar');svg.dataset.length=bar.value;svg.dataset.pixels=bar.pixels;
   const add=(tag,attrs,text)=>{const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text)n.textContent=text;svg.append(n);return n};
   const position=window.aztecOverlayPlacement.corner(current.options.scale_bar_position,'bottom-left'),bounds={left:x,right,top:y,bottom},reserve=panelLabelReserve(caption);
   const point=window.aztecScaleBar.position(bar,bounds,0,position,reserve),start=point.x,base=point.y;
   const name=cell.querySelector('.eds-overview-name');if(name&&position==='bottom-right'){name.style.left='5px';name.style.right='auto'}
   add('rect',{x:start-bar.border,y:base-bar.border,width:bar.pixels+2*bar.border,height:bar.height+2*bar.border,fill:'#000'});
   add('rect',{x:start,y:base,width:bar.pixels,height:bar.height,fill:'#fff'});
   const text=add('text',{x:start+bar.pixels/2,y:base-bar.gap,fill:'#fff',stroke:'#000','stroke-width':2*bar.stroke,'paint-order':'stroke','stroke-linejoin':'round','font-size':bar.fontSize,'font-family':'system-ui','text-anchor':'middle'},bar.label);
   const labelWidth=text.getComputedTextLength(),label=window.aztecScaleBar.position(bar,bounds,labelWidth,position,reserve);text.setAttribute('x',label.labelX+labelWidth/2);
  };
  img.addEventListener('load',draw,{once:true});const observer=new ResizeObserver(draw);observer.observe(cell);plotObservers.push(observer);draw();return draw;
 }
 function panMapRow(tiles,row,label){
  if(!tiles.length)return;
  const key=itemKey(row.acquisition);
  let centre=cropCentres.get(key)||[.5,.5];if(!Array.isArray(centre)||centre.length!==2||!centre.every(Number.isFinite))centre=[.5,.5];
  const factors=(tiles[0].img.registeredFrame||tiles[0].img).style;const sx=parseFloat(factors.width)/100||1,sy=parseFloat(factors.height)/100||1;
  if(sx<=1&&sy<=1)return;
  const clamp=(value,scale)=>scale>1?Math.max(.5/scale,Math.min(1-.5/scale,value)):.5;
  const move=(x,y)=>{centre=[clamp(x,sx),clamp(y,sy)];cropCentres.set(key,centre);clearTimeout(persistTimer);persistTimer=setTimeout(persist,200);for(const {img,redrawScale} of tiles){(img.registeredFrame||img).style.transform=`translate(${-100*centre[0]}%,${-100*centre[1]}%)`;redrawScale()}};
  const reset=el('button','Centre crop','eds-crop-reset');reset.type='button';reset.onclick=()=>move(.5,.5);label.append(reset);
  for(const {cell,img} of tiles){
   cell.classList.add('eds-pannable');cell.tabIndex=0;cell.setAttribute('role','group');cell.setAttribute('aria-label',img.alt+' · drag or use arrow keys to pan; Home to centre');img.draggable=false;
   let drag=null;
   cell.onpointerdown=e=>{if(e.button!==0||e.target.closest('button'))return;e.preventDefault();cell.focus({preventScroll:true});const rect=mapFieldBox(img);drag={id:e.pointerId,x:e.clientX,y:e.clientY,centre:[...centre],width:rect.width,height:rect.height};cell.setPointerCapture(e.pointerId);cell.classList.add('eds-panning')};
   cell.onpointermove=e=>{if(drag&&e.pointerId===drag.id)move(drag.centre[0]-(e.clientX-drag.x)/drag.width,drag.centre[1]-(e.clientY-drag.y)/drag.height)};
   const end=e=>{if(drag&&e.pointerId===drag.id){drag=null;cell.classList.remove('eds-panning');if(cell.hasPointerCapture(e.pointerId))cell.releasePointerCapture(e.pointerId)}};
   cell.onpointerup=end;cell.onpointercancel=end;cell.onlostpointercapture=end;cell.ondblclick=()=>move(.5,.5);
   cell.onkeydown=e=>{const step=e.shiftKey?.1:.025;const delta={ArrowLeft:[-step/sx,0],ArrowRight:[step/sx,0],ArrowUp:[0,-step/sy],ArrowDown:[0,step/sy]}[e.key];if(delta){e.preventDefault();move(centre[0]+delta[0],centre[1]+delta[1])}else if(e.key==='Home'){e.preventDefault();move(.5,.5)}};
  }
  move(...centre);
 }
 function imageTile(root,label,source,colour,error,row,stat){
  const figure=el('figure',undefined,'eds-map-tile'),cell=el('div',undefined,'eds-map-image');root.append(figure);figure.append(cell);mapLabel(cell,label==='Electron image'?exportLabel(row):label,label==='Electron image'?row:null);
  if(error){cell.append(el('p',error,'eds-channel-error'));return null}
  const img=el('img');img.src=source;img.alt=label;if(colour)img.dataset.intensityMap='';
  if(label==='Electron image'&&row.overviews?.[0]?.full_resolution){cell.style.aspectRatio=String(row.width/row.height);registeredOverview(cell,img,row.overviews[0],row,true)}else cell.append(img);mapScaleBar(cell,img,row);
  return {cell,img};
 }
 function hideMapHover(){mapHover?.remove();mapHover=null}
 function showMapHover(source,event,label){
  if(!source.fullPreview&&current?.options.hover_detail===false||event.buttons||source.cell.classList.contains('eds-panning')){hideMapHover();return}
  const box=mapImageBox(source.img),field=mapFieldBox(source.img),cell=source.cell.getBoundingClientRect();
  const left=Math.max(box.left,field.left,cell.left),top=Math.max(box.top,field.top,cell.top),right=Math.min(box.left+box.width,field.left+field.width,cell.right),bottom=Math.min(box.top+box.height,field.top+field.height,cell.bottom);
  if(!(right>left&&bottom>top)||event.clientX<left||event.clientX>right||event.clientY<top||event.clientY>bottom){hideMapHover();return}
  if(!mapHover){mapHover=el('aside');mapHover.id='eds-map-hover';mapHover.setAttribute('aria-hidden','true');const image=el('img');image.alt='';mapHover.append(image,el('span'));(source.cell.closest('dialog[open]')||document.body).append(mapHover)}
  const image=mapHover.querySelector('img');
  if(source.fullPreview){image.style.aspectRatio=String(source.img.naturalWidth/source.img.naturalHeight);image.src=source.img.src;image.style.filter=source.img.style.filter;mapHover.querySelector('span').textContent=label+' · '+source.img.naturalWidth+' × '+source.img.naturalHeight+' pixels'}
  else{
   const scale=source.img.naturalWidth/box.width,scaleY=source.img.naturalHeight/box.height;image.style.aspectRatio=String((right-left)/(bottom-top));
   image.src=window.WorkbenchImageDetail.draw(source.img,{x:(left-box.left)*scale,y:(top-box.top)*scaleY,width:(right-left)*scale,height:(bottom-top)*scaleY,u:(event.clientX-left)/(right-left),v:(event.clientY-top)/(bottom-top)},source.img.style.filter,source.img.style.imageRendering!=='pixelated');
   mapHover.querySelector('span').textContent=`5× detail · ${label} · ${source.cell.querySelector('.eds-overview-name')?.textContent||source.cell.querySelector('.eds-map-label')?.textContent||source.img.alt}`;
  }
  window.WorkbenchImageDetail.position(mapHover,event.clientX,event.clientY);
 }
 function mapImageBox(img){const r=img.getBoundingClientRect();if(img.registeredFrame)return r;const scale=Math.min(r.width/img.naturalWidth,r.height/img.naturalHeight),width=img.naturalWidth*scale,height=img.naturalHeight*scale;return {left:r.left+(r.width-width)/2,top:r.top+(r.height-height)/2,width,height}}
 function mapFieldBox(img){return img.registeredFrame?img.registeredFrame.getBoundingClientRect():mapImageBox(img)}
 function linkMapHover(tiles,path=null,label='',observers=plotObservers){
  // Coordinates belong to an acquisition, never to unrelated specimen fields.
  const listeners=[],listen=(node,event,handler)=>{node.addEventListener(event,handler);listeners.push(()=>node.removeEventListener(event,handler))};
  const marked=tiles.map(tile=>{const cursor=el('span',undefined,'eds-map-crosshair');cursor.hidden=true;cursor.setAttribute('aria-hidden','true');tile.cell.append(cursor);return {...tile,cursor}});
  const hide=()=>{hideMapHover();for(const {cursor} of marked)cursor.hidden=true;if(path)setMapCursor(null)};
  for(const source of marked){
   source.cell.classList.add('eds-hover-map');source.cell.tabIndex=0;
   if(!source.cell.hasAttribute('aria-label'))source.cell.setAttribute('aria-label',`${label} · ${source.img.alt} · 5× hover detail`);
   const move=event=>{
    const b=mapFieldBox(source.img),u=(event.clientX-b.left)/b.width,v=(event.clientY-b.top)/b.height;
    if(!Number.isFinite(u+v)||u<0||u>1||v<0||v>1){hide();return}
    if(path)setMapCursor(path,u,v);
    for(const {cell,img,cursor} of marked){const box=mapFieldBox(img),r=cell.getBoundingClientRect(),x=box.left+u*box.width-r.left,y=box.top+v*box.height-r.top;
     cursor.hidden=!!source.fullPreview||!(x>=0&&y>=0&&x<=r.width&&y<=r.height);cursor.style.left=x+'px';cursor.style.top=y+'px';
    }
    showMapHover(source,event,label);
   };
   const centre=()=>{const b=mapFieldBox(source.img),r=source.cell.getBoundingClientRect();move({clientX:(Math.max(b.left,r.left)+Math.min(b.left+b.width,r.right))/2,clientY:(Math.max(b.top,r.top)+Math.min(b.top+b.height,r.bottom))/2})};
   listen(source.cell,'pointermove',move);listen(source.cell,'pointerleave',hide);
   listen(source.cell,'pointerdown',hide);
   listen(source.cell,'pointerup',event=>{if(event.pointerType==='touch')move(event)});
   listen(source.cell,'focus',centre);listen(source.cell,'blur',hide);
   listen(source.cell,'keydown',event=>{if(event.key==='Escape')hide();else if(['Enter',' '].includes(event.key)&&event.target===source.cell){event.preventDefault();centre()}});
  }
  window.addEventListener('scroll',hide,true);window.addEventListener('resize',hide);
  observers.push({disconnect(){hide();for(const remove of listeners)remove();window.removeEventListener('scroll',hide,true);window.removeEventListener('resize',hide)}});
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

 function linePlots(root,row,result,structureBody=null,structureTitle=''){
  for(const tile of row.tiles.filter(t=>t.error))root.append(el('p',`${tile.label}: ${tile.error}`,'eds-channel-error'));row={...row,tiles:row.tiles.filter(t=>!t.error)};
  if(!row.tiles.length){root.append(el('p','Select an element other than the ratio denominator.','hint'));return}
  const display={...current.options},overlay=row.overlay??display.layout==='overlay',normalized=result.normalisation!=='none',baseline=normalized?1:0;
  const stack=el('div',undefined,`eds-line-plots${overlay?' eds-line-overlay':''}`);root.append(stack);
  const readout=el('p',row.trimmed?`${row.viewStart.toFixed(1)}–${(row.viewStart+row.viewLength).toFixed(1)} ${row.distance_unit} of scan · axis starts at selection`:`${row.length.toFixed(1)} ${row.distance_unit} · start → end`,'eds-line-readout');readout.title=row.calibration;root.append(readout);
  const normalLabel=({median:'Median',mean:'Mean',p20:'P20'})[result.normalisation];
  const noise=el(structureBody?'section':'details',undefined,structureBody?'eds-structure-entry':'eds-noise-check'),summary=structureBody?el('h4',structureTitle):el('summary','Spatial structure');
  const checks=row.tiles.filter(t=>t.noise_check?.available);
  if(checks.length)summary.append(el('span',' · '+checks.map(t=>`${t.label}: ${t.noise_check.structure_ratio.toFixed(1)}×`).join(' · '),'hint'));
  noise.append(summary);
  noisePlot(noise,row.tiles);
  if(!structureBody)noise.append(el('p','Smoothed variation compared with 256 paired shuffles of the same measurements. Around 1× means random ordering produces similar variation. Larger values indicate spatial structure, which can also come from drift, thickness or correlated noise; this is not a segregation test or a percentage of noise.','hint'));
  const table=el('table',undefined,'eds-noise-table'),head=el('tr');for(const text of ['Profile','Variation','Shuffled median','Shuffled 95th'])head.append(el('th',text));table.append(head);
  for(const tile of row.tiles){const check=tile.noise_check,tr=el('tr');tr.append(el('td',tile.label));if(check?.available){for(const value of [check.observed_cv,check.shuffled_cv,check.shuffled_95])tr.append(el('td',(100*value).toFixed(1)+'%'))}else{const cell=el('td',check?.reason||'Unavailable');cell.colSpan=3;tr.append(cell)}table.append(tr)}noise.append(table);
  if(!structureBody)noise.append(el('p','Full acquisition: variation = standard deviation ÷ mean of the smoothed profile, excluding 3σ at each end. The 95th percentile is a reference for this shuffle model, not a confidence interval. Numerator/denominator stay paired; channels are smoothed before division. Display normalization does not affect the result. Spatially correlated errors and instrument/systematic uncertainty are not estimated.','hint'));
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
   const caption=el('figcaption',undefined,'eds-line-caption');caption.dataset.labelKind='line';caption.hidden=!window.aztecPanelLabels.visible(current.options,'line');for(const tile of tiles){const sourceRow=current.comparison&&display.layout==='overlay'?result.rows.find(r=>r.acquisition===tile.acquisition):null,label=el('span',sourceRow?exportLabel(sourceRow):tile.label);label.style.color=tile.colour;label.title=tile.source||tile.label;if(sourceRow)label.dataset.acquisition=tile.acquisition;caption.append(label)}figure.append(caption);
   const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('role','img');svg.setAttribute('aria-label',`${tiles.map(t=>t.label).join(', ')} over centred scan image`);figure.append(svg);
   const metric=normalized?`${normalLabel} = 1`:tiles[0].unit;figure.dataset.metric=current.comparison?metric:'';
   if(current.comparison){const note=el('span',metric,'eds-line-metric');note.title=normalized?`${normalLabel} = 1 on the scan path`:metric;figure.append(note)}
   const linkedRange=row.sharedRanges?Math.max(...tiles.map(t=>row.sharedRanges.get(t.scaleKey)||0)):0;
   const range=linkedRange||sharedRange||rangeFor(tiles),showX=index===panels.length-1;
   const observer=new ResizeObserver(draw);plotObservers.push(observer);observer.observe(svg);
   function draw(){
    if(!svg.isConnected){observer.disconnect();return}
    svg.replaceChildren();const w=Math.max(150,svg.clientWidth),h=svg.clientHeight,left=normalized?(w<400?30:32):(w<400?38:42),right=current.comparison?0:8,top=4,bottom=showX?21:6,pw=Math.max(60,w-left-right),ph=h-top-bottom,centre=top+ph/2;
    svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
    svg.dataset.cropTop=top;svg.dataset.cropHeight=ph;
    const nativeExtent=row.image_extent||[-.035,1.035,-.23,.23],axisLength=row.axisLength||row.length,extent=current.comparison?[0,1,nativeExtent[2],nativeExtent[3]]:row.axisLength?[-.035,1.035,nativeExtent[2],nativeExtent[3]]:nativeExtent,span=extent[1]-extent[0],viewStart=row.viewStart||0,viewLength=row.viewLength||row.length;
    if(index===0&&current.comparison){for(const ref of referenceCursors){if(ref.unit!==row.distance_unit||(!row.overlay||current.options.layout!=='overlay')&&ref.acquisition!==row.acquisition)continue;const length=ref.row.length,halfHeight=ph/2/(pw/span)*axisLength/length;ref.updateCrop([Math.max(ref.row.image_extent[0],(ref.row.viewStart+(ref.row.trimmed?0:extent[0]*axisLength))/length),Math.min(ref.row.image_extent[1],(ref.row.viewStart+(ref.row.trimmed?ref.row.viewLength:extent[1]*axisLength))/length),Math.max(ref.row.image_extent[2],-halfHeight),Math.min(ref.row.image_extent[3],halfHeight)])}}
    if(index===0&&!current.comparison){const halfHeight=ph/2/(pw/span);setLineCrop(tiles[0].path,[extent[0],extent[1],Math.max(extent[2],-halfHeight),Math.min(extent[3],halfHeight)])}
    const X=x=>left+pw*(x/axisLength-extent[0])/span,Y=y=>centre-(y-baseline)*(ph/2-7)/range;
    if(current.comparison){
     const x=(row.trimmed?Math.max(left,X(0)):left)+6,y=top+6,width=Math.max(60,Math.min(pw*.7,left+pw-x-6)),metric=figure.querySelector('.eds-line-metric'),position=window.aztecPanelLabels.position(current.options,'line');
     const bounds={left:x-5,right:left+pw-1,top:y-5,bottom:top+ph-1};caption.style.maxWidth=width+'px';const point=window.aztecOverlayPlacement.box(bounds,caption.offsetWidth,caption.offsetHeight,position);Object.assign(caption.style,{left:point.x+'px',top:point.y+'px',right:'auto',bottom:'auto'});
     if(metric){metric.style.top=(y+(position==='top-right'&&!caption.hidden?caption.offsetHeight+4:0))+'px';metric.style.right=(right+6)+'px';metric.style.maxWidth=Math.max(50,pw*.28)+'px'}
     figure.dataset.labelX=x/w;figure.dataset.labelY=y/h;figure.dataset.labelWidth=width/w;figure.dataset.metricRight=(right+6)/w;figure.dataset.labelBounds=JSON.stringify([bounds.left/w,bounds.right/w,bounds.top/h,bounds.bottom/h]);
    }
    const add=(tag,attrs,text,parent=svg)=>{const n=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;parent.append(n);return n};
    const clipId=`${plotNamespace}-line-clip-${++plotSerial}`,defs=add('defs',{}),clip=add('clipPath',{id:clipId},undefined,defs);add('rect',{x:row.trimmed?X(0):left,y:top,width:row.trimmed?X(viewLength)-X(0):pw,height:ph},undefined,clip);const plot=add('g',{'clip-path':`url(#${clipId})`});
    if(display.background&&row.background){const scale=pw/span*row.length/axisLength;
     // The rotated crop uses equal x/y sampling. Its extent already defines the displayed aspect; an SVG meet fit adds empty side gutters.
     add('image',{href:row.background,x:X(nativeExtent[0]*row.length-viewStart),y:centre+nativeExtent[2]*scale,width:(nativeExtent[1]-nativeExtent[0])*scale,height:(nativeExtent[3]-nativeExtent[2])*scale,preserveAspectRatio:'none'},undefined,plot)}
    add('line',{x1:left,y1:centre,x2:left+pw,y2:centre,stroke:'#000','stroke-width':3,opacity:.8},undefined,plot);
    add('line',{x1:left,y1:centre,x2:left+pw,y2:centre,stroke:'#fff','stroke-width':1,'stroke-dasharray':'5 4',opacity:.8},undefined,plot);
    add('circle',{cx:X(0),cy:centre,r:3,fill:'#fff',stroke:'#000'},undefined,plot);add('path',{d:`M${X(viewLength)-7},${centre-4} L${X(viewLength)},${centre} L${X(viewLength)-7},${centre+4}Z`,fill:'#fff',stroke:'#000'},undefined,plot);
    const path=(tile,values)=>{let d='',move=true;values.forEach((y,i)=>{if(!Number.isFinite(y)){move=true;return}d+=`${move?'M':'L'}${X(tile.x[i]-(tile.viewStart||0))},${Y(y)} `;move=false});return d};
    if(display.raw)for(const tile of tiles){const d=path(tile,tile.raw),source=tile.acquisition?{'data-acquisition':tile.acquisition}:{};add('path',{d,fill:'none',stroke:'#07101b',opacity:.7,'stroke-width':2.5,...source},undefined,plot);add('path',{d,fill:'none',stroke:tile.colour,opacity:.85,'stroke-width':1.2,...source},undefined,plot)}
    for(const tile of tiles){const d=path(tile,tile.y),source=tile.acquisition?{'data-acquisition':tile.acquisition}:{};add('path',{d,fill:'none',stroke:'#fff',opacity:.9,'stroke-width':3.5,'stroke-linejoin':'round',...source},undefined,plot);add('path',{d,fill:'none',stroke:tile.colour,'stroke-width':2,'stroke-linejoin':'round',...source},undefined,plot)}
    const fmt=v=>Number(v.toPrecision(3)).toString(),axisFmt=v=>v!==0&&(Math.abs(v)<.01||Math.abs(v)>=1000)?v.toExponential(1):Number(v.toFixed(2)).toString();for(const value of [baseline+range,baseline,baseline-range])if(value>=0)add('text',{x:left-5,y:Y(value)+3,fill:'#becbda','text-anchor':'end','font-size':10},axisFmt(value));
    if(showX){for(let i=0;i<=4;i++){const x=axisLength*i/4;add('text',{x:i===4?Math.min(X(x),w-10):X(x),y:h-5,fill:'#becbda','text-anchor':i===4?'end':i===0?'start':'middle','font-size':10},`${x.toFixed(0)}${i===4?' '+row.distance_unit:''}`)}}
    if(!current.comparison)add('text',{x:left+5,y:top+11,fill:'#fff',stroke:'#000','stroke-width':2,'paint-order':'stroke','font-size':10},normalized?`${normalLabel} = 1 on scan`:metric);
    const cursor=add('line',{x1:X(0),x2:X(0),y1:top,y2:top+ph,stroke:'#fff','stroke-dasharray':'3 3',visibility:'hidden'});
    if(current.comparison&&display.background&&row.background&&row.trimmed&&row.length>row.viewLength){
     svg.classList.add('eds-line-pannable');svg.setAttribute('aria-description','Drag the crop to move the selected scan segment');
     svg.onpointerdown=event=>{const box=svg.getBoundingClientRect(),sx=(event.clientX-box.left)*w/box.width,sy=(event.clientY-box.top)*h/box.height;if(sx>=left&&sx<=left+pw&&sy>=top&&sy<=top+ph)beginLinePan(event,row,(dx)=>dx*w/box.width/pw*span*axisLength)};
    }
    const sources=new Set(tiles.map(tile=>tile.acquisition||row.acquisition).filter(Boolean));
    linePlotCursors.set(svg,{unit:row.distance_unit,sources,update:distance=>{if(distance===null){cursor.setAttribute('visibility','hidden');return}cursor.setAttribute('x1',X(distance));cursor.setAttribute('x2',X(distance));cursor.setAttribute('visibility','visible')}});
    const linked=entry=>entry.unit===row.distance_unit&&[...sources].some(id=>entry.sources.has(id));
    svg.onpointermove=e=>{const box=svg.getBoundingClientRect(),sx=(e.clientX-box.left)*w/box.width,distance=((sx-left)/pw*span+extent[0])*axisLength;
     for(const entry of linePlotCursors.values())if(linked(entry))entry.update(distance);
     const readings=tiles.map(t=>{const length=t.x.at(-1),i=Math.round((distance+(t.viewStart||0))/length*(t.x.length-1));return `${t.label}: ${i>=0&&i<t.y.length&&Number.isFinite(t.y[i])?fmt(t.y[i]):'—'}`});
     if(!current.comparison)setLineCursor(tiles[0].path,Math.max(0,Math.min(1,distance/row.length)));
     for(const ref of referenceCursors)ref.update(ref.unit===row.distance_unit&&sources.has(ref.acquisition)?distance:null);
     readout.textContent=`${distance.toFixed(1)} ${row.distance_unit} · `+readings.join(' · ')};svg.onpointerleave=()=>{for(const entry of linePlotCursors.values())if(linked(entry))entry.update(null);setLineCursor(null);for(const ref of referenceCursors)ref.update(null)};

   }
   svg.redraw=draw;draw();
  });
  (structureBody||root).append(noise);
 }

 if(!previewOnly)window.addEventListener('pagehide',persist);
 return {open,close,groups,relocateSources,linePreview};
};

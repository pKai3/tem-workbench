/* EDS file inspection: stored datasets first; processing lives downstream. */
(() => {
'use strict';
const $=id=>document.getElementById(id);
const state={token:'',listing:null,file:null,acquisition:null,dataset:null,site:null,analysisGroup:null,lineCrop:null,folderVersion:0,files:[],fileVersion:0,previewVersion:0,siteVersion:0};
let project='',sources=[],restoring=false,projectVersion=0,config;
const saved=()=>{try{return JSON.parse(WorkbenchWorkspace.readRaw('tem-eds-browser')||'{}')}catch{return {}}};
let sourceIds={};try{const stored=JSON.parse(WorkbenchWorkspace.readRaw('tem-aztec-source-ids')||'{}');if(stored&&typeof stored==='object'&&!Array.isArray(stored))sourceIds=stored}catch{}
function remember(){
 if(restoring)return;
 const previous=WorkbenchWorkspace.bookmark(project,'aztec');
 if(!state.file&&previous.file&&!state.comparisonKind)return; // Keep unavailable-file bookmarks for reconnection.
 const bookmark={folder:state.listing?.path||'',file:state.file?.catalogue.source.path||previous.file,dataset:state.dataset?.path,acquisition:state.acquisition?.index,comparison:state.comparisonKind||null,comparisonTable:state.comparisonTable||null,analysisGroup:state.analysisGroup,image:state.site?.image_path||(previous.acquisition===state.acquisition?.index?previous.image:null)};
 WorkbenchWorkspace.remember(project,'aztec',bookmark);
 const owner=WorkbenchWorkspace.projectForPath(bookmark.file||bookmark.folder);
 if(owner&&owner!==project)WorkbenchWorkspace.remember(owner,'aztec',bookmark);
 WorkbenchWorkspace.writeRaw('tem-eds-browser',JSON.stringify(bookmark));
}
document.addEventListener('workbench-bookmark',remember);

function el(tag,text,cls){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node}
function status(text,error=false){$('eds-status').textContent=text;$('eds-status').classList.toggle('eds-warning',error)}
function number(value){return Number.isFinite(value)?Number(value).toLocaleString(undefined,{maximumSignificantDigits:6}):'—'}
function size(value){const units=['B','KiB','MiB','GiB'];let i=0;while(value>=1024&&i<3){value/=1024;i++}return `${number(value)} ${units[i]}`}
function dimensions(shape){return shape===null?'Stored record':shape.length?shape.map(n=>n.toLocaleString()).join(' × '):'Scalar'}
function valueText(value){return typeof value==='object'?JSON.stringify(value):String(value??'—')}
function pointLabel(label){return label.replace(/^Spectrum\b/,'Point').replace(/^Preview spectrum$/i,'Preview').replace(/ Sum Spectrum$/i,' sum')}
function isSavedPreview(d){return d.path.startsWith('/EDXSpectra/')&&/^Preview spectrum$/i.test(d.attributes.Label||'')}
function siteContents(a){
 if(state.file.catalogue.file_type!=='OIPX')return [];
 const datasets=a.layers.flatMap(l=>l.signals),items=[],seen=new Set();
 for(const d of datasets){const kind=d.path.split('/')[1],label=d.attributes.Label||'',acquisition=d.attributes.Acquisition;
  if(kind==='ElectronImages')items.push(label.replace(/^Electron Image /,'Image '));
  else if(['SmartMaps','SmartLines','XrayMapImages','XrayLinescans','QuantLinescans'].includes(kind)&&acquisition&&!seen.has(d.attributes['Acquisition ID'])){seen.add(d.attributes['Acquisition ID']);items.push(acquisition.replace(/^(Map|Line) Data /,'$1 '))}
 }
 const points=datasets.filter(d=>d.path.startsWith('/EDXSpectra/')&&!isSavedPreview(d)&&! /^(Map|Line) Sum Spectrum$/i.test(d.attributes.Label||'')).map(d=>pointLabel(d.attributes.Label||'Point'));
 return [items.join(' · '),points.length?`Points: ${points.join(', ')}`:''].filter(Boolean);
}
function table(entries){const node=el('table',undefined,'eds-metadata-table');const body=el('tbody');for(const [key,value] of entries){const row=el('tr');row.append(el('th',key),el('td',valueText(value)));body.append(row)}node.append(body);return node}
async function api(action,body){const response=await fetch(`/api/aztec/${action}`,body?{method:'POST',headers:{'Content-Type':'application/json','X-TEM-Token':state.token},body:JSON.stringify(body)}:{});const data=await response.json();if(!response.ok)throw new Error(data.error||'Request failed');return data}
const analysis=window.createAztecAnalysis({$,el,state,api,highlightRegions,setLineCrop,setLineCursor,setMapCursor,remember});
function openAnalysis(id,comparison=false,channelTable){clearPreview();analysis.open(id,comparison,channelTable);remember()}
async function sharedApi(action,body){const response=await fetch(`/api/${action}`,{method:'POST',headers:{'Content-Type':'application/json','X-TEM-Token':state.token},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(data.error||'Request failed');return data}
const folderBrowser=WorkbenchProjectTools.browser(sharedApi);
const projectSettings=WorkbenchProjectTools.sources({api:sharedApi,getConfig:()=>config,chooseFolder:target=>folderBrowser.choose(target),
 onRename:async data=>{config.sources=data.sources;await updateProjects();await scanFiles()},
 onSave:async data=>{remember();config={...config,...data};await updateProjects();projectSettings.render();await changeProject(project)}});
async function updateProjects(){
 sources=config.sources||[];await WorkbenchWorkspace.configure(config);
 $('eds-sources').replaceChildren(new Option('All projects',''));for(const source of sources)$('eds-sources').add(new Option(source.name||source.path,source.id));
 if(!sources.some(s=>s.id===project))project='';$('eds-sources').value=project;
}
function renderFileChoice(){
 const path=state.file?.catalogue.source.path;$('eds-current-file').textContent=path?path.split(/[\\/]/).at(-1):'Choose file…';$('eds-current-file').title=path||'';$('eds-sites-empty').hidden=!!state.file;
}
function renderFiles(){
 const host=$('eds-files'),query=$('eds-filter').value.toLowerCase();host.replaceChildren();
 const matches=state.files.filter(f=>(f.relative_path+' '+f.project).toLowerCase().includes(query));
 $('eds-file-count').textContent=String(state.files.length);
 for(const file of matches){
  const button=el('button',undefined,'eds-entry'),name=el('span',file.name,'eds-file-name');button.type='button';button.append(name);
  const folder=file.relative_path.split(/[\\/]/).slice(0,-1).join(' / '),context=[project?'':file.project,folder].filter(Boolean).join(' / ');
  if(context)button.append(WorkbenchProjectTools.pathText(el('small'),context));button.title=file.path;button.setAttribute('aria-current',String(file.path===state.file?.catalogue.source.path));button.onclick=()=>openFile(file.path);host.append(button);
 }
 if(!matches.length)host.append(el('p',query?'No matching files.':'No supported AZtec files found. Choose another project or check its source folder in Project settings.','hint'));
}
async function scanFiles(){
 const version=++state.folderVersion;$('eds-rescan').disabled=true;$('eds-scan-status').textContent='Scanning configured files…';
 try{
  const listing=await api('files',{});if(version!==state.folderVersion)return;
  const moves=window.aztecComparisonState.relocations(sourceIds,listing.files),reopen=analysis.relocateSources(moves);
  if(Object.keys(moves).length){
   const relocate=bookmark=>moves[bookmark.file]?{...bookmark,file:moves[bookmark.file],folder:moves[bookmark.file].split(/[\\/]/).slice(0,-1).join('/')}:bookmark;
   for(const scope of ['',...sources.map(source=>source.id)]){
    const before=WorkbenchWorkspace.bookmark(scope,'aztec'),after=relocate(before);
    if(after===before)continue;
    WorkbenchWorkspace.remember(scope,'aztec',after);
    const owner=WorkbenchWorkspace.projectForPath(after.file),existing=owner&&WorkbenchWorkspace.bookmark(owner,'aztec');
    if(owner&&owner!==scope&&(!existing.file||existing.file===before.file))WorkbenchWorkspace.remember(owner,'aztec',after);
   }
   const old=saved(),updated=relocate(old);if(updated!==old)WorkbenchWorkspace.writeRaw('tem-eds-browser',JSON.stringify(updated));
   const movedFolder=Object.entries(moves).find(([oldPath])=>state.listing?.path===oldPath.split(/[\\/]/).slice(0,-1).join('/'));
   if(movedFolder)state.listing={path:movedFolder[1].split(/[\\/]/).slice(0,-1).join('/')};
  }
  for(const oldPath of Object.keys(moves))delete sourceIds[oldPath];
  for(const file of listing.files)if(file.kind==='OIPX'&&file.project_id)sourceIds[file.path]=file.project_id;
  WorkbenchWorkspace.writeRaw('tem-aztec-source-ids',JSON.stringify(sourceIds));
  state.files=project?listing.files.filter(file=>file.source_id===project):listing.files;renderFiles();
  $('eds-scan-status').textContent=listing.errors.join(' · ');$('eds-scan-status').classList.toggle('eds-warning',!!listing.errors.length);
  const oldPath=state.file?.catalogue.source.path;
  if(oldPath&&moves[oldPath]){const bookmark=WorkbenchWorkspace.bookmark(project,'aztec');state.file=null;await openFile(moves[oldPath],bookmark.dataset,bookmark.acquisition,bookmark.comparison,bookmark.comparisonTable,bookmark)}
  else if(reopen)await analysis.open(null,reopen.kind,reopen.table);
 }
 catch(error){if(version===state.folderVersion)$('eds-scan-status').textContent=error.message}
 finally{if(version===state.folderVersion)$('eds-rescan').disabled=false}
}
async function openFile(path,restoreDataset,restoreAcquisition,restoreComparison,restoreTable,bookmark={}){
 const owner=WorkbenchWorkspace.projectForPath(path);if(project&&owner!==project){remember();project=owner;$('eds-sources').value=project;WorkbenchWorkspace.set('active_project',project)}
 const version=++state.fileVersion;++state.previewVersion;status('Reading file contents…');
 try{const file=await api('open',{path});if(version!==state.fileVersion)return;state.file=file;const c=file.catalogue;$('eds-empty').hidden=true;$('eds-file').hidden=false;$('eds-file-info').textContent=`${c.source.path.split(/[\\/]/).at(-1)} · ${size(c.source.size)} · ${c.file_type} ${c.format_version}${c.software_version?' · AZtec '+c.software_version:''}`;
  const restored=c.acquisitions.find(a=>a.index===restoreAcquisition)||c.acquisitions.find(a=>a.layers.some(l=>l.signals.some(d=>d.path===restoreDataset)));
  renderAcquisition((restored||c.acquisitions[0])?.index);renderAcquisitions();state.listing={path:file.folder};renderFileChoice();renderFiles();remember();status(c.inventory?`${c.inventory.Samples||0} specimens · ${c.inventory.Analyses||0} sites · ${c.inventory.SmartMaps||0} maps · ${c.inventory.SmartLines||0} line scans · ${c.inventory.EDXSpectra||0} stored spectra · ${c.inventory.ElectronImages||0} electron images`:`${c.acquisitions.length} acquisitions · ${c.datasets.length} datasets · previews load when selected`);
  const target=state.acquisition?.layers.flatMap(l=>l.signals).find(d=>d.path===restoreDataset);if(['map','line'].includes(restoreComparison)){analysis.open(null,restoreComparison,restoreTable);remember()}else if(bookmark.analysisGroup){const [id,table]=bookmark.analysisGroup.split(':');openAnalysis(id,false,table)}else if(target)selectDataset(target);
  if(bookmark.image)await loadSite(bookmark.image);
 }catch(error){if(version===state.fileVersion)status(error.message,true)}
}
function renderAcquisitions(){
 const root=$('eds-acquisitions');root.replaceChildren();root.hidden=false;
 const groups=new Map();for(const a of state.file.catalogue.acquisitions){const name=a.specimen||'Project';if(!groups.has(name))groups.set(name,[]);groups.get(name).push(a)}
 for(const [name,items] of groups){const group=el('section');group.append(el('h3',name));const list=el('ul');for(const a of items){
  const item=el('li'),label=[a.site===a.label?null:a.site,a.label].filter(Boolean).join(' / '),button=el('button',undefined,'eds-site'),contents=siteContents(a);
  const title=el('span',label,'eds-site-name');title.title=label;button.append(title);for(const text of contents){const note=el('small',text,'eds-site-summary');note.title=text;button.append(note)}
  button.type='button';button.title=[label,...contents].join('\n');button.setAttribute('aria-label',label);button.dataset.index=a.index;button.setAttribute('aria-current',String(!state.comparisonKind&&a.index===state.acquisition?.index));button.onclick=()=>{if(state.comparisonKind||a.index!==state.acquisition?.index)renderAcquisition(a.index)};item.append(button);list.append(item)
 }group.append(list);root.append(group)}
}
function renderAcquisition(index){
 ++state.previewVersion;state.dataset=null;state.acquisition=state.file.catalogue.acquisitions.find(a=>a.index===index);for(const button of $('eds-acquisitions').querySelectorAll('.eds-site'))button.setAttribute('aria-current',String(button.dataset.index===String(index)));
 loadSite();
 const a=state.acquisition,c=state.file.catalogue;$('eds-context').textContent=[a?.project,a?.specimen,a?.site===a?.label?null:a?.site].filter(Boolean).join(' / ');$('eds-title').textContent=a?.label||'File contents';
 const notes=[...(c.notes||[]),...c.warnings];$('eds-warnings').textContent=notes.join(' ');$('eds-warnings').hidden=!notes.length;
 const root=$('eds-contents');root.replaceChildren();clearPreview();$('eds-metadata').open=false;$('eds-metadata-body').replaceChildren();
 const native=c.file_type==='OIPX',previewable=d=>!isSavedPreview(d)&&/^\/(ElectronImages|XrayMapImages|XrayLinescans|QuantLinescans|SmartLines|EDXSpectra)\//.test(d.path);
 const layers=(a?.layers||[]).flatMap(l=>{const previews=l.signals.filter(isSavedPreview);return previews.length?[{...l,signals:l.signals.filter(d=>!isSavedPreview(d))},{...l,path:'Saved preview spectra',technique:'Saved preview spectra',signals:previews}]:[l]});if(native)layers.sort((x,y)=>Number(!x.signals.some(previewable))-Number(!y.signals.some(previewable)));
 const channelsByAcquisition=new Set(layers.flatMap(l=>l.signals).filter(d=>/^\/(XrayMapImages|XrayLinescans|QuantLinescans)\//.test(d.path)).map(d=>d.attributes['Acquisition ID']));
 const sums=new Map(layers.flatMap(l=>l.signals).filter(d=>d.path.startsWith('/EDXSpectra/')&&/^(Line|Map) Sum Spectrum$/i.test(d.attributes.Label||'')&&channelsByAcquisition.has(d.attributes['Acquisition ID'])).map(d=>[d.attributes['Acquisition ID'],d]));
 const inlineSums=new Set([...sums.values()].map(d=>d.path));
 const unavailable=el('details',undefined,'eds-unavailable'),unavailableCount=layers.flatMap(l=>l.signals).filter(d=>!previewable(d)).length;
 unavailable.append(el('summary',`Other stored data · ${unavailableCount}`));
 for(const originalLayer of layers){
  const layer={...originalLayer,signals:originalLayer.signals.filter(d=>!inlineSums.has(d.path))};if(!layer.signals.length)continue;
  const compact=native&&layer.signals.every(previewable),points=native&&layer.signals.every(d=>d.path.startsWith('/EDXSpectra/')),name=(layer.technique==='Layered Image'?layer.path.split('/').at(-1):layer.technique).replace(/Stored spectra/g,'Points');
  const section=el(native?'section':'details',undefined,native?'eds-data-group':undefined);
  if(!native)section.open=['EDS','Electron Image'].includes(layer.technique);
  const heading=el(native?'h4':'summary',`${name} · ${layer.signals.length}`);heading.title=heading.textContent;section.append(heading);
  if(!native)section.append(el('p',`${layer.state}${layer.grid_shape?` · ${dimensions(layer.grid_shape)} grid`:''}`,'hint'));
  for(const note of layer.notes)section.append(el('p',note,'eds-warning'));
  const buttonRow=compact||points,buttons=buttonRow?el('div',undefined,'eds-data-buttons'):section;if(buttonRow){buttons.setAttribute('role','group');buttons.setAttribute('aria-label',name);section.append(buttons)}
  const channel=layer.signals.find(d=>/^\/(XrayMapImages|XrayLinescans|QuantLinescans)\//.test(d.path)),acquisitionId=channel?.attributes['Acquisition ID'];
  if(acquisitionId){const all=el('button','All','eds-item');all.type='button';all.title='View all elements';all.setAttribute('aria-label','View all elements');all.setAttribute('aria-pressed','false');all.dataset.analysisGroup=acquisitionId+':'+channel.path.split('/')[1];all.onclick=()=>openAnalysis(acquisitionId,false,channel.path.split('/')[1]);buttons.append(all)}
  let lastGroup='';for(const d of layer.signals){
   const relative=native?(d.attributes.Label||d.attributes['Record type']):d.path.slice(layer.path.length+'/Data/'.length),parts=relative.split('/'),group=parts.length>1?parts.slice(0,-1).join('/'):'Data',label=parts.at(-1);
   if(group!==lastGroup&&!native){section.append(el('p',group,'eds-group-label'));lastGroup=group}
   const symbol=label.split(' ')[0],shortLabel=points?pointLabel(label):compact?(channel&&layer.signals.filter(s=>s.attributes.Label?.split(' ')[0]===symbol).length===1?symbol:label.replace(/^Electron Image /,'Image ')):label;
   const b=el('button',shortLabel,'eds-item');b.type='button';b.dataset.path=d.path;b.setAttribute('aria-pressed','false');b.setAttribute('aria-label',points?shortLabel:label);if(buttonRow)b.title=label;
   if(native){if(!previewable(d)&&!points&&!isSavedPreview(d))b.append(el('small','Preview not available yet'))}else b.append(el('small',`${dimensions(d.shape)}${d.attributes.Unit?` · ${d.attributes.Unit}`:''}`));
   b.onclick=()=>selectDataset(d);buttons.append(b);
  }
  const sum=sums.get(acquisitionId);if(sum){const button=el('button','Sum','eds-item');button.type='button';button.dataset.path=sum.path;button.setAttribute('aria-pressed','false');button.setAttribute('aria-label',sum.attributes.Acquisition+' sum');button.title='Stored spectrum summed over the entire '+(channel.path.startsWith('/XrayMapImages/')?'map':'line');button.onclick=()=>selectDataset(sum);buttons.append(button)}
  (native&&!compact?unavailable:root).append(section);
 }
 if(native&&unavailableCount)root.append(unavailable);
 if(!root.childElementCount)root.append(el('p','No recognised acquisition layers. All dataset metadata is available below.','hint'));remember();
}
function clearPreview(){
 analysis.close();
 $('eds-dataset-title').textContent='Select an item to inspect';$('eds-dataset-info').textContent='';$('eds-preview').replaceChildren();$('eds-preview').classList.remove('eds-raw-line-preview');$('eds-preview-note').textContent='';$('eds-preview-tools').hidden=true;$('eds-dataset-details').hidden=true;$('eds-preview-error').hidden=true;$('eds-preview-busy').hidden=true;
}
function selectDataset(d){
 if(d.path.startsWith('/SmartMaps/')&&analysis.groups().some(g=>g.id===d.attributes['Acquisition ID'])){openAnalysis(d.attributes['Acquisition ID']);return}
 state.dataset=d;clearPreview();const label=d.attributes.Label||d.path.split('/').at(-1);$('eds-dataset-title').textContent=d.path.startsWith('/EDXSpectra/')?pointLabel(label):label;$('eds-dataset-info').textContent=state.file.catalogue.file_type==='OIPX'?d.attributes['Record type'].replace(/Stored spectra/g,'Points'):`${dimensions(d.shape)} · ${d.dtype}${d.attributes.Unit?` · ${d.attributes.Unit}`:''}`;$('eds-dataset-path').textContent=d.path;$('eds-attributes').replaceChildren(table(Object.entries({Storage:d.storage,...d.attributes})));$('eds-sample').replaceChildren();$('eds-dataset-details').hidden=false;$('eds-dataset-details').open=false;$('eds-row').value=1;$('eds-unsigned').checked=false;$('eds-energy-low').value='';$('eds-energy-high').value='';
 highlightRegions();
 remember();preview();
}
async function loadSite(image){
 const version=++state.siteVersion;state.site=null;const native=state.file.catalogue.file_type==='OIPX'&&state.acquisition?.index!=='unassigned';$('eds-site-view').hidden=!native;$('eds-site-canvas').replaceChildren();$('eds-site-regions').replaceChildren();$('eds-site-error').hidden=true;$('eds-site-image-label').hidden=true;$('eds-site-help').hidden=true;$('eds-site-unpositioned').replaceChildren();if(!native)return;
 $('eds-site-busy').hidden=false;
 try{const site=await api('site',{id:state.file.id,site:state.acquisition.index,image});if(version!==state.siteVersion)return;state.site=site;const select=$('eds-site-image');select.replaceChildren();for(const im of site.images){const o=el('option',im.label);o.value=im.path;select.append(o)}select.value=site.image_path||'';$('eds-site-image-label').hidden=site.images.length<2;
  remember();if(site.preview)drawSite(site);else $('eds-site-canvas').append(el('p',site.note,'hint'));
  for(const item of site.unpositioned||[])$('eds-site-unpositioned').append(el('p',`${item.label}: ${item.reason}`,'hint'));
  if(site.unpositioned?.length){$('eds-site-help').hidden=false;$('eds-site-error').textContent=`${site.unpositioned.length} saved regions have no decoded outline. See Unplaced regions.`;$('eds-site-error').hidden=false}
 }catch(error){if(version===state.siteVersion){$('eds-site-error').textContent=error.message;$('eds-site-error').hidden=false}}finally{if(version===state.siteVersion)$('eds-site-busy').hidden=true}
}
function highlightRegions(){
 const active=new Set((state.site?.regions||[]).filter(r=>r.paths.includes(state.dataset?.path)).map(r=>r.id));for(const node of $('eds-site-view').querySelectorAll('[data-region]'))node.setAttribute('aria-pressed',String(active.has(node.dataset.region)));
 for(const button of $('eds-contents').querySelectorAll('.eds-item')){
  const selected=state.analysisGroup?button.dataset.analysisGroup===state.analysisGroup:Boolean(button.dataset.path&&button.dataset.path===state.dataset?.path);
  button.setAttribute('aria-pressed',String(selected));if(selected){const details=button.closest('details');if(details)details.open=true}
 }
}
function setLineCrop(path,extent){
 state.lineCrop=path?{path,extent}:null;
 const svg=$('eds-site-canvas').querySelector('svg');if(!svg)return;
 svg.querySelector('.eds-line-crop')?.remove();
 const region=state.site?.regions.find(r=>r.kind==='line'&&r.paths.includes(path));if(!region||!extent)return;
 const [[x,y],[x2,y2]]=region.points,dx=x2-x,dy=y2-y,[u0,u1,v0,v1]=extent;
 const polygon=document.createElementNS('http://www.w3.org/2000/svg','polygon');polygon.classList.add('eds-line-crop');
 polygon.setAttribute('points',[[u0,v0],[u1,v0],[u1,v1],[u0,v1]].map(([u,v])=>`${x+u*dx-v*dy},${y+u*dy+v*dx}`).join(' '));
 polygon.setAttribute('aria-hidden','true');svg.querySelector('image').after(polygon);
}
function setLineCursor(path,fraction){
 const svg=$('eds-site-canvas').querySelector('svg');if(!svg)return;
 let cursor=svg.querySelector('.eds-line-position');
 const region=state.site?.regions.find(r=>r.kind==='line'&&r.paths.includes(path));
 if(!region||!Number.isFinite(fraction)){cursor?.remove();return}
 const [[x,y],[x2,y2]]=region.points,dx=x2-x,dy=y2-y,length=Math.hypot(dx,dy);if(!length){cursor?.remove();return}
 const t=Math.max(0,Math.min(1,fraction)),cx=x+t*dx,cy=y+t*dy;
 // Keep the crossbar compact in screen pixels regardless of image resolution.
 const half=7*state.site.geometry.width/(svg.getBoundingClientRect().width||320),nx=-dy/length*half,ny=dx/length*half;
 if(!cursor){cursor=document.createElementNS('http://www.w3.org/2000/svg','line');cursor.classList.add('eds-line-position');cursor.setAttribute('aria-hidden','true');svg.append(cursor)}
 for(const [key,value]of Object.entries({x1:cx-nx,y1:cy-ny,x2:cx+nx,y2:cy+ny}))cursor.setAttribute(key,value);
}
function setMapCursor(path,u,v){
 const svg=$('eds-site-canvas').querySelector('svg');if(!svg)return;
 let cursor=svg.querySelector('.eds-map-position');
 const region=state.site?.regions.find(r=>r.kind==='rectangle'&&r.paths.includes(path));
 if(!region||!Number.isFinite(u+v)){cursor?.remove();return}
 const [[x,y],[x2,y2]]=region.points,cx=x+u*(x2-x),cy=y+v*(y2-y),half=10*state.site.geometry.width/(svg.getBoundingClientRect().width||320);
 if(!cursor){cursor=document.createElementNS('http://www.w3.org/2000/svg','path');cursor.classList.add('eds-map-position');cursor.setAttribute('aria-hidden','true');svg.append(cursor)}
 cursor.setAttribute('d',`M${cx-half},${cy}h${half*2} M${cx},${cy-half}v${half*2}`);
}
function placeLineLabel(node,points,w,h,unit){
 const [[x,y],[x2,y2]]=points,dx=x2-x,dy=y2-y,length=Math.hypot(dx,dy);if(!length)return;
 const tx=dx/length,ty=dy/length,nx=-ty,ny=tx,box=node.getBBox(),hw=box.width/2,hh=box.height/2,pad=5*unit;
 const offset=Math.abs(nx)*hw+Math.abs(ny)*hh+8*unit;
 // Try either side of the arrow near its start, then farther along at an edge.
 let best;
 for(const along of [Math.min(12*unit,length/2),length*.25,length*.5,length*.75])for(const side of [1,-1]){
  const cx=x+tx*along+side*nx*offset,cy=y+ty*along+side*ny*offset;
  const overflow=Math.max(0,pad+hw-cx)+Math.max(0,cx+hw+pad-w)+Math.max(0,pad+hh-cy)+Math.max(0,cy+hh+pad-h);
  if(!best||overflow<best.overflow)best={cx,cy,overflow};
 }
 node.setAttribute('x',Math.max(pad+hw,Math.min(w-pad-hw,best.cx)));
 node.setAttribute('y',Math.max(pad+hh,Math.min(h-pad-hh,best.cy))-(box.y+hh));
}
function drawSite(site){
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),w=site.geometry.width,h=site.geometry.height,unit=Math.max(w,h)/320;
 svg.setAttribute('viewBox',`0 0 ${w} ${h}`);svg.setAttribute('aria-label','Electron image with acquisition regions');svg.classList.add('eds-site-svg');$('eds-site-canvas').append(svg);
 const make=(parent,tag,attrs,text)=>{const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;parent.append(n);return n};make(svg,'image',{href:site.preview.image,x:0,y:0,width:w,height:h});
 const choose=region=>{const ds=state.file.catalogue.datasets;const d=ds.find(d=>region.paths.includes(d.path)&&/^\/(XrayMapImages|XrayLinescans)\//.test(d.path))||ds.find(d=>d.path===region.path);if(d){const id=d.attributes['Acquisition ID'];if(id&&analysis.groups().some(g=>g.id===id))openAnalysis(id);else selectDataset(d)}};
 for(const region of [...site.regions].sort((a,b)=>(a.kind!=='rectangle')-(b.kind!=='rectangle'))){
  const [[x,y],[x2,y2]]=region.points,color='#fff';const group=make(svg,'g',{class:'eds-region',role:'button',tabindex:0,'aria-label':pointLabel(region.label),'data-region':region.id});make(group,'title',{},pointLabel(region.label));group.onclick=()=>choose(region);group.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(region)}};
  if(region.kind==='rectangle'){make(group,'rect',{x,y,width:x2-x,height:y2-y,class:'eds-region-outline'});make(group,'rect',{x,y,width:x2-x,height:y2-y,class:'eds-region-hit'})}
  else if(region.kind==='point'){make(group,'circle',{cx:x,cy:y,r:5*unit,class:'eds-region-outline'});make(group,'path',{d:`M${x-9*unit},${y}h${18*unit} M${x},${y-9*unit}v${18*unit}`,class:'eds-region-outline'});make(group,'circle',{cx:x,cy:y,r:12*unit,class:'eds-region-hit'})}
  else{make(group,'line',{x1:x,y1:y,x2,y2,class:'eds-region-outline'});make(group,'line',{x1:x,y1:y,x2,y2,class:'eds-region-hit'});make(group,'circle',{cx:x,cy:y,r:3*unit,class:'eds-region-start'});const angle=Math.atan2(y2-y,x2-x);make(group,'path',{d:`M${x2},${y2}l${-10*unit*Math.cos(angle-.4)},${-10*unit*Math.sin(angle-.4)} M${x2},${y2}l${-10*unit*Math.cos(angle+.4)},${-10*unit*Math.sin(angle+.4)}`,class:'eds-region-outline'})}
  const label=region.label.replace('Line Data ','L').replace('Map Data ','M').replace('Spectrum ','P'),text=make(group,'text',{x:Math.min(w-30*unit,Math.max(6*unit,x+8*unit)),y:Math.max(15*unit,y-8*unit),class:'eds-region-label','font-size':12*unit},label);
  if(region.kind==='line'){text.setAttribute('x',0);text.setAttribute('y',0);text.setAttribute('text-anchor','middle');placeLineLabel(text,region.points,w,h,unit)}
  const button=el('button',pointLabel(region.label).replace('Line Data ','Line ').replace('Map Data ','Map '),'eds-region-key');button.type='button';button.dataset.region=region.id;button.style.setProperty('--region-colour',color);button.onclick=()=>choose(region);$('eds-site-regions').append(button);
 }
 highlightRegions();if(state.lineCrop)setLineCrop(state.lineCrop.path,state.lineCrop.extent);
}
async function preview(){
 if(!state.dataset)return;const version=++state.previewVersion;const d=state.dataset;$('eds-preview-busy').hidden=false;$('eds-preview-error').hidden=true;$('eds-preview').replaceChildren();$('eds-preview-note').textContent='';
 try{const rawLine=d.path.startsWith('/SmartLines/'),low=$('eds-energy-low').value,high=$('eds-energy-high').value,result=await api('preview',{id:state.file.id,dataset:d.path,row:Number($('eds-row').value)-1,unsigned:$('eds-unsigned').checked,...(rawLine?{energy_low:low===''?null:Number(low),energy_high:high===''?null:Number(high)}:{})});if(version!==state.previewVersion)return;
  $('eds-row-label').hidden=!result.rows;$('eds-row').max=result.rows||1;$('eds-unsigned-label').hidden=!result.unsigned_available;
  for(const [id,value] of [['eds-energy-low',result.energy_window?.low],['eds-energy-high',result.energy_window?.high]])if(value!==undefined&&!$(id).value)$(id).value=String(value);
  $('eds-energy-low-label').hidden=$('eds-energy-high-label').hidden=!result.energy_window;$('eds-preview-tools').hidden=!result.rows&&!result.unsigned_available&&!result.energy_window;
  if(result.shape)$('eds-dataset-info').textContent=result.total_counts!==undefined?`${dimensions(result.shape)} channels · ${result.total_counts.toLocaleString()} counts · ${number(result.channel_width_ev)} eV/channel`:`${dimensions(result.shape)}${result.shape.length===1?' samples':''}${result.unit?' · '+result.unit:''}`;const root=$('eds-preview');root.classList.toggle('eds-raw-line-preview',!!result.spectrum_image);if(result.kind==='image'){const img=el('img');img.src=result.image;img.alt=`Stored preview of ${d.path}`;root.append(img)}else if(result.kind==='plot'){drawPlot(root,result);if(result.spectrum_image){const figure=el('figure',undefined,'eds-spectrum-heatmap'),img=el('img');img.src=result.spectrum_image;img.alt='Raw spectrum counts by scan position and energy';figure.append(img,el('figcaption',`Raw counts · scan 1–${result.x.length} across · energy ${number(result.energy_window.minimum)}–${number(result.energy_window.maximum)} keV upward · log brightness`,'hint'));root.append(figure)}}else if(result.sample!==undefined||result.value!==undefined){root.append(table([['Stored values',result.sample??result.value]]))}else root.append(el('p',result.note,'hint'));
  $('eds-preview-note').textContent=result.kind==='metadata'?'':result.note+(result.minimum!==undefined?` Range ${number(result.minimum)}–${number(result.maximum)}${result.unit?' '+result.unit:''}.`:'');
  $('eds-sample').replaceChildren();if(result.kind==='image'&&result.sample!==undefined){$('eds-sample').append(el('h3','First stored rows'),table([['Original values',result.sample]]))}
 }catch(error){if(version===state.previewVersion){$('eds-preview-error').textContent=error.message;$('eds-preview-error').hidden=false}}finally{if(version===state.previewVersion)$('eds-preview-busy').hidden=true}
}
function drawPlot(root,data){
 const wrap=el('div',undefined,'eds-plot-wrap'),svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),readout=el('p','Hover to inspect stored values.','hint eds-plot-readout');svg.setAttribute('role','img');svg.setAttribute('aria-label',`${data.y_label} against ${data.x_label}`);wrap.append(svg,readout);root.append(wrap);
 const make=(tag,attrs,text)=>{const n=document.createElementNS(svg.namespaceURI,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;svg.append(n);return n};
 const values=data.y.filter(Number.isFinite),xs=data.x.filter(Number.isFinite);if(!values.length||!xs.length){readout.textContent='No finite values to plot.';return}
 const xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(0,...values),ymax=Math.max(...values);let cursor;
 function render(){if(!svg.isConnected){observer.disconnect();return}svg.replaceChildren();const w=Math.max(220,wrap.clientWidth),h=svg.clientHeight||340,left=65,right=18,top=20,bottom=48;svg.setAttribute('viewBox',`0 0 ${w} ${h}`);const X=x=>left+(x-xmin)/(xmax-xmin||1)*(w-left-right),Y=y=>h-bottom-(y-ymin)/(ymax-ymin||1)*(h-top-bottom);make('line',{x1:left,y1:top,x2:left,y2:h-bottom,class:'eds-axis'});make('line',{x1:left,y1:h-bottom,x2:w-right,y2:h-bottom,class:'eds-axis'});
  for(let i=0;i<3;i++){const x=xmin+(xmax-xmin)*i/2,y=ymin+(ymax-ymin)*i/2;make('text',{x:X(x),y:h-bottom+20,'text-anchor':'middle'},number(x));make('text',{x:left-8,y:Y(y)+4,'text-anchor':'end'},number(y))}make('text',{x:left,y:12},data.y_label);make('text',{x:(left+w-right)/2,y:h-4,'text-anchor':'middle'},data.x_label);
  let path='',start=true;data.y.forEach((y,i)=>{if(!Number.isFinite(y)||!Number.isFinite(data.x[i])){start=true;return}path+=`${start?'M':'L'}${X(data.x[i])},${Y(y)} `;start=false});make('path',{d:path,class:'eds-curve'});cursor=make('line',{x1:left,x2:left,y1:top,y2:h-bottom,class:'eds-cursor',visibility:'hidden'});
  svg.onpointermove=e=>{const p=(e.clientX-svg.getBoundingClientRect().left-left)/(w-left-right),i=Math.max(0,Math.min(data.x.length-1,Math.round(p*(data.x.length-1))));cursor.setAttribute('x1',X(data.x[i]));cursor.setAttribute('x2',X(data.x[i]));cursor.setAttribute('visibility','visible');readout.textContent=`${data.x_label}: ${number(data.x[i])} · ${data.y_label}: ${number(data.y[i])}`};svg.onpointerleave=()=>cursor.setAttribute('visibility','hidden');
 }
 const observer=new ResizeObserver(render);observer.observe(wrap);render();
}
function metadata(){
 const root=$('eds-metadata-body');if(root.childElementCount)return;const c=state.file.catalogue;if(c.inventory)root.append(el('h3','Native project inventory'),table(Object.entries(c.inventory)));root.append(table(Object.entries({File:c.source.path,Bytes:c.source.size,Format:c.format_version,Software:c.software_version,Manufacturer:c.manufacturer,Reader:c.source.reader})));
 for(const layer of state.acquisition?.layers||[]){root.append(el('h3',layer.path),table(Object.entries(layer.header).map(([key,d])=>[key,`${d.value===null?dimensions(d.shape):valueText(d.value)}${d.attributes.Unit?' '+d.attributes.Unit:''}`])))}
 const all=el('details');all.append(el('summary',`All datasets (${c.datasets.length})`));all.addEventListener('toggle',()=>{if(!all.open||all.childElementCount>1)return;for(const d of c.datasets){const b=el('button',`${d.path} · ${dimensions(d.shape)}`,'eds-item');b.type='button';b.onclick=()=>{selectDataset(d);$('eds-dataset-title').scrollIntoView({block:'nearest'})};all.append(b)}});root.append(all);
}
$('eds-rescan').onclick=scanFiles;
$('eds-filter').oninput=renderFiles;
$('eds-row').onchange=preview;
$('eds-unsigned').onchange=preview;
$('eds-energy-low').onchange=preview;
$('eds-energy-high').onchange=preview;
$('eds-metadata').ontoggle=()=>{if($('eds-metadata').open)metadata()};
$('eds-project-settings').onclick=()=>WorkbenchProjectTools.showSources($('eds-project-dialog'));
$('eds-project-close').onclick=()=>$('eds-project-dialog').close();
$('eds-sources').onchange=e=>changeProject(e.target.value);
$('eds-compare').onclick=()=>openAnalysis(null,'map');
$('eds-compare-lines').onclick=()=>openAnalysis(null,'line');
$('eds-site-image').onchange=e=>loadSite(e.target.value);
$('eds-catalogue').onclick=async()=>{if(!state.file)return;const button=$('eds-catalogue'),notice=WorkbenchExportNotice.show;button.disabled=true;notice('Saving catalogue…','Preparing the file…');try{const saved=await api('export',{id:state.file.id,format:'catalogue'});notice('✓ Export saved · '+saved.path.split(/[\\/]/).at(-1),saved.path,'saved')}catch(error){notice('Export failed',error.message,'error')}finally{button.disabled=false}};
async function changeProject(id){
 const version=++projectVersion;remember();project=id;WorkbenchWorkspace.set('active_project',project);$('eds-sources').value=project;
 let bookmark=WorkbenchWorkspace.bookmark(project,'aztec');restoring=true;
 ++state.fileVersion;++state.folderVersion;++state.siteVersion;++state.previewVersion;
 analysis.close();state.file=null;state.acquisition=null;state.dataset=null;state.site=null;state.listing=null;
 $('eds-file').hidden=true;$('eds-empty').hidden=false;$('eds-acquisitions').replaceChildren();state.files=[];$('eds-files').replaceChildren();$('eds-filter').value='';renderFileChoice();
 try{
  state.listing={path:bookmark.folder||sources.find(s=>s.id===project)?.path||''};status('Choose an AZtec file.');
  await scanFiles();if(version!==projectVersion)return;bookmark=WorkbenchWorkspace.bookmark(project,'aztec');
  if(bookmark.file&&state.files.some(file=>file.path===bookmark.file))await openFile(bookmark.file,bookmark.dataset,bookmark.acquisition,bookmark.comparison,bookmark.comparisonTable,bookmark);
  else if(bookmark.comparison)await analysis.open(null,bookmark.comparison,bookmark.comparisonTable);
  else if(state.files.length===1)await openFile(state.files[0].path);
 }finally{if(version===projectVersion){restoring=false;remember()}}
}
async function init(){try{
 config=await api('config');state.token=config.token;sources=config.sources||[];
 await WorkbenchWorkspace.configure(config);
 window.configureWorkbenchDiagnostics({send:body=>fetch('/api/diagnostics',{method:'POST',headers:{'Content-Type':'application/json','X-TEM-Token':state.token},body:JSON.stringify(body),keepalive:true}),context:()=>({workspace:'AZtec',file_path:state.file?.catalogue.source.path,site:state.acquisition?.label,dataset:state.dataset?.path})});
 $('eds-version').textContent=config.app_version;
 const previous=saved(),owner=WorkbenchWorkspace.projectForPath(previous.file||previous.folder);
 if(previous.file&&!WorkbenchWorkspace.bookmark(owner,'aztec').file)WorkbenchWorkspace.remember(owner,'aztec',previous);
 const active=WorkbenchWorkspace.get('active_project',owner),id=sources.some(s=>s.id===active)?active:'';
 await updateProjects();projectSettings.render();
 // Do not replace a remembered project with the initial empty viewer.
 project=id;restoring=true;await changeProject(id);
 }catch(error){restoring=false;status(error.message,true)}}

init();
})();

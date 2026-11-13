/* EDS file inspection: stored datasets first; processing lives downstream. */
(() => {
'use strict';
const $=id=>document.getElementById(id);
const state={token:'',listing:null,file:null,acquisition:null,dataset:null,site:null,folderVersion:0,fileVersion:0,previewVersion:0,siteVersion:0};
const saved=()=>{try{return JSON.parse(localStorage.getItem('tem-eds-browser')||'{}')}catch{return {}}};
const remember=()=>{try{localStorage.setItem('tem-eds-browser',JSON.stringify({folder:state.listing?.path,file:state.file?.catalogue.source.path,dataset:state.dataset?.path,acquisition:state.acquisition?.index}))}catch{/* Browsing also works with storage disabled. */}};
function el(tag,text,cls){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node}
function status(text,error=false){$('eds-status').textContent=text;$('eds-status').classList.toggle('eds-warning',error)}
function number(value){return Number.isFinite(value)?Number(value).toLocaleString(undefined,{maximumSignificantDigits:6}):'—'}
function size(value){const units=['B','KiB','MiB','GiB'];let i=0;while(value>=1024&&i<3){value/=1024;i++}return `${number(value)} ${units[i]}`}
function dimensions(shape){return shape===null?'Stored record':shape.length?shape.map(n=>n.toLocaleString()).join(' × '):'Scalar'}
function valueText(value){return typeof value==='object'?JSON.stringify(value):String(value??'—')}
function table(entries){const node=el('table',undefined,'eds-metadata-table');const body=el('tbody');for(const [key,value] of entries){const row=el('tr');row.append(el('th',key),el('td',valueText(value)));body.append(row)}node.append(body);return node}
async function api(action,body){const response=await fetch(`/api/aztec/${action}`,body?{method:'POST',headers:{'Content-Type':'application/json','X-TEM-Token':state.token},body:JSON.stringify(body)}:{});const data=await response.json();if(!response.ok)throw new Error(data.error||'Request failed');return data}
const analysis=window.createAztecAnalysis({$,el,state,api,highlightRegions});
function openAnalysis(id,comparison=false){clearPreview();analysis.open(id,comparison);remember()}
function renderFiles(){
 const root=$('eds-files');root.replaceChildren();const listing=state.listing;if(!listing)return;
 const query=$('eds-filter').value.toLowerCase();
 for(const folder of listing.directories.filter(f=>f.name.toLowerCase().includes(query))){const b=el('button',`▸ ${folder.name}`,'eds-entry');b.type='button';b.onclick=()=>browse(folder.path);root.append(b)}
 for(const file of listing.files.filter(f=>f.name.toLowerCase().includes(query))){const b=el('button',file.name,'eds-entry');b.type='button';b.setAttribute('aria-current',String(file.path===state.file?.catalogue.source.path));b.append(el('small',`${size(file.size)} · ${file.kind==='H5OINA'?'H5OINA · optional export':file.supported?'Native project':'Legacy project · reader pending'}`));b.disabled=!file.supported;b.onclick=()=>openFile(file.path);root.append(b)}
 if(!root.childElementCount)root.append(el('p',query?'No matching files or folders.':'No AZtec files or subfolders here.','hint'));
}
async function browse(path){
 const version=++state.folderVersion;status('Reading folder…');
 try{const listing=await api('browse',{path});if(version!==state.folderVersion)return;state.listing=listing;$('eds-path').value=listing.path;$('eds-up').disabled=listing.parent===listing.path;$('eds-filter').value='';$('eds-file-browser').open=true;renderFiles();remember();status(`${listing.files.filter(f=>f.supported).length} readable files · ${listing.directories.length} folders`)}catch(error){if(version===state.folderVersion)status(error.message,true)}
}
async function openFile(path,restoreDataset,restoreAcquisition){
 const version=++state.fileVersion;++state.previewVersion;status('Reading file contents…');
 try{const file=await api('open',{path});if(version!==state.fileVersion)return;state.file=file;const c=file.catalogue;$('eds-empty').hidden=true;$('eds-file').hidden=false;$('eds-file-info').textContent=`${c.source.path.split(/[\\/]/).at(-1)} · ${size(c.source.size)} · ${c.file_type} ${c.format_version}${c.software_version?' · AZtec '+c.software_version:''}`;
  const restored=c.acquisitions.find(a=>a.index===restoreAcquisition)||c.acquisitions.find(a=>a.layers.some(l=>l.signals.some(d=>d.path===restoreDataset)));
  $('eds-compare').hidden=!analysis.groups().some(g=>g.kind==='map');renderAcquisition((restored||c.acquisitions[0])?.index);renderAcquisitions();renderFiles();remember();if(file.folder!==state.listing?.path)await browse(file.folder);if(version!==state.fileVersion)return;$('eds-file-browser').open=false;status(c.inventory?`${c.inventory.Samples||0} specimens · ${c.inventory.Analyses||0} sites · ${c.inventory.SmartMaps||0} maps · ${c.inventory.SmartLines||0} line scans · ${c.inventory.EDXSpectra||0} stored spectra · ${c.inventory.ElectronImages||0} electron images`:`${c.acquisitions.length} acquisitions · ${c.datasets.length} datasets · previews load when selected`);
  const target=state.acquisition?.layers.flatMap(l=>l.signals).find(d=>d.path===restoreDataset);if(target)selectDataset(target);
 }catch(error){if(version===state.fileVersion)status(error.message,true)}
}
function renderAcquisitions(){
 const root=$('eds-acquisitions');root.replaceChildren();root.hidden=false;
 const groups=new Map();for(const a of state.file.catalogue.acquisitions){const name=a.specimen||'Project';if(!groups.has(name))groups.set(name,[]);groups.get(name).push(a)}
 for(const [name,items] of groups){const group=el('section');group.append(el('h3',name));const list=el('ul');for(const a of items){const item=el('li'),button=el('button',[a.site===a.label?null:a.site,a.label].filter(Boolean).join(' / '),'eds-site');button.type='button';button.dataset.index=a.index;button.setAttribute('aria-current',String(a.index===state.acquisition?.index));button.onclick=()=>{if(a.index!==state.acquisition?.index)renderAcquisition(a.index)};item.append(button);list.append(item)}group.append(list);root.append(group)}
}
function renderAcquisition(index){
 ++state.previewVersion;state.dataset=null;state.acquisition=state.file.catalogue.acquisitions.find(a=>a.index===index);for(const button of $('eds-acquisitions').querySelectorAll('.eds-site'))button.setAttribute('aria-current',String(button.dataset.index===String(index)));
 loadSite();
 const a=state.acquisition,c=state.file.catalogue;$('eds-context').textContent=[a?.project,a?.specimen,a?.site===a?.label?null:a?.site].filter(Boolean).join(' / ');$('eds-title').textContent=a?.label||'File contents';
 const notes=[...(c.notes||[]),...c.warnings];$('eds-warnings').textContent=notes.join(' ');$('eds-warnings').hidden=!notes.length;
 const root=$('eds-contents');root.replaceChildren();clearPreview();$('eds-metadata').open=false;$('eds-metadata-body').replaceChildren();
 for(const layer of a?.layers||[]){const details=el('details');details.open=['EDS','Electron Image'].includes(layer.technique);const name=layer.technique==='Layered Image'?layer.path.split('/').at(-1):layer.technique;details.open=state.file.catalogue.file_type==='OIPX'?/Electron images|Element maps|Element profiles|Composition profiles/.test(name):details.open;const summary=el('summary',`${name} · ${layer.signals.length}`);details.append(summary);
  if(state.file.catalogue.file_type!=='OIPX')details.append(el('p',`${layer.state}${layer.grid_shape?` · ${dimensions(layer.grid_shape)} grid`:''}`,'hint'));
  const acquisitionId=layer.signals.find(d=>/^\/(XrayMapImages|XrayLinescans)\//.test(d.path))?.attributes['Acquisition ID'];if(acquisitionId){const all=el('button','View all elements','eds-item');all.type='button';all.onclick=()=>openAnalysis(acquisitionId);details.append(all)}
  for(const note of layer.notes)details.append(el('p',note,'eds-warning'));
  let lastGroup='';for(const d of layer.signals){const relative=state.file.catalogue.file_type==='OIPX'?(d.attributes.Label||d.attributes['Record type']):d.path.slice(layer.path.length+'/Data/'.length);const parts=relative.split('/');const group=parts.length>1?parts.slice(0,-1).join('/'):'Data';if(group!==lastGroup&&state.file.catalogue.file_type!=='OIPX'){details.append(el('p',group,'eds-group-label'));lastGroup=group}const b=el('button',parts.at(-1),'eds-item');b.type='button';b.dataset.path=d.path;b.setAttribute('aria-pressed','false');b.append(el('small',state.file.catalogue.file_type==='OIPX'?(/\/(ElectronImages|XrayMapImages|XrayLinescans|QuantLinescans)\//.test(d.path)?'Preview available':'Contents identified · preview pending'):`${dimensions(d.shape)}${d.attributes.Unit?` · ${d.attributes.Unit}`:''}`));b.onclick=()=>selectDataset(d);details.append(b)}root.append(details);
 }
 if(!root.childElementCount)root.append(el('p','No recognised acquisition layers. All dataset metadata is available below.','hint'));remember();
}
function clearPreview(){
 analysis.close();
 $('eds-dataset-title').textContent='Select an item to inspect';$('eds-dataset-info').textContent='';$('eds-preview').replaceChildren();$('eds-preview-note').textContent='';$('eds-preview-tools').hidden=true;$('eds-dataset-details').hidden=true;$('eds-preview-error').hidden=true;$('eds-preview-busy').hidden=true;
}
function selectDataset(d){
 if(/^\/(SmartLines|SmartMaps)\//.test(d.path)&&analysis.groups().some(g=>g.id===d.attributes['Acquisition ID'])){openAnalysis(d.attributes['Acquisition ID']);return}
 state.dataset=d;clearPreview();$('eds-dataset-title').textContent=(d.attributes.Label||d.path.split('/').at(-1));$('eds-dataset-info').textContent=state.file.catalogue.file_type==='OIPX'?d.attributes['Record type']:`${dimensions(d.shape)} · ${d.dtype}${d.attributes.Unit?` · ${d.attributes.Unit}`:''}`;$('eds-dataset-path').textContent=d.path;$('eds-attributes').replaceChildren(table(Object.entries({Storage:d.storage,...d.attributes})));$('eds-sample').replaceChildren();$('eds-dataset-details').hidden=false;$('eds-dataset-details').open=false;$('eds-row').value=1;$('eds-unsigned').checked=false;
 for(const b of $('eds-contents').querySelectorAll('.eds-item[data-path]')){b.setAttribute('aria-pressed',String(b.dataset.path===d.path));if(b.dataset.path===d.path)b.closest('details').open=true}highlightRegions();
 remember();preview();
}
async function loadSite(image){
 const version=++state.siteVersion;state.site=null;const native=state.file.catalogue.file_type==='OIPX'&&state.acquisition?.index!=='unassigned';$('eds-site-view').hidden=!native;$('eds-site-canvas').replaceChildren();$('eds-site-regions').replaceChildren();$('eds-site-error').hidden=true;$('eds-site-image-label').hidden=true;$('eds-site-note').textContent='';$('eds-site-unpositioned').replaceChildren();if(!native)return;
 $('eds-site-busy').hidden=false;
 try{const site=await api('site',{id:state.file.id,site:state.acquisition.index,image});if(version!==state.siteVersion)return;state.site=site;const select=$('eds-site-image');select.replaceChildren();for(const im of site.images){const o=el('option',im.label);o.value=im.path;select.append(o)}select.value=site.image_path||'';$('eds-site-image-label').hidden=site.images.length<2;$('eds-site-note').textContent=site.note;
  if(site.preview)drawSite(site);else $('eds-site-canvas').append(el('p',site.note,'hint'));
  for(const item of site.unpositioned||[])$('eds-site-unpositioned').append(el('p',`${item.label}: ${item.reason}`,'hint'));
  if(site.unpositioned?.length){$('eds-site-error').textContent=`${site.unpositioned.length} saved regions have no decoded outline. See Position details.`;$('eds-site-error').hidden=false}
 }catch(error){if(version===state.siteVersion){$('eds-site-error').textContent=error.message;$('eds-site-error').hidden=false}}finally{if(version===state.siteVersion)$('eds-site-busy').hidden=true}
}
function highlightRegions(){
 const active=new Set((state.site?.regions||[]).filter(r=>r.paths.includes(state.dataset?.path)).map(r=>r.id));for(const node of $('eds-site-view').querySelectorAll('[data-region]'))node.setAttribute('aria-pressed',String(active.has(node.dataset.region)));
}
function drawSite(site){
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),w=site.geometry.width,h=site.geometry.height,unit=Math.max(w,h)/320;
 svg.setAttribute('viewBox',`0 0 ${w} ${h}`);svg.setAttribute('aria-label','Electron image with acquisition regions');svg.classList.add('eds-site-svg');$('eds-site-canvas').append(svg);
 const make=(parent,tag,attrs,text)=>{const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;parent.append(n);return n};make(svg,'image',{href:site.preview.image,x:0,y:0,width:w,height:h});
 const choose=region=>{const ds=state.file.catalogue.datasets;const d=ds.find(d=>region.paths.includes(d.path)&&/^\/(XrayMapImages|XrayLinescans)\//.test(d.path))||ds.find(d=>d.path===region.path);if(d){const id=d.attributes['Acquisition ID'];if(id&&analysis.groups().some(g=>g.id===id))openAnalysis(id);else selectDataset(d)}};
 for(const region of [...site.regions].sort((a,b)=>(a.kind!=='rectangle')-(b.kind!=='rectangle'))){
  const [[x,y],[x2,y2]]=region.points,color='#fff';const group=make(svg,'g',{class:'eds-region',role:'button',tabindex:0,'aria-label':region.label,'data-region':region.id});make(group,'title',{},region.label);group.onclick=()=>choose(region);group.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(region)}};
  if(region.kind==='rectangle'){make(group,'rect',{x,y,width:x2-x,height:y2-y,class:'eds-region-outline'});make(group,'rect',{x,y,width:x2-x,height:y2-y,class:'eds-region-hit'})}
  else if(region.kind==='point'){make(group,'circle',{cx:x,cy:y,r:5*unit,class:'eds-region-outline'});make(group,'path',{d:`M${x-9*unit},${y}h${18*unit} M${x},${y-9*unit}v${18*unit}`,class:'eds-region-outline'});make(group,'circle',{cx:x,cy:y,r:12*unit,class:'eds-region-hit'})}
  else{make(group,'line',{x1:x,y1:y,x2,y2,class:'eds-region-outline'});make(group,'line',{x1:x,y1:y,x2,y2,class:'eds-region-hit'});make(group,'circle',{cx:x,cy:y,r:3*unit,class:'eds-region-start'});const angle=Math.atan2(y2-y,x2-x);make(group,'path',{d:`M${x2},${y2}l${-10*unit*Math.cos(angle-.4)},${-10*unit*Math.sin(angle-.4)} M${x2},${y2}l${-10*unit*Math.cos(angle+.4)},${-10*unit*Math.sin(angle+.4)}`,class:'eds-region-outline'})}
  const label=region.label.replace('Line Data ','L').replace('Map Data ','M').replace('Spectrum ','P');make(group,'text',{x:Math.min(w-30*unit,Math.max(6*unit,x+8*unit)),y:Math.max(15*unit,y-8*unit),class:'eds-region-label','font-size':12*unit},label);
  const button=el('button',region.label.replace('Line Data ','Line ').replace('Map Data ','Map '),'eds-region-key');button.type='button';button.dataset.region=region.id;button.style.setProperty('--region-colour',color);button.onclick=()=>choose(region);$('eds-site-regions').append(button);
 }
 highlightRegions();
}
async function preview(){
 if(!state.dataset)return;const version=++state.previewVersion;const d=state.dataset;$('eds-preview-busy').hidden=false;$('eds-preview-error').hidden=true;$('eds-preview').replaceChildren();$('eds-preview-note').textContent='';
 try{const result=await api('preview',{id:state.file.id,dataset:d.path,row:Number($('eds-row').value)-1,unsigned:$('eds-unsigned').checked});if(version!==state.previewVersion)return;
  $('eds-row-label').hidden=!result.rows;$('eds-row').max=result.rows||1;$('eds-unsigned-label').hidden=!result.unsigned_available;$('eds-preview-tools').hidden=!result.rows&&!result.unsigned_available;
  if(result.shape)$('eds-dataset-info').textContent=`${dimensions(result.shape)}${result.shape.length===1?' samples':''}${result.unit?' · '+result.unit:''}`;const root=$('eds-preview');if(result.kind==='image'){const img=el('img');img.src=result.image;img.alt=`Stored preview of ${d.path}`;root.append(img)}else if(result.kind==='plot'){drawPlot(root,result)}else if(result.sample!==undefined||result.value!==undefined){root.append(table([['Stored values',result.sample??result.value]]))}else root.append(el('p',result.note,'hint'));
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
$('eds-location').onsubmit=e=>{e.preventDefault();const path=$('eds-path').value.trim();if(/\.(h5oina|oipx?)$/i.test(path))openFile(path);else browse(path)};
$('eds-sources').onchange=e=>{if(e.target.value)browse(e.target.value)};$('eds-up').onclick=()=>browse(state.listing?.parent);$('eds-home').onclick=()=>browse(state.listing?.home||'');$('eds-filter').oninput=renderFiles;$('eds-row').onchange=preview;$('eds-unsigned').onchange=preview;$('eds-metadata').ontoggle=()=>{if($('eds-metadata').open)metadata()};
$('eds-compare').onclick=()=>openAnalysis(null,true);
$('eds-site-image').onchange=e=>loadSite(e.target.value);
$('eds-catalogue').onclick=()=>{if(!state.file)return;const blob=new Blob([JSON.stringify(state.file.catalogue,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),link=el('a');link.href=url;link.download=state.file.catalogue.source.path.split(/[\\/]/).at(-1)+'.catalogue.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
async function init(){try{const config=await api('config');state.token=config.token;$('eds-version').textContent=config.app_version;for(const source of config.sources||[]){const option=el('option',source.name||source.path);option.value=source.path;$('eds-sources').append(option)}const previous=saved();await browse(previous.folder||config.sources?.[0]?.path||'');if(previous.file)await openFile(previous.file,previous.dataset,previous.acquisition)}catch(error){status(error.message,true)}}
init();
})();

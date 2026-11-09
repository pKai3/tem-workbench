/* Approximate stage-coordinate map. This never changes analysis coordinates. */
(() => {
 const byId=id=>document.getElementById(id), dialog=byId('acquisition-map'), svg=byId('acquisition-canvas');
 const node=(name,attrs={},text)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n};
 let data=null, originId='', selectedFolder='', visible=[], reference=null, view=null, busy=false, drag=null, moved=false, request=0;
 const moveHistory=[];
 const previews=new Map(), hoverCache=new Map(), rotations=new Map(), placements=new Map(), decoded=new Map();
 let adjust=false,adjustId="",zoomOutLimit=Infinity, batchId="", scopedBatches=[];
 const selectionKey=(sample=null)=>`tem-acquisition-selection:${JSON.stringify([(config.state_namespace||config.data_root),sample])}`;
 function rememberSelection(){
  if(!data||busy)return;
  writePreference(selectionKey(),data.sample);
  writePreference(selectionKey(data.sample),{folder:selectedFolder,scope:byId('acquisition-scope').value,date:byId('acquisition-date').value,batch:batchId,reference:reference?.id||'',alignBatch:byId('acquisition-align-batch').value});
 }
 function restoreSelection(current,opening){
  const saved=readPreference(selectionKey(data.sample),null);
  // Opening/returning follows the analysis image, not a previous map visit.
  const state=opening&&current?{folder:current.folder,date:current.date,scope:'folder',batch:current.acquisition_batch,
   reference:field(current)?current.id:batchOf(current)?.reference_id}:(saved&&typeof saved==='object'?saved:{});
  const dates=[...new Set(data.files.map(f=>f.date))].sort();
  const date=dates.includes(state.date)||state.date==='*'?state.date:current?.date??'*';
  options(byId('acquisition-date'),[['*','All dates'],...dates.map(d=>[d,d||'Date unknown'])],date);
  const folders=data.files.filter(f=>date==='*'||f.date===date).map(f=>f.folder);
  selectedFolder=folders.includes(state.folder)?state.folder:current?.folder||'';
  byId('acquisition-scope').value=['folder','sample'].includes(state.scope)?state.scope:opening?'folder':'sample';
  batchId=typeof state.batch==='string'?state.batch:'';
  const ref=data.files.find(f=>f.id===state.reference);
  if(ref)options(byId('acquisition-reference'),[[ref.id,ref.name]],ref.id);
  const align=data.batches?.find(b=>b.id===state.alignBatch);
  if(align)options(byId('acquisition-align-batch'),[[align.id,batchLabel(align)]],align.id);
 }
 function openingSeed(){
  const sample=readPreference(selectionKey(),null);
  return config.files.find(f=>f.id===originId)||config.files.find(f=>f.sample===sample);
 }
 const batches=()=>data?.batches||[];
 const batchOf=f=>batches().find(b=>b.id===f?.acquisition_batch);
 const batchReference=b=>data?.files.find(f=>f.id===b?.reference_id);
 const batchLabel=b=>`${b.first??batchReference(b)?.name??"Unnumbered"}${b.last!==b.first?"–"+(b.last??"?"):""} · α ${tilt(b.alpha)}, β ${tilt(b.beta)} · ${b.members.length} images`;
 const rotationKey=()=>`tem-acquisition-rotation:${JSON.stringify([(config.state_namespace||config.data_root),reference.id])}`;
 function restoreRotation(){
  if(!reference)return;
  const key=rotationKey(), saved=rotations.has(key)?rotations.get(key):readPreference(key,0);
  const value=typeof saved==='number'&&Number.isFinite(saved)?saved:0;
  rotations.set(key,value);byId('acquisition-rotation').value=value;
 }
 function rememberRotation(){
  if(!reference)return;
  const value=byId('acquisition-rotation').valueAsNumber;
  if(!Number.isFinite(value)){restoreRotation();return}
  rotations.set(rotationKey(),value);writePreference(rotationKey(),value);update(false);
 }
 let treeSnapshot=null, treeMasterId=null, hoverTimer=0, hoverTicket=0;
 const card=byId('acquisition-hover');
 let highlighted=[];
 function highlight(files=[]){
  highlighted=files.map(f=>f.id);
  for(const el of svg.querySelectorAll('[data-image-ids]'))el.classList.toggle('is-hovered',JSON.parse(el.getAttribute('data-image-ids')).some(id=>highlighted.includes(id)));
 }
 function hideHover(){clearTimeout(hoverTimer);hoverTicket++;card.hidden=true;highlight()}
 function positionCard(e){
  const box=e.currentTarget?.getBoundingClientRect();
  const x=e.clientX??box?.right??20,y=e.clientY??box?.top??20;
  const w=card.offsetWidth,h=card.offsetHeight;
  card.style.left=`${Math.max(8,Math.min(x+18,innerWidth-w-8))}px`;
  card.style.top=`${Math.max(8,Math.min(y+18,innerHeight-h-8))}px`;
 }
 async function imageURL(url){
  if(!hoverCache.has(url)){
   const task=fetch(url).then(async res=>{
    if(!res.ok)throw Error('Preview unavailable');
    const blob=await res.blob();
    return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob)});
   });
   hoverCache.set(url,task);
   task.catch(()=>hoverCache.delete(url));
   if(hoverCache.size>20)hoverCache.delete(hoverCache.keys().next().value);
  }
  return hoverCache.get(url);
 }
 const placementKey=(f,ref=reference)=>`tem-acquisition-placement:${JSON.stringify([(config.state_namespace||config.data_root),ref.id,f.id])}`;
 function placement(f,ref=reference){
  if(!ref||f.id===ref.id)return null;
  const key=placementKey(f,ref);
  if(!placements.has(key)){const saved=readPreference(key,null);placements.set(key,saved&&Number.isFinite(saved.x)&&Number.isFinite(saved.y)?saved:null)}
  return placements.get(key);
 }
 function adjustable(){return visible.filter(f=>field(f)&&f.id!==reference?.id&&location(f))}
 function placementReference(f){return f.acquisition_batch===reference?.acquisition_batch||batchOf(f)?.reference_id===f.id?reference:batchReference(batchOf(f))}
 function syncBatchAlignment(){
  const all=batchId==='*';
  byId('acquisition-reference-label').textContent=all?'Master image':'Reference image';
  const candidates=scopedBatches.filter(b=>b.id!==reference?.acquisition_batch&&b.reference_id);
  options(byId('acquisition-align-batch'),candidates.map(b=>[b.id,batchLabel(b)]),byId('acquisition-align-batch').value);
  byId('acquisition-place-batch').disabled=!reference||!candidates.length;
  const anchor=batchReference(candidates.find(b=>b.id===byId('acquisition-align-batch').value));
  byId('acquisition-place-batch').textContent=anchor&&placement(anchor)?'Adjust batch on map':'Show batch for alignment';
  showAlignmentPreview(reference?anchor:null);
 }
 let alignmentPreviewId='';
 function showAlignmentPreview(anchor){
  const panel=byId('acquisition-align-preview'),im=byId('acquisition-align-image');
  panel.hidden=!anchor;
  if(!anchor){alignmentPreviewId='';im.hidden=true;return}
  byId('acquisition-align-info').textContent=`${anchor.name} · ${fmt(anchor.field_nm[0])} nm wide\n${placement(anchor)?'Placed relative to':'Will start at the centre of'} ${reference.name}. Drag to align; the whole batch moves together.`;
  if(alignmentPreviewId===anchor.id)return;
  alignmentPreviewId=anchor.id;im.hidden=true;
  imageURL(`/api/acquisition-preview?id=${encodeURIComponent(anchor.id)}`).then(url=>{if(alignmentPreviewId===anchor.id){im.src=url;im.hidden=false}}).catch(()=>{if(alignmentPreviewId===anchor.id)byId('acquisition-align-info').textContent+=' Preview unavailable.'});
 }
 function syncAdjustment(){
  if(!adjustable().some(f=>f.id===adjustId))adjustId='';
  const f=visible.find(f=>f.id===adjustId),manual=f&&placement(f,placementReference(f));
  syncBatchAlignment();
  const reset=byId('acquisition-reset-placement');
  reset.disabled=!manual;reset.textContent=f?`Reset ${number(f)}`:'Reset placement';
  reset.title=manual?`Reset saved placement of ${f.name}`:f?`${f.name} has no saved movement in this view`:'Hover an image on the map or tree to select its placement';
  byId('acquisition-placement-status').textContent=manual?`Manually placed · X ${fmt(manual.x)} µm, Y ${fmt(manual.y)} µm from reference centre (right/down). Saved on release.`:'Drag a footprint to place it; changes are remembered for this reference.';
  syncUndo();
  svg.classList.toggle('adjusting',adjust);
  if(adjust&&f)preview(f.id);
 }
 function cropDetails(f,ref=reference){
  const pos=location(f),parentPos=location(ref);
  if(!ref||!field(ref)||!field(f)||!pos||!parentPos)return {bounds:null,info:'No calibrated footprint or stage position for this comparison.',status:'Comparison unavailable'};
  const [x,y]=pos.map((v,i)=>v-parentPos[i]),[rw,rh]=ref.field_nm.map(v=>v/1000),[fw,fh]=f.field_nm.map(v=>v/1000);
  const bounds={x:(x-fw/2+rw/2)/rw,y:(y-fh/2+rh/2)/rh,w:fw/rw,h:fh/rh};
  const overlap=Math.max(0,Math.min(1,bounds.x+bounds.w)-Math.max(0,bounds.x))*Math.max(0,Math.min(1,bounds.y+bounds.h)-Math.max(0,bounds.y))/(bounds.w*bounds.h);
  let info=`${f.field_nm.map(fmt).join(' × ')} nm · crop from ${number(ref)} · about ${Math.round(bounds.w*ref.width)} × ${Math.round(bounds.h*ref.height)} source pixels. ${placement(f)||placement(ref)?'Manual placement.':'Approximate placement.'}`;
  if(overlap<.999)info+=` ${Math.round(overlap*100)}% inside source; outside areas are black.`;
  return {bounds:overlap?bounds:null,info,status:overlap?'Loading…':'Outside source'};
 }
 function comparisonParents(f,mode=byId('acquisition-crop-source').value){
  if(!field(f))return []; // Diffraction calibration does not define a specimen footprint.
  const chain=treePath(f).slice(0,-1);
  if(!chain?.length)return []; // Tree roots and their alternate captures do not crop themselves.
  const parents=chain.map(g=>g.files.find(x=>x.id===reference?.id)||g.files.find(x=>x.id===groupChoices.get(g.files[0].id))||g.files[0]).reverse();
  if(mode==='current'){
   if(footprintPeers(f).some(x=>x.id===reference?.id))return [];
   const end=parents.findIndex(x=>x.id===reference?.id);
   return end<0?parents.slice(0,1):parents.slice(0,end+1);
  }
  if(mode==='master')return parents.slice(-1); // The root of this image's own tree.
  return mode==='all'?parents:parents.slice(0,1);
 }
 async function decodedPreview(id){
  if(!decoded.has(id)){
   const pending=imageURL(`/api/acquisition-preview?id=${encodeURIComponent(id)}`).then(url=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=url}));
   decoded.set(id,pending);pending.catch(()=>decoded.delete(id));if(decoded.size>8)decoded.delete(decoded.keys().next().value);
  }
  return decoded.get(id);
 }
 function showComparison(f,e,live=false){
  if(adjust||drag){hideHover();return}
  const parents=comparisonParents(f),ticket=++hoverTicket,ref=parents[0]||reference,detail=cropDetails(f,ref);
  const wasHidden=card.hidden;card.hidden=false;
  const peers=footprintPeers(f);
  byId('acquisition-hover-title').textContent=groupName({files:peers})+(peers.length>1?' · same location':'');
  byId('acquisition-hover-full-label').textContent=`${number(f)} · ${captureLabel(f)}`;
  const peerFigures=byId('acquisition-hover-peers');peerFigures.replaceChildren();
  const captures=byId('acquisition-hover-captures');captures.classList.toggle('stacked',peers.length>1);captures.style.setProperty('--capture-count',peers.length);
  const extras=byId('acquisition-hover-extras');extras.replaceChildren();
  for(const other of peers.filter(x=>x.id!==f.id)){
   const figure=document.createElement('figure'),caption=document.createElement('figcaption'),im=document.createElement('img');
   caption.textContent=`${number(other)} · ${captureLabel(other)}`;caption.title=other.name;im.alt=other.name;const frame=document.createElement('div');frame.append(im);figure.append(caption,frame);peerFigures.append(figure);
   imageURL(`/api/acquisition-preview?id=${encodeURIComponent(other.id)}`).then(url=>{if(ticket===hoverTicket)im.src=url}).catch(()=>{caption.textContent+=' · Preview unavailable'});
  }
  byId('acquisition-hover-crop').closest('figure').hidden=!parents.length;
  byId('acquisition-hover-crop-label').textContent=`Crop · ${ref?.name||'Reference'}`;
  function cropURL(parent,details){
   if(!live)return imageURL(`/api/acquisition-crop?${new URLSearchParams({id:parent.id,...details.bounds})}`);
   return decodedPreview(parent.id).then(im=>{
    const b=details.bounds,canvas=document.createElement('canvas');canvas.width=320;canvas.height=Math.max(1,Math.round(320*f.field_nm[1]/f.field_nm[0]));
    const ctx=canvas.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingEnabled=false;
    ctx.drawImage(im,b.x*im.width,b.y*im.height,b.w*im.width,b.h*im.height,0,0,canvas.width,canvas.height);return canvas.toDataURL();
   });
  }
  for(const parent of parents.slice(1)){
   const figure=document.createElement('figure'),caption=document.createElement('figcaption'),im=document.createElement('img'),details=cropDetails(f,parent);
   caption.textContent=`Crop · ${parent.name}`;caption.title=details.info;im.alt=`Crop of ${parent.name}`;figure.style.order='3';const frame=document.createElement('div');frame.append(im);figure.append(caption,frame);extras.append(figure);
   if(!details.bounds){im.hidden=true;const status=document.createElement('span');status.textContent=details.status;frame.append(status);continue}
   cropURL(parent,details).then(url=>{if(ticket===hoverTicket)im.src=url}).catch(()=>{if(ticket===hoverTicket){im.hidden=true;caption.textContent+=' · Preview unavailable'}});
  }
  card.style.width=`${Math.min(240*(1+parents.length)+20,innerWidth-28)}px`;
  byId('acquisition-hover-info').textContent=(!field(f)?'Specimen area unknown · stage location only; no real-space crop available.':parents.length?detail.info:peers.length>1?'Same footprint · alternate captures':'Full image')+(live?' Live preview; original-pixel crop loads on release.':'');
  const render=async(type,promise)=>{try{const url=await promise;if(ticket!==hoverTicket)return;const im=byId(`acquisition-hover-${type}`);im.src=url;im.hidden=false;byId(`acquisition-hover-${type}-status`).textContent=''}catch{if(ticket===hoverTicket)byId(`acquisition-hover-${type}-status`).textContent='Preview unavailable'}};
  if(wasHidden){for(const type of ['full','crop']){byId(`acquisition-hover-${type}`).hidden=true;byId(`acquisition-hover-${type}-status`).textContent='Loading…'}}
  render('full',imageURL(`/api/acquisition-preview?id=${encodeURIComponent(f.id)}`));
  if(!parents.length){/* No reference self-crop. */}
  else if(!detail.bounds){byId('acquisition-hover-crop').hidden=true;byId('acquisition-hover-crop-status').textContent=detail.status}
  else render('crop',cropURL(ref,detail));
  positionCard(e);
 }
 function selectPlacementTarget(f){
  if(!drag&&f.id!==reference?.id&&field(f)&&location(f)&&adjustId!==f.id){adjustId=f.id;syncAdjustment()}
 }
 function hover(f,e){
  byId('acquisition-detail').textContent=title(f).replaceAll('\n',' · ');
  if(drag)return;
  selectPlacementTarget(f);
  hideHover();const peers=footprintPeers(f);highlight(peers);if(f.id===reference?.id&&peers.length===1)return;
  hoverTimer=setTimeout(()=>showComparison(f,e),180);
 }
 function chooseImage(f){if(adjust){adjustId=f.id;hideHover();syncAdjustment();draw()}else selectReference(f)}
 function bindHover(el,f){el.onmouseenter=e=>hover(f,e);el.onmouseleave=()=>{if(!drag?.image)hideHover()};el.onfocus=e=>hover(f,e);el.onblur=hideHover}
 function navigation(){
  const depth=Math.max(0,treePath(reference).length-1);
  byId('acquisition-back').disabled=!depth;
  byId('acquisition-level').textContent=reference?`${depth?'Level '+depth:'Overview'} · ${number(reference)}`:'No reference';
 }
 function selectReference(f){
  if(moved||f.id===reference?.id)return;
  if(!field(f)){byId('acquisition-detail').textContent='This image has no calibrated real-space footprint. Use Open to analyze it.';return}
  if(f.acquisition_batch===reference?.acquisition_batch&&footprintPeers(reference).some(x=>x.id===f.id)){
   // Alternate capture of the same footprint: change backdrop, not navigation level or coordinate frame.
   const oldRef=reference,angle=Number(byId('acquisition-rotation').value)||0;
   for(const image of visible){const manual=placement(image,oldRef);if(manual&&image.id!==f.id){const key=placementKey(image,f);placements.set(key,{...manual});writePreference(key,{...manual})}}
   const key=`tem-acquisition-rotation:${JSON.stringify([(config.state_namespace||config.data_root),f.id])}`;rotations.set(key,angle);writePreference(key,angle);
   options(byId('acquisition-reference'),[[f.id,f.name]],f.id);update(false,true);return;
  }
  spatialTree(); // Retain hierarchy only if the next view has equivalent placements.
  options(byId('acquisition-reference'),[[f.id,f.name]],f.id);update(false,true);fit(true);
 }

 async function preview(id){
  if(previews.has(id))return;
  previews.set(id,null);
  try{const res=await fetch(`/api/acquisition-preview?id=${encodeURIComponent(id)}`);if(!res.ok)throw Error('Overview preview unavailable');const blob=await res.blob();const url=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob)});previews.set(id,url);if(visible.some(f=>f.id===id))draw()}catch(e){previews.set(id,'');if(reference?.id===id)byId('acquisition-status').textContent+=' Overview preview unavailable.'}
 }
 const positioned=f=>Number.isFinite(f.stage_position?.x)&&Number.isFinite(f.stage_position?.y);
 const field=f=>Array.isArray(f.field_nm)&&f.field_nm.every(x=>Number.isFinite(x)&&x>0);
 const number=f=>{const n=acquisitionNumber(f);return Number.isFinite(n)?String(n):(f.name.length>30?f.name.slice(0,27)+"…":f.name)};
 const coord=n=>Number.isFinite(n)?String(Number(n.toPrecision(9))):'unknown';
 const tilt=n=>Number.isFinite(n)?(String(n).replace(/[-.e+]/g,'').replace(/^0+/,'').length<3?n.toPrecision(3):String(n)):'unknown';
 const fmt=n=>Number(n).toPrecision(4).replace(/\.0+$/, '');
 function options(select,rows,value){select.replaceChildren();for(const [id,label] of rows){const o=document.createElement('option');o.value=id;o.textContent=label;select.append(o)}select.value=rows.some(r=>r[0]===value)?value:rows[0]?.[0]??''}
 function openImage(f){if(moved)return;dialog.close();clearFileSearch();byId('file').value=f.id;openFile()}
 function title(f){const p=f.stage_position;return `${f.name}\n${f.folder}\n${f.date} ${f.time}\nStage X ${coord(p.x)}, Y ${coord(p.y)} (raw); α ${tilt(p.alpha)}, β ${tilt(p.beta)}\n${field(f)?f.field_nm.map(fmt).join(' × ')+' nm':'No real-space footprint'}`}
 // Group only identical calibrated footprints. Point-only records remain independent.
 function footprintGroups(files=visible){
  const groups=[];
  for(const f of files){
   const pos=location(f),rect=pos&&field(f)?[...pos,...f.field_nm.map(v=>v/1000)]:null;
   const same=rect&&groups.find(g=>g.rect&&g.rect.every((v,i)=>Math.abs(v-rect[i])<=1e-10));
   if(same)same.files.push(f);else groups.push({files:[f],rect,pos,children:[]});
  }
  return groups;
 }
 function footprintPeers(f){return footprintGroups().find(g=>g.files.some(x=>x.id===f.id))?.files||[f]}
 const captureLabel=f=>f.name.match(/(?:^|_)(ADF|Hitachi|OneView)(?:_|$)/i)?.[1]||f.name;
 const groupName=g=>{
  const files=[...g.files].sort((a,b)=>acquisitionNumber(a)-acquisitionNumber(b)||a.name.localeCompare(b.name));
  const numbers=[...new Set(files.map(number))],kinds=[...new Set(files.map(captureLabel))];
  return numbers.join('/')+(files.length>1&&kinds.length>1&&kinds.every(k=>!files.some(f=>f.name===k))?` (${kinds.join(' & ')})`:'');
 };
 function overlaps(parent,child){
  if(!parent.rect||!child.pos)return false;
  const [x,y,w,h]=parent.rect,[cx,cy]=child.pos,[cw,ch]=child.rect?.slice(2)||[0,0];
  return cw&&ch?Math.abs(x-cx)<(w+cw)/2&&Math.abs(y-cy)<(h+ch)/2:Math.abs(x-cx)<=w/2&&Math.abs(y-cy)<=h/2;
 }
 function placementFingerprint(){
  // Ignore a common origin shift, but detect reference-specific saved movements.
  const rows=visible.map(f=>({id:f.id,pos:location(f),size:field(f)?f.field_nm:null})).sort((a,b)=>a.id.localeCompare(b.id));
  const origin=rows.find(r=>r.pos)?.pos||[0,0];
  return JSON.stringify(rows.map(r=>[r.id,r.pos?.map((v,i)=>Math.round((v-origin[i])*1e9)),r.size]));
 }
 function spatialTree(){
  if(drag?.image&&treeSnapshot)return treeSnapshot;
  const fingerprint=placementFingerprint();
  if(treeSnapshot?.fingerprint===fingerprint)return treeSnapshot;
  const groups=footprintGroups(),root=groups.find(g=>g.files.some(f=>f.id===(treeMasterId||reference?.id)));
  const unplaced=groups.filter(g=>!g.pos),placed=groups.filter(g=>g.pos),roots=[];
  const area=g=>g.rect?g.rect[2]*g.rect[3]:0;
  // Count eligible smaller footprints before attaching them, avoiding order-dependent ties.
  const childCounts=new Map(placed.map(p=>[p,placed.filter(c=>area(p)>area(c)&&overlaps(p,c)).length]));
  for(const g of placed){
   // Parentage depends on footprint size, never on the current viewing reference.
   const parent=placed.filter(p=>p!==g&&area(p)>area(g)&&overlaps(p,g)).sort((a,b)=>area(a)-area(b)||childCounts.get(b)-childCounts.get(a))[0];
   if(parent)parent.children.push(g);else roots.push(g);
  }
  roots.sort((a,b)=>(a===root?-1:b===root?1:0)||area(b)-area(a));
  return treeSnapshot={root,roots,unplaced,fingerprint};
 }
 function treePath(f){
  if(!f)return [];
  function visit(g){if(g.files.some(x=>x.id===f.id))return [g];for(const child of g.children){const below=visit(child);if(below)return [g,...below]}return null}
  for(const root of spatialTree().roots){const path=visit(root);if(path)return path}return [];
 }
 function parentImage(f=reference){const path=treePath(f),g=path.at(-2);return g&&(g.files.find(x=>x.id===groupChoices.get(g.files[0].id))||g.files[0])}
 const treeExpanded=new Map(),groupChoices=new Map(),groupSelectors=new Map();
 function chooseGroup(g){
  if(g.files.length===1){chooseImage(g.files[0]);return}
  const select=groupSelectors.get(g.files[0].id);select?.focus();select?.scrollIntoView({block:'nearest'});
  byId('acquisition-detail').textContent=`${groupName(g)} share this footprint. Choose an image in the tree, then Use reference.`;
 }
 const leavesFirst=items=>[...items].sort((a,b)=>Number(a.children.length>0)-Number(b.children.length>0));
 function renderImageTree(){
  const list=byId('acquisition-list');list.replaceChildren();groupSelectors.clear();
  function branch(parent,items,key,label){
   if(!items.length)return;
   const details=document.createElement('details');details.className='acquisition-tree-branch';details.open=treeExpanded.get(key)??true;
   details.addEventListener('toggle',()=>treeExpanded.set(key,details.open));
   const summary=document.createElement('summary');summary.textContent=label;
   const ul=document.createElement('ul');ul.append(...leavesFirst(items).map(entry));details.append(summary,ul);parent.append(details);
  }
  function entry(g){
   const li=document.createElement('li'),row=document.createElement('div');row.className='acquisition-entry';
   row.setAttribute('data-image-ids',JSON.stringify(g.files.map(f=>f.id)));
   const isRoot=g.files.some(f=>f.id===reference?.id),key=g.files[0].id;
   let f=g.files.find(f=>f.id===groupChoices.get(key))||(isRoot?reference:g.files[0]);
   if(isRoot)row.classList.add('acquisition-tree-reference');
   const box=document.createElement('div');box.className='acquisition-tree-image';
   if(g.files.length>1){
    const label=document.createElement('strong');label.textContent=groupName(g);box.append(label);
    const select=document.createElement('select');select.setAttribute('aria-label',`Choose image at ${groupName(g)}`);
    options(select,g.files.map(x=>[x.id,x.name]),f.id);for(const member of g.files)groupSelectors.set(member.id,select);
    select.onchange=()=>{f=g.files.find(x=>x.id===select.value);groupChoices.set(key,f.id);use.title=title(f);use.textContent=f.id===reference?.id?'Current reference':'Use reference'};
    box.append(select);
   }
   const use=document.createElement('button');use.type='button';use.textContent=g.files.length>1?(f.id===reference?.id?'Current reference':'Use reference'):f.name;
   if(g.files.some(f=>f.id===originId))use.setAttribute('aria-current','true');
   use.title=title(f);use.onclick=()=>{moved=false;chooseImage(f)};
   row.onmouseenter=()=>{highlight(g.files);selectPlacementTarget(f)};row.onmouseleave=()=>{if(!drag?.image)hideHover()};
   use.onfocus=()=>{highlight(g.files);selectPlacementTarget(f)};use.onblur=hideHover;box.append(use);
   const sub=document.createElement('small');sub.textContent=[g.files.some(f=>f.id===originId)?'Current image':'',isRoot?'Reference image':'',!g.pos?'Not placed':g.rect?`${fmt(f.field_nm[0])} nm wide`:'Point only'].filter(Boolean).join(' · ');box.append(sub);
   const open=document.createElement('button');open.type='button';open.textContent='Open';open.title='Open selected image for analysis';open.onclick=()=>{moved=false;openImage(f)};
   open.onmouseenter=e=>hover(f,e);open.onmouseleave=hideHover;open.onfocus=e=>hover(f,e);open.onblur=hideHover;
   row.append(box,open);li.append(row);
   branch(li,g.children,`${treeMasterId}:${key}`,'Within this image');return li;
  }
  const tree=spatialTree(),ul=document.createElement('ul');ul.className='acquisition-tree';ul.append(...[...tree.roots.filter(g=>g===tree.root),...leavesFirst(tree.roots.filter(g=>g!==tree.root))].map(entry));list.append(ul);
  branch(list,tree.unplaced,`${treeMasterId}:unplaced`,'Not placed');
 }
 function referenceChildCount(candidate,files){
  const key=`tem-acquisition-rotation:${JSON.stringify([(config.state_namespace||config.data_root),candidate.id])}`;
  const rotation=rotations.has(key)?rotations.get(key):readPreference(key,0);
  const parent={rect:[0,0,...candidate.field_nm.map(v=>v/1000)]};
  // Coincident alternate captures count as one footprint, not extra children.
  const footprints=new Set();
  for(const f of files){
   if(f.id===candidate.id||f.acquisition_batch!==candidate.acquisition_batch)continue;
   if(field(f)&&f.field_nm[0]*f.field_nm[1]>=candidate.field_nm[0]*candidate.field_nm[1])continue;
   const manual=placement(f,candidate),pos=manual?[manual.x,manual.y]:stageOffset(f,candidate,Number(rotation)||0);
   if(!pos)continue;
   const rect=field(f)?[...pos,...f.field_nm.map(v=>v/1000)]:null;
   if(overlaps(parent,{pos,rect}))footprints.add(JSON.stringify(rect||pos));
  }
  return footprints.size;
 }
 function update(reset=true,preserveTree=false){
  if(!data)return;
  if(!preserveTree)treeSnapshot=null;hideHover();
  const date=byId('acquisition-date').value;
  const dated=data.files.filter(f=>date==='*'||f.date===date);
  const folders=[...new Set(dated.map(f=>f.folder))].sort();
  options(byId('acquisition-folder'),folders.map(f=>[f,f||'(root)']),selectedFolder);
  selectedFolder=byId('acquisition-folder').value;
  const scoped=dated.filter(f=>byId('acquisition-scope').value==='sample'||f.folder===selectedFolder);
  const scopedIds=new Set(scoped.map(f=>f.id));
  scopedBatches=batches().filter(b=>b.members.some(id=>scopedIds.has(id)));
  if(!scopedBatches.some(b=>b.id===batchId)&&batchId!=='*')batchId=scopedBatches.find(b=>b.members.includes(originId))?.id||scopedBatches[0]?.id||'';
  options(byId('acquisition-batch'),[['*','All acquisition batches'],...scopedBatches.map(b=>[b.id,batchLabel(b)])],batchId);
  visible=scoped.filter(f=>batchId==='*'||f.acquisition_batch===batchId);
  const counts=new Map();
  const count=f=>{if(!counts.has(f.id))counts.set(f.id,referenceChildCount(f,visible));return counts.get(f.id)};
  const refs=visible.filter(f=>field(f)&&(batchId!=='*'||location(f)||scopedBatches.some(b=>b.reference_id===f.id)))
   .sort((a,b)=>b.field_nm[0]*b.field_nm[1]-a.field_nm[0]*a.field_nm[1]||count(b)-count(a));
  const old=byId('acquisition-reference').value;
  const preferred=refs.some(f=>f.id===old)?old:refs[0]?.id;
  options(byId('acquisition-reference'),refs.map(f=>[f.id,`${f.name} · ${fmt(f.field_nm[0])} nm wide`]),preferred);
  reference=refs.find(f=>f.id===byId('acquisition-reference').value)||null;
  if(!treeMasterId)treeMasterId=reference?.id;
  restoreRotation();
  const placed=visible.filter(f=>location(f));
  byId('acquisition-status').textContent=!data.batches?'Restart TEM Workbench to enable tilt batches.':`${data.sample} · ${scopedBatches.length} batches · ${placed.length}/${visible.length} images placed${batchId==='*'?' · Unaligned batches stay off the map until placed.':' · Matching tilts permit a stage estimate; verify alignment.'}`;
  renderImageTree();
  navigation();syncAdjustment();rememberSelection();
  if(reference&&field(reference))preview(reference.id);
  if(reset)fit(false);else draw();
 }
 function stageOffset(f,anchor,rotation){
  if(f.id===anchor.id)return [0,0];
  if(!positioned(f)||!positioned(anchor)||!f.acquisition_batch||f.acquisition_batch!==anchor.acquisition_batch)return null;
  const factor=Number(byId('acquisition-units').value)/1000;
  let x=(f.stage_position.x-anchor.stage_position.x)*factor,y=(f.stage_position.y-anchor.stage_position.y)*factor;
  if(byId('acquisition-flip-x').checked)x=-x;if(byId('acquisition-flip-y').checked)y=-y;
  const angle=rotation*Math.PI/180;
  return [x*Math.cos(angle)-y*Math.sin(angle),-(x*Math.sin(angle)+y*Math.cos(angle))];
 }
 function location(f){
  if(!reference||!f)return null;
  if(f.id===reference.id)return [0,0];
  if(f.acquisition_batch===reference.acquisition_batch){
   const manual=placement(f);return manual?[manual.x,manual.y]:stageOffset(f,reference,Number(byId('acquisition-rotation').value)||0);
  }
  // Across tilt/sequence boundaries, ONLY a manually positioned batch anchor connects coordinates.
  const anchor=batchReference(batchOf(f)),offset=anchor&&placement(anchor);
  if(!offset)return null;
  const key=`tem-acquisition-rotation:${JSON.stringify([(config.state_namespace||config.data_root),anchor.id])}`;
  const rotation=rotations.has(key)?rotations.get(key):readPreference(key,0);
  const local=placement(f,anchor);
  const delta=local?[local.x,local.y]:stageOffset(f,anchor,Number(rotation)||0);
  return delta?[offset.x+delta[0],offset.y+delta[1]]:null;
 }
 // Apply the same level filter to fitting and drawing, before viewport clipping.
 function mappedImages(){return visible.filter(f=>location(f)&&((adjust&&f.id===adjustId)||!(treePath(reference).length>1&&field(f)&&field(reference)&&f.field_nm[0]*f.field_nm[1]>reference.field_nm[0]*reference.field_nm[1]*1.001)))}
 function fittedView(overview=false){
  if(!reference)return null;
  let loX=Infinity,loY=Infinity,hiX=-Infinity,hiY=-Infinity;
  for(const f of overview?[reference]:[reference,...mappedImages()]){
   const [x,y]=location(f),[w,h]=field(f)?f.field_nm.map(v=>v/1000):[0,0];
   loX=Math.min(loX,x-w/2);hiX=Math.max(hiX,x+w/2);loY=Math.min(loY,y-h/2);hiY=Math.max(hiY,y+h/2);
  }
  const width=Math.max(hiX-loX,(hiY-loY)*800/620,.01)*1.15;
  return {x:(loX+hiX-width)/2,y:(loY+hiY-width*620/800)/2,w:width,h:width*620/800};
 }
 function fit(overview){
  hideHover();view=fittedView(overview);
  zoomOutLimit=(fittedView()?.w||0)*2;
  draw();
 }
 function outsideReferenceFraction(f){
  if(!field(f)||!field(reference))return 0;
  const pos=location(f);if(!pos)return 0;
  const [w,h]=f.field_nm.map(v=>v/1000),[rw,rh]=reference.field_nm.map(v=>v/1000),[x,y]=pos;
  const overlap=Math.max(0,Math.min(x+w/2,rw/2)-Math.max(x-w/2,-rw/2))*Math.max(0,Math.min(y+h/2,rh/2)-Math.max(y-h/2,-rh/2));
  return 1-overlap/(w*h);
 }
 function draw(){
  svg.replaceChildren();
  if(!view||!reference){svg.append(node('text',{x:30,y:50,fill:'#9aacbc','font-size':18},busy?'Reading metadata…':'No calibrated reference image in this selection.'));return}
  const sx=x=>(x-view.x)*800/view.w,sy=y=>(y-view.y)*620/view.h;
  if(field(reference)){
   const [w,h]=reference.field_nm.map(v=>v/1000);
   const im=node('image',{x:sx(-w/2),y:sy(-h/2),width:w*800/view.w,height:h*620/view.h,preserveAspectRatio:'none',opacity:'.65',href:previews.get(reference.id)||'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E'});
   im.addEventListener('error',()=>{byId('acquisition-status').textContent+=' Overview preview unavailable.'},{once:true});svg.append(im);
   svg.append(node('rect',{x:sx(-w/2),y:sy(-h/2),width:w*800/view.w,height:h*620/view.h,class:'location reference-outline','data-image-ids':JSON.stringify([reference.id]),'pointer-events':'none',fill:'none',stroke:reference.id===originId?'#ff8197':'#fff','stroke-dasharray':'5 5'}));
  }
  const placed=mappedImages().sort((a,b)=>adjust?(Number(a.id===adjustId)-Number(b.id===adjustId)||((b.field_nm?.[0]||0)-(a.field_nm?.[0]||0))):((b.field_nm?.[0]||0)-(a.field_nm?.[0]||0)));
  const usedLabels=new Set();
  for(const group of footprintGroups(placed)){
   const f=group.files.find(x=>x.id===adjustId&&adjust)||group.files.find(x=>x.id===reference.id)||group.files[0];
   if(f.id===reference.id)continue;
   const [x,y]=location(f), px=sx(x),py=sy(y);const colour=f.id===originId?'#ff8197':field(f)?'#7abaff':'#ffc36b';
   const [w,h]=field(f)?f.field_nm.map(v=>v/1000):[0,0],pw=w*800/view.w,ph=h*620/view.h;
   if(px+pw/2<0||px-pw/2>800||py+ph/2<0||py-ph/2>620)continue;
   const g=node('g',{class:'location','data-image-id':f.id,'data-image-ids':JSON.stringify(group.files.map(x=>x.id)),tabindex:'0',role:'button','aria-label':`Use ${f.name} as reference`});
   if(placement(f))g.setAttribute('data-manual','true');
   if(adjust&&f.id===adjustId)g.setAttribute('data-selected','true');
   const showImage=field(f)&&((adjust&&f.id===adjustId)||outsideReferenceFraction(f)>.5);
   if(showImage&&!previews.has(f.id))preview(f.id);
   if(showImage&&previews.get(f.id))g.append(node('image',{x:px-pw/2,y:py-ph/2,width:pw,height:ph,preserveAspectRatio:'none',opacity:'.5',href:previews.get(f.id),'pointer-events':'none'}));
   if(field(f))g.append(node('rect',{x:px-pw/2,y:py-ph/2,width:pw,height:ph,fill:colour,'fill-opacity':'.09',stroke:colour,'stroke-width':1}));
   const markerX=px+pw/2,markerY=py-ph/2;
   g.append(node('circle',{cx:markerX,cy:markerY,r:4,fill:colour,stroke:'#080d13','stroke-width':1}));
   // Do not stack unreadable labels at identical / nearly identical recorded positions.
   const key=`${Math.round(markerX/50)},${Math.round(markerY/18)}`;
   if(!usedLabels.has(key)){g.append(node('text',{x:markerX-7,y:markerY-6,'text-anchor':'end',fill:colour,'font-size':12,'paint-order':'stroke',stroke:'#080d13','stroke-width':3},groupName(group)+(placement(f)?' · manual':'')));usedLabels.add(key)}
   g.onclick=()=>{if(!moved){if(adjust)chooseImage(f);else chooseGroup(group)}};g.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();moved=false;chooseGroup(group)}};
   bindHover(g,f);svg.append(g);
  }
  // Draw the reference identifier last so overlapping footprints cannot hide it.
  if(field(reference)){
   const peers=footprintPeers(reference),x=sx(reference.field_nm[0]/2000),y=sy(-reference.field_nm[1]/2000);
   const colour=peers.some(f=>f.id===originId)?'#ff8197':'#7abaff';
   const label=node('g',{class:'location','data-image-ids':JSON.stringify(peers.map(f=>f.id)),tabindex:'0'});
   label.append(node('circle',{cx:x,cy:y,r:4,fill:colour}),node('text',{x:x-7,y:y-6,'text-anchor':'end',fill:colour,'font-size':12,'paint-order':'stroke',stroke:'#080d13','stroke-width':3},groupName({files:peers})));
   bindHover(label,reference);svg.append(label);
  }
  highlight(visible.filter(f=>highlighted.includes(f.id)));
  const bar=view.w/5;
  svg.append(node('rect',{x:8,y:578,width:270,height:36,fill:'#080d13',opacity:.88}));
  svg.append(node('path',{d:'M 20 601 h 160',stroke:'#fff','stroke-width':2}));
  svg.append(node('text',{x:20,y:593,fill:'#fff','font-size':12},`${fmt(bar)} µm · approximate`));
 }
 async function loadSample(seedId,opening=false){
  const ticket=++request;
  moveHistory.length=0;syncUndo();
  busy=true;treeSnapshot=null;treeMasterId=null;batchId='';scopedBatches=[];hideHover();drag=null;moved=false;adjustId='';
  data=null;view=null;reference=null;visible=[];
  for(const id of ['acquisition-folder','acquisition-date','acquisition-reference','acquisition-batch','acquisition-align-batch','acquisition-list','acquisition-error-list'])byId(id).replaceChildren();
  byId('acquisition-errors').hidden=true;
  byId('acquisition-reset-placement').disabled=true;
  byId('acquisition-detail').textContent='';byId('acquisition-placement-status').textContent='';
  byId('acquisition-status').textContent='Reading stage metadata for this labelled sample…';
  navigation();draw();
  try{
   const result=await api(`acquisition-map?id=${encodeURIComponent(seedId)}`);if(ticket!==request)return;data=result;
   const current=opening?data.files.find(f=>f.id===originId):null;
   restoreSelection(current,opening);
   byId('acquisition-errors').hidden=!data.errors.length;for(const err of data.errors){const p=document.createElement('p');p.textContent=`${err.name}: ${err.error}`;byId('acquisition-error-list').append(p)}
   busy=false;update();if(current)frameCurrentImage(current);
  }catch(e){if(ticket===request){busy=false;byId('acquisition-status').textContent=e.message;draw()}}
  finally{if(ticket===request)busy=false}
 }
 function frameCurrentImage(current){
  const group=footprintGroups().find(g=>g.files.some(f=>f.id===current.id));
  if(group)groupChoices.set(group.files[0].id,current.id);
  for(const ancestor of treePath(current))treeExpanded.set(`${treeMasterId}:${ancestor.files[0].id}`,true);
  treeExpanded.set(`${treeMasterId}:unplaced`,true);
  renderImageTree();fit(field(current));
  const row=[...byId('acquisition-list').querySelectorAll('[data-image-ids]')].find(el=>JSON.parse(el.getAttribute('data-image-ids')).includes(current.id));
  row?.scrollIntoView({block:'nearest'});
  byId('acquisition-detail').textContent=`Current image: ${current.name}`+(!field(current)?' · No calibrated real-space footprint; shown in its acquisition batch.':'');
 }
 function showCurrentImage({reload=false}={}){
  if(!fileId)return;
  originId=fileId;
  const samples=[...new Set(config.files.map(f=>f.sample))].sort((a,b)=>a.localeCompare(b));
  const seed=openingSeed();
  options(byId('acquisition-sample'),samples.map(s=>[s,s||'Unlabelled']),seed?.sample);
  const current=data?.files.find(f=>f.id===originId);
  if(current&&!busy&&!reload){
   treeMasterId=null;treeSnapshot=null;moved=false;adjustId='';
   restoreSelection(current,true);update();frameCurrentImage(current);
   return;
  }
  return loadSample(seed?.id||originId,true);
 }
 const cropMode=readPreference('tem-acquisition-crop-source','closest');
 byId('acquisition-crop-source').value=['closest','master','all','current'].includes(cropMode)?cropMode:'closest';
 byId('acquisition-crop-source').onchange=()=>{writePreference('tem-acquisition-crop-source',byId('acquisition-crop-source').value);hideHover()};
 // Snapshot descendants before dragging so the move scope cannot change mid-drag.
 function startPlacementMove(f,withChildren,wholeBatch=false){
  const group=treePath(f).at(-1),ids=new Set([f.id]);
  function collect(g){for(const member of g.files)ids.add(member.id);if(withChildren)g.children.forEach(collect)}
  if(group)collect(group);
  if(wholeBatch){ids.clear();for(const member of visible)if(member.acquisition_batch===f.acquisition_batch&&member.id!==reference.id)ids.add(member.id)}
  return {positions:visible.map(image=>({image,pos:location(image)})).filter(item=>item.pos),ids,changes:new Map()};
 }
 function applyPlacementMove(move,dx,dy){
  function set(image,ref,value){
   const key=placementKey(image,ref);
   if(!move.changes.has(key))move.changes.set(key,placement(image,ref));
   placements.set(key,value);
  }
  const targets=move.positions.map(({image,pos})=>({image,pos:[pos[0]+(move.ids.has(image.id)?dx:0),pos[1]+(move.ids.has(image.id)?dy:0)]}));
  // Update anchors first, then compensate stationary members or move descendants.
  targets.sort((a,b)=>Number(batchOf(b.image)?.reference_id===b.image.id)-Number(batchOf(a.image)?.reference_id===a.image.id));
  for(const {image,pos} of targets){
   if(image.id===reference.id)continue;
   const now=location(image);if(now&&Math.hypot(now[0]-pos[0],now[1]-pos[1])<1e-12)continue;
   if(image.acquisition_batch===reference.acquisition_batch||batchOf(image)?.reference_id===image.id)set(image,reference,{x:pos[0],y:pos[1]});
   else{
    const anchor=batchReference(batchOf(image)),base=location(anchor);
    if(base)set(image,anchor,{x:pos[0]-base[0],y:pos[1]-base[1]});
   }
  }
 }
 function syncUndo(){const button=byId('acquisition-undo-move');button.disabled=!moveHistory.length||!!drag;}
 function finishPlacementMove(move,save){
  const changed=new Map([...move.changes].filter(([key,prior])=>JSON.stringify(prior)!==JSON.stringify(placements.get(key))));
  for(const [key,prior] of move.changes){if(save)writePreference(key,placements.get(key));else placements.set(key,prior)}
  if(save&&changed.size){moveHistory.push(changed);if(moveHistory.length>50)moveHistory.shift()}
  syncUndo();
 }
 function undoPlacementMove(){
  if(drag||!moveHistory.length)return;
  for(const [key,prior] of moveHistory.pop()){placements.set(key,prior);writePreference(key,prior)}
  hideHover();treeSnapshot=null;update(false);syncUndo();
 }
 // Edge picking ignores SVG paint order. Use screen pixels so zoom cannot shrink the grab area.
 function boundaryTarget(p,screenScale=1){
  let best=null,distance=9,area=Infinity;
  for(const f of adjustable()){
   const [x,y]=location(f),[w,h]=f.field_nm.map(v=>v/1000);
   const left=(x-w/2-view.x)*800/view.w,top=(y-h/2-view.y)*620/view.h;
   const right=left+w*800/view.w,bottom=top+h*620/view.h;
   const dx=Math.max(left-p.x,0,p.x-right),dy=Math.max(top-p.y,0,p.y-bottom);
   const inside=dx===0&&dy===0;
   const d=(inside?Math.min(p.x-left,right-p.x,p.y-top,bottom-p.y):Math.hypot(dx,dy))*screenScale;
   if(d<distance-1e-6||(Math.abs(d-distance)<1e-6&&w*h<area)){best=f;distance=d;area=w*h}
  }
  return best;
 }
 function pointerImage(e,p){
  const matrix=svg.getScreenCTM(),edge=adjust&&boundaryTarget(p,Math.hypot(matrix.a,matrix.b));
  return edge||visible.find(f=>f.id===e.target.closest('[data-image-id]')?.getAttribute('data-image-id'));
 }
 byId('acquisition-map-open').onclick=()=>{
  if(!fileId)return;
  dialog.showModal();return showCurrentImage({reload:true});
 };
 byId('acquisition-current').onclick=()=>showCurrentImage();
 byId('acquisition-sample').onchange=()=>{
  const seed=config.files.find(f=>f.sample===byId('acquisition-sample').value);
  if(seed)return loadSample(seed.id);
 };
 byId('acquisition-undo-move').onclick=undoPlacementMove;
 dialog.addEventListener('keydown',e=>{
  if(!dialog.open||e.defaultPrevented||e.shiftKey||e.altKey||!(e.metaKey||e.ctrlKey)||e.key.toLowerCase()!=='z'||e.target.closest('input,textarea,[contenteditable="true"]'))return;
  if(moveHistory.length&&!drag){e.preventDefault();e.stopPropagation();undoPlacementMove()}
 });
 byId('acquisition-map-close').onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>{++request;busy=false;hideHover()});
 byId('acquisition-back').onclick=()=>{const parent=parentImage();if(parent){moved=false;selectReference(parent)}};
 byId('acquisition-folder').onchange=()=>{selectedFolder=byId('acquisition-folder').value;byId('acquisition-scope').value='folder';treeSnapshot=null;treeMasterId=null;batchId='';byId('acquisition-reference').replaceChildren();update()};
 for(const id of ['acquisition-scope','acquisition-date'])byId(id).onchange=()=>{treeSnapshot=null;treeMasterId=null;batchId='';byId('acquisition-reference').replaceChildren();update()};
 byId('acquisition-batch').onchange=()=>{batchId=byId('acquisition-batch').value;treeSnapshot=null;treeMasterId=null;byId('acquisition-reference').replaceChildren();update();fit(true)};
 byId('acquisition-align-batch').onchange=()=>{syncBatchAlignment();rememberSelection()};
 byId('acquisition-place-batch').onclick=()=>{
  const anchor=batchReference(scopedBatches.find(b=>b.id===byId('acquisition-align-batch').value));
  if(!anchor||!reference)return;
  if(!placement(anchor)){const value={x:0,y:0};placements.set(placementKey(anchor),value);writePreference(placementKey(anchor),value)}
  batchId='*';adjust=true;byId('acquisition-adjust').checked=true;byId('acquisition-move-scope').value='batch';adjustId=anchor.id;update(false);fit(false);
  byId('acquisition-placement-controls').open=true;svg.scrollIntoView({block:'nearest'});
  byId('acquisition-detail').textContent=`Drag the translucent ${anchor.name} image to align it with ${reference.name}. Its entire acquisition batch moves with it.`;
 };
 byId('acquisition-reference').onchange=()=>{treeSnapshot=null;treeMasterId=null;update(false);fit(true)};
 byId('acquisition-rotation').onchange=rememberRotation;
 for(const id of ['acquisition-units','acquisition-flip-x','acquisition-flip-y'])byId(id).onchange=()=>{treeSnapshot=null;treeMasterId=null;update()};
 byId('acquisition-adjust').onchange=()=>{adjust=byId('acquisition-adjust').checked;svg.style.cursor='';hideHover();syncAdjustment();draw()};
 byId('acquisition-reset-placement').onclick=()=>{const f=visible.find(f=>f.id===adjustId);if(!f)return;const key=placementKey(f,placementReference(f));placements.set(key,null);writePreference(key,null);hideHover();update(false)};
 byId('acquisition-fit').onclick=()=>fit(false);byId('acquisition-overview').onclick=()=>fit(true);
 function zoom(factor,px=400,py=310){if(!view||drag)return;hideHover();zoomOutLimit=(fittedView()?.w||view.w)*2;factor=Math.max(1e-7/view.w,Math.min(factor,zoomOutLimit/view.w));if(factor===1)return;view.x+=px/800*view.w*(1-factor);view.y+=py/620*view.h*(1-factor);view.w*=factor;view.h*=factor;draw()}
 byId('acquisition-zoom-in').onclick=()=>zoom(Math.sqrt(.65));byId('acquisition-zoom-out').onclick=()=>zoom(1/Math.sqrt(.65));
 // Convert pointer coordinates through the SVG transform, including letterboxing.
 function point(e){return new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse())}
 svg.addEventListener('wheel',e=>{e.preventDefault();const p=point(e);zoom(e.deltaY>0?Math.sqrt(1.15):1/Math.sqrt(1.15),p.x,p.y)},{passive:false});
 svg.onpointerdown=e=>{
  if(!view||e.button!==0)return;hideHover();moved=false;const p=point(e);
  const f=pointerImage(e,p);
  if(adjust&&f&&f.id!==reference.id&&field(f)){
   adjustId=f.id;const [x,y]=location(f);drag={x:p.x,y:p.y,view:{...view},image:f,start:{x,y},move:startPlacementMove(f,byId('acquisition-move-scope').value==='children',byId('acquisition-move-scope').value==='batch')};
   syncAdjustment();
  }else drag={x:p.x,y:p.y,view:{...view}};
  if(drag.image)svg.setPointerCapture(e.pointerId);
 };
 svg.onpointermove=e=>{
  const p=point(e);
  if(!drag){
   if(adjust){const f=pointerImage(e,p);if(f&&f.id!==reference.id&&field(f)){selectPlacementTarget(f);highlight(footprintPeers(f));svg.style.cursor='move'}else{highlight();svg.style.cursor=''}}
   return;
  }
  const dx=p.x-drag.x,dy=p.y-drag.y;
  if(Math.hypot(dx,dy)>4||moved){
   moved=true;
   if(drag.image){applyPlacementMove(drag.move,dx/800*drag.view.w,dy/620*drag.view.h);draw()}
   else{view.x=drag.view.x-dx/800*drag.view.w;view.y=drag.view.y-dy/620*drag.view.h;draw()}
  }
 };
 svg.onpointerup=e=>{
  const done=drag;drag=null;
  if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);
  if(done?.image){finishPlacementMove(done.move,moved);update(false);hideHover();}
 };
 svg.onpointercancel=e=>{if(drag?.image)finishPlacementMove(drag.move,false);drag=null;hideHover();syncAdjustment();draw()};
 window.addEventListener('pointerup',()=>{if(drag&&!drag.image)drag=null});
 svg.onpointerleave=()=>{if(drag&&!drag.image)drag=null;if(!drag){hideHover();svg.style.cursor=''}};
})();

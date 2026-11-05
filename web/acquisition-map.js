/* Approximate stage-coordinate map. This never changes analysis coordinates. */
(() => {
 const byId=id=>document.getElementById(id), dialog=byId('acquisition-map'), svg=byId('acquisition-canvas');
 const node=(name,attrs={},text)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n};
 let data=null, originId='', selectedFolder='', visible=[], reference=null, view=null, busy=false, drag=null, moved=false, request=0;
 const previews=new Map(), hoverCache=new Map(), rotations=new Map(), placements=new Map(), decoded=new Map();
 let adjust=false,adjustId="",zoomOutLimit=Infinity, batchId="", scopedBatches=[];
 const batches=()=>data?.batches||[];
 const batchOf=f=>batches().find(b=>b.id===f?.acquisition_batch);
 const batchReference=b=>data?.files.find(f=>f.id===b?.reference_id);
 const batchLabel=b=>`${b.first??"Unnumbered"}${b.last!==b.first?"–"+(b.last??"?"):""} · α ${tilt(b.alpha)}, β ${tilt(b.beta)} · ${b.members.length} images`;
 const rotationKey=()=>`tem-acquisition-rotation:${JSON.stringify([config.data_root,reference.id])}`;
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
 let history=[], hoverTimer=0, hoverTicket=0;
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
 const placementKey=(f,ref=reference)=>`tem-acquisition-placement:${JSON.stringify([config.data_root,ref.id,f.id])}`;
 function placement(f,ref=reference){
  if(!ref||f.id===ref.id)return null;
  const key=placementKey(f,ref);
  if(!placements.has(key)){const saved=readPreference(key,null);placements.set(key,saved&&Number.isFinite(saved.x)&&Number.isFinite(saved.y)?saved:null)}
  return placements.get(key);
 }
 function adjustable(){return visible.filter(f=>field(f)&&f.id!==reference?.id&&location(f)&&
   (batchId!=='*'||f.acquisition_batch===reference?.acquisition_batch||batchOf(f)?.reference_id===f.id))}
 function syncBatchAlignment(){
  const all=batchId==='*';
  byId('acquisition-align-label').hidden=!all;byId('acquisition-place-batch').hidden=!all;
  byId('acquisition-reference-label').textContent=all?'Master image':'Reference image';
  const candidates=scopedBatches.filter(b=>b.id!==reference?.acquisition_batch&&b.reference_id);
  options(byId('acquisition-align-batch'),candidates.map(b=>[b.id,batchLabel(b)]),byId('acquisition-align-batch').value);
  byId('acquisition-place-batch').disabled=!reference||!candidates.length;
  const anchor=batchReference(candidates.find(b=>b.id===byId('acquisition-align-batch').value));
  byId('acquisition-place-batch').textContent=anchor&&placement(anchor)?'Adjust batch':'Place batch';
 }
 function syncAdjustment(){
  options(byId('acquisition-adjust-image'),adjustable().map(f=>[f.id,f.name]),adjustId);
  adjustId=byId('acquisition-adjust-image').value;
  const f=visible.find(f=>f.id===adjustId),manual=f&&placement(f);
  syncBatchAlignment();
  byId('acquisition-reset-placement').disabled=!manual;
  byId('acquisition-adjust-image').disabled=!adjust;
  byId('acquisition-placement-status').textContent=manual?`Manually placed · X ${fmt(manual.x)} µm, Y ${fmt(manual.y)} µm from reference centre (right/down). Saved on release.`:'Drag a footprint to place it; changes are remembered for this reference.';
  svg.classList.toggle('adjusting',adjust);
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
  const tree=spatialTree();
  function path(g){if(g.files.some(x=>x.id===f.id))return [];for(const child of g.children){const below=path(child);if(below)return [g,...below]}return null}
  const chain=tree.root?path(tree.root):null;
  if(chain?.length===0)return []; // Reference and its alternate captures do not crop themselves.
  if(mode==='master'||!chain)return reference?[reference]:[];
  const parents=chain.map(g=>g===tree.root?reference:g.files.find(x=>x.id===groupChoices.get(g.files[0].id))||g.files[0]).reverse();
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
  const parents=comparisonParents(f),ticket=++hoverTicket,ref=parents[0]||reference,detail=cropDetails(f,ref);
  const wasHidden=card.hidden;card.hidden=false;
  const peers=footprintPeers(f);
  byId('acquisition-hover-title').textContent=peers.map(x=>x.name).join(' / ');
  const extras=byId('acquisition-hover-extras');extras.replaceChildren();
  for(const other of peers.filter(x=>x.id!==f.id)){
   const figure=document.createElement('figure'),caption=document.createElement('figcaption'),im=document.createElement('img');
   caption.textContent=other.name;im.alt=other.name;figure.append(caption,im);extras.append(figure);
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
   caption.textContent=`Crop · ${parent.name}`;caption.title=details.info;im.alt=`Crop of ${parent.name}`;figure.append(caption,im);extras.append(figure);
   if(!details.bounds){caption.textContent+=` · ${details.status}`;continue}
   cropURL(parent,details).then(url=>{if(ticket===hoverTicket)im.src=url}).catch(()=>{caption.textContent+=' · Preview unavailable'});
  }
  byId('acquisition-hover-info').textContent=(parents.length?detail.info:'Same footprint · alternate captures')+(live?' Live preview; original-pixel crop loads on release.':'');
  const render=async(type,promise)=>{try{const url=await promise;if(ticket!==hoverTicket)return;const im=byId(`acquisition-hover-${type}`);im.src=url;im.hidden=false;byId(`acquisition-hover-${type}-status`).textContent=''}catch{if(ticket===hoverTicket)byId(`acquisition-hover-${type}-status`).textContent='Preview unavailable'}};
  if(wasHidden){for(const type of ['full','crop']){byId(`acquisition-hover-${type}`).hidden=true;byId(`acquisition-hover-${type}-status`).textContent='Loading…'}}
  render('full',imageURL(`/api/acquisition-preview?id=${encodeURIComponent(f.id)}`));
  if(!parents.length){/* No reference self-crop. */}
  else if(!detail.bounds){byId('acquisition-hover-crop').hidden=true;byId('acquisition-hover-crop-status').textContent=detail.status}
  else render('crop',cropURL(ref,detail));
  if(wasHidden||!live)positionCard(e);
 }
 function hover(f,e){
  byId('acquisition-detail').textContent=title(f).replaceAll('\n',' · ');
  if(drag)return;
  hideHover();const peers=footprintPeers(f);highlight(peers);if(f.id===reference?.id&&peers.length===1)return;
  hoverTimer=setTimeout(()=>showComparison(f,e),180);
 }
 function chooseImage(f){if(adjust){adjustId=batchId==='*'&&f.acquisition_batch!==reference?.acquisition_batch?batchOf(f)?.reference_id:f.id;hideHover();syncAdjustment();draw()}else selectReference(f)}
 function bindHover(el,f){el.onmouseenter=e=>hover(f,e);el.onmouseleave=()=>{if(!drag?.image)hideHover()};el.onfocus=e=>hover(f,e);el.onblur=hideHover}
 function navigation(){
  byId('acquisition-back').disabled=!history.length;
  byId('acquisition-level').textContent=reference?`${history.length?'Level '+history.length:'Overview'} · ${number(reference)}`:'No reference';
  byId('acquisition-open-reference').disabled=!reference;
 }
 function selectReference(f){
  if(moved||f.id===reference?.id)return;
  if(!field(f)){byId('acquisition-detail').textContent='This image has no calibrated real-space footprint. Use Open to analyze it.';return}
  if(f.acquisition_batch===reference?.acquisition_batch&&footprintPeers(reference).some(x=>x.id===f.id)){
   // Alternate capture of the same footprint: change backdrop, not navigation level or coordinate frame.
   const oldRef=reference,angle=Number(byId('acquisition-rotation').value)||0;
   for(const image of visible){const manual=placement(image,oldRef);if(manual&&image.id!==f.id){const key=placementKey(image,f);placements.set(key,{...manual});writePreference(key,{...manual})}}
   const key=`tem-acquisition-rotation:${JSON.stringify([config.data_root,f.id])}`;rotations.set(key,angle);writePreference(key,angle);
   options(byId('acquisition-reference'),[[f.id,f.name]],f.id);update(false);return;
  }
  history.push({id:reference?.id,view:view?{...view}:null,zoomOutLimit,folder:selectedFolder,scope:byId('acquisition-scope').value,batchId});
  batchId=f.acquisition_batch;
  options(byId('acquisition-reference'),[[f.id,f.name]],f.id);update(false);fit(true);
 }

 async function preview(id){
  if(previews.has(id))return;
  previews.set(id,null);
  try{const res=await fetch(`/api/acquisition-preview?id=${encodeURIComponent(id)}`);if(!res.ok)throw Error('Overview preview unavailable');const blob=await res.blob();const url=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob)});previews.set(id,url);if(previews.size>8)previews.delete(previews.keys().next().value);if(reference?.id===id)draw()}catch(e){previews.set(id,'');if(reference?.id===id)byId('acquisition-status').textContent+=' Overview preview unavailable.'}
 }
 const positioned=f=>Number.isFinite(f.stage_position?.x)&&Number.isFinite(f.stage_position?.y);
 const field=f=>Array.isArray(f.field_nm)&&f.field_nm.every(x=>Number.isFinite(x)&&x>0);
 const number=f=>{const n=acquisitionNumber(f);return Number.isFinite(n)?String(n):f.name};
 const coord=n=>Number.isFinite(n)?String(Number(n.toPrecision(9))):'unknown';
 const tilt=n=>Number.isFinite(n)?(String(n).replace(/[-.e+]/g,'').replace(/^0+/,'').length<3?n.toPrecision(3):String(n)):'unknown';
 const fmt=n=>Number(n).toPrecision(4).replace(/\.0+$/, '');
 function options(select,rows,value){select.replaceChildren();for(const [id,label] of rows){const o=document.createElement('option');o.value=id;o.textContent=label;select.append(o)}if(rows.some(r=>r[0]===value))select.value=value}
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
 const groupName=g=>[...new Set([...g.files].sort((a,b)=>acquisitionNumber(a)-acquisitionNumber(b)||a.name.localeCompare(b.name)).map(number))].join('/');
 function overlaps(parent,child){
  if(!parent.rect||!child.pos)return false;
  const [x,y,w,h]=parent.rect,[cx,cy]=child.pos,[cw,ch]=child.rect?.slice(2)||[0,0];
  return cw&&ch?Math.abs(x-cx)<(w+cw)/2&&Math.abs(y-cy)<(h+ch)/2:Math.abs(x-cx)<=w/2&&Math.abs(y-cy)<=h/2;
 }
 function spatialTree(){
  const groups=footprintGroups(),root=groups.find(g=>g.files.some(f=>f.id===reference?.id));
  const outside=[],unplaced=[],inside=[];
  for(const g of groups){if(g===root)continue;if(!g.pos)unplaced.push(g);else if(root&&overlaps(root,g))inside.push(g);else outside.push(g)}
  const area=g=>g.rect?g.rect[2]*g.rect[3]:0;
  function nest(items,fallback){
   const tops=[];
   for(const g of items){
    const parent=items.filter(p=>p!==g&&area(p)>area(g)&&overlaps(p,g)).sort((a,b)=>area(a)-area(b))[0]||fallback;
    if(parent)parent.children.push(g);else tops.push(g);
   }
   return tops;
  }
  nest(inside,root);return {root,outside:nest(outside,null),unplaced};
 }
 const treeExpanded=new Map(),groupChoices=new Map(),groupSelectors=new Map();
 function chooseGroup(g){
  if(g.files.length===1){chooseImage(g.files[0]);return}
  const select=groupSelectors.get(g.files[0].id);select?.focus();select?.scrollIntoView({block:'nearest'});
  byId('acquisition-detail').textContent=`${groupName(g)} share this footprint. Choose an image in the tree, then Use reference.`;
 }
 function renderImageTree(){
  const list=byId('acquisition-list');list.replaceChildren();groupSelectors.clear();
  function branch(parent,items,key,label){
   if(!items.length)return;
   const details=document.createElement('details');details.className='acquisition-tree-branch';details.open=treeExpanded.get(key)??true;
   details.addEventListener('toggle',()=>treeExpanded.set(key,details.open));
   const summary=document.createElement('summary');summary.textContent=label;
   const ul=document.createElement('ul');ul.append(...items.map(entry));details.append(summary,ul);parent.append(details);
  }
  function entry(g){
   const li=document.createElement('li'),row=document.createElement('div');row.className='acquisition-entry';
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
   use.title=title(f);use.onclick=()=>{moved=false;chooseImage(f)};
   box.onmouseenter=e=>hover(f,e);box.onmouseleave=()=>{if(!drag?.image)hideHover()};box.onfocusin=e=>hover(f,e);box.onfocusout=hideHover;box.append(use);
   const sub=document.createElement('small');sub.textContent=[isRoot?'Reference image':'',!g.pos?'Not placed':g.rect?`${fmt(f.field_nm[0])} nm wide`:'Point only'].filter(Boolean).join(' · ');box.append(sub);
   const open=document.createElement('button');open.type='button';open.textContent='Open';open.title='Open selected image for analysis';open.onclick=()=>{moved=false;openImage(f)};
   row.append(box,open);li.append(row);
   branch(li,g.children,`${reference?.id}:${key}`,'Within this image');return li;
  }
  const tree=spatialTree(),ul=document.createElement('ul');ul.className='acquisition-tree';if(tree.root)ul.append(entry(tree.root));list.append(ul);
  branch(list,tree.outside,`${reference?.id}:outside`,'Outside reference');branch(list,tree.unplaced,`${reference?.id}:unplaced`,'Not placed');
 }
 function update(reset=true){
  if(!data)return;hideHover();
  const date=byId('acquisition-date').value;
  const dated=data.files.filter(f=>date==='*'||f.date===date);
  const folders=[...new Set(dated.map(f=>f.folder))].sort();
  options(byId('acquisition-folder'),folders.map(f=>[f,f||'(root)']),selectedFolder);
  selectedFolder=byId('acquisition-folder').value;
  const scoped=dated.filter(f=>byId('acquisition-scope').value==='sample'||f.folder===selectedFolder);
  const scopedIds=new Set(scoped.map(f=>f.id));
  scopedBatches=batches().filter(b=>b.members.some(id=>scopedIds.has(id)));
  if(!scopedBatches.some(b=>b.id===batchId)&&batchId!=='*')batchId=scopedBatches.find(b=>b.members.includes(originId))?.id||scopedBatches[0]?.id||'';
  options(byId('acquisition-batch'),[['*','All batches · align to master'],...scopedBatches.map(b=>[b.id,batchLabel(b)])],batchId);
  visible=scoped.filter(f=>batchId==='*'||f.acquisition_batch===batchId);
  const refs=visible.filter(f=>field(f)&&(batchId!=='*'||location(f)||scopedBatches.some(b=>b.reference_id===f.id)))
   .sort((a,b)=>b.field_nm[0]*b.field_nm[1]-a.field_nm[0]*a.field_nm[1]);
  const old=byId('acquisition-reference').value;
  const preferred=refs.some(f=>f.id===old)?old:batchReference(batchOf(visible[0]))?.id;
  options(byId('acquisition-reference'),refs.map(f=>[f.id,`${f.name} · ${fmt(f.field_nm[0])} nm wide`]),batchId==='*'?old:preferred);
  reference=refs.find(f=>f.id===byId('acquisition-reference').value)||null;
  restoreRotation();
  const placed=visible.filter(f=>location(f));
  byId('acquisition-status').textContent=!data.batches?'Restart TEM Workbench to enable tilt batches.':`${data.sample} · ${scopedBatches.length} batches · ${placed.length}/${visible.length} images placed${batchId==='*'?' · Unaligned batches stay off the map until placed.':' · Matching tilts permit a stage estimate; verify alignment.'}`;
  renderImageTree();
  navigation();syncAdjustment();
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
  const key=`tem-acquisition-rotation:${JSON.stringify([config.data_root,anchor.id])}`;
  const rotation=rotations.has(key)?rotations.get(key):readPreference(key,0);
  const local=placement(f,anchor);
  const delta=local?[local.x,local.y]:stageOffset(f,anchor,Number(rotation)||0);
  return delta?[offset.x+delta[0],offset.y+delta[1]]:null;
 }
 // Apply the same level filter to fitting and drawing, before viewport clipping.
 function mappedImages(){return visible.filter(f=>location(f)&&!(history.length&&field(f)&&field(reference)&&f.field_nm[0]*f.field_nm[1]>reference.field_nm[0]*reference.field_nm[1]*1.001))}
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
 function draw(){
  svg.replaceChildren();
  if(!view||!reference){svg.append(node('text',{x:30,y:50,fill:'#9aacbc','font-size':18},busy?'Reading metadata…':'No calibrated reference image in this selection.'));return}
  const sx=x=>(x-view.x)*800/view.w,sy=y=>(y-view.y)*620/view.h;
  if(field(reference)){
   const [w,h]=reference.field_nm.map(v=>v/1000);
   const im=node('image',{x:sx(-w/2),y:sy(-h/2),width:w*800/view.w,height:h*620/view.h,preserveAspectRatio:'none',opacity:'.65',href:previews.get(reference.id)||'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E'});
   im.addEventListener('error',()=>{byId('acquisition-status').textContent+=' Overview preview unavailable.'},{once:true});svg.append(im);
   svg.append(node('rect',{x:sx(-w/2),y:sy(-h/2),width:w*800/view.w,height:h*620/view.h,class:'location reference-outline','data-image-ids':JSON.stringify([reference.id]),'pointer-events':'none',fill:'none',stroke:'#fff','stroke-dasharray':'5 5'}));
  }
  const placed=mappedImages().sort((a,b)=>adjust?(Number(a.id===adjustId)-Number(b.id===adjustId)||((b.field_nm?.[0]||0)-(a.field_nm?.[0]||0))):((b.field_nm?.[0]||0)-(a.field_nm?.[0]||0)));
  const usedLabels=new Set();
  for(const group of footprintGroups(placed)){
   const f=group.files.find(x=>x.id===adjustId&&adjust)||group.files.find(x=>x.id===reference.id)||group.files[0];
   if(f.id===reference.id&&group.files.length===1)continue;
   const [x,y]=location(f), px=sx(x),py=sy(y);const colour=f.id===originId?'#ff8197':field(f)?'#7abaff':'#ffc36b';
   const [w,h]=field(f)?f.field_nm.map(v=>v/1000):[0,0],pw=w*800/view.w,ph=h*620/view.h;
   if(px+pw/2<0||px-pw/2>800||py+ph/2<0||py-ph/2>620)continue;
   const g=node('g',{class:'location','data-image-id':f.id,'data-image-ids':JSON.stringify(group.files.map(x=>x.id)),tabindex:'0',role:'button','aria-label':`Use ${f.name} as reference`});
   if(placement(f))g.setAttribute('data-manual','true');
   if(adjust&&f.id===adjustId)g.setAttribute('data-selected','true');
   if(field(f))g.append(node('rect',{x:px-pw/2,y:py-ph/2,width:pw,height:ph,fill:colour,'fill-opacity':'.09',stroke:colour,'stroke-width':1}));
   const markerX=px+pw/2,markerY=py-ph/2;
   g.append(node('circle',{cx:markerX,cy:markerY,r:4,fill:colour,stroke:'#080d13','stroke-width':1}));
   // Do not stack unreadable labels at identical / nearly identical recorded positions.
   const key=`${Math.round(markerX/50)},${Math.round(markerY/18)}`;
   if(!usedLabels.has(key)){g.append(node('text',{x:markerX-7,y:markerY-6,'text-anchor':'end',fill:colour,'font-size':12,'paint-order':'stroke',stroke:'#080d13','stroke-width':3},groupName(group)+(placement(f)?' · manual':'')));usedLabels.add(key)}
   g.onclick=()=>{if(!moved){if(adjust)chooseImage(f);else chooseGroup(group)}};g.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();moved=false;chooseGroup(group)}};
   bindHover(g,f);svg.append(g);
  }
  highlight(visible.filter(f=>highlighted.includes(f.id)));
  const bar=view.w/5;
  svg.append(node('rect',{x:8,y:578,width:270,height:36,fill:'#080d13',opacity:.88}));
  svg.append(node('path',{d:'M 20 601 h 160',stroke:'#fff','stroke-width':2}));
  svg.append(node('text',{x:20,y:593,fill:'#fff','font-size':12},`${fmt(bar)} µm · approximate`));
 }
 async function loadSample(seedId,opening=false){
  const ticket=++request;
  busy=true;history=[];batchId='';scopedBatches=[];hideHover();drag=null;moved=false;adjustId='';
  data=null;view=null;reference=null;visible=[];
  for(const id of ['acquisition-folder','acquisition-date','acquisition-reference','acquisition-adjust-image','acquisition-batch','acquisition-align-batch','acquisition-list','acquisition-error-list'])byId(id).replaceChildren();
  byId('acquisition-errors').hidden=true;
  byId('acquisition-reset-placement').disabled=true;
  byId('acquisition-detail').textContent='';byId('acquisition-placement-status').textContent='';
  byId('acquisition-status').textContent='Reading stage metadata for this labelled sample…';
  navigation();draw();
  try{
   const result=await api(`acquisition-map?id=${encodeURIComponent(seedId)}`);if(ticket!==request)return;data=result;
   const current=opening?data.files.find(f=>f.id===originId):null;selectedFolder=current?.folder||'';
   const dates=[...new Set(data.files.map(f=>f.date))].sort();options(byId('acquisition-date'),[['*','All dates'],...dates.map(d=>[d,d||'Date unknown'])],current?.date??'*');
   byId('acquisition-scope').value=opening?'folder':'sample';
   byId('acquisition-errors').hidden=!data.errors.length;for(const err of data.errors){const p=document.createElement('p');p.textContent=`${err.name}: ${err.error}`;byId('acquisition-error-list').append(p)}
   busy=false;update();
  }catch(e){if(ticket===request){busy=false;byId('acquisition-status').textContent=e.message;draw()}}
  finally{if(ticket===request)busy=false}
 }
 const cropMode=readPreference('tem-acquisition-crop-source','closest');
 byId('acquisition-crop-source').value=['closest','master','all'].includes(cropMode)?cropMode:'closest';
 byId('acquisition-crop-source').onchange=()=>{writePreference('tem-acquisition-crop-source',byId('acquisition-crop-source').value);hideHover()};
 byId('acquisition-map-open').onclick=()=>{
  if(!fileId)return;
  originId=fileId;
  const samples=[...new Set(config.files.map(f=>f.sample))].sort((a,b)=>a.localeCompare(b));
  options(byId('acquisition-sample'),samples.map(s=>[s,s||'Unlabelled']),config.files.find(f=>f.id===originId)?.sample);
  dialog.showModal();return loadSample(originId,true);
 };
 byId('acquisition-sample').onchange=()=>{
  const seed=config.files.find(f=>f.sample===byId('acquisition-sample').value);
  if(seed)return loadSample(seed.id);
 };
 byId('acquisition-map-close').onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>{++request;busy=false;hideHover()});
 byId('acquisition-open-reference').onclick=()=>{if(reference){moved=false;openImage(reference)}};
 byId('acquisition-back').onclick=()=>{
  const prior=history.pop();if(!prior)return;
  batchId=prior.batchId;selectedFolder=prior.folder;byId('acquisition-scope').value=prior.scope;options(byId('acquisition-reference'),[[prior.id,prior.id]],prior.id);update(false);view=prior.view;zoomOutLimit=prior.zoomOutLimit;draw();
 };
 byId('acquisition-folder').onchange=()=>{selectedFolder=byId('acquisition-folder').value;byId('acquisition-scope').value='folder';history=[];batchId='';byId('acquisition-reference').replaceChildren();update()};
 for(const id of ['acquisition-scope','acquisition-date'])byId(id).onchange=()=>{history=[];batchId='';byId('acquisition-reference').replaceChildren();update()};
 byId('acquisition-batch').onchange=()=>{batchId=byId('acquisition-batch').value;history=[];byId('acquisition-reference').replaceChildren();update();fit(true)};
 byId('acquisition-align-batch').onchange=syncBatchAlignment;
 byId('acquisition-place-batch').onclick=()=>{
  const anchor=batchReference(scopedBatches.find(b=>b.id===byId('acquisition-align-batch').value));
  if(!anchor||!reference)return;
  if(!placement(anchor)){const value={x:0,y:0};placements.set(placementKey(anchor),value);writePreference(placementKey(anchor),value)}
  adjust=true;byId('acquisition-adjust').checked=true;adjustId=anchor.id;update(false);fit(false);
  byId('acquisition-detail').textContent=`Drag ${anchor.name} to align its batch with the master. Other batch members follow.`;
 };
 byId('acquisition-reference').onchange=()=>{history=[];update(false);fit(true)};
 byId('acquisition-rotation').onchange=rememberRotation;
 for(const id of ['acquisition-units','acquisition-flip-x','acquisition-flip-y'])byId(id).onchange=()=>{history=[];update()};
 byId('acquisition-adjust').onchange=()=>{adjust=byId('acquisition-adjust').checked;hideHover();syncAdjustment();draw()};
 byId('acquisition-adjust-image').onchange=()=>{adjustId=byId('acquisition-adjust-image').value;hideHover();syncAdjustment();draw()};
 byId('acquisition-reset-placement').onclick=()=>{const f=visible.find(f=>f.id===adjustId);if(!f)return;placements.set(placementKey(f),null);writePreference(placementKey(f),null);hideHover();update(false)};
 byId('acquisition-fit').onclick=()=>fit(false);byId('acquisition-overview').onclick=()=>fit(true);
 function zoom(factor,px=400,py=310){if(!view||drag)return;hideHover();zoomOutLimit=(fittedView()?.w||view.w)*2;factor=Math.max(1e-7/view.w,Math.min(factor,zoomOutLimit/view.w));if(factor===1)return;view.x+=px/800*view.w*(1-factor);view.y+=py/620*view.h*(1-factor);view.w*=factor;view.h*=factor;draw()}
 byId('acquisition-zoom-in').onclick=()=>zoom(.65);byId('acquisition-zoom-out').onclick=()=>zoom(1/.65);
 // Convert pointer coordinates through the SVG transform, including letterboxing.
 function point(e){return new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse())}
 svg.addEventListener('wheel',e=>{e.preventDefault();const p=point(e);zoom(e.deltaY>0?1.15:1/1.15,p.x,p.y)},{passive:false});
 svg.onpointerdown=e=>{
  if(!view||e.button!==0)return;hideHover();moved=false;const p=point(e);
  const id=e.target.closest('[data-image-id]')?.getAttribute('data-image-id');let f=visible.find(f=>f.id===id);
  if(adjust&&batchId==='*'&&f&&f.acquisition_batch!==reference.acquisition_batch)f=batchReference(batchOf(f));
  if(adjust&&f&&f.id!==reference.id&&field(f)){
   adjustId=f.id;const [x,y]=location(f);drag={x:p.x,y:p.y,view:{...view},image:f,start:{x,y},prior:placement(f),key:placementKey(f)};
   syncAdjustment();showComparison(f,e,true);
  }else drag={x:p.x,y:p.y,view:{...view}};
  if(drag.image)svg.setPointerCapture(e.pointerId);
 };
 svg.onpointermove=e=>{
  if(!drag)return;const p=point(e),dx=p.x-drag.x,dy=p.y-drag.y;
  if(Math.hypot(dx,dy)>4||moved){
   moved=true;
   if(drag.image){placements.set(drag.key,{x:drag.start.x+dx/800*drag.view.w,y:drag.start.y+dy/620*drag.view.h});draw();showComparison(drag.image,e,true)}
   else{view.x=drag.view.x-dx/800*drag.view.w;view.y=drag.view.y-dy/620*drag.view.h;draw()}
  }
 };
 svg.onpointerup=e=>{
  const done=drag;drag=null;
  if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);
  if(done?.image){if(moved)writePreference(done.key,placements.get(done.key));update(false);showComparison(done.image,e);}
 };
 svg.onpointercancel=e=>{if(drag?.image)placements.set(drag.key,drag.prior);drag=null;hideHover();syncAdjustment();draw()};
 window.addEventListener('pointerup',()=>{if(drag&&!drag.image)drag=null});
 svg.onpointerleave=()=>{if(drag&&!drag.image)drag=null;if(!drag)hideHover()};
})();

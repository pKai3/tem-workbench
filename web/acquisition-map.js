/* Approximate stage-coordinate map. This never changes analysis coordinates. */
(() => {
 const byId=id=>document.getElementById(id), dialog=byId('acquisition-map'), svg=byId('acquisition-canvas');
 const node=(name,attrs={},text)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n};
 let data=null, originId='', selectedFolder='', visible=[], reference=null, view=null, busy=false, drag=null, moved=false, request=0;
 const previews=new Map(), hoverCache=new Map();
 let history=[], compare=false, hoverTimer=0, hoverTicket=0;
 const card=byId('acquisition-hover');
 function hideHover(){clearTimeout(hoverTimer);hoverTicket++;card.hidden=true}
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
 function hover(f,e){
  byId('acquisition-detail').textContent=title(f).replaceAll('\n',' · ');
  hideHover();if(!compare||drag||f.id===reference?.id)return;
  const ticket=hoverTicket, ref=reference;
  hoverTimer=setTimeout(()=>{
   card.hidden=false;byId('acquisition-hover-title').textContent=f.name;
   for(const type of ['full','crop']){byId(`acquisition-hover-${type}`).hidden=true;byId(`acquisition-hover-${type}-status`).textContent='Loading…'}
   let bounds=null, info='No calibrated footprint or stage position for this comparison.';
   if(ref&&field(ref)&&field(f)&&positioned(f)){
    const [x,y]=location(f),[rw,rh]=ref.field_nm.map(v=>v/1000),[fw,fh]=f.field_nm.map(v=>v/1000);
    bounds={x:(x-fw/2+rw/2)/rw,y:(y-fh/2+rh/2)/rh,w:fw/rw,h:fh/rh};
    const overlap=Math.max(0,Math.min(1,bounds.x+bounds.w)-Math.max(0,bounds.x))*Math.max(0,Math.min(1,bounds.y+bounds.h)-Math.max(0,bounds.y))/(bounds.w*bounds.h);
    info=`${f.field_nm.map(fmt).join(' × ')} nm · reference ${number(ref)} · about ${Math.round(bounds.w*ref.width)} × ${Math.round(bounds.h*ref.height)} reference pixels. Approximate placement; image orientation is not corrected.`;
    if(overlap<.999)info+=` ${Math.round(overlap*100)}% inside reference; outside areas are black.`;
    if(!overlap)bounds=null;
    byId('acquisition-hover-crop-status').textContent=overlap?'Loading…':'Outside reference';
   }else byId('acquisition-hover-crop-status').textContent='Comparison unavailable';
   byId('acquisition-hover-info').textContent=info;positionCard(e);
   const show=async(type,url)=>{try{const result=await imageURL(url);if(ticket!==hoverTicket)return;const img=byId(`acquisition-hover-${type}`);img.src=result;img.hidden=false;byId(`acquisition-hover-${type}-status`).textContent=''}catch(err){if(ticket===hoverTicket)byId(`acquisition-hover-${type}-status`).textContent=err.message}};
   show('full',`/api/acquisition-preview?id=${encodeURIComponent(f.id)}`);
   if(bounds)show('crop',`/api/acquisition-crop?${new URLSearchParams({id:ref.id,...bounds})}`);
  },180);
 }
 function bindHover(el,f){el.onmouseenter=e=>hover(f,e);el.onmouseleave=hideHover;el.onfocus=e=>hover(f,e);el.onblur=hideHover}
 function navigation(){
  byId('acquisition-back').disabled=!history.length;
  byId('acquisition-level').textContent=reference?`${history.length?'Level '+history.length:'Overview'} · ${number(reference)}`:'No reference';
  byId('acquisition-open-reference').disabled=!reference;
 }
 function selectReference(f){
  if(moved||f.id===reference?.id)return;
  if(!positioned(f)||!field(f)){byId('acquisition-detail').textContent='This image has no calibrated real-space footprint. Use Open to analyze it.';return}
  history.push({id:reference?.id,view:view?{...view}:null,folder:selectedFolder,scope:byId('acquisition-scope').value});
  byId('acquisition-reference').value=f.id;update(false);fit(true);
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
 const fmt=n=>Number(n).toPrecision(4).replace(/\.0+$/, '');
 function options(select,rows,value){select.replaceChildren();for(const [id,label] of rows){const o=document.createElement('option');o.value=id;o.textContent=label;select.append(o)}if(rows.some(r=>r[0]===value))select.value=value}
 function openImage(f){if(moved)return;dialog.close();clearFileSearch();byId('file').value=f.id;openFile()}
 function title(f){const p=f.stage_position;return `${f.name}\n${f.folder}\n${f.date} ${f.time}\nStage X ${coord(p.x)}, Y ${coord(p.y)} (raw); α ${coord(p.alpha)}, β ${coord(p.beta)}\n${field(f)?f.field_nm.map(fmt).join(' × ')+' nm':'No real-space footprint'}`}
 function update(reset=true){
  if(!data)return;hideHover();
  const date=byId('acquisition-date').value;
  const dated=data.files.filter(f=>date==='*'||f.date===date);
  const folders=[...new Set(dated.map(f=>f.folder))].sort();
  options(byId('acquisition-folder'),folders.map(f=>[f,f||'(root)']),selectedFolder);
  selectedFolder=byId('acquisition-folder').value;
  visible=dated.filter(f=>byId('acquisition-scope').value==='sample'||f.folder===selectedFolder);
  const refs=dated.filter(f=>positioned(f)&&field(f)).sort((a,b)=>b.field_nm[0]*b.field_nm[1]-a.field_nm[0]*a.field_nm[1]);
  const old=byId('acquisition-reference').value;
  options(byId('acquisition-reference'),refs.map(f=>[f.id,`${f.name} · ${fmt(f.field_nm[0])} nm wide`]),old);
  reference=refs.find(f=>f.id===byId('acquisition-reference').value)||null;
  if(!reference)reference=visible.find(positioned)||null;
  const placed=visible.filter(positioned);
  byId('acquisition-status').textContent=`${data.sample} (as labelled) · ${placed.length}/${visible.length} images have stage X/Y · ${visible.length-placed.length} without locations. Units assumed ${byId('acquisition-units').selectedOptions[0].text}; verify for your microscope. ${reference&&field(reference)?'Overview anchored at its recorded stage position.':'No calibrated overview available; showing stage locations only.'}`;
  const list=byId('acquisition-list');list.replaceChildren();
  for(const f of [...visible].sort((a,b)=>acquisitionNumber(a)-acquisitionNumber(b)||a.name.localeCompare(b.name))){
   const b=document.createElement('button');b.type='button';b.textContent=f.name;b.title=title(f);b.setAttribute('aria-current',String(f.id===originId));
   const sub=document.createElement('small');sub.textContent=positioned(f)?`X ${coord(f.stage_position.x)}, Y ${coord(f.stage_position.y)} · ${field(f)?fmt(f.field_nm[0])+' nm wide':'point only'}`:'Stage position unavailable';b.append(sub);b.onclick=()=>{moved=false;selectReference(f)};
   bindHover(b,f);b.title='Use as reference: '+f.name;
   const entry=document.createElement('div');entry.className='acquisition-entry';
   const open=document.createElement('button');open.type='button';open.textContent='Open';open.setAttribute('aria-label',`Open ${f.name} for analysis`);open.onclick=()=>{moved=false;openImage(f)};
   entry.append(b,open);list.append(entry);
  }
  navigation();
  if(reference&&field(reference))preview(reference.id);
  if(reset)fit(false);else draw();
 }
 function location(f){
  const factor=Number(byId('acquisition-units').value)/1000; // nm per raw unit → µm
  let x=(f.stage_position.x-reference.stage_position.x)*factor, y=(f.stage_position.y-reference.stage_position.y)*factor;
  if(byId('acquisition-flip-x').checked)x=-x;if(byId('acquisition-flip-y').checked)y=-y;
  const angle=(Number(byId('acquisition-rotation').value)||0)*Math.PI/180;
  return [x*Math.cos(angle)-y*Math.sin(angle), -(x*Math.sin(angle)+y*Math.cos(angle))];
 }
 function fit(overview){
  if(!reference){view=null;draw();return}
  let loX=Infinity,loY=Infinity,hiX=-Infinity,hiY=-Infinity;
  for(const f of overview?[reference]:[reference,...visible.filter(positioned)]){
   const [x,y]=location(f),[w,h]=field(f)?f.field_nm.map(v=>v/1000):[0,0];
   loX=Math.min(loX,x-w/2);hiX=Math.max(hiX,x+w/2);loY=Math.min(loY,y-h/2);hiY=Math.max(hiY,y+h/2);
  }
  const width=Math.max(hiX-loX,(hiY-loY)*800/620,.01)*1.15;
  view={x:(loX+hiX-width)/2,y:(loY+hiY-width*620/800)/2,w:width,h:width*620/800};draw();
 }
 function draw(){
  svg.replaceChildren();
  if(!view||!reference){svg.append(node('text',{x:30,y:50,fill:'#9aacbc','font-size':18},busy?'Reading metadata…':'No recorded stage positions in this selection.'));return}
  const sx=x=>(x-view.x)*800/view.w,sy=y=>(y-view.y)*620/view.h;
  if(field(reference)){
   const [w,h]=reference.field_nm.map(v=>v/1000);
   const im=node('image',{x:sx(-w/2),y:sy(-h/2),width:w*800/view.w,height:h*620/view.h,preserveAspectRatio:'none',opacity:'.65',href:previews.get(reference.id)||'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E'});
   im.addEventListener('error',()=>{byId('acquisition-status').textContent+=' Overview preview unavailable.'},{once:true});svg.append(im);
   svg.append(node('rect',{x:sx(-w/2),y:sy(-h/2),width:w*800/view.w,height:h*620/view.h,fill:'none',stroke:'#fff','stroke-dasharray':'5 5'}));
  }
  const placed=visible.filter(positioned).sort((a,b)=>(b.field_nm?.[0]||0)-(a.field_nm?.[0]||0));
  const usedLabels=new Set();
  for(const f of placed){
   if(f.id===reference.id)continue;
   if(history.length&&field(f)&&field(reference)&&f.field_nm[0]*f.field_nm[1]>reference.field_nm[0]*reference.field_nm[1]*1.001)continue;
   const [x,y]=location(f), px=sx(x),py=sy(y);const colour=f.id===originId?'#ff8197':field(f)?'#7abaff':'#ffc36b';
   const [w,h]=field(f)?f.field_nm.map(v=>v/1000):[0,0],pw=w*800/view.w,ph=h*620/view.h;
   if(px+pw/2<0||px-pw/2>800||py+ph/2<0||py-ph/2>620)continue;
   const g=node('g',{class:'location',tabindex:'0',role:'button','aria-label':`Use ${f.name} as reference`});
   if(field(f))g.append(node('rect',{x:px-pw/2,y:py-ph/2,width:pw,height:ph,fill:colour,'fill-opacity':'.09',stroke:colour,'stroke-width':1}));
   const markerX=px+pw/2,markerY=py-ph/2;
   g.append(node('circle',{cx:markerX,cy:markerY,r:4,fill:colour,stroke:'#080d13','stroke-width':1}));
   // Do not stack unreadable labels at identical / nearly identical recorded positions.
   const key=`${Math.round(markerX/50)},${Math.round(markerY/18)}`;
   if(!usedLabels.has(key)){g.append(node('text',{x:markerX-7,y:markerY-6,'text-anchor':'end',fill:colour,'font-size':12,'paint-order':'stroke',stroke:'#080d13','stroke-width':3},number(f)));usedLabels.add(key)}
   g.onclick=()=>selectReference(f);g.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();moved=false;selectReference(f)}};
   bindHover(g,f);svg.append(g);
  }
  const bar=view.w/5;
  svg.append(node('rect',{x:8,y:578,width:270,height:36,fill:'#080d13',opacity:.88}));
  svg.append(node('path',{d:'M 20 601 h 160',stroke:'#fff','stroke-width':2}));
  svg.append(node('text',{x:20,y:593,fill:'#fff','font-size':12},`${fmt(bar)} µm · approximate`));
 }
 byId('acquisition-map-open').onclick=async()=>{
  if(busy||!fileId)return;
  history=[];hideHover();navigation();
  byId('acquisition-preview-on').disabled=!config.acquisition_comparison;byId('acquisition-preview-on').title=config.acquisition_comparison?'':'Restart TEM Workbench and reload to enable comparison previews';
  const ticket=++request;originId=fileId;busy=true;previews.clear();data=null;view=null;byId('acquisition-list').replaceChildren();byId('acquisition-status').textContent='Reading stage metadata for this labelled sample…';dialog.showModal();draw();
  try{
   const result=await api(`acquisition-map?id=${encodeURIComponent(originId)}`);if(ticket!==request)return;data=result;
   const current=data.files.find(f=>f.id===originId);selectedFolder=current?.folder||'';
   const dates=[...new Set(data.files.map(f=>f.date))].sort();options(byId('acquisition-date'),[['*','All dates'],...dates.map(d=>[d,d||'Date unknown'])],current?.date??'*');
   byId('acquisition-reference').replaceChildren();byId('acquisition-scope').value='folder';
   byId('acquisition-errors').hidden=!data.errors.length;byId('acquisition-error-list').replaceChildren();for(const err of data.errors){const p=document.createElement('p');p.textContent=`${err.name}: ${err.error}`;byId('acquisition-error-list').append(p)}
   update();
  }catch(e){byId('acquisition-status').textContent=e.message}finally{busy=false}
 };
 byId('acquisition-map-close').onclick=()=>dialog.close();
 dialog.addEventListener('close',hideHover);
 for(const enabled of [false,true])byId(enabled?'acquisition-preview-on':'acquisition-preview-off').onclick=()=>{
  compare=enabled;hideHover();byId('acquisition-preview-on').setAttribute('aria-pressed',String(compare));byId('acquisition-preview-off').setAttribute('aria-pressed',String(!compare));
 };
 byId('acquisition-open-reference').onclick=()=>{if(reference){moved=false;openImage(reference)}};
 byId('acquisition-back').onclick=()=>{
  const prior=history.pop();if(!prior)return;
  selectedFolder=prior.folder;byId('acquisition-scope').value=prior.scope;byId('acquisition-reference').value=prior.id;update(false);view=prior.view;draw();
 };
 byId('acquisition-folder').onchange=()=>{selectedFolder=byId('acquisition-folder').value;byId('acquisition-scope').value='folder';update()};
 for(const id of ['acquisition-scope','acquisition-date'])byId(id).onchange=()=>{history=[];byId('acquisition-reference').replaceChildren();update()};
 byId('acquisition-reference').onchange=()=>{history=[];update(false);fit(true)};
 for(const id of ['acquisition-units','acquisition-rotation','acquisition-flip-x','acquisition-flip-y'])byId(id).onchange=()=>{history=[];update()};
 byId('acquisition-fit').onclick=()=>fit(false);byId('acquisition-overview').onclick=()=>fit(true);
 function zoom(factor,px=400,py=310){if(!view||view.w*factor<1e-7||view.w*factor>1e10)return;view.x+=px/800*view.w*(1-factor);view.y+=py/620*view.h*(1-factor);view.w*=factor;view.h*=factor;draw()}
 byId('acquisition-zoom-in').onclick=()=>zoom(.65);byId('acquisition-zoom-out').onclick=()=>zoom(1/.65);
 // Convert pointer coordinates through the SVG transform, including letterboxing.
 function point(e){return new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse())}
 svg.addEventListener('wheel',e=>{e.preventDefault();const p=point(e);zoom(e.deltaY>0?1.15:1/1.15,p.x,p.y)},{passive:false});
 svg.onpointerdown=e=>{hideHover();if(!view)return;moved=false;const p=point(e);drag={x:p.x,y:p.y,view:{...view}}};
 svg.onpointermove=e=>{if(!drag)return;const p=point(e),dx=p.x-drag.x,dy=p.y-drag.y;if(Math.hypot(dx,dy)>4){moved=true;view.x=drag.view.x-dx/800*view.w;view.y=drag.view.y-dy/620*view.h;draw()}};
 window.addEventListener('pointerup',()=>{drag=null});svg.onpointerleave=()=>{drag=null};
})();

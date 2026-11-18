/* Editable figure recipes; original images are read only. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 let config,folderBrowser,projectSettings,files=[],selectedPanel=0,currentId='',timer=0,renderVersion=0,hoverTimer=0,browserPreferred=160;
 let saved={};
 const blank=()=>({schema_version:1,name:'Untitled figure',rows:1,columns:2,aspect:4/3,background:'white',slots:[{},{}]});
 function normaliseRecipe(value){
  if(!value||!Array.isArray(value.slots))return blank();
  const next=structuredClone(value),columns=Number(next.columns)||2;
  if(columns<1||columns>4||next.slots.length>24)return blank();
  next.columns=columns;next.rows=Math.max(1,Math.min(6,Number(next.rows)||Math.ceil(next.slots.length/columns)||1));
  next.rows=Math.max(next.rows,Math.ceil(next.slots.length/columns));
  if(next.rows*columns>24)return blank();
  while(next.slots.length<next.rows*columns)next.slots.push({});
  return next;
 }
 const parse=(raw,fallback)=>{try{const value=JSON.parse(raw);return value&&typeof value==='object'?value:fallback}catch{return fallback}};
 const normaliseHex=value=>{const raw=String(value||'').trim().replace(/^#/,'');return /^(?:[\da-fA-F]{3}|[\da-fA-F]{6})$/.test(raw)?'#'+(raw.length===3?[...raw].map(c=>c+c).join(''):raw).toLowerCase():null};
 let recipe=blank();
 async function api(path,body){
  const response=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-TEM-Token':config.token},body:JSON.stringify(body)});
  const value=await response.json();if(!response.ok)throw new Error(value.error||'Request failed.');return value;
 }
 function status(text,error=false){$('fig-status').textContent=text;$('fig-error').textContent=error?text:''}
 function draft(){WorkbenchWorkspace.writeRaw('tem-figures-draft-v1',JSON.stringify(recipe));WorkbenchWorkspace.writeRaw('tem-figures-current-v1',currentId)}
 function chooseSaved(){
  const select=$('fig-saved');select.replaceChildren(new Option('New figure',''));
  for(const [id,value] of Object.entries(saved).sort((a,b)=>a[1].name.localeCompare(b[1].name)))select.add(new Option(value.name,id));
  select.value=currentId;$('fig-delete').disabled=!currentId;
 }
 function sync(){
  $('fig-name').value=recipe.name;$('fig-rows').value=String(recipe.rows);$('fig-columns').value=String(recipe.columns);
  $('fig-aspect').value=String(recipe.aspect);$('fig-background').value=recipe.background;
  $('fig-count').textContent=`${recipe.slots.filter(slot=>slot.path).length} of ${recipe.slots.length} filled`;
  $('fig-open-browser').disabled=!files.length;
  $('fig-export').disabled=!recipe.slots.length||recipe.slots.some(slot=>!slot.path||slot.scale_mode!=='keep'&&(!slot.scale_nm||!slot.bar_px));
 }
 function inputField(parent,title,type,value,onchange,attrs={}){
  const label=document.createElement('label');label.textContent=title;
  const input=document.createElement('input');input.type=type;input.value=value??'';
  for(const [key,item] of Object.entries(attrs))input.setAttribute(key,item);
  input.addEventListener(type==='range'?'input':'change',()=>onchange(input.value));label.append(input);parent.append(label);
  return input;
 }
 function renderCards(){
  const host=$('fig-slot-content');host.replaceChildren();
  recipe.slots.forEach((slot,index)=>{
   if(index!==selectedPanel)return;
   $('fig-slot-title').textContent=`Panel ${index+1} · row ${Math.floor(index/recipe.columns)+1}, column ${index%recipe.columns+1}`;
   const card=document.createElement('div');card.className='fig-panel'+(index===selectedPanel?' selected':'');
   const head=document.createElement('div');head.className='fig-panel-head';
   const title=document.createElement('strong');title.textContent=`${index+1}. ${slot.label||slot.name||'Empty slot'}`;
   title.tabIndex=0;title.setAttribute('role','button');title.setAttribute('aria-label',`Select panel ${index+1}`);
   const select=()=>{selectedPanel=index;renderCards();sync()};title.onclick=select;title.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select()}};
   head.append(title);
   for(const [text,delta] of [['↑',-1],['↓',1]]){
    const button=document.createElement('button');button.type='button';button.textContent=text;button.title=`Move panel ${delta<0?'up':'down'}`;
    button.disabled=index+delta<0||index+delta>=recipe.slots.length;
    button.onclick=()=>{[recipe.slots[index],recipe.slots[index+delta]]=[recipe.slots[index+delta],recipe.slots[index]];selectedPanel=index+delta;changed(true)};head.append(button);
   }
   const remove=document.createElement('button');remove.type='button';remove.textContent='Clear';remove.title='Clear this slot';remove.disabled=!slot.path;
   remove.onclick=()=>{recipe.slots[index]={};changed(true)};head.append(remove);card.append(head);
   const choose=document.createElement('button');choose.type='button';choose.textContent=slot.path?'Replace image…':'Choose image…';
   choose.onclick=openImageBrowser;card.append(choose);
   if(!slot.path){const note=document.createElement('p');note.className='hint';note.textContent='Choose an image for this slot.';card.append(note);host.append(card);return}
   const viewActions=document.createElement('div');viewActions.className='fig-view-actions';
   const compare=document.createElement('button');compare.type='button';compare.textContent='Compare original';compare.onclick=()=>showOriginal(slot);
   const resetZoom=document.createElement('button');resetZoom.type='button';resetZoom.textContent='Reset zoom';resetZoom.onclick=()=>{slot.zoom=1;changed(true)};
   const centre=document.createElement('button');centre.type='button';centre.textContent='Centre crop';centre.onclick=()=>{slot.center_x=.5;slot.center_y=.5;changed(true)};
   viewActions.append(compare,resetZoom,centre);card.append(viewActions);
   const fields=document.createElement('div');fields.className='fig-panel-fields';
   inputField(fields,'Export label','text',slot.label,value=>{slot.label=value;title.textContent=`${index+1}. ${value||slot.name}`;changed()}, {maxlength:'120'});
   const colourLabel=document.createElement('label');colourLabel.textContent='Label shade';const colourRow=document.createElement('span');colourRow.className='fig-colour-row';
   const picker=document.createElement('input');picker.type='color';picker.value=normaliseHex(slot.label_colour)||'#0c131c';picker.setAttribute('aria-label',`Pick label shade for panel ${index+1}`);
   const hex=document.createElement('input');hex.type='text';hex.maxLength=7;hex.placeholder='#RRGGBB';hex.value=normaliseHex(slot.label_colour)||'';hex.setAttribute('aria-label',`Hex label shade for panel ${index+1}`);
   const reset=document.createElement('button');reset.type='button';reset.textContent='↺';reset.title='Use default label shade';
   picker.oninput=()=>{slot.label_colour=picker.value;hex.value=picker.value;hex.setAttribute('aria-invalid','false');changed()};
   hex.oninput=()=>{const colour=normaliseHex(hex.value);hex.setAttribute('aria-invalid',String(Boolean(hex.value)&&!colour));if(colour){slot.label_colour=colour;picker.value=colour;changed()}else if(!hex.value){slot.label_colour=null;changed()}};
   hex.onchange=()=>{const colour=normaliseHex(hex.value);if(colour)hex.value=colour};
   reset.onclick=()=>{slot.label_colour=null;hex.value='';picker.value='#0c131c';hex.setAttribute('aria-invalid','false');changed()};
   colourRow.append(picker,hex,reset);colourLabel.append(colourRow);fields.append(colourLabel);
   const modeLabel=document.createElement('label');modeLabel.textContent='Scale display';const mode=document.createElement('select');
   mode.add(new Option('Trim footer + new bar','replace'));mode.add(new Option('Keep source image','keep'));
   mode.value=slot.scale_mode||'replace';mode.onchange=()=>{slot.scale_mode=mode.value;changed(true)};modeLabel.append(mode);fields.append(modeLabel);
   const keep=slot.scale_mode==='keep';
   inputField(fields,'Zoom ×','number',slot.zoom||1,value=>{slot.zoom=Number(value);changed()}, {min:'1',max:'20',step:'0.1'});
   inputField(fields,'Field ends at row','number',slot.content_height,value=>{slot.content_height=Number(value);changed()}, {min:'1',max:String(slot.height),step:'1'}).disabled=keep;
   inputField(fields,'Centre X, %','range',Math.round((slot.center_x??.5)*100),value=>{slot.center_x=Number(value)/100;changed()}, {min:'0',max:'100',step:'1'});
   inputField(fields,'Centre Y, %','range',Math.round((slot.center_y??.5)*100),value=>{slot.center_y=Number(value)/100;changed()}, {min:'0',max:'100',step:'1'});
   const unit=(slot.scale_nm||0)>=1000?'µm':'nm',factor=unit==='µm'?1000:1;
   const valueInput=inputField(fields,'Printed bar value','number',slot.scale_nm?slot.scale_nm/factor:'',value=>{slot.scale_nm=value?Number(value)*Number(unitSelect.value==='µm'?1000:1):null;changed()}, {min:'0.001',step:'any'});
   valueInput.disabled=keep;
   const unitLabel=document.createElement('label');unitLabel.textContent='Unit';const unitSelect=document.createElement('select');
   for(const name of ['nm','µm'])unitSelect.add(new Option(name,name));unitSelect.value=unit;
   unitSelect.onchange=()=>{if(slot.scale_nm)valueInput.value=slot.scale_nm/(unitSelect.value==='µm'?1000:1);changed()};
   unitSelect.disabled=keep;
   unitLabel.append(unitSelect);fields.append(unitLabel);
   inputField(fields,'Printed bar width, px','number',slot.bar_px??'',value=>{slot.bar_px=value?Number(value):null;changed()}, {min:'1',step:'1'}).disabled=keep;
   const positionLabel=document.createElement('label');positionLabel.textContent='Scale bar position';const position=document.createElement('select');
   for(const name of ['Left','Right'])position.add(new Option(name,name.toLowerCase()));position.value=slot.scale_position||'left';
   position.onchange=()=>{slot.scale_position=position.value;changed()};position.disabled=keep;positionLabel.append(position);fields.append(positionLabel);
   card.append(fields);
   const note=document.createElement('p');note.className='hint';note.textContent=`${slot.name} · ${slot.width} × ${slot.height} px · ${slot.footer_detected?'footer detected':'no footer detected'} · ${slot.scale_source||'confirm printed scale value'}${slot.analysis?` · linked analysis: ${slot.analysis.path.split(/[\\/]/).at(-1)}`:''}`;card.append(note);
   host.append(card);
  });
  sync();
 }
 function openSlot(index){
  if(index<0||index>=recipe.slots.length)return;
  selectedPanel=index;renderCards();
  if(!$('fig-slot-dialog').open)$('fig-slot-dialog').showModal();
 }
 async function showOriginal(slot){
  const dialog=$('fig-original-dialog');$('fig-original-title').textContent=`Compare original · ${slot.name}`;
  $('fig-original-note').textContent=`Image field ends at row ${slot.content_height} of ${slot.height}. Printed bar: ${slot.bar_px||'not found'} px${slot.sidecar_bar_px?` (TXT: ${slot.sidecar_bar_px} px)`:''}${slot.scale_nm?` · ${slot.scale_nm>=1000?slot.scale_nm/1000+' µm':slot.scale_nm+' nm'}`:' · value needs confirmation'}.`;
  $('fig-original-image').removeAttribute('src');$('fig-panel-image').removeAttribute('src');dialog.showModal();
  try{const [original,panel]=await Promise.all([api('figures/original',{path:slot.path}),api('figures/panel',{slot,aspect:recipe.aspect})]);
   if(!dialog.open)return;$('fig-original-image').src=original.image;$('fig-panel-image').src=panel.image;
  }catch(error){$('fig-original-note').textContent=error.message}
 }
 function schedulePreview(){
  clearTimeout(timer);const revision=++renderVersion;
  timer=setTimeout(async()=>{
   try{const value=await api('figures/render',{recipe});if(revision!==renderVersion)return;
    $('fig-preview').src=value.image;$('fig-preview').hidden=false;status('Preview updated.');}
   catch(error){if(revision!==renderVersion)return;$('fig-preview').hidden=true;status(error.message,true)}
  },160);
 }
 function changed(cards=false){draft();if(cards)renderCards();else sync();schedulePreview()}
 function populateProjects(){
  const select=$('fig-project'),remembered=WorkbenchWorkspace.readRaw('tem-figures-project');
  const previous=select.dataset.populated==='true'?select.value:remembered!==null?remembered:WorkbenchWorkspace.get('active_project','');
  select.replaceChildren(new Option('Custom folder',''),...(config.sources||[]).map(source=>new Option(source.name||source.path,source.id)));
  select.value=(config.sources||[]).some(source=>source.id===previous)?previous:'';select.dataset.populated='true';
  $('fig-folder-controls').hidden=Boolean(select.value);
 }
 function previewUrl(row){return row.id&&row.has_preview?'/api/file-preview?id='+encodeURIComponent(row.id):'/api/figures/thumbnail?path='+encodeURIComponent(row.path)}
 function hideHover(){clearTimeout(hoverTimer);$('fig-browser-hover').hidden=true}
 function positionHover(x,y){
  const host=$('fig-browser-hover'),box=host.getBoundingClientRect(),gap=16;
  let left=x+gap;if(left+box.width>innerWidth-8)left=x-box.width-gap;
  host.style.left=Math.max(8,Math.min(left,innerWidth-box.width-8))+'px';
  host.style.top=Math.max(8,Math.min(y+gap,innerHeight-box.height-8))+'px';
 }
 function showHover(row,x,y){
  hideHover();hoverTimer=setTimeout(()=>{
   const host=$('fig-browser-hover'),img=$('fig-browser-hover-image');
   $('fig-browser-hover-name').textContent=row.name;img.src=previewUrl(row);
   host.hidden=false;positionHover(x,y);img.onload=()=>positionHover(x,y);
  },180);
 }
 function refreshBrowserSize(fromInput=false){
  const input=$('fig-browser-size'),output=$('fig-browser-size-value'),host=$('fig-browser-list');
  const style=getComputedStyle(host),width=host.clientWidth-(parseFloat(style.paddingLeft)||0)-(parseFloat(style.paddingRight)||0);
  if(width<=0)return;
  const gap=parseFloat(style.columnGap)||12,extra=18;
  const minimum=Math.max(1,Math.ceil((width+gap)/(240+extra+gap)));
  const maximum=Math.max(minimum,Math.floor((width+gap)/(80+extra+gap)));
  const choices=Array.from({length:maximum-minimum+1},(_,index)=>{
   const columns=minimum+index;return {columns,size:Math.max(1,Math.floor((width-gap*(columns-1))/columns)-extra)};
  });
  const chosen=fromInput?choices.find(choice=>choice.columns===maximum-Number(input.value))||choices[0]
   :choices.reduce((best,choice)=>Math.abs(choice.size-browserPreferred)<Math.abs(best.size-browserPreferred)?choice:best,choices[0]);
  input.min='0';input.max=String(maximum-minimum);input.step='1';input.value=String(maximum-chosen.columns);
  host.style.setProperty('--preview-size',chosen.size+'px');output.textContent=`${chosen.size} px · ${chosen.columns}/row`;
  input.setAttribute('aria-valuetext',`${chosen.size} pixel previews, ${chosen.columns} images per row`);
  if(fromInput){browserPreferred=chosen.size;WorkbenchWorkspace.writeRaw('tem-figures-preview-size',String(browserPreferred))}
 }
 function browserTypeIcon(row){
  const badge=document.createElement('span'),svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  badge.className='image-browser-type';badge.title=row.image_kind==='diffraction'?'Diffraction':'Real space';badge.setAttribute('aria-hidden','true');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.8');
  const add=(tag,attrs)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);svg.append(node)};
  if(row.image_kind==='diffraction'){
   add('circle',{cx:12,cy:12,r:2.2});for(const [cx,cy] of [[5,5],[19,5],[5,19],[19,19],[12,3],[12,21],[3,12],[21,12]])add('circle',{cx,cy,r:1.1,fill:'currentColor',stroke:'none'});
  }else{add('rect',{x:2.5,y:3.5,width:19,height:17,rx:2});add('circle',{cx:8,cy:9,r:1.4,fill:'currentColor',stroke:'none'});add('path',{d:'M4 17l5-5 3 3 4-5 4 5'})}
  badge.append(svg);return badge;
 }
 function browserFormatIcon(row){
  const extension=(row.extension||row.name.match(/\.[^.]+$/)?.[0]||'').replace(/^\./,'').toUpperCase();
  const badge=document.createElement('span'),svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path'),text=document.createElement('span');
  badge.className='image-browser-format';badge.title=extension+' file';badge.setAttribute('aria-hidden','true');
  svg.setAttribute('viewBox','0 0 16 18');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.5');path.setAttribute('d','M3 1h7l3 3v13H3z M10 1v4h3');svg.append(path);
  text.textContent=extension;badge.append(svg,text);return badge;
 }
 function renderBrowser(){
  const host=$('fig-browser-list'),term=$('fig-browser-search').value.trim().toLocaleLowerCase();host.replaceChildren();
  const visible=files.filter(row=>(row.name+' '+row.path).toLocaleLowerCase().includes(term));
  $('fig-browser-count').textContent=`${visible.length} image${visible.length===1?'':'s'}`;
  for(const row of visible){
   const tile=document.createElement('button');tile.type='button';tile.className='image-browser-tile';tile.title=row.path;
   tile.setAttribute('aria-label',`Use ${row.name} in panel ${selectedPanel+1}`);
   const picture=document.createElement('span');picture.className='image-browser-preview';
   const placeholder=document.createElement('span');placeholder.className='muted';placeholder.textContent='Loading preview…';picture.append(placeholder);
   const image=document.createElement('img');image.alt='';image.loading='lazy';image.decoding='async';image.src=previewUrl(row);
   image.onload=()=>placeholder.hidden=true;image.onerror=()=>{placeholder.textContent='Preview unavailable';image.remove()};picture.append(image);
   picture.append(browserTypeIcon(row),browserFormatIcon(row));
   const name=document.createElement('strong');name.className='image-browser-name';
   const stem=row.name.replace(/\.[^.]+$/,''),match=stem.match(/^(.*?)[_\s-](\d+)$/);
   const description=document.createElement('span');description.className='image-browser-name-text';description.textContent=match?match[1]:stem;name.append(description);
   if(match){const number=document.createElement('span');number.className='image-browser-number';number.textContent='#'+match[2];name.append(number)}
   const group=document.createElement('small');group.textContent=row.folder&&row.folder!=='.'?row.folder:row.sample||'Selected folder';group.title=row.relative_path||row.path;
   tile.append(picture,name,group);
   tile.onmouseenter=event=>showHover(row,event.clientX,event.clientY);
   tile.onmousemove=event=>{if(!$('fig-browser-hover').hidden)positionHover(event.clientX,event.clientY)};
   tile.onmouseleave=hideHover;
   tile.onfocus=()=>{const rect=tile.getBoundingClientRect();showHover(row,rect.right,rect.top)};
   tile.onblur=hideHover;
   tile.onclick=async()=>{hideHover();if(await add(row.path))$('fig-browser-dialog').close()};host.append(tile);
  }
  if(!visible.length){const empty=document.createElement('p');empty.className='hint';empty.textContent='No matching images.';host.append(empty)}
  refreshBrowserSize();
 }
 function openImageBrowser(){
  $('fig-browser-title').textContent=`Choose image for panel ${selectedPanel+1}`;
  $('fig-browser-search').value='';
  renderBrowser();$('fig-browser-dialog').showModal();refreshBrowserSize();$('fig-browser-search').focus();
 }
 async function scan(){
  $('fig-folder-status').textContent='Scanning…';
  try{
   const project=$('fig-project').value;
   if(project){files=(config.files||[]).filter(row=>row.source_id===project&&/\.(tif|tiff|png|jpe?g)$/i.test(row.path||'')).map(row=>({path:row.path,name:row.name+(row.extension||''),extension:row.extension,id:row.id,has_preview:row.has_preview,sample:row.sample,folder:row.folder,image_kind:row.image_kind}));}
   else{const result=await api('figures/list',{folder:$('fig-folder').value});files=result.images;$('fig-folder').value=result.folder;WorkbenchWorkspace.writeRaw('tem-figures-folder',result.folder)}
   sync();if($('fig-browser-dialog').open)renderBrowser();$('fig-folder-status').textContent=`${files.length} images found${project?' in this project':' in folder and subfolders'}`;
  }catch(error){$('fig-folder-status').textContent=error.message}
 }
 async function add(path){
  if(!path||selectedPanel<0||!recipe.slots[selectedPanel])return;
  const index=selectedPanel;
  try{status('Reading image and scale bar…');const info=await api('figures/inspect',{path});
   const slot={...info,label:info.name.replace(/\.[^.]+$/,''),zoom:1,center_x:.5,center_y:.5};
   recipe.slots[index]=slot;selectedPanel=index;
   changed(true);return true;
  }catch(error){status(error.message,true);return false}
 }
 function loadRecipe(next){recipe=normaliseRecipe(next);selectedPanel=0;renderCards();draft();schedulePreview()}
 function changeLayout(){
  const rows=Number($('fig-rows').value),columns=Number($('fig-columns').value),total=rows*columns;
  if(recipe.slots.slice(total).some(slot=>slot.path)){
   status('Clear or move images outside the new layout first.',true);sync();return;
  }
  recipe.rows=rows;recipe.columns=columns;recipe.slots.length=total;
  for(let index=0;index<total;index++)recipe.slots[index]??={};
  selectedPanel=Math.min(selectedPanel,total-1);changed(true);
 }
 async function start(){
  try{
   config=await (await fetch('/api/config')).json();if(!config.token)throw new Error(config.error||'Could not connect to Workbench.');
   await WorkbenchWorkspace.configure(config);$('fig-version').textContent=config.app_version==='development'?'Development':'v'+config.app_version;
   folderBrowser=WorkbenchProjectTools.browser(api);
   projectSettings=WorkbenchProjectTools.sources({api,getConfig:()=>config,chooseFolder:target=>folderBrowser.choose(target),
    onRename:async data=>{config={...config,...data};populateProjects();scan()},
    onSave:async data=>{config={...config,...data};populateProjects();projectSettings.render();scan()}});
   saved=parse(WorkbenchWorkspace.readRaw('tem-figures-saved-v1'),{});
   browserPreferred=Math.max(80,Math.min(240,Number(WorkbenchWorkspace.readRaw('tem-figures-preview-size'))||160));
   currentId=WorkbenchWorkspace.readRaw('tem-figures-current-v1')||'';if(!saved[currentId])currentId='';
   recipe=normaliseRecipe(parse(WorkbenchWorkspace.readRaw('tem-figures-draft-v1'),blank()));
   $('fig-folder').value=WorkbenchWorkspace.readRaw('tem-figures-folder')||config.sources?.[0]?.path||config.data_root||'';
   populateProjects();projectSettings.render();
   chooseSaved();renderCards();schedulePreview();
   $('fig-browse').onclick=()=>folderBrowser.open({path:$('fig-folder').value,title:'Choose image folder',onSelect:path=>{$('fig-folder').value=path;scan()}});$('fig-scan').onclick=scan;
   $('fig-project').onchange=()=>{const value=$('fig-project').value;WorkbenchWorkspace.writeRaw('tem-figures-project',value);if(value)WorkbenchWorkspace.set('active_project',value);$('fig-folder-controls').hidden=Boolean(value);scan()};
   $('fig-project-settings').onclick=()=>WorkbenchProjectTools.showSources($('fig-project-dialog'));
   $('fig-project-close').onclick=()=>$('fig-project-dialog').close();
   $('fig-open-browser').onclick=openImageBrowser;
   $('fig-browser-close').onclick=()=>{$('fig-browser-dialog').close();hideHover()};
   $('fig-browser-dialog').onclose=hideHover;
   $('fig-browser-search').oninput=renderBrowser;
   $('fig-browser-size').oninput=()=>refreshBrowserSize(true);
   new ResizeObserver(()=>{if($('fig-browser-dialog').open)refreshBrowserSize()}).observe($('fig-browser-list'));
   $('fig-slot-close').onclick=()=>$('fig-slot-dialog').close();
   $('fig-original-close').onclick=()=>$('fig-original-dialog').close();
   $('fig-original-size').oninput=()=>{$('fig-original-image').style.width=$('fig-original-size').value+'%'};
   $('fig-folder').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();scan()}};
   $('fig-preview').onclick=event=>{const rect=event.currentTarget.getBoundingClientRect(),scale=event.currentTarget.naturalWidth/rect.width;
    const x=(event.clientX-rect.left)*scale-18,y=(event.clientY-rect.top)*scale-18;
    const tileHeight=Math.round(420/recipe.aspect),column=Math.floor(x/432),row=Math.floor(y/(tileHeight+12)),index=row*recipe.columns+column;
    if(x>=0&&y>=0&&x%432<420&&y%(tileHeight+12)<tileHeight&&column<recipe.columns&&row<recipe.rows)openSlot(index)};
   $('fig-preview').onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openSlot(selectedPanel)}};
   $('fig-name').oninput=()=>{recipe.name=$('fig-name').value;draft()};
   $('fig-rows').onchange=changeLayout;$('fig-columns').onchange=changeLayout;
   for(const [id,key,transform] of [['fig-aspect','aspect',Number],['fig-background','background',String]])$(id).onchange=()=>{recipe[key]=transform($(id).value);changed()};
   $('fig-new').onclick=()=>{currentId='';loadRecipe(blank());chooseSaved()};
   $('fig-saved').onchange=()=>{currentId=$('fig-saved').value;if(currentId)loadRecipe(saved[currentId]);else loadRecipe(blank());chooseSaved()};
   $('fig-save').onclick=async()=>{recipe.name=$('fig-name').value.trim()||'Untitled figure';if(!recipe.slots.some(slot=>slot.path)){status('Choose an image before saving.',true);return}
    currentId=currentId||crypto.randomUUID();saved[currentId]=structuredClone(recipe);WorkbenchWorkspace.writeRaw('tem-figures-saved-v1',JSON.stringify(saved));draft();chooseSaved();await WorkbenchWorkspace.flush();status(`Saved ${recipe.name}.`)};
   $('fig-delete').onclick=async()=>{if(!currentId)return;delete saved[currentId];currentId='';WorkbenchWorkspace.writeRaw('tem-figures-saved-v1',JSON.stringify(saved));chooseSaved();await WorkbenchWorkspace.flush();status('Saved figure deleted. Current panels remain open.')};
   $('fig-export').onclick=async()=>{try{status('Exporting full-resolution figure…');const result=await api('figures/export',{recipe});status(`Saved ${result.png} and ${result.recipe}`)}catch(error){status(error.message,true)}};
   if($('fig-folder').value)scan();
  }catch(error){status(error.message,true)}
 }
 document.addEventListener('DOMContentLoaded',start);
})();

/* Editable figure recipes; original images are read only. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 let config,folderBrowser,projectSettings,files=[],selectedPanel=0,currentId='',timer=0,renderVersion=0,hoverTimer=0,browserPreferred=160,indexPoll=0,indexRecords={};
 let saved={};
 let indexStarting=false,indexJob=null;
 let scanVersion=0,browserRoot='',previewPoll=0,previewStarting=false,previewJob=null;
 const metadataFilters=[['fig-filter-mag','magnification'],['fig-filter-kv','voltage_kv'],['fig-filter-probe','probe'],['fig-filter-wd','working_distance'],['fig-filter-date','acquisition_date']];
 const blank=()=>({schema_version:2,name:'Untitled figure',rows:1,columns:2,aspect:4/3,background:'white',match_tone:false,sharpness:1,crop_metadata:true,scale_bar_overlay:true,scale_bar_position:'left',image_padding:36,export_scale_percent:100,metadata_overlay:[],slots:[{},{}]});
 function normaliseRecipe(value){
  if(!value||!Array.isArray(value.slots))return blank();
  const next=structuredClone(value),columns=Number(next.columns)||2;
  if(columns<1||columns>4||next.slots.length>24)return blank();
  if(Number(next.schema_version||1)<2){
   for(const slot of next.slots)if(slot.scale_mode==='keep'&&slot.height)slot.content_height=slot.height;
   next.schema_version=2;
  }
  for(const slot of next.slots)if(slot.metadata&&typeof slot.metadata==='object')
   for(const [key,entry] of Object.entries(slot.metadata))if(entry?.source==='Filename')delete slot.metadata[key];
  next.match_tone=Boolean(next.match_tone);
  next.crop_metadata=next.crop_metadata!==false;
  next.scale_bar_overlay=next.scale_bar_overlay!==false;
  next.scale_bar_position=['left','right'].includes(next.scale_bar_position)?next.scale_bar_position:'left';
  next.image_padding=Number.isInteger(Number(next.image_padding))&&Number(next.image_padding)>=0&&Number(next.image_padding)<=200?Number(next.image_padding):36;
  next.export_scale_percent=Number.isInteger(Number(next.export_scale_percent))&&Number(next.export_scale_percent)>=25&&Number(next.export_scale_percent)<=100?Number(next.export_scale_percent):100;
  next.sharpness=Number.isFinite(Number(next.sharpness))&&Number(next.sharpness)>=0&&Number(next.sharpness)<=3?Number(next.sharpness):1;
  next.metadata_overlay=Array.isArray(next.metadata_overlay)?next.metadata_overlay.map(key=>key==='probe_current'?'probe':key).filter(key=>['magnification','voltage_kv','probe','working_distance'].includes(key)):[];
  next.columns=columns;next.rows=Math.max(1,Math.min(6,Number(next.rows)||Math.ceil(next.slots.length/columns)||1));
  next.rows=Math.max(next.rows,Math.ceil(next.slots.length/columns));
  if(next.rows*columns>24)return blank();
  while(next.slots.length<next.rows*columns)next.slots.push({});
  return next;
 }
 const parse=(raw,fallback)=>{try{const value=JSON.parse(raw);return value&&typeof value==='object'?value:fallback}catch{return fallback}};
 const normaliseHex=value=>{const raw=String(value||'').trim().replace(/^#/,'');return /^(?:[\da-fA-F]{3}|[\da-fA-F]{6})$/.test(raw)?'#'+(raw.length===3?[...raw].map(c=>c+c).join(''):raw).toLowerCase():null};
 let recipe=blank();
 let outputHover,hoveredPanel=-1,hoveredSource='',hoverEnabled=true,hoverPoint=null;
 let detailCache=new Map(),detailPending=new Map(),dragState=null,dropTarget,panelHighlight,suppressOutputClick=false;
 let panelPreviewTimer=0,panelPreviewRevision=0;
 let annotationTool='select',selectedAnnotation=-1,annotationDrag=null;
 const annotationDefaults={arrowColor:'#ff2020',textColor:'#ffffff',width:3,size:30,text:'β'};
 let estimateTimer=0,estimateVersion=0,estimatedBytes=null,estimateExact=false,estimateError='';
 let tagRows=[];
 async function api(path,body){
  const response=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-TEM-Token':config.token},body:JSON.stringify(body)});
  const value=await response.json();if(!response.ok)throw new Error(value.error||'Request failed.');return value;
 }
 function status(text,error=false){$('fig-status').textContent=text;$('fig-error').textContent=error?text:''}
 function draft(){WorkbenchWorkspace.writeRaw('tem-figures-draft-v1',JSON.stringify(recipe));WorkbenchWorkspace.writeRaw('tem-figures-current-v1',currentId)}
 function exportGeometry(){
  const ratios=recipe.slots.filter(slot=>slot.path).map(slot=>{
   const height=(typeof slot.crop_metadata==='boolean'?slot.crop_metadata:recipe.crop_metadata)
    ?Number(slot.content_height||slot.height):Number(slot.height);
   return Number(slot.width)>0&&height>0?Number(slot.width)/height:null;
  }).filter(value=>value&&Number.isFinite(value)).sort((a,b)=>a-b);
  const middle=Math.floor(ratios.length/2);
  const aspect=recipe.aspect==='auto'?(ratios.length?(ratios.length%2?ratios[middle]:(ratios[middle-1]+ratios[middle])/2):4/3):Number(recipe.aspect);
  if(!Number.isFinite(aspect)||aspect<=0)return null;
  let nativeWidth=1000;
  for(const slot of recipe.slots){
   if(!slot.path)continue;
   const height=(typeof slot.crop_metadata==='boolean'?slot.crop_metadata:recipe.crop_metadata)
    ?Number(slot.content_height||slot.height):Number(slot.height);
   const zoom=Number(slot.zoom||1),width=Number(slot.width);
   if(!Number.isFinite(width)||!Number.isFinite(height)||!Number.isFinite(zoom)||width<=0||height<=0||zoom<=0)return null;
   nativeWidth=Math.max(nativeWidth,Math.ceil(Math.min(width,height*aspect)/zoom));
  }
  const panelWidth=Math.ceil(nativeWidth*recipe.export_scale_percent/100);
  const panelHeight=Math.ceil(panelWidth/aspect),margin=recipe.image_padding;
  const width=recipe.columns*panelWidth+(recipe.columns+1)*margin;
  const rows=Math.ceil(recipe.slots.length/recipe.columns);
  const height=rows*panelHeight+(rows+1)*margin;
  return {width,height,pixels:width*height};
 }
 function fileSize(bytes){return bytes>=1e9?`${(bytes/1e9).toFixed(1)} GB`:bytes>=1e6?`${(bytes/1e6).toFixed(1)} MB`:`${Math.round(bytes/1e3)} kB`}
 function updateExportEstimate(){
  const geometry=exportGeometry(),label=$('fig-export-dimensions');
  if(!geometry){label.dataset.error='false';label.textContent='Choose images to estimate size.';return}
  const dimensions=`${geometry.width.toLocaleString()} × ${geometry.height.toLocaleString()} px`;
  if(geometry.pixels>120_000_000){label.textContent=`${dimensions} · exceeds 120 MP limit`;label.dataset.error='true';return}
  label.dataset.error=String(Boolean(estimateError));
  label.textContent=dimensions+(estimateError?` · ${estimateError}`:
   estimatedBytes!=null?` · ${estimateExact?'':'≈'}${fileSize(estimatedBytes)} PNG`:' · estimating PNG size…');
 }
 function scheduleEstimate(){
  clearTimeout(estimateTimer);const revision=++estimateVersion;
  estimatedBytes=null;estimateExact=false;estimateError='';updateExportEstimate();
  if(!recipe.slots.some(slot=>slot.path))return;
  estimateTimer=setTimeout(async()=>{
   try{const result=await api('figures/estimate',{recipe});if(revision!==estimateVersion)return;
    estimatedBytes=result.estimated_size_bytes;estimateExact=Boolean(result.exact);updateExportEstimate()}
   catch(error){if(revision!==estimateVersion)return;estimateError=error.message;updateExportEstimate()}
  },450);
 }
 function chooseSaved(){
  const select=$('fig-saved');select.replaceChildren(new Option('New figure',''));
  for(const [id,value] of Object.entries(saved).sort((a,b)=>a[1].name.localeCompare(b[1].name)))select.add(new Option(value.name,id));
  select.value=currentId;$('fig-delete').disabled=!currentId;
 }
 function sync(){
  $('fig-name').value=recipe.name;$('fig-rows').value=String(recipe.rows);$('fig-columns').value=String(recipe.columns);
  $('fig-aspect').value=String(recipe.aspect);$('fig-background').value=recipe.background;
  $('fig-match-tone').checked=recipe.match_tone;
  $('fig-sharpness').value=String(recipe.sharpness);
  $('fig-sharpness-value').textContent=Number(recipe.sharpness).toFixed(1)+'×';
  $('fig-crop-on').setAttribute('aria-pressed',String(recipe.crop_metadata));
  $('fig-crop-off').setAttribute('aria-pressed',String(!recipe.crop_metadata));
  $('fig-hover-on').setAttribute('aria-pressed',String(hoverEnabled));
  $('fig-hover-off').setAttribute('aria-pressed',String(!hoverEnabled));
  $('fig-scale-bar-overlay').checked=recipe.scale_bar_overlay;
  $('fig-scale-position-control').hidden=!recipe.scale_bar_overlay;
  $('fig-scale-left').setAttribute('aria-pressed',String(recipe.scale_bar_position==='left'));
  $('fig-scale-right').setAttribute('aria-pressed',String(recipe.scale_bar_position==='right'));
  $('fig-image-padding').value=String(recipe.image_padding);
  $('fig-export-scale').value=String(recipe.export_scale_percent);
  $('fig-export-scale-number').value=String(recipe.export_scale_percent);
  for(const input of document.querySelectorAll('[data-figure-meta]'))input.checked=recipe.metadata_overlay.includes(input.dataset.figureMeta);
  $('fig-count').textContent=`${recipe.slots.filter(slot=>slot.path).length} of ${recipe.slots.length} filled`;
  $('fig-open-browser').disabled=!files.length;
  $('fig-export').disabled=!recipe.slots.length||(exportGeometry()?.pixels||0)>120_000_000||recipe.slots.some(slot=>!slot.path||
   recipe.scale_bar_overlay&&slot.scale_mode!=='keep'&&(slot.scale_mode==='metadata'?!slot.pixel_size_nm:!slot.scale_nm||!slot.bar_px));
  updateExportEstimate();
 }
 function saveTags(){WorkbenchWorkspace.writeRaw('tem-figures-tags-v1',JSON.stringify(tagRows))}
 function tagError(message,error=true){$('fig-tags-status').textContent=message;$('fig-tags-status').dataset.error=String(error)}
 function validateTags(){
  const seen=new Set();let error='';
  for(const [index,row] of tagRows.entries()){
   const label=String(row.label||'').trim(),key=label.toLocaleLowerCase();
   const duplicate=Boolean(label&&seen.has(key));
   if(label)seen.add(key);
   const invalidColour=Boolean(row.colour&&!normaliseHex(row.colour));
   const invalidLabel=!label||label.length>120;
   const item=$('fig-tags-list').children[index];
   if(item){item.querySelector('.fig-tag-name').setAttribute('aria-invalid',String(invalidLabel||duplicate));
    item.querySelector('.fig-tag-hex').setAttribute('aria-invalid',String(invalidColour));
    item.classList.toggle('duplicate',duplicate)}
   if(!error)error=duplicate?`Duplicate tag: ${label}`:invalidColour?'Use a 6-digit hex colour.':invalidLabel?'Enter a label of 1–120 characters.':'';
  }
  $('fig-tags-export').disabled=!tagRows.length||Boolean(error);
  tagError(error||`${tagRows.length} tag${tagRows.length===1?'':'s'} ready`,Boolean(error));
 }
 function tagInk(colour){
  if(!colour)return '#fff';
  const channels=[1,3,5].map(start=>parseInt(colour.slice(start,start+2),16)/255)
   .map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);
  return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722>.179?'#0b1520':'#fff';
 }
 function renderTags(){
  const list=$('fig-tags-list');list.replaceChildren();
  tagRows.forEach((row,index)=>{
   const item=document.createElement('div');item.className='fig-tag-row';
   const preview=document.createElement('span');preview.className='fig-tag-preview';
   const updatePreview=()=>{const colour=normaliseHex(row.colour);
    preview.textContent=row.label.trim()||'Tag';preview.style.background=colour||'rgba(5,10,16,.78)';preview.style.color=tagInk(colour)};
   const name=document.createElement('input');name.className='fig-tag-name';name.type='text';name.maxLength=120;
   name.placeholder='Tag text';name.setAttribute('aria-label',`Tag ${index+1} text`);name.value=row.label;
   name.oninput=()=>{row.label=name.value;updatePreview();saveTags();validateTags()};
   const picker=document.createElement('input');picker.type='color';picker.value=normaliseHex(row.colour)||'#0c131c';
   picker.setAttribute('aria-label',`Tag ${index+1} shade picker`);
   const hex=document.createElement('input');hex.className='fig-tag-hex';hex.type='text';hex.placeholder='Default or #RRGGBB';
   hex.setAttribute('aria-label',`Tag ${index+1} shade hex`);hex.value=row.colour||'';
   picker.oninput=()=>{row.colour=picker.value;hex.value=row.colour;updatePreview();saveTags();validateTags()};
   hex.oninput=()=>{row.colour=hex.value.trim();if(normaliseHex(row.colour))picker.value=normaliseHex(row.colour);
    updatePreview();saveTags();validateTags()};
   const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.title=`Remove tag ${index+1}`;
   remove.setAttribute('aria-label',`Remove tag ${index+1}`);remove.onclick=()=>{tagRows.splice(index,1);saveTags();renderTags()};
   updatePreview();item.append(preview,name,picker,hex,remove);list.append(item);
  });
  validateTags();
 }
 function addTagSet(rows){
  const seen=new Set(tagRows.map(row=>row.label.trim().toLocaleLowerCase()));
  const additions=rows.filter(row=>{const key=String(row.label||'').trim().toLocaleLowerCase();
   if(!key||seen.has(key))return false;seen.add(key);return true});
  if(!additions.length){tagError('No new labels found.');return}
  const existing=tagRows.length===1&&!tagRows[0].label.trim()?0:tagRows.length;
  if(existing+additions.length>500){tagError('At most 500 tags can be exported together.');return}
  if(tagRows.length===1&&!tagRows[0].label.trim())tagRows=[];
  tagRows.push(...additions);saveTags();renderTags();
 }
 function projectTags(){
  return files.map(row=>{
   const stem=String(row.name||'').replace(/\.[^.]+$/,'');
   const prefix=stem.match(/^([A-Za-z][A-Za-z0-9-]{0,30})[ _-]/)?.[1];
   return {label:String(row.sample||prefix||row.folder?.split('/').filter(Boolean).at(0)||'').trim(),colour:''};
  }).filter(row=>row.label&&row.label!=='.');
 }
 function inputField(parent,title,type,value,onchange,attrs={},live=false){
  const label=document.createElement('label');label.textContent=title;
  const input=document.createElement('input');input.type=type;
  for(const [key,item] of Object.entries(attrs))input.setAttribute(key,item);
  input.value=value??'';
  input.addEventListener(type==='range'||live?'input':'change',()=>onchange(input.value));label.append(input);parent.append(label);
  return input;
 }
 function panelDisplayName(slot){
  if(!slot.path)return 'Empty slot';
  const original=slot.name||slot.path.split(/[\\/]/).at(-1);
  return `${original}${slot.label?` [${slot.label}]`:''}`;
 }
 function schedulePanelPreview(){
  clearTimeout(panelPreviewTimer);const revision=++panelPreviewRevision;
  const dialog=$('fig-slot-dialog'),slot=recipe.slots[selectedPanel],image=dialog.querySelector('.fig-live-preview img');
  const note=dialog.querySelector('.fig-live-preview-status');
  if(!dialog.open||!slot?.path||!image||!note)return;
  note.textContent='Updating preview…';
  panelPreviewTimer=setTimeout(async()=>{
   try{const result=await api('figures/panel',{slot:{...slot,annotations:[]},aspect:recipe.aspect,
    metadata_overlay:recipe.metadata_overlay,recipe,width:800});
    if(revision!==panelPreviewRevision||!dialog.open)return;
    image.src=result.image;note.textContent='';
   }catch(error){if(revision===panelPreviewRevision&&dialog.open)note.textContent=error.message}
  },180);
 }
 const svgNode=(tag,attributes={})=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));return node};
 const clamp=value=>Math.max(0,Math.min(1,value));
 function annotationAtoms(value){
  const atoms=[];for(let index=0;index<value.length;index++){
   let char=value[index],escaped=false;
   if(char==='\\'&&index+1<value.length){char=value[++index];escaped=true}
   if(!escaped&&(char==='_'||char==='^')&&atoms.length&&index+1<value.length){
    let script;if(value[index+1]==='{'){const end=value.indexOf('}',index+2);
     if(end<0){atoms.push({base:char,sub:'',sup:''});continue}
     script=value.slice(index+2,end);index=end;
    }else script=value[++index];
    atoms.at(-1)[char==='_'?'sub':'sup']=script;
   }else atoms.push({base:char,sub:'',sup:''});
  }return atoms;
 }
 function annotationChanged(){draft();sync();schedulePreview();scheduleEstimate();renderAnnotationOverlay()}
 function renderAnnotationOverlay(){
  const svg=$('fig-annotation-svg'),image=$('fig-slot-dialog').querySelector('.fig-live-preview img');
  if(!svg||!image)return;
  const slot=recipe.slots[selectedPanel],items=slot.annotations||[];
  const viewHeight=1000*(image.naturalHeight||750)/(image.naturalWidth||1000);
  svg.setAttribute('viewBox',`0 0 1000 ${viewHeight}`);svg.replaceChildren();
  const measure=document.createElement('canvas').getContext('2d');
  items.forEach((item,index)=>{
   const group=svgNode('g',{'data-annotation':index});
   if(item.type==='arrow'){
    const x1=item.x1*1000,y1=item.y1*viewHeight,x2=item.x2*1000,y2=item.y2*viewHeight;
    const distance=Math.hypot(x2-x1,y2-y1)||1,ux=(x2-x1)/distance,uy=(y2-y1)/distance;
    const stroke=Math.max(2,Number(item.width||3)*1000/320),head=Math.min(distance*.55,Math.max(stroke*3,26)),wing=head*.42;
    const bx=x2-ux*head,by=y2-uy*head;
    group.append(svgNode('line',{x1,y1,x2:x2-ux*head*.8,y2:y2-uy*head*.8,stroke:item.color,'stroke-width':stroke,'stroke-linecap':'round'}));
    group.append(svgNode('polygon',{points:`${x2},${y2} ${bx-uy*wing},${by+ux*wing} ${bx+uy*wing},${by-ux*wing}`,fill:item.color}));
    group.append(svgNode('line',{x1,y1,x2,y2,stroke:'transparent','stroke-width':Math.max(20,stroke*3),'data-annotation':index}));
    if(index===selectedAnnotation)for(const [handle,x,y] of [['start',x1,y1],['end',x2,y2]])
     group.append(svgNode('circle',{cx:x,cy:y,r:9,fill:'#fff',stroke:'#111','stroke-width':2,'data-annotation':index,'data-handle':handle}));
   }else if(item.type==='text'){
    const size=Number(item.size||30)*1000/320,small=size*.68;
    let x=item.x*1000,y=item.y*viewHeight;
    for(const atom of annotationAtoms(item.text||'')){
     const base=svgNode('text',{x,y,'font-size':size,'font-family':'system-ui, sans-serif','font-weight':600,
      'dominant-baseline':'text-before-edge',fill:item.color,stroke:'#000','stroke-width':Math.max(2,1000/640),'paint-order':'stroke'});
     base.textContent=atom.base;group.append(base);
     measure.font=`600 ${size}px system-ui`;const after=x+measure.measureText(atom.base).width;
     let extra=0;for(const [key,offset] of [['sup',-.16],['sub',.47]])if(atom[key]){
      const script=svgNode('text',{x:after,y:y+size*offset,'font-size':small,'font-family':'system-ui, sans-serif','font-weight':600,
       'dominant-baseline':'text-before-edge',fill:item.color,stroke:'#000','stroke-width':Math.max(2,1000/640),'paint-order':'stroke'});
      script.textContent=atom[key];group.append(script);measure.font=`600 ${small}px system-ui`;
      extra=Math.max(extra,measure.measureText(atom[key]).width);
     }x=after+extra;
    }
    const hit=svgNode('rect',{x:item.x*1000,y:item.y*viewHeight-10,width:Math.max(24,x-item.x*1000),height:size*1.4,
     fill:'transparent','data-annotation':index});group.append(hit);
    if(index===selectedAnnotation)group.insertBefore(svgNode('rect',{x:item.x*1000-5,y:item.y*viewHeight-10,
     width:Math.max(24,x-item.x*1000)+10,height:size*1.4,fill:'none',stroke:'#5dd6da','stroke-width':2,'pointer-events':'none'}),group.firstChild);
   }
   svg.append(group);
  });
  svg.style.cursor=annotationTool==='select'?'default':'crosshair';
 }
 function annotationEditor(slot,previewPane,previewImage){
  slot.annotations=Array.isArray(slot.annotations)?slot.annotations:[];
  const frame=document.createElement('div');frame.className='fig-annotation-frame';
  const svg=svgNode('svg',{id:'fig-annotation-svg',role:'img','aria-label':'Editable annotations on this panel'});
  frame.append(previewImage,svg);previewPane.append(frame);
  previewImage.onload=renderAnnotationOverlay;
  const tools=document.createElement('div');tools.className='fig-annotation-tools';
  for(const [mode,label] of [['select','Select'],['arrow','Arrow'],['text','Text']]){
   const button=document.createElement('button');button.type='button';button.textContent=label;
   button.onclick=()=>{annotationTool=mode;updateControls();renderAnnotationOverlay()};tools.append(button);
   button.dataset.tool=mode;
  }
  const remove=document.createElement('button');remove.type='button';remove.textContent='Delete';
  remove.onclick=()=>{if(selectedAnnotation<0)return;slot.annotations.splice(selectedAnnotation,1);selectedAnnotation=-1;updateControls();annotationChanged()};tools.append(remove);
  previewPane.append(tools);
  const fields=document.createElement('div');fields.className='fig-annotation-fields';
  const textLabel=document.createElement('label');textLabel.textContent='Text';
  const textInput=document.createElement('input');textInput.type='text';textInput.maxLength=120;
  textInput.placeholder='β or α_p or x^{2+}';textLabel.append(textInput);fields.append(textLabel);
  const greek=document.createElement('details');greek.className='fig-greek-picker';
  const summary=document.createElement('summary');summary.textContent='Greek picker';greek.append(summary);
  const grid=document.createElement('div');grid.className='fig-greek-grid';
  let selectionStart=0,selectionEnd=0;
  const rememberSelection=()=>{selectionStart=textInput.selectionStart;selectionEnd=textInput.selectionEnd};
  for(const letter of 'αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩµ'){
   const button=document.createElement('button');button.type='button';button.textContent=letter;button.title=`Insert ${letter}`;
   button.onpointerdown=event=>event.preventDefault();
   button.onclick=()=>{textInput.setRangeText(letter,selectionStart,selectionEnd,'end');textInput.focus();rememberSelection();
    textInput.dispatchEvent(new Event('input',{bubbles:true}))};grid.append(button);
  }greek.append(grid);fields.append(greek);
  const colourLabel=document.createElement('label');colourLabel.textContent='Colour';
  const colour=document.createElement('input');colour.type='color';colourLabel.append(colour);fields.append(colourLabel);
  const sizeLabel=document.createElement('label');sizeLabel.textContent='Text size';
  const size=document.createElement('input');size.type='number';size.min='12';size.max='72';size.value='30';sizeLabel.append(size);fields.append(sizeLabel);
  const widthLabel=document.createElement('label');widthLabel.textContent='Arrow width';
  const width=document.createElement('input');width.type='number';width.min='1';width.max='12';width.value='3';widthLabel.append(width);fields.append(widthLabel);
  previewPane.append(fields);
  const help=document.createElement('p');help.className='hint fig-annotation-help';help.textContent='Drag to draw an arrow; click to place text. Drag selected items or arrow ends. Use _ and ^ for subscript and superscript; braces group longer text.';previewPane.append(help);
  function updateControls(){
   for(const button of tools.querySelectorAll('[data-tool]'))button.setAttribute('aria-pressed',String(button.dataset.tool===annotationTool));
   const item=slot.annotations[selectedAnnotation];remove.disabled=!item;
   textInput.value=item?.type==='text'?item.text:annotationDefaults.text;
   colour.value=item?.color||annotationDefaults[annotationTool==='arrow'?'arrowColor':'textColor'];size.value=String(item?.type==='text'?item.size:annotationDefaults.size);
   width.value=String(item?.type==='arrow'?item.width:annotationDefaults.width);
   textInput.disabled=Boolean(item&&item.type!=='text');size.disabled=Boolean(item&&item.type!=='text');
   width.disabled=Boolean(item&&item.type!=='arrow');selectionStart=selectionEnd=textInput.value.length;
  }
  textInput.addEventListener('select',rememberSelection);textInput.addEventListener('keyup',rememberSelection);
  textInput.oninput=()=>{rememberSelection();annotationDefaults.text=textInput.value;const item=slot.annotations[selectedAnnotation];
   if(item?.type==='text'){item.text=textInput.value;annotationChanged()}};
  colour.oninput=()=>{const item=slot.annotations[selectedAnnotation];
   annotationDefaults[item?.type==='arrow'||!item&&annotationTool==='arrow'?'arrowColor':'textColor']=colour.value;
   if(item){item.color=colour.value;annotationChanged()}};
  size.onchange=()=>{const value=Number(size.value);if(!Number.isFinite(value)||value<12||value>72){updateControls();return}
   annotationDefaults.size=value;const item=slot.annotations[selectedAnnotation];if(item?.type==='text'){item.size=value;annotationChanged()}};
  width.onchange=()=>{const value=Number(width.value);if(!Number.isFinite(value)||value<1||value>12){updateControls();return}
   annotationDefaults.width=value;const item=slot.annotations[selectedAnnotation];if(item?.type==='arrow'){item.width=value;annotationChanged()}};
  const point=event=>{const box=svg.getBoundingClientRect();return {x:clamp((event.clientX-box.left)/box.width),y:clamp((event.clientY-box.top)/box.height)}};
  svg.onpointerdown=event=>{
   const at=point(event),target=event.target.closest('[data-annotation]');
   if(annotationTool==='arrow'){
    if(slot.annotations.length>=40){status('At most 40 annotations per panel.',true);return}
    selectedAnnotation=slot.annotations.push({type:'arrow',x1:at.x,y1:at.y,x2:at.x,y2:at.y,color:annotationDefaults.arrowColor,width:annotationDefaults.width})-1;
    annotationDrag={index:selectedAnnotation,mode:'end',start:at,original:structuredClone(slot.annotations[selectedAnnotation]),created:true};
   }else if(annotationTool==='text'){
    if(slot.annotations.length>=40){status('At most 40 annotations per panel.',true);return}
    selectedAnnotation=slot.annotations.push({type:'text',x:at.x,y:at.y,text:annotationDefaults.text,color:annotationDefaults.textColor,size:annotationDefaults.size})-1;
    annotationTool='select';updateControls();annotationChanged();textInput.focus();textInput.select();return;
   }else if(target){selectedAnnotation=Number(target.dataset.annotation);
    annotationDrag={index:selectedAnnotation,mode:target.dataset.handle||'move',start:at,original:structuredClone(slot.annotations[selectedAnnotation])};
   }else{selectedAnnotation=-1;updateControls();renderAnnotationOverlay();return}
   svg.setPointerCapture(event.pointerId);updateControls();renderAnnotationOverlay();event.preventDefault();
  };
  svg.onpointermove=event=>{if(!annotationDrag)return;
   const at=point(event),drag=annotationDrag,item=slot.annotations[drag.index],dx=at.x-drag.start.x,dy=at.y-drag.start.y;
   if(item.type==='text'){item.x=clamp(drag.original.x+dx);item.y=clamp(drag.original.y+dy)}
   else if(drag.mode==='move'){
    item.x1=clamp(drag.original.x1+dx);item.y1=clamp(drag.original.y1+dy);
    item.x2=clamp(drag.original.x2+dx);item.y2=clamp(drag.original.y2+dy);
   }else{item[drag.mode==='start'?'x1':'x2']=at.x;item[drag.mode==='start'?'y1':'y2']=at.y}
   renderAnnotationOverlay();
  };
  svg.onpointerup=event=>{if(!annotationDrag)return;
   if(svg.hasPointerCapture(event.pointerId))svg.releasePointerCapture(event.pointerId);
   const item=slot.annotations[annotationDrag.index];
   if(annotationDrag.created&&Math.hypot(item.x2-item.x1,item.y2-item.y)<.005){slot.annotations.splice(annotationDrag.index,1);selectedAnnotation=-1}
   annotationDrag=null;updateControls();annotationChanged();
  };
  svg.onpointercancel=()=>{annotationDrag=null;renderAnnotationOverlay()};
  updateControls();renderAnnotationOverlay();
 }
 function renderCards(){
  const host=$('fig-slot-content');host.replaceChildren();
  recipe.slots.forEach((slot,index)=>{
   if(index!==selectedPanel)return;
   $('fig-slot-title').textContent=`Panel ${index+1} · row ${Math.floor(index/recipe.columns)+1}, column ${index%recipe.columns+1}`;
   const card=document.createElement('div');card.className='fig-panel'+(index===selectedPanel?' selected':'');
   const head=document.createElement('div');head.className='fig-panel-head';
   const title=document.createElement('strong');title.textContent=`${index+1}. ${panelDisplayName(slot)}`;
   title.title=title.textContent;
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
   choose.onclick=openImageBrowser;
   const columns=document.createElement('div');columns.className='fig-popup-columns';
   const sourcePane=document.createElement('section');sourcePane.className='fig-popup-section fig-popup-source';
   const editPane=document.createElement('section');editPane.className='fig-popup-section fig-popup-edit';
   const sourceTitle=document.createElement('h3');sourceTitle.textContent='Source and calibration';
   const editTitle=document.createElement('h3');editTitle.textContent='Panel adjustments';
   const sourceButtons=document.createElement('div');sourceButtons.className='fig-source-buttons';sourceButtons.append(choose);
   const previewPane=document.createElement('section');previewPane.className='fig-popup-section fig-live-preview';
   const previewTitle=document.createElement('h3');previewTitle.textContent='Live panel';
   const previewImage=document.createElement('img');previewImage.alt=`Preview of ${panelDisplayName(slot)}`;
   const previewStatus=document.createElement('p');previewStatus.className='hint fig-live-preview-status';
   previewStatus.setAttribute('role','status');
   if(!slot.path)previewStatus.textContent='Choose an image to preview it.';
   previewPane.append(previewTitle);
   if(slot.path)annotationEditor(slot,previewPane,previewImage);
   previewPane.append(previewStatus);
   sourcePane.append(sourceTitle,sourceButtons);editPane.append(editTitle);
   columns.append(sourcePane,editPane,previewPane);card.append(columns);
   if(!slot.path){const note=document.createElement('p');note.className='hint';note.textContent='Choose an image for this slot.';sourcePane.append(note);host.append(card);return}
   const native=slot.source_format==='dm4'||/\.dm4$/i.test(slot.path);
   const metadata=document.createElement('div');metadata.className='fig-acquisition-meta';
   const metadataTitle=document.createElement('h3');metadataTitle.textContent='Acquisition metadata';metadata.append(metadataTitle);
   for(const [key,label,unit] of [['magnification','Magnification','×'],['voltage_kv','Voltage','kV'],['probe','Probe',''],['working_distance','WD','mm']]){
    const entry=slot.metadata?.[key],field=document.createElement('label');field.textContent=label+(entry?.unit?` · ${entry.unit}`:unit?` · ${unit}`:'');
    if(key==='probe'&&entry?.kind)field.textContent=entry.kind==='number'?'Probe No.':'Probe current';
    const input=document.createElement('input');input.type='number';input.min='0.000001';input.step='any';input.value=entry?.value??'';
    input.placeholder='Unavailable';input.title=entry?.source||'Not found in the source image';
    input.onchange=()=>{slot.metadata??={};slot.metadata[key]={value:Number(input.value)>0?Number(input.value):null,
     unit:entry?.unit||unit,source:'Manual',kind:entry?.kind||(key==='probe'?'number':undefined)};source.textContent='Manual';changed()};
    const source=document.createElement('small');source.textContent=entry?.reported?`${entry.source} reported ${entry.reported}`:entry?.source||'Not found';
    field.append(input,source);metadata.append(field);
   }
   const dateEntry=slot.metadata?.acquisition_date,dateField=document.createElement('label');dateField.textContent='Acquired';
   const dateInput=document.createElement('input');dateInput.type='date';dateInput.value=dateEntry?.value||'';
   dateInput.onchange=()=>{slot.metadata??={};slot.metadata.acquisition_date={value:dateInput.value||null,source:'Manual'};
    dateSource.textContent='Manual';changed()};
   const dateSource=document.createElement('small');dateSource.textContent=dateEntry?.source||(native?'Not recorded in DM4':'Not found in footer, TXT or TIFF');
   dateField.append(dateInput,dateSource);metadata.append(dateField);
   const cropOverride=document.createElement('div');cropOverride.className='fig-crop-override';
   const cropChoice=document.createElement('label'),cropCheck=document.createElement('input');cropCheck.type='checkbox';
   cropCheck.checked=typeof slot.crop_metadata==='boolean';
   cropChoice.append(cropCheck,document.createTextNode('Override figure crop'));
   const cropSwitch=document.createElement('div');cropSwitch.className='signal-toggle';
   cropSwitch.setAttribute('role','group');cropSwitch.setAttribute('aria-label','Crop metadata for this panel');
   const cropOn=document.createElement('button'),cropOff=document.createElement('button');
   cropOn.type=cropOff.type='button';cropOn.textContent='On';cropOff.textContent='Off';
   const effectiveCrop=()=>typeof slot.crop_metadata==='boolean'?slot.crop_metadata:recipe.crop_metadata;
   const updateCropSwitch=()=>{cropOn.disabled=cropOff.disabled=!cropCheck.checked;
    cropOn.setAttribute('aria-pressed',String(effectiveCrop()));cropOff.setAttribute('aria-pressed',String(!effectiveCrop()))};
   cropCheck.onchange=()=>{if(cropCheck.checked)slot.crop_metadata=effectiveCrop();else delete slot.crop_metadata;changed(true)};
   cropOn.onclick=()=>{slot.crop_metadata=true;changed(true)};cropOff.onclick=()=>{slot.crop_metadata=false;changed(true)};
   updateCropSwitch();cropSwitch.append(cropOn,cropOff);cropOverride.append(cropChoice,cropSwitch);metadata.append(cropOverride);
   const modeLabel=document.createElement('label');modeLabel.textContent='Scale display';const mode=document.createElement('select');
   if(slot.pixel_size_nm)mode.add(new Option('Recorded calibration','metadata'));
   mode.add(new Option('Printed scale bar','replace'));mode.add(new Option('No new bar','keep'));
   mode.value=slot.scale_mode||'replace';mode.onchange=()=>{slot.scale_mode=mode.value;changed(true)};
   mode.disabled=!recipe.scale_bar_overlay;
   modeLabel.append(mode);metadata.append(modeLabel);
   const keep=slot.scale_mode==='keep'||!recipe.scale_bar_overlay;
   if(slot.scale_mode==='metadata'){
    const calibration=document.createElement('label');calibration.textContent='Pixel size, nm/px';
    const value=document.createElement('input');value.type='number';value.value=slot.pixel_size_nm;value.readOnly=true;
    const source=document.createElement('small');source.textContent=slot.pixel_size_source||'Recorded calibration';
    calibration.append(value,source);metadata.append(calibration);
   }else{
   const unit=(slot.scale_nm||0)>=1000?'µm':'nm',factor=unit==='µm'?1000:1;
   const valueInput=inputField(metadata,'Printed bar value','number',slot.scale_nm?slot.scale_nm/factor:'',value=>{
    slot.scale_nm=value?Number(value)*Number(unitSelect.value==='µm'?1000:1):null;
    slot.scale_source=value?'Manual':null;changed()
   }, {min:'0.001',step:'any'});valueInput.disabled=keep;
   const unitLabel=document.createElement('label');unitLabel.textContent='Unit';const unitSelect=document.createElement('select');
   for(const name of ['nm','µm'])unitSelect.add(new Option(name,name));unitSelect.value=unit;
   unitSelect.onchange=()=>{if(slot.scale_nm)valueInput.value=slot.scale_nm/(unitSelect.value==='µm'?1000:1);changed()};
   unitSelect.disabled=keep;unitLabel.append(unitSelect);metadata.append(unitLabel);
   inputField(metadata,'Printed bar width, px','number',slot.bar_px??'',value=>{slot.bar_px=value?Number(value):null;changed()}, {min:'1',step:'1'}).disabled=keep;
   }
   const positionLabel=document.createElement('label');positionLabel.textContent='Scale bar position';const position=document.createElement('select');
   position.add(new Option(`Figure (${recipe.scale_bar_position==='left'?'Left':'Right'})`,''));
   for(const name of ['Left','Right'])position.add(new Option(name,name.toLowerCase()));position.value=slot.scale_position||'';
   position.onchange=()=>{if(position.value)slot.scale_position=position.value;else delete slot.scale_position;changed()};position.disabled=keep;
   positionLabel.append(position);metadata.append(positionLabel);
   const styleLabel=document.createElement('label');styleLabel.textContent='Scale bar style';
   const style=document.createElement('select');style.add(new Option('Standard','standard'));
   style.add(new Option('Black plaque','plaque'));style.value=slot.scale_style||'standard';style.disabled=keep;
   style.onchange=()=>{slot.scale_style=style.value;changed()};styleLabel.append(style);metadata.append(styleLabel);
   const footer=document.createElement('section');footer.className='fig-footer-evidence';
   const footerHead=document.createElement('div');footerHead.className='fig-footer-head';
   const footerTitle=document.createElement('strong');footerTitle.textContent='Trimmed metadata bar';
   const fullSize=document.createElement('button');fullSize.type='button';fullSize.textContent='Full size';
   fullSize.setAttribute('aria-pressed','false');fullSize.onclick=()=>{
    const expanded=footer.classList.toggle('expanded');fullSize.textContent=expanded?'Fit width':'Full size';
    fullSize.setAttribute('aria-pressed',String(expanded));
   };
   footerHead.append(footerTitle,fullSize);
   const footerFrame=document.createElement('div');footerFrame.className='fig-footer-frame';
   const footerImage=document.createElement('img');footerImage.alt=`Trimmed source metadata bar for ${slot.name||slot.label||'this image'}`;
   const footerNote=document.createElement('span');footerNote.className='hint';footerNote.textContent='No rows are trimmed at this crop boundary.';
   footerImage.onerror=()=>{footerImage.hidden=true;footerNote.hidden=false;footerNote.textContent='Metadata bar preview unavailable.'};
   footerFrame.append(footerImage,footerNote);
   const updateFooter=()=>{
    const row=Number(slot.content_height??slot.height),trimmed=Number.isFinite(row)&&row>=1&&row<Number(slot.height);
    footerTitle.textContent=native?'Trimmed image rows':effectiveCrop()?'Trimmed metadata bar':'Metadata bar retained';
    footer.hidden=native&&!trimmed;
    footerImage.hidden=!trimmed;footerNote.hidden=trimmed;fullSize.hidden=!trimmed;
    if(trimmed)footerImage.src=`/api/figures/footer?path=${encodeURIComponent(slot.path)}&row=${row}`;
    else footerImage.removeAttribute('src');
   };
   const ocrLabel=document.createElement('strong');ocrLabel.textContent='Footer OCR text';
   const ocrText=document.createElement('pre');ocrText.textContent=slot.footer_ocr_text||'No footer text extracted.';
   footer.append(footerHead,footerFrame);if(!native)footer.append(ocrLabel,ocrText);metadata.append(footer);updateFooter();
   if(slot.footer_ocr_raw_text&&slot.footer_ocr_raw_text!==slot.footer_ocr_text){
    const raw=document.createElement('details');raw.className='fig-ocr-raw';
    const summary=document.createElement('summary');summary.textContent='Uncorrected OCR';
    const text=document.createElement('pre');text.textContent=slot.footer_ocr_raw_text;
    raw.append(summary,text);footer.append(raw);
   }
   sourcePane.append(metadata);
   const sidecarNote=document.createElement('p');sidecarNote.className='hint fig-sidecar-note';
   sidecarNote.textContent=native?'Embedded DM4 metadata · original pixels':slot.metadata_sidecar?`TXT sidecar: ${slot.metadata_sidecar.path.split(/[\\/]/).at(-1)}${slot.metadata_sidecar.checks?.acquired_at?` · acquired ${slot.metadata_sidecar.checks.acquired_at.replace('T',' ')}`:''}`:'No matching TXT sidecar';
   sidecarNote.title=native?'Pixels and calibration are read from the original DM4. PNGs are used only in the image browser.':slot.metadata_sidecar?.path||'Only an exact same-name TXT in this folder is matched.';sourcePane.append(sidecarNote);
   for(const warning of slot.metadata_sidecar?.warnings||[]){const note=document.createElement('p');note.className='fig-meta-warning';note.textContent=warning;sourcePane.append(note)}
   const viewActions=document.createElement('div');viewActions.className='fig-view-actions';
   const compare=document.createElement('button');compare.type='button';compare.textContent='Compare original';compare.onclick=()=>showOriginal(slot);
   const resetZoom=document.createElement('button');resetZoom.type='button';resetZoom.textContent='Reset zoom';resetZoom.onclick=()=>{slot.zoom=1;changed(true)};
   const centre=document.createElement('button');centre.type='button';centre.textContent='Centre crop';centre.onclick=()=>{slot.center_x=.5;slot.center_y=.5;changed(true)};
   viewActions.append(compare,resetZoom,centre);editPane.append(viewActions);
   const fields=document.createElement('div');fields.className='fig-panel-fields';
   inputField(fields,'Export label','text',slot.label,value=>{slot.label=value;
    title.textContent=`${index+1}. ${panelDisplayName(slot)}`;title.title=title.textContent;
    previewImage.alt=`Preview of ${panelDisplayName(slot)}`;changed()}, {maxlength:'120'},true);
   const labelChoice=document.createElement('label');labelChoice.className='fig-label-choice';
   const labelCheck=document.createElement('input');labelCheck.type='checkbox';labelCheck.checked=slot.label_visible!==false;
   labelCheck.onchange=()=>{slot.label_visible=labelCheck.checked;changed()};
   labelChoice.append(labelCheck,document.createTextNode('Show panel label'));fields.append(labelChoice);
   const colourLabel=document.createElement('label');colourLabel.textContent='Label shade';const colourRow=document.createElement('span');colourRow.className='fig-colour-row';
   const picker=document.createElement('input');picker.type='color';picker.value=normaliseHex(slot.label_colour)||'#0c131c';picker.setAttribute('aria-label',`Pick label shade for panel ${index+1}`);
   const hex=document.createElement('input');hex.type='text';hex.maxLength=7;hex.placeholder='#RRGGBB';hex.value=normaliseHex(slot.label_colour)||'';hex.setAttribute('aria-label',`Hex label shade for panel ${index+1}`);
   const reset=document.createElement('button');reset.type='button';reset.textContent='↺';reset.title='Use default label shade';
   picker.oninput=()=>{slot.label_colour=picker.value;hex.value=picker.value;hex.setAttribute('aria-invalid','false');changed()};
   hex.oninput=()=>{const colour=normaliseHex(hex.value);hex.setAttribute('aria-invalid',String(Boolean(hex.value)&&!colour));if(colour){slot.label_colour=colour;picker.value=colour;changed()}else if(!hex.value){slot.label_colour=null;changed()}};
   hex.onchange=()=>{const colour=normaliseHex(hex.value);if(colour)hex.value=colour};
   reset.onclick=()=>{slot.label_colour=null;hex.value='';picker.value='#0c131c';hex.setAttribute('aria-invalid','false');changed()};
   colourRow.append(picker,hex,reset);colourLabel.append(colourRow);fields.append(colourLabel);
   inputField(fields,'Zoom ×','number',slot.zoom||1,value=>{const next=Number(value);
    if(value&&next>=1&&next<=20){slot.zoom=next;changed()}}, {min:'1',max:'20',step:'0.1'},true);
   inputField(fields,'Brightness ×','number',slot.brightness??1,value=>{const next=Number(value);
    if(value&&next>=.25&&next<=3){slot.brightness=next;changed()}}, {min:'0.25',max:'3',step:'0.05'},true);
   inputField(fields,'Contrast ×','number',slot.contrast??1,value=>{const next=Number(value);
    if(value&&next>=.25&&next<=3){slot.contrast=next;changed()}}, {min:'0.25',max:'3',step:'0.05'},true);
   const sharpnessControl=document.createElement('div');sharpnessControl.className='fig-panel-sharpness';
   const sharpnessChoice=document.createElement('label');const sharpnessCheck=document.createElement('input');
   sharpnessCheck.type='checkbox';sharpnessCheck.checked=slot.sharpness!=null;
   sharpnessChoice.append(sharpnessCheck,document.createTextNode('Override sharpness'));
   const sharpnessValue=document.createElement('output');
   const sharpnessSlider=document.createElement('input');sharpnessSlider.type='range';
   sharpnessSlider.min='0';sharpnessSlider.max='3';sharpnessSlider.step='0.1';
   sharpnessSlider.value=String(slot.sharpness??recipe.sharpness);sharpnessSlider.disabled=!sharpnessCheck.checked;
   const refreshSharpness=()=>{sharpnessValue.textContent=Number(sharpnessSlider.value).toFixed(1)+'×'};
   sharpnessCheck.onchange=()=>{sharpnessSlider.disabled=!sharpnessCheck.checked;
    if(sharpnessCheck.checked)slot.sharpness=Number(sharpnessSlider.value);
    else{delete slot.sharpness;sharpnessSlider.value=String(recipe.sharpness)}
    refreshSharpness();changed()};
   sharpnessSlider.oninput=()=>{slot.sharpness=Number(sharpnessSlider.value);refreshSharpness();changed()};
   refreshSharpness();sharpnessControl.append(sharpnessChoice,sharpnessValue,sharpnessSlider);fields.append(sharpnessControl);
   const rowInput=inputField(fields,'Keep rows through','number',slot.content_height,value=>{slot.content_height=Number(value);cropSlider.value=value;updateFooter();changed()}, {min:'1',max:String(slot.height),step:'1'});
   const cropSlider=inputField(fields,'Bottom crop','range',slot.content_height,value=>{slot.content_height=Number(value);rowInput.value=value;updateFooter();changed()}, {min:'1',max:String(slot.height),step:'1'});
   rowInput.disabled=cropSlider.disabled=!effectiveCrop();rowInput.title=slot.content_height_source||'Image pixels';
   const detect=document.createElement('button');detect.type='button';detect.textContent=native?'Reread metadata':'Re-detect footer';
   detect.title=native?'Reread the original DM4 metadata. Keep manual edits.':'Reread this image’s footer, printed bar and OCR. Keep manual metadata and crop edits.';
   detect.onclick=async()=>{try{status(native?'Reading DM4 metadata…':'Checking image footer…');const info=await api('figures/inspect',{path:slot.path});
    if(info.sha256!==slot.sha256)throw new Error('The source image changed. Replace this panel to use the new file.');
    if(slot.detected_content_height!=null&&slot.content_height===slot.detected_content_height)
     slot.content_height=info.content_height;
    slot.detected_content_height=info.content_height;slot.footer_detected=info.footer_detected;
    slot.content_height_source=info.content_height_source;slot.pixel_size_nm=info.pixel_size_nm;slot.pixel_size_source=info.pixel_size_source;
    if(info.pixel_size_nm&&slot.scale_source!=='Manual')slot.scale_mode='metadata';
    if(slot.bar_px===slot.bar?.w||slot.bar_px==null)slot.bar_px=info.bar_px;
    slot.bar=info.bar;
    const oldScaleSource=slot.scale_source;slot.sidecar_bar_px=info.sidecar_bar_px;
    if(!slot.scale_nm||/sidecar/i.test(oldScaleSource||'')){
     slot.scale_nm=info.scale_nm;slot.scale_source=info.scale_source}
    const manual=Object.fromEntries(Object.entries(slot.metadata||{}).filter(([,entry])=>entry?.source==='Manual'));
    slot.metadata={...info.metadata,...manual};slot.metadata_sidecar=info.metadata_sidecar;slot.footer_ocr_text=info.footer_ocr_text;
    slot.footer_ocr_raw_text=info.footer_ocr_raw_text;slot.scale_ocr_text=info.scale_ocr_text;
    slot.ocr_available=info.ocr_available;slot.inspection_version=info.inspection_version;
    changed(true);
    status(native?'DM4 metadata refreshed.':info.footer_detected?`Footer found at row ${info.content_height}.`:'No footer found. Set the crop row manually if needed.');
   }catch(error){status(error.message,true)}};
   sourceButtons.append(detect);
   inputField(fields,'Centre X, %','range',Math.round((slot.center_x??.5)*100),value=>{slot.center_x=Number(value)/100;changed()}, {min:'0',max:'100',step:'1'});
   inputField(fields,'Centre Y, %','range',Math.round((slot.center_y??.5)*100),value=>{slot.center_y=Number(value)/100;changed()}, {min:'0',max:'100',step:'1'});
   editPane.append(fields);
   const note=document.createElement('p');note.className='hint';note.textContent=`${slot.name} · ${slot.width} × ${slot.height} px · ${effectiveCrop()?slot.height-(slot.content_height||slot.height):0} bottom rows removed · ${(slot.scale_mode==='metadata'?slot.pixel_size_source:slot.scale_source)||(native?'No spatial calibration recorded':'confirm printed scale value')}${slot.analysis?` · linked analysis: ${slot.analysis.path.split(/[\\/]/).at(-1)}`:''}`;editPane.append(note);
   host.append(card);
  });
  sync();
 }
 function openSlot(index){
  if(index<0||index>=recipe.slots.length)return;
  hideOutputHover();
  selectedPanel=index;selectedAnnotation=-1;annotationTool='select';renderCards();
  if(!$('fig-slot-dialog').open)$('fig-slot-dialog').showModal();
  schedulePanelPreview();
 }
 function previewPanelHit(event){
  const image=event.currentTarget,rect=image.getBoundingClientRect();
  if(!image.naturalWidth||!rect.width)return null;
  const scale=image.naturalWidth/rect.width,width=420;
  const margin=Math.round((image.naturalWidth-recipe.columns*width)/(recipe.columns+1)),gap=margin;
  const height=Math.round((image.naturalHeight-(recipe.rows+1)*gap)/recipe.rows);
  const x=(event.clientX-rect.left)*scale-margin,y=(event.clientY-rect.top)*scale-margin;
  const column=Math.floor(x/(width+gap)),row=Math.floor(y/(height+gap));
  if(x<0||y<0||column>=recipe.columns||row>=recipe.rows||
     x%(width+gap)>=width||y%(height+gap)>=height)return null;
  return {index:row*recipe.columns+column,x:margin+column*(width+gap),
   y:margin+row*(height+gap),width,height,localX:x% (width+gap),localY:y%(height+gap)};
 }
 function highlightPanel(event){
  if(dragState?.dragging){panelHighlight.hidden=true;return}
  const hit=previewPanelHit(event);
  if(!hit){panelHighlight.hidden=true;return}
  const image=event.currentTarget,scale=image.getBoundingClientRect().width/image.naturalWidth;
  panelHighlight.style.left=hit.x*scale+'px';
  panelHighlight.style.top=hit.y*scale+'px';
  panelHighlight.style.width=hit.width*scale+'px';
  panelHighlight.style.height=hit.height*scale+'px';
  panelHighlight.hidden=false;
 }
 function hideOutputHover(){if(outputHover)outputHover.hidden=true;hoveredPanel=-1;hoverPoint=null}
 function positionOutputHover(x,y){
  const box=outputHover.getBoundingClientRect(),gap=14;
  let left=x+gap;if(left+box.width>innerWidth-8)left=x-box.width-gap;
  outputHover.style.left=Math.max(8,Math.min(left,innerWidth-box.width-8))+'px';
  outputHover.style.top=Math.max(8,Math.min(y+gap,innerHeight-box.height-8))+'px';
 }
 function drawDetailZoom(source,hit,wholeFigure=false){
  const zoom=5,fullWidth=wholeFigure?hit.width:source.naturalWidth;
  const fullHeight=wholeFigure?hit.height:source.naturalHeight;
  const cropWidth=fullWidth/zoom,cropHeight=fullHeight/zoom;
  const left=Math.max(0,Math.min(fullWidth-cropWidth,hit.localX/hit.width*fullWidth-cropWidth/2));
  const top=Math.max(0,Math.min(fullHeight-cropHeight,hit.localY/hit.height*fullHeight-cropHeight/2));
  const canvas=document.createElement('canvas');canvas.width=560;
  canvas.height=Math.round(canvas.width*cropHeight/cropWidth);
  canvas.getContext('2d').drawImage(source,(wholeFigure?hit.x:0)+left,(wholeFigure?hit.y:0)+top,
   cropWidth,cropHeight,0,0,canvas.width,canvas.height);
  outputHover.querySelector('img').src=canvas.toDataURL('image/png');
 }
 function showOutputHover(event){
  highlightPanel(event);
  if(!hoverEnabled||dragState?.dragging){hideOutputHover();return}
  const hit=previewPanelHit(event),slot=hit&&recipe.slots[hit.index];
  if(!slot?.path){hideOutputHover();return}
  const image=event.currentTarget;
  hoverPoint={hit,x:event.clientX,y:event.clientY};
  const key=`${renderVersion}:${hit.index}`,detail=detailCache.get(key);
  drawDetailZoom(detail||image,hit,!detail);
  outputHover.querySelector('span').textContent=`Panel ${hit.index+1} · 5× detail · ${slot.label||slot.name}`;
  hoveredPanel=hit.index;hoveredSource=image.src;
  if(!detail&&!detailPending.has(key)){
   const request=api('figures/panel',{slot,aspect:recipe.aspect,metadata_overlay:recipe.metadata_overlay,
    recipe,width:1600}).then(result=>new Promise((resolve,reject)=>{
     const full=new Image();full.onload=()=>resolve(full);full.onerror=reject;full.src=result.image;
    })).then(full=>{if(key.startsWith(renderVersion+':')){
      detailCache.set(key,full);if(detailCache.size>8)detailCache.delete(detailCache.keys().next().value);
      if(hoverPoint?.hit.index===hit.index&&!outputHover.hidden){
       drawDetailZoom(full,hoverPoint.hit);positionOutputHover(hoverPoint.x,hoverPoint.y)}
     }}).catch(()=>{}).finally(()=>detailPending.delete(key));
   detailPending.set(key,request);
  }
  outputHover.hidden=false;
  positionOutputHover(event.clientX,event.clientY);
 }
 function startOutputDrag(event){
  if(event.button!==0)return;
  const hit=previewPanelHit(event);
  if(!hit||!recipe.slots[hit.index]?.path)return;
  dragState={from:hit.index,x:event.clientX,y:event.clientY,dragging:false};
  try{event.currentTarget.setPointerCapture(event.pointerId)}catch{}
 }
 function moveOutputPointer(event){
  if(!dragState){showOutputHover(event);return}
  if(!dragState.dragging&&Math.hypot(event.clientX-dragState.x,event.clientY-dragState.y)<8)return;
  dragState.dragging=true;hideOutputHover();panelHighlight.hidden=true;
  const hit=previewPanelHit(event);
  if(!hit||hit.index===dragState.from){dropTarget.hidden=true;return}
  const image=event.currentTarget,rect=image.getBoundingClientRect(),scale=rect.width/image.naturalWidth;
  dropTarget.style.left=rect.left+hit.x*scale+'px';dropTarget.style.top=rect.top+hit.y*scale+'px';
  dropTarget.style.width=hit.width*scale+'px';dropTarget.style.height=hit.height*scale+'px';
  dropTarget.textContent=recipe.slots[hit.index]?.path?'Swap panels':'Move panel';
  dropTarget.hidden=false;
 }
 function finishOutputDrag(event){
  if(!dragState)return;
  const previous=dragState;dragState=null;dropTarget.hidden=true;
  if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  if(!previous.dragging)return;
  suppressOutputClick=true;setTimeout(()=>{suppressOutputClick=false},0);
  const hit=previewPanelHit(event);
  if(!hit||hit.index===previous.from)return;
  [recipe.slots[previous.from],recipe.slots[hit.index]]=[recipe.slots[hit.index],recipe.slots[previous.from]];
  selectedPanel=hit.index;changed(true);
 }
 async function showOriginal(slot){
  const dialog=$('fig-original-dialog');$('fig-original-title').textContent=`Compare original · ${slot.name}`;
  $('fig-original-note').textContent=`Crop ends at row ${slot.content_height} of ${slot.height}. ${slot.scale_mode==='metadata'?`Recorded scale: ${slot.pixel_size_nm} nm/px`:`Printed bar: ${slot.bar_px||'not found'} px`}${slot.sidecar_bar_px?` (TXT: ${slot.sidecar_bar_px} px)`:''}${slot.scale_nm?` · ${slot.scale_nm>=1000?slot.scale_nm/1000+' µm':slot.scale_nm+' nm'}`:slot.scale_mode==='metadata'?'':' · value needs confirmation'}.`;
  $('fig-original-image').removeAttribute('src');$('fig-panel-image').removeAttribute('src');dialog.showModal();
  try{const [original,panel]=await Promise.all([api('figures/original',{path:slot.path}),api('figures/panel',{slot,aspect:recipe.aspect,metadata_overlay:recipe.metadata_overlay,recipe})]);
   if(!dialog.open)return;$('fig-original-image').src=original.image;$('fig-panel-image').src=panel.image;
  }catch(error){$('fig-original-note').textContent=error.message}
 }
 function schedulePreview(){
  clearTimeout(timer);const revision=++renderVersion;detailCache.clear();hideOutputHover();updateExportEstimate();
  timer=setTimeout(async()=>{
   try{const value=await api('figures/render',{recipe});if(revision!==renderVersion)return;
    const image=$('fig-preview');image.src=value.image;image.hidden=false;status('Preview updated.');}
   catch(error){if(revision!==renderVersion)return;$('fig-preview').hidden=true;status(error.message,true)}
  },160);
 }
 function changed(cards=false){draft();if(cards)renderCards();else sync();schedulePreview();scheduleEstimate();schedulePanelPreview()}
 function populateProjects(){
  const select=$('fig-project'),remembered=WorkbenchWorkspace.readRaw('tem-figures-project');
  const previous=select.dataset.populated==='true'?select.value:remembered!==null?remembered:WorkbenchWorkspace.get('active_project','');
  select.replaceChildren(new Option('Custom folder',''),...(config.sources||[]).map(source=>new Option(source.name||source.path,source.id)));
  select.value=(config.sources||[]).some(source=>source.id===previous)?previous:'';select.dataset.populated='true';
  $('fig-folder-controls').hidden=Boolean(select.value);
 }
 function selectedRoot(){
  const project=$('fig-project').value;
  return project?(config.sources||[]).find(source=>source.id===project)?.path||'':$('fig-folder').value;
 }
 function sourceSelection(){return $('fig-project').value?{project:$('fig-project').value}:{folder:$('fig-folder').value}}
 function previewError(message){
  for(const prefix of ['fig-','fig-browser-'])$(prefix+'preview-status').textContent=message;
 }
 function showPreviewStatus(job){
  previewJob=job;
  const running=job?.state==='running';
  for(const prefix of ['fig-','fig-browser-']){
   $(prefix+'generate-previews').disabled=!config.sidecar_previews||running||previewStarting||!selectedRoot();
   $(prefix+'cancel-previews').hidden=!running;
   const progress=$(prefix+'preview-progress');progress.hidden=!running;
   progress.max=Math.max(1,job?.total||1);progress.value=job?.processed||0;
   $(prefix+'preview-status').textContent=previewStarting?'Starting DM4 previews…':job?
    `${running?'Creating previews':job.state==='cancelled'?'Previews cancelled':'Previews complete'} · ${job.processed}/${job.total} · ${job.created} saved · ${job.skipped} existing · ${job.failed} failed${job.current?' · '+job.current:''}`:'';
   $(prefix+'preview-status').title=job?.data_root||'';
   $(prefix+'preview-errors').hidden=!job?.errors?.length;$(prefix+'preview-error-list').replaceChildren();
   for(const error of job?.errors||[]){const item=document.createElement('li');item.textContent=error;$(prefix+'preview-error-list').append(item)}
  }
 }
 async function pollPreviews(){
  clearTimeout(previewPoll);
  try{
   const response=await fetch('/api/previews'),job=await response.json();
   if(!response.ok)throw new Error(job?.error||'Could not read preview progress.');
   showPreviewStatus(job);
   if(job?.state==='running'){previewPoll=setTimeout(pollPreviews,800);return}
   await scan();
  }catch(error){previewError(error.message);previewPoll=setTimeout(pollPreviews,3000)}
 }
 async function generatePreviews(){
  if(previewStarting||previewJob?.state==='running')return;
  previewStarting=true;showPreviewStatus(null);
  try{
   const job=await api('figures/previews',sourceSelection());
   previewStarting=false;showPreviewStatus(job);pollPreviews();
  }catch(error){previewStarting=false;showPreviewStatus(null);previewError(error.message)}
 }
 function cachedMetadata(row){return indexRecords[row.path]?.metadata||recipe.slots.find(slot=>slot.path===row.path)?.metadata||{}}
 function formatMetadata(key,entry){
  if(!entry||entry.value==null)return '';
  if(key==='acquisition_date')return String(entry.value);
  const value=Number(entry.value);
  if(key==='magnification')return `${Math.round(value).toLocaleString()}×`;
  if(key==='voltage_kv')return `${value}kV`;
  if(key==='probe')return entry.kind==='number'?`P${value}`:`I=${value}${entry.unit||''}`;
  return `WD ${value}${entry.unit||''}`;
 }
 function refreshFilters(){
  const folder=$('fig-filter-folder'),previousFolder=folder.value,folders=new Set(['.']);
  for(const row of files){const parts=(row.folder||'.').split('/');for(let i=1;i<=parts.length;i++)folders.add(parts.slice(0,i).join('/'))}
  folder.replaceChildren(new Option('All folders',''),...Array.from(folders).sort(naturalCompare).map(value=>new Option(value==='.'?'Top folder':value,value)));
  folder.value=folders.has(previousFolder)?previousFolder:'';
  for(const [id,key] of metadataFilters){
   const select=$(id),previous=select.value,entries=new Map();
   for(const row of files){const entry=cachedMetadata(row)[key];if(entry?.value!=null)entries.set(String(entry.value),formatMetadata(key,entry))}
   const ordered=[...entries].sort((a,b)=>key==='acquisition_date'?b[0].localeCompare(a[0]):Number(a[0])-Number(b[0]));
   select.replaceChildren(new Option('All',''),...ordered.map(([value,label])=>new Option(label,value)));
   select.value=entries.has(previous)?previous:'';
  }
 }
 function indexControls(){
  const active=indexJob?.state==='running';
  for(const prefix of ['fig-','fig-browser-']){
   $(prefix+'preprocess').disabled=$(prefix+'reprocess-ocr').disabled=indexStarting||active||!files.length;
   $(prefix+'preprocess-cancel').hidden=!active;
   $(prefix+'ocr-workers').disabled=indexStarting||active;
  }
 }
 function indexMessage(message){
  for(const prefix of ['fig-','fig-browser-'])$(prefix+'preprocess-status').textContent=message;
 }
 async function startPreprocess(force=false){
  if(indexStarting||indexJob?.state==='running')return;
  indexStarting=true;indexControls();indexMessage('Starting metadata preprocessing…');
  try{
   const result=await api('figures/index/start',{...sourceSelection(),force,workers:Number($('fig-ocr-workers').value)});
   indexStarting=false;showIndexStatus(result);refreshIndex();
  }catch(error){indexStarting=false;indexControls();indexMessage(error.message)}
 }
 function showIndexStatus(result){
  indexRecords=result.records||indexRecords;
  indexJob=result;
  const active=result.state==='running';
  if(result.state==='complete'){
   let refreshed=false;
   for(const slot of recipe.slots){
    const record=slot.path&&indexRecords[slot.path];
    if(!record||record.sha256!==slot.sha256)continue;
    const manual=Object.fromEntries(Object.entries(slot.metadata||{}).filter(([,entry])=>entry?.source==='Manual'));
    const metadata={...record.metadata,...manual};
    if(slot.footer_ocr_text===record.footer_ocr_text&&slot.footer_ocr_raw_text===record.footer_ocr_raw_text&&
       JSON.stringify(slot.metadata)===JSON.stringify(metadata))continue;
    slot.metadata=metadata;slot.metadata_sidecar=record.metadata_sidecar;
    slot.footer_ocr_text=record.footer_ocr_text;slot.footer_ocr_raw_text=record.footer_ocr_raw_text;
    slot.scale_ocr_text=record.scale_ocr_text;refreshed=true;
   }
   if(refreshed)changed(true);
  }
  if(!active){refreshFilters();if($('fig-browser-dialog').open)renderBrowser()}
  indexControls();
  let message;
  if(active)message=`${result.force?'Reprocessing metadata':'Preprocessing'} ${result.done}/${result.total||'…'} · ${result.workers} workers · ${result.current||'scanning files'}`;
  else if(result.state==='complete'||result.state==='cancelled')message=`${result.state==='complete'?'Processed':'Stopped after'} ${result.done} images · ${result.reused} reused · ${result.failed} failed`;
  else if(result.state==='error')message=`Preprocessing failed: ${result.errors?.at(-1)||'unknown error'}`;
  else message=`${Object.keys(indexRecords).length} images indexed`;
  indexMessage(message);
  for(const prefix of ['fig-','fig-browser-']){
   const progress=$(prefix+'preprocess-progress');
   progress.hidden=!active&&result.state==='idle';progress.max=Math.max(1,result.total||1);progress.value=result.done||0;
   $(prefix+'preprocess-status').title=[result.index_path,...(result.errors||[])].filter(Boolean).join('\n');
  }
  $('fig-browser-preprocess-errors').hidden=!result.errors?.length;$('fig-browser-preprocess-error-list').replaceChildren();
  for(const error of result.errors||[]){const item=document.createElement('li');item.textContent=error;$('fig-browser-preprocess-error-list').append(item)}
 }
 async function refreshIndex(){
  clearTimeout(indexPoll);
  const root=selectedRoot();
  try{
   const result=await api('figures/index/status',{folder:root});if(root!==selectedRoot())return;showIndexStatus(result);
   if(result.state==='running')indexPoll=setTimeout(refreshIndex,750);
  }catch(error){indexMessage(error.message)}
 }
 function previewUrl(row){const path=row.thumbnail_path||(browserFileType(row)==='dm4'?null:row.path);return path?'/api/figures/thumbnail?path='+encodeURIComponent(path):null}
 function hideHover(){clearTimeout(hoverTimer);$('fig-browser-hover').hidden=true}
 function positionHover(x,y){
  const host=$('fig-browser-hover'),box=host.getBoundingClientRect(),gap=16;
  let left=x+gap;if(left+box.width>innerWidth-8)left=x-box.width-gap;
  host.style.left=Math.max(8,Math.min(left,innerWidth-box.width-8))+'px';
  host.style.top=Math.max(8,Math.min(y+gap,innerHeight-box.height-8))+'px';
 }
 function showHover(row,x,y){
  hideHover();if(!previewUrl(row))return;hoverTimer=setTimeout(()=>{
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
  badge.className='image-browser-format';badge.title=extension==='DM4'?'Original DM4 source · PNG thumbnail only':extension+' file';badge.setAttribute('aria-hidden','true');
  svg.setAttribute('viewBox','0 0 16 18');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.5');path.setAttribute('d','M3 1h7l3 3v13H3z M10 1v4h3');svg.append(path);
  text.textContent=extension;badge.append(svg,text);return badge;
 }
 function naturalCompare(a,b){return a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'})}
 function browserFileType(row){
  const extension=(row.extension||row.name.match(/\.[^.]+$/)?.[0]||'').replace(/^\./,'').toLowerCase();
  return ['tif','tiff'].includes(extension)?'tiff':['jpg','jpeg'].includes(extension)?'jpeg':extension;
 }
 function matchingBrowserFiles(){
  const terms=$('fig-browser-search').value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const type=$('fig-filter-type').value,folder=$('fig-filter-folder').value,subfolders=$('fig-filter-subfolders').checked;
  const visible=files.filter(row=>{
   const text=(row.name+' '+(row.relative_path||row.folder||'')).toLocaleLowerCase();
   if(!terms.every(term=>text.includes(term)))return false;
   if(type&&browserFileType(row)!==type)return false;
   const parent=row.folder||'.';
   if(folder&&parent!==folder&&!(subfolders&&(folder==='.'||parent.startsWith(folder+'/'))))return false;
   const sidecar=$('fig-filter-sidecar').value;
   if(sidecar&&row.has_sidecar!==(sidecar==='yes'))return false;
   const metadata=cachedMetadata(row);
   return metadataFilters.every(([id,key])=>!$(id).value||String(metadata[key]?.value)===$(id).value);
  });
  const order=$('fig-browser-sort').value;
  return visible.sort((a,b)=>{
   if(order==='date'){
    const delta=String(cachedMetadata(b).acquisition_date?.value||'').localeCompare(String(cachedMetadata(a).acquisition_date?.value||''));
    if(delta)return delta;
   }
   if(order==='type'){const delta=naturalCompare(browserFileType(a),browserFileType(b));if(delta)return delta}
   if(order==='folder'){const delta=naturalCompare(a.folder||'.',b.folder||'.');if(delta)return delta}
   return naturalCompare(a.name,b.name)||naturalCompare(a.path,b.path);
  });
 }
 function saveBrowserSettings(){
  WorkbenchWorkspace.writeRaw('tem-figures-browser-settings',JSON.stringify({type:$('fig-filter-type').value,sort:$('fig-browser-sort').value,subfolders:$('fig-filter-subfolders').checked}));
 }
 function resetBrowserFilters(){
  $('fig-browser-search').value='';
  for(const id of ['fig-filter-type','fig-filter-folder','fig-filter-sidecar',...metadataFilters.map(([id])=>id)])$(id).value='';
  $('fig-filter-subfolders').checked=true;$('fig-browser-sort').value='folder';saveBrowserSettings();renderBrowser();
 }
 function renderBrowser(){
  hideHover();
  const host=$('fig-browser-list');host.replaceChildren();
  const visible=matchingBrowserFiles();
  $('fig-browser-count').textContent=`${visible.length} of ${files.length} images`;
  for(const row of visible){
   const tile=document.createElement('button');tile.type='button';tile.className='image-browser-tile';tile.title=row.path;
   const native=browserFileType(row)==='dm4';
   tile.setAttribute('aria-label',`Use ${row.name} in panel ${selectedPanel+1} · ${native?'Embedded DM4 metadata':row.has_sidecar?'TXT sidecar available':'no TXT sidecar'}`);
   const picture=document.createElement('span');picture.className='image-browser-preview';
   const placeholder=document.createElement('span');placeholder.className='muted';placeholder.textContent=previewUrl(row)?'Loading preview…':'Create DM4 previews';picture.append(placeholder);
   if(previewUrl(row)){
   const image=document.createElement('img');image.alt='';image.loading='lazy';image.decoding='async';image.src=previewUrl(row);
   image.onload=()=>placeholder.hidden=true;image.onerror=()=>{placeholder.textContent='Preview unavailable';image.remove()};picture.append(image);
   }
   picture.append(browserTypeIcon(row),browserFormatIcon(row));
   if(!native){
   const sidecar=document.createElement('span');sidecar.className='image-browser-sidecar '+(row.has_sidecar?'available':'missing');
   sidecar.textContent='TXT';sidecar.title=row.has_sidecar?'Matching TXT sidecar available':'No matching TXT sidecar';
   sidecar.setAttribute('aria-hidden','true');picture.append(sidecar);
   }
   const name=document.createElement('strong');name.className='image-browser-name';
   const stem=row.name.replace(/\.[^.]+$/,''),match=stem.match(/^(.*?)[_\s-](\d+)$/);
   const description=document.createElement('span');description.className='image-browser-name-text';description.textContent=match?match[1]:stem;name.append(description);
   if(match){const number=document.createElement('span');number.className='image-browser-number';number.textContent='#'+match[2];name.append(number)}
   const group=document.createElement('small');group.textContent=row.folder&&row.folder!=='.'?row.folder:row.sample||'Selected folder';group.title=row.relative_path||row.path;
   const metadata=document.createElement('small');metadata.className='fig-browser-metadata';
   metadata.textContent=(['magnification','voltage_kv','probe','working_distance','acquisition_date'].map(key=>formatMetadata(key,cachedMetadata(row)[key])).filter(Boolean).join(' · ')||(indexRecords[row.path]?(native?'No acquisition tags recorded':'No acquisition metadata'):'Run Preprocess folder'));
   tile.append(picture,name,group,metadata);
   tile.onmouseenter=event=>showHover(row,event.clientX,event.clientY);
   tile.onmousemove=event=>{if(!$('fig-browser-hover').hidden)positionHover(event.clientX,event.clientY)};
   tile.onmouseleave=hideHover;
   tile.onfocus=()=>{const rect=tile.getBoundingClientRect();showHover(row,rect.right,rect.top)};
   tile.onblur=hideHover;
   tile.onclick=async()=>{hideHover();if(await add(row.path))$('fig-browser-dialog').close()};host.append(tile);
  }
  if(!visible.length){const empty=document.createElement('p');empty.className='hint';empty.textContent='No matching images. Try Reset filters or Rescan images.';host.append(empty)}
  refreshBrowserSize();
 }
 function openImageBrowser(){
  $('fig-browser-title').textContent=`Choose image for panel ${selectedPanel+1}`;
  refreshFilters();
  renderBrowser();$('fig-browser-dialog').showModal();refreshBrowserSize();$('fig-browser-search').focus();
 }
 async function scan(){
  const version=++scanVersion,selection=sourceSelection();
  $('fig-folder-status').textContent=$('fig-browser-scan-status').textContent='Scanning…';
  $('fig-dm4-status').textContent='';
  files=[];sync();
  indexControls();
  try{
   const result=await api('figures/list',selection);if(version!==scanVersion)return;
   const known=new Map();for(const row of config.files||[])for(const path of row.locations||[row.path])known.set(path,row);
   files=result.images.map(row=>({...row,image_kind:known.get(row.path)?.image_kind}));
   if(browserRoot!==result.folder){$('fig-filter-folder').value='';browserRoot=result.folder;indexRecords={}}
   if(!selection.project){$('fig-folder').value=result.folder;WorkbenchWorkspace.writeRaw('tem-figures-folder',result.folder)}
   refreshFilters();if($('fig-browser-dialog').open)renderBrowser();
   sync();$('fig-folder-status').textContent=$('fig-browser-scan-status').textContent=`${files.length} images · DM4, TIFF, PNG, JPEG`;
   $('fig-dm4-status').textContent=result.dm4_count?`${result.dm4_count} DM4 files · ${result.dm4_missing_previews} missing PNG previews`:'';
   showPreviewStatus(previewJob);
   await refreshIndex();
  }catch(error){if(version!==scanVersion)return;$('fig-folder-status').textContent=$('fig-browser-scan-status').textContent=error.message;if($('fig-browser-dialog').open)renderBrowser()}
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
 function loadRecipe(next){recipe=normaliseRecipe(next);selectedPanel=0;renderCards();draft();schedulePreview();scheduleEstimate();refreshLegacySlots()}
 async function refreshLegacySlots(){
  const current=recipe,pending=current.slots.filter(slot=>slot.path&&Number(slot.inspection_version||0)<10);
  if(!pending.length)return;
  status(`Reading footer metadata for ${pending.length} images…`);
  let updated=false;
  for(const slot of pending){
   try{
    const info=await api('figures/inspect',{path:slot.path});
    if(recipe!==current)return;
    if(!current.slots.includes(slot)||Number(slot.inspection_version||0)>=10)continue;
    if(info.sha256!==slot.sha256)continue;
    const manual=Object.fromEntries(Object.entries(slot.metadata||{}).filter(([,entry])=>entry?.source==='Manual'));
    slot.metadata={...info.metadata,...manual};slot.metadata_sidecar=info.metadata_sidecar;
    slot.footer_ocr_text=info.footer_ocr_text;slot.footer_ocr_raw_text=info.footer_ocr_raw_text;
    slot.scale_ocr_text=info.scale_ocr_text;slot.ocr_available=info.ocr_available;
    if(!slot.footer_detected&&slot.content_height===slot.height&&info.footer_detected){
     slot.content_height=info.content_height;slot.footer_detected=true;
     if(slot.bar_px==null||slot.bar_px===slot.bar?.w)slot.bar_px=info.bar_px;
     slot.bar=info.bar;
     if(slot.scale_source!=='Manual'){slot.scale_nm=info.scale_nm;slot.scale_source=info.scale_source;slot.scale_mode=info.scale_mode}
    }else if(/sidecar/i.test(slot.scale_source||'')){
     slot.scale_nm=info.scale_nm;slot.scale_source=info.scale_source;
    }
    slot.detected_content_height=info.content_height;slot.content_height_source=info.content_height_source;
    slot.pixel_size_nm=info.pixel_size_nm;slot.pixel_size_source=info.pixel_size_source;
    if(info.pixel_size_nm&&slot.scale_source!=='Manual')slot.scale_mode='metadata';
    slot.inspection_version=info.inspection_version;updated=true;
   }catch(error){status(error.message,true)}
  }
  if(updated&&recipe===current)changed(true);
 }
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
   const storedTags=parse(WorkbenchWorkspace.readRaw('tem-figures-tags-v1'),[]);
   tagRows=Array.isArray(storedTags)?storedTags.filter(row=>row&&typeof row.label==='string')
    .slice(0,500).map(row=>({label:row.label,colour:typeof row.colour==='string'?row.colour:''})):[];
   if(!tagRows.length)tagRows=[{label:'',colour:''}];
   browserPreferred=Math.max(80,Math.min(240,Number(WorkbenchWorkspace.readRaw('tem-figures-preview-size'))||160));
   const browserSettings=parse(WorkbenchWorkspace.readRaw('tem-figures-browser-settings'),{});
   $('fig-filter-type').value=browserSettings.type==='dm4-preview'?'dm4':['tiff','png','jpeg','dm4'].includes(browserSettings.type)?browserSettings.type:'';
   $('fig-browser-sort').value=['name','type','date'].includes(browserSettings.sort)?browserSettings.sort:'folder';
   $('fig-filter-subfolders').checked=browserSettings.subfolders!==false;
   hoverEnabled=WorkbenchWorkspace.readRaw('tem-figures-hover-detail')!=='off';
   const savedWorkers=Number(WorkbenchWorkspace.readRaw('tem-figures-ocr-workers'));
   for(const id of ['fig-ocr-workers','fig-browser-ocr-workers']){
    $(id).value=String(Number.isInteger(savedWorkers)&&savedWorkers>0?savedWorkers:4);
    $(id).onchange=()=>{
     const value=Number($(id).value),count=Number.isInteger(value)&&value>0?value:4;
     $('fig-ocr-workers').value=$('fig-browser-ocr-workers').value=String(count);
     WorkbenchWorkspace.writeRaw('tem-figures-ocr-workers',String(count));
    };
   }
   currentId=WorkbenchWorkspace.readRaw('tem-figures-current-v1')||'';if(!saved[currentId])currentId='';
   recipe=normaliseRecipe(parse(WorkbenchWorkspace.readRaw('tem-figures-draft-v1'),blank()));
   $('fig-folder').value=WorkbenchWorkspace.readRaw('tem-figures-folder')||config.sources?.[0]?.path||config.data_root||'';
   populateProjects();projectSettings.render();
   chooseSaved();renderCards();schedulePreview();scheduleEstimate();
   $('fig-browse').onclick=()=>folderBrowser.open({path:$('fig-folder').value,title:'Choose image folder',onSelect:path=>{$('fig-folder').value=path;scan()}});$('fig-scan').onclick=$('fig-browser-scan').onclick=scan;
   $('fig-project').onchange=()=>{const value=$('fig-project').value;WorkbenchWorkspace.writeRaw('tem-figures-project',value);if(value)WorkbenchWorkspace.set('active_project',value);$('fig-folder-controls').hidden=Boolean(value);scan()};
   $('fig-project-settings').onclick=()=>WorkbenchProjectTools.showSources($('fig-project-dialog'));
   $('fig-project-close').onclick=()=>$('fig-project-dialog').close();
   $('fig-open-browser').onclick=openImageBrowser;
   $('fig-generate-previews').onclick=$('fig-browser-generate-previews').onclick=generatePreviews;
   $('fig-cancel-previews').onclick=$('fig-browser-cancel-previews').onclick=async()=>{try{showPreviewStatus(await api('previews/cancel',{}));pollPreviews()}
    catch(error){previewError(error.message)}};
   showPreviewStatus(config.preview_job);if(config.preview_job?.state==='running')pollPreviews();
   $('fig-preprocess').onclick=$('fig-browser-preprocess').onclick=()=>startPreprocess();
   $('fig-reprocess-ocr').onclick=$('fig-browser-reprocess-ocr').onclick=()=>startPreprocess(true);
   $('fig-preprocess-cancel').onclick=$('fig-browser-preprocess-cancel').onclick=async()=>{try{await api('figures/index/cancel',{});refreshIndex()}
    catch(error){indexMessage(error.message)}};
   $('fig-browser-close').onclick=()=>{$('fig-browser-dialog').close();hideHover()};
   $('fig-browser-dialog').onclose=hideHover;
   $('fig-browser-search').oninput=renderBrowser;
   $('fig-browser-size').oninput=()=>refreshBrowserSize(true);
   for(const id of ['fig-filter-type','fig-filter-folder','fig-filter-subfolders','fig-browser-sort','fig-filter-sidecar',...metadataFilters.map(([id])=>id)])$(id).onchange=()=>{saveBrowserSettings();renderBrowser()};
   $('fig-filter-reset').onclick=resetBrowserFilters;
   new ResizeObserver(()=>{if($('fig-browser-dialog').open)refreshBrowserSize()}).observe($('fig-browser-list'));
   $('fig-slot-close').onclick=()=>$('fig-slot-dialog').close();
   $('fig-original-close').onclick=()=>$('fig-original-dialog').close();
   $('fig-original-size').oninput=()=>{$('fig-original-image').style.width=$('fig-original-size').value+'%'};
   $('fig-folder').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();scan()}};
   outputHover=document.createElement('aside');outputHover.id='fig-output-hover';outputHover.hidden=true;
   outputHover.setAttribute('aria-hidden','true');outputHover.append(document.createElement('img'),document.createElement('span'));
   document.body.append(outputHover);
   dropTarget=document.createElement('div');dropTarget.id='fig-drop-target';dropTarget.hidden=true;
   dropTarget.setAttribute('aria-hidden','true');document.body.append(dropTarget);
   panelHighlight=$('fig-panel-highlight');
   $('fig-preview').draggable=false;
   $('fig-preview').onclick=event=>{if(suppressOutputClick){suppressOutputClick=false;return}
    const hit=previewPanelHit(event);if(hit)openSlot(hit.index)};
   $('fig-preview').onpointerdown=startOutputDrag;$('fig-preview').onpointermove=moveOutputPointer;
   $('fig-preview').onpointerup=finishOutputDrag;
   $('fig-preview').onpointercancel=()=>{dragState=null;dropTarget.hidden=true;panelHighlight.hidden=true};
   $('fig-preview').onmouseleave=()=>{if(!dragState?.dragging)hideOutputHover();panelHighlight.hidden=true};
   $('fig-preview').onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openSlot(selectedPanel)}};
   $('fig-name').oninput=()=>{recipe.name=$('fig-name').value;draft()};
   $('fig-rows').onchange=changeLayout;$('fig-columns').onchange=changeLayout;
   for(const [id,key,transform] of [['fig-aspect','aspect',value=>value==='auto'?'auto':Number(value)],['fig-background','background',String]])$(id).onchange=()=>{recipe[key]=transform($(id).value);changed()};
   $('fig-match-tone').onchange=()=>{recipe.match_tone=$('fig-match-tone').checked;changed()};
   $('fig-crop-on').onclick=()=>{recipe.crop_metadata=true;changed(true)};
   $('fig-crop-off').onclick=()=>{recipe.crop_metadata=false;changed(true)};
   $('fig-scale-bar-overlay').onchange=()=>{recipe.scale_bar_overlay=$('fig-scale-bar-overlay').checked;changed(true)};
   $('fig-scale-left').onclick=()=>{recipe.scale_bar_position='left';changed(true)};
   $('fig-scale-right').onclick=()=>{recipe.scale_bar_position='right';changed(true)};
   $('fig-image-padding').onchange=()=>{const value=Number($('fig-image-padding').value);
    if(!$('fig-image-padding').value||!Number.isInteger(value)||value<0||value>200){sync();return}
    recipe.image_padding=value;changed()};
   $('fig-export-scale').oninput=()=>{recipe.export_scale_percent=Number($('fig-export-scale').value);changed()};
   $('fig-export-scale-number').onchange=()=>{const value=Number($('fig-export-scale-number').value);
    if(!$('fig-export-scale-number').value||!Number.isInteger(value)||value<25||value>100){sync();return}
    recipe.export_scale_percent=value;changed()};
   document.querySelector('.fig-export-help').onclick=event=>{
    const help=$('fig-export-help-text');help.hidden=!help.hidden;
    event.currentTarget.setAttribute('aria-expanded',String(!help.hidden));
   };
   $('fig-hover-on').onclick=()=>{hoverEnabled=true;WorkbenchWorkspace.writeRaw('tem-figures-hover-detail','on');sync()};
   $('fig-hover-off').onclick=()=>{hoverEnabled=false;WorkbenchWorkspace.writeRaw('tem-figures-hover-detail','off');hideOutputHover();sync()};
   $('fig-sharpness').oninput=()=>{recipe.sharpness=Number($('fig-sharpness').value);
    const inherited=$('fig-slot-dialog').querySelector('.fig-panel-sharpness input[type=range]:disabled');
    if(inherited){inherited.value=String(recipe.sharpness);
     $('fig-slot-dialog').querySelector('.fig-panel-sharpness output').textContent=recipe.sharpness.toFixed(1)+'×'}
    changed()};
   for(const input of document.querySelectorAll('[data-figure-meta]'))input.onchange=()=>{
    recipe.metadata_overlay=[...document.querySelectorAll('[data-figure-meta]:checked')].map(item=>item.dataset.figureMeta);changed()};
   $('fig-new').onclick=()=>{currentId='';loadRecipe(blank());chooseSaved()};
   $('fig-saved').onchange=()=>{currentId=$('fig-saved').value;if(currentId)loadRecipe(saved[currentId]);else loadRecipe(blank());chooseSaved()};
   $('fig-save').onclick=async()=>{recipe.name=$('fig-name').value.trim()||'Untitled figure';if(!recipe.slots.some(slot=>slot.path)){status('Choose an image before saving.',true);return}
    currentId=currentId||crypto.randomUUID();saved[currentId]=structuredClone(recipe);WorkbenchWorkspace.writeRaw('tem-figures-saved-v1',JSON.stringify(saved));draft();chooseSaved();await WorkbenchWorkspace.flush();status(`Saved ${recipe.name}.`)};
   $('fig-delete').onclick=async()=>{if(!currentId)return;delete saved[currentId];currentId='';WorkbenchWorkspace.writeRaw('tem-figures-saved-v1',JSON.stringify(saved));chooseSaved();await WorkbenchWorkspace.flush();status('Saved figure deleted. Current panels remain open.')};
   $('fig-export').onclick=async()=>{try{status(`Exporting figure at ${recipe.export_scale_percent}%…`);
    const result=await api('figures/export',{recipe});status(`Saved ${result.png} (${fileSize(result.size_bytes)}) and ${result.recipe}`)}
    catch(error){status(error.message,true)}};
   $('fig-tag-open').onclick=()=>{renderTags();$('fig-tags-dialog').showModal()};
   $('fig-tags-close').onclick=()=>$('fig-tags-dialog').close();
   $('fig-tags-add').onclick=()=>{if(tagRows.length>=500){tagError('At most 500 tags can be exported together.');return}
    tagRows.push({label:'',colour:''});saveTags();renderTags();$('fig-tags-list').lastElementChild?.querySelector('input')?.focus()};
   $('fig-tags-from-figure').onclick=()=>addTagSet(recipe.slots.filter(slot=>slot.path).map(slot=>({
    label:String(slot.label||slot.name||'').replace(/\.[^.]+$/,''),colour:normaliseHex(slot.label_colour)||''})));
   $('fig-tags-from-project').onclick=()=>addTagSet(projectTags());
   $('fig-tags-export').onclick=async()=>{
    validateTags();if($('fig-tags-export').disabled)return;
    $('fig-tags-export').disabled=true;tagError('Exporting tags…',false);
    try{const sourcePath=files[0]?.path||recipe.slots.find(slot=>slot.path)?.path;
     const result=await api('figures/tags/export',{tags:tagRows.map(row=>({label:row.label.trim(),
      colour:normaliseHex(row.colour)})),recipe,source_path:sourcePath});
     tagError(`Saved ${result.files.length} tags to ${result.folder}`,false)}
    catch(error){tagError(error.message)}finally{$('fig-tags-export').disabled=false}
   };
   if($('fig-folder').value)scan();refreshLegacySlots();
  }catch(error){status(error.message,true)}
 }
 document.addEventListener('DOMContentLoaded',start);
})();

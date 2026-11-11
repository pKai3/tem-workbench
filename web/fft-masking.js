/* Independent FFT filtering workspace; follows the selected ROI or full image. */
function syncIfftControl(){
 $('open-ifft').hidden=isDiffraction();
 $('open-ifft').disabled=!config?.fft_reconstruction||!result||isDiffraction()||pending||busy;
 $('open-ifft').title=config?.fft_reconstruction?'Mask frequencies and reconstruct this region':'Restart Workbench to enable inverse FFT';
}
let refreshIfftSource;
(()=>{
 let observations=[],snapshot=null,masks={mode:'keep',keep_dc:false,spots:[]},selected=-1,extent=null,serial=0,inFlight=false,wanted=false,timer=null,dragging=null,history=[],exporting=false,key='',sourceLabel='';
 let spectrumRaw=null,spectrumProcessed=null,processedView=false,sourceLive=false;
 const storeKey='tem-ifft-masks-v1',clone=v=>JSON.parse(JSON.stringify(v));
 // Keep both square panes equal while reserving space for controls and exports.
 let layoutFrame=0;
 function fitWorkspace(){
  cancelAnimationFrame(layoutFrame);layoutFrame=requestAnimationFrame(()=>{
   const dialog=$('ifft-dialog');if(!dialog.open)return;
   const views=dialog.querySelector('.ifft-views'),footer=dialog.querySelector('.ifft-footer');
   const caption=Math.max(...[...views.querySelectorAll('figcaption')].map(e=>e.getBoundingClientRect().height))+12;
   const bottom=dialog.getBoundingClientRect().bottom-parseFloat(getComputedStyle(dialog).paddingBottom)-2;
   const side=Math.max(160,bottom-views.getBoundingClientRect().top-caption-footer.getBoundingClientRect().height-40);
   views.style.maxWidth=`${2*side+parseFloat(getComputedStyle(views).columnGap)}px`;
  });
 }
 const layoutObserver=new ResizeObserver(fitWorkspace);
 for(const element of [$('ifft-dialog'),$('ifft-source'),$('ifft-pairs'),document.querySelector('.ifft-controls'),document.querySelector('.ifft-footer')])layoutObserver.observe(element);

 const canonical=v=>JSON.stringify(v,(_,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
 function remember(){try{const saved=JSON.parse(localStorage.getItem(storeKey)||'{}');delete saved[key];saved[key]=masks;const entries=Object.entries(saved);localStorage.setItem(storeKey,JSON.stringify(Object.fromEntries(entries.slice(-20))))}catch(e){/* Filtering still works without browser storage. */}}
 function checkpoint(){history.push(clone(masks));if(history.length>40)history.shift()}
 function status(text,error=false){$('ifft-status').textContent=text;$('ifft-status').classList.toggle('error',error)}
 function controls(){
  $('ifft-mode').value=masks.mode;$('ifft-dc').checked=masks.keep_dc;
  const all=selected==='all',spot=masks.spots[selected];
  for(const [id,field] of [['ifft-radius','radius'],['ifft-feather','feather']]){
   const input=$(id);input.placeholder='';
   if(all&&masks.spots.length){const value=masks.spots[0][field],same=masks.spots.every(s=>s[field]===value);input.value=same?value:'';input.placeholder=same?'':'Mixed'}
   else if(spot)input.value=spot[field];
  }
  $('ifft-delete').disabled=all?!masks.spots.length:!spot;$('ifft-delete').textContent=all?'Delete all':'Delete pair';$('ifft-undo').disabled=!history.length;
  const pairs=$('ifft-pairs');while(pairs.children.length>masks.spots.length+1)pairs.lastElementChild.remove();
  const allButton=pairs.children[0]||document.createElement('button');allButton.type='button';allButton.textContent='All';allButton.disabled=!masks.spots.length;allButton.setAttribute('aria-pressed',String(all));allButton.title='Select all mask pairs to edit radius or edge fade together. Click a numbered pair or a ring to edit it alone.';allButton.onclick=()=>{selected='all';controls();draw()};if(!allButton.parentNode)pairs.append(allButton);
  masks.spots.forEach((spot,i)=>{const b=pairs.children[i+1]||document.createElement('button');b.textContent=String(i+1);b.type='button';b.setAttribute('aria-pressed',String(selected==='all'||i===selected));b.title=`±(${spot.qx.toFixed(3)}, ${spot.qy.toFixed(3)}) nm⁻¹ · radius ${spot.radius.toFixed(3)}`;b.onclick=()=>{selected=i;controls();draw()};if(!b.parentNode)pairs.append(b)});
 }
 function draw(){
  const group=$('ifft-rings');group.replaceChildren();if(!extent)return;
  const [xmin,xmax,ymin,ymax]=extent,sx=600/(xmax-xmin),sy=600/(ymax-ymin);
  masks.spots.forEach((spot,i)=>{for(const sign of [1,-1]){
   const x=(sign*spot.qx-xmin)*sx,y=(ymax-sign*spot.qy)*sy,color=(selected==='all'||i===selected)?'#fff':'#c58aff',rx=spot.radius*sx,ry=spot.radius*sy;
   group.append(el('ellipse',{cx:x,cy:y,rx,ry,fill:color,'fill-opacity':.08,stroke:color,'stroke-width':1.3,'stroke-dasharray':'5 3','vector-effect':'non-scaling-stroke','data-mask':i,'data-sign':sign}));
   if(spot.feather>0)group.append(el('ellipse',{cx:x,cy:y,rx:(spot.radius-spot.feather)*sx,ry:(spot.radius-spot.feather)*sy,fill:'none',stroke:color,'stroke-width':1,'stroke-dasharray':'3 4','pointer-events':'none'}));
   group.append(el('text',{x:x+4,y:y-5,fill:color,'font-size':13,'pointer-events':'none'},String(i+1)));
   appendRadiusEditControls(group,{cx:x,cy:y,rx,ry,colour:color,handleSize:4,half:5,deleteGap:16,resizeAttrs:{'data-mask-resize':i,'data-sign':sign},deleteAttrs:{'data-mask-delete':i},deleteLabel:`Delete mask pair ${i+1}`});
   if(dragging?.mode==='radius'&&i===selected)group.append(el('text',{x:x+rx+6,y,fill:color,'font-size':13,stroke:'#0a1119','stroke-width':3,'paint-order':'stroke','pointer-events':'none'},`${spot.radius.toFixed(3)} nm⁻¹`));
  }});
  refreshHover();
 }
 function displaySpectrum(){
  const image=processedView&&spectrumProcessed?spectrumProcessed:spectrumRaw;
  if(image)$('ifft-spectrum').setAttribute('href',colourSpectrum(image,'real_space'));
  $('ifft-raw').setAttribute('aria-pressed',String(!processedView));
  $('ifft-processed').setAttribute('aria-pressed',String(processedView));
  $('ifft-processed').disabled=!spectrumProcessed;refreshHover();
 }
 function clearSpectrum(){spectrumRaw=null;spectrumProcessed=null;$('ifft-spectrum').removeAttribute('href');displaySpectrum()}
 $('ifft-raw').onclick=()=>{processedView=false;displaySpectrum()};
 $('ifft-processed').onclick=()=>{processedView=true;displaySpectrum()};
 function refreshSource(){
  if(!$('ifft-dialog').open)return;
  if(fileId!==snapshot?.file_id||isDiffraction()){$('ifft-dialog').close();return}
  const full=$('ifft-scope').value==='full',next={file_id:fileId,roi:full?{x:0,y:0,w:meta.width,h:meta.height}:clone(roi),settings:settings()};
  const different=canonical(next)!==canonical(snapshot);
  if(different){
   const moving=!full&&(Boolean(drag)||(typeof polygonVertexDrag!=='undefined'&&Boolean(polygonVertexDrag)));
   const sameProcessing=canonical(next.settings)===canonical(snapshot?.settings);
   if(!sourceLive)remember();
   snapshot=next;key=canonical([fileId,next.roi,next.settings.fft_window,next.settings.remove_mean]);
   if(moving&&sameProcessing){
    // Keep completed frames visible and accept intermediate ROI responses during a gesture.
    if(!sourceLive){serial++;clearTimeout(timer);timer=null;wanted=false;sourceLive=true}
    previewDrag();
   }else{
    sourceLive=false;extent=null;clearSpectrum();$('ifft-output').removeAttribute('src');$('ifft-input').removeAttribute('src');changed();
   }
  }
  sourceLabel=`${meta.name} · ${next.roi.w} × ${next.roi.h} px · ${next.roi.polygon?'polygon fade':next.settings.fft_window==='hann'?'Hann window':'no window'} · mean ${next.settings.remove_mean?'removed':'retained'}`;
  $('ifft-source').textContent=sourceLabel;
  const matching=result&&canonical(result.roi)===canonical(next.roi);
  observations=matching?clone(result.spectrum.peaks):[];$('ifft-detected').disabled=!matching;
  $('ifft-detected').title=matching?'Add detected profiles from this selection':'Detected spots are available once this selection has been analysed';
  $('ifft-adjust').disabled=full;
 }
 refreshIfftSource=refreshSource;
 function setAdjusting(value){
  $('ifft-dialog').classList.toggle('adjust-selection',value);$('ifft-adjust').setAttribute('aria-pressed',String(value));$('ifft-adjust').textContent=value?'Done adjusting':'Adjust selection';
  if(value)$('overview').scrollIntoView({block:'center',behavior:'smooth'});
 }
 function resetWipe(){$('ifft-wipe').value='50';$('ifft-reconstruction').style.setProperty('--wipe','50%')}
 document.querySelectorAll('[data-ifft-view]').forEach(button=>button.onclick=()=>{
  if(button.dataset.ifftView==='compare'&&$('ifft-reconstruction').dataset.view!=='compare')resetWipe();
  $('ifft-reconstruction').dataset.view=button.dataset.ifftView;
  document.querySelectorAll('[data-ifft-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));refreshHover();
 });
 $('ifft-wipe').oninput=()=>{$('ifft-reconstruction').style.setProperty('--wipe',$('ifft-wipe').value+'%');refreshHover()};
 // Map the divider to the image itself, independent of native range thumb geometry.
 let wipePointer=null;
 function moveWipe(e){const r=$('ifft-reconstruction').getBoundingClientRect();$('ifft-wipe').value=String(Math.round(clamp((e.clientX-r.left)/r.width*100,0,100)*10)/10);$('ifft-wipe').oninput()}
 $('ifft-wipe').addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();wipePointer=e.pointerId;$('ifft-wipe').setPointerCapture(e.pointerId);moveWipe(e)});
 $('ifft-wipe').addEventListener('pointermove',e=>{if(wipePointer===e.pointerId)moveWipe(e)});
 for(const type of ['pointerup','pointercancel'])$('ifft-wipe').addEventListener(type,e=>{if(wipePointer===e.pointerId)wipePointer=null});
 // Capture release outside the overview too; polygon handlers stop propagation there.
 for(const type of ['pointerup','pointercancel'])document.addEventListener(type,()=>{
  if(sourceLive)queueMicrotask(()=>{if(!sourceLive)return;sourceLive=false;changed(0)});
 },true);
 $('ifft-adjust').onclick=()=>setAdjusting(!$('ifft-dialog').classList.contains('adjust-selection'));
 $('ifft-scope').onchange=()=>{setAdjusting(false);refreshSource()};
 function deleteMask(index){if(!masks.spots[index])return;checkpoint();masks.spots.splice(index,1);selected=-1;changed()}
 function changed(delay=180){serial++;remember();controls();draw();$('ifft-export').disabled=true;$('ifft-output').classList.add('pending');status('Updating reconstruction…');clearTimeout(timer);timer=setTimeout(()=>{timer=null;wanted=true;pump()},delay)}
 // During a gesture, accept completed intermediate frames and coalesce newer positions.
 // A new gesture, committed edit or source change invalidates previous frames via serial.
 function previewDrag(){
  $('ifft-export').disabled=true;
  if(timer===null)timer=setTimeout(()=>{timer=null;wanted=true;pump()},100);
 }
 async function pump(){
  if(inFlight||exporting||!snapshot||!$('ifft-dialog').open)return;
  inFlight=true;
  try{while(wanted&&$('ifft-dialog').open){
   wanted=false;const version=serial,body={...snapshot,masks:clone(masks)};
   try{const data=await api('ifft',body);if(version!==serial||!$('ifft-dialog').open)continue;
    const images=data.images||{fft:data.fft};
    const [raw,processed]=await Promise.all([decodeSpectrumImage(images),images.detector_signal16?decodeSpectrumImage({fft_log16:images.detector_signal16,fft_log_limits:images.detector_signal_limits}).then(image=>({...image,detector:true})):null]);
    if(version!==serial||!$('ifft-dialog').open)continue;
    spectrumRaw=raw;spectrumProcessed=processed;
    extent=data.extent;displaySpectrum();$('ifft-input').src=data.input;$('ifft-output').src=data.image;$('ifft-output').classList.remove('pending');draw();
    $('ifft-export').disabled=Boolean(dragging||sourceLive||wanted||timer);
    const blank=masks.mode==='keep'&&!masks.spots.length&&!masks.keep_dc;
    status(blank?'No frequencies selected. Click FFT spots to begin.':`${masks.spots.length} paired masks · RMS ${data.rms.toPrecision(4)} · separate display contrast`);
   }catch(e){if(version===serial)status(e.message,true)}
  }}finally{inFlight=false}
 }

 let hover=null,hoverTimer=null,hoverFrame=null;
 const loupe=document.createElement('aside');loupe.className='ifft-hover';loupe.hidden=true;loupe.setAttribute('aria-hidden','true');
 const loupeTitle=document.createElement('div'),loupeView=el('svg',{viewBox:'0 0 600 600'}),loupeContent=el('g',{}),loupeCross=el('path',{'class':'ifft-hover-cross'});
 loupeView.append(loupeContent,loupeCross);loupe.append(loupeTitle,loupeView);$('ifft-dialog').append(loupe);
 function hideHover(){clearTimeout(hoverTimer);hoverTimer=null;cancelAnimationFrame(hoverFrame);hoverFrame=null;hover=null;loupe.hidden=true}
 function refreshHover(){if(!hover||loupe.hidden)return;cancelAnimationFrame(hoverFrame);hoverFrame=requestAnimationFrame(renderHover)}
 function renderHover(){
  hoverFrame=null;if(!hover||!$('ifft-dialog').open)return;
  const r=hover.host.getBoundingClientRect(),x=(hover.x-r.left)/r.width*600,y=(hover.y-r.top)/r.height*600;
  if(x<0||x>600||y<0||y>600){hideHover();return}
  loupeContent.replaceChildren();
  if(hover.host.id==='ifft-editor'){
   if(!$('ifft-spectrum').getAttribute('href')){loupe.hidden=true;return}
   loupeTitle.textContent=(processedView?'Processed FFT':'Raw FFT')+' · 3×';
   loupeContent.append($('ifft-spectrum').cloneNode(true),$('ifft-rings').cloneNode(true));
   for(const node of loupeContent.querySelectorAll('[id]'))node.removeAttribute('id');
  }else{
   const mode=$('ifft-reconstruction').dataset.view;
   const image=id=>el('image',{href:$(id).getAttribute('src')||'',width:600,height:600,preserveAspectRatio:'xMidYMid meet'});
   if(!$(mode==='input'?'ifft-input':'ifft-output').getAttribute('src')){loupe.hidden=true;return}
   loupeTitle.textContent=({input:'Input',filtered:'Filtered',compare:'Input / filtered'})[mode]+' · 3×';
   if(mode!=='input')loupeContent.append(image('ifft-output'));
   if(mode==='input')loupeContent.append(image('ifft-input'));
   if(mode==='compare'){
    const width=Number($('ifft-wipe').value)*6,clip=el('svg',{x:0,y:0,width,height:600,viewBox:`0 0 ${width||.001} 600`,overflow:'hidden'});
    clip.append(image('ifft-input'));loupeContent.append(clip);
    loupeContent.append(el('path',{d:`M${width} 0V600`,stroke:'#fff','stroke-width':1}));
   }
  }
  loupe.hidden=false;
  const size=loupeView.getBoundingClientRect().width,span=size/(r.width/600*3),arm=10*span/size,gap=3*span/size;
  loupeView.setAttribute('viewBox',`${x-span/2} ${y-span/2} ${span} ${span}`);
  loupeCross.setAttribute('d',`M${x-arm} ${y}h${arm-gap}M${x+gap} ${y}h${arm-gap}M${x} ${y-arm}v${arm-gap}M${x} ${y+gap}v${arm-gap}`);
  const box=loupe.getBoundingClientRect();
  loupe.style.left=clamp(hover.x-box.width-18,8,Math.max(8,innerWidth-box.width-8))+'px';
  loupe.style.top=clamp(hover.y-box.height-18,8,Math.max(8,innerHeight-box.height-8))+'px';
 }
 for(const id of ['ifft-editor','ifft-reconstruction']){
  const host=$(id);
  host.addEventListener('pointermove',e=>{
   if(e.pointerType==='touch')return;
   if(hover?.host!==host)hideHover();hover={host,x:e.clientX,y:e.clientY};
   if(loupe.hidden){if(hoverTimer===null)hoverTimer=setTimeout(()=>{hoverTimer=null;renderHover()},180)}else refreshHover();
  });
  for(const type of ['pointerleave','pointercancel'])host.addEventListener(type,hideHover);
 }
 $('ifft-dialog').addEventListener('scroll',hideHover,true);window.addEventListener('resize',hideHover);window.addEventListener('blur',hideHover);
 function coordinate(e){const svg=$('ifft-editor'),p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const q=p.matrixTransform(svg.getScreenCTM().inverse());return [extent[0]+clamp(q.x,0,600)/600*(extent[1]-extent[0]),extent[3]-clamp(q.y,0,600)/600*(extent[3]-extent[2])]}
 function defaults(){if(!$('ifft-radius').value.trim()||!$('ifft-feather').value.trim())throw Error('Set a radius and edge fade, or select one numbered pair, before adding spots.');const radius=Number($('ifft-radius').value),feather=Number($('ifft-feather').value);if(!Number.isFinite(radius)||radius<=0||radius>100||!Number.isFinite(feather)||feather<0||feather>radius)throw Error('Choose a positive radius and an edge fade no larger than that radius.');return {radius,feather}}
 $('open-ifft').onclick=()=>{
  if(!result||isDiffraction())return;
  snapshot=clone({file_id:fileId,roi:result.roi,settings:result.settings});observations=clone(result.spectrum.peaks);
  key=canonical([fileId,snapshot.roi,snapshot.settings.fft_window,snapshot.settings.remove_mean]);
  masks={mode:'keep',keep_dc:false,spots:[]};try{const saved=JSON.parse(localStorage.getItem(storeKey)||'{}')[key];if(saved)masks=saved}catch(e){}
  selected=-1;history=[];extent=null;sourceLive=false;resetWipe();serial++;wanted=true;controls();draw();
  for(const id of ['ifft-input','ifft-output'])$(id).removeAttribute('src');processedView=showDetectorSignal;clearSpectrum();$('ifft-export').disabled=true;
  $('ifft-source').textContent=`${meta.name} · ${snapshot.roi.w} × ${snapshot.roi.h} px · ${snapshot.roi.polygon?'polygon fade':snapshot.settings.fft_window==='hann'?'Hann window':'no window'} · mean ${snapshot.settings.remove_mean?'removed':'retained'}`;
  $('ifft-scope').value='selection';setAdjusting(false);$('ifft-dialog').show();document.documentElement.classList.add('ifft-open');refreshSource();status('Preparing complex FFT…');pump();
 };
 $('ifft-close').onclick=()=>$('ifft-dialog').close();$('ifft-dialog').addEventListener('close',()=>{serial++;wanted=false;dragging=null;sourceLive=false;hideHover();clearTimeout(timer);timer=null;document.documentElement.classList.remove('ifft-open');setAdjusting(false)});
 $('ifft-dialog').addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();$('ifft-dialog').close()}});
 $('ifft-editor').addEventListener('pointerdown',e=>{
  if(!extent||e.button!==0)return;e.preventDefault();
  const deletion=e.target.closest('[data-mask-delete]');if(deletion){deleteMask(Number(deletion.dataset.maskDelete));return}
  const ring=e.target.closest('[data-mask-resize],[data-mask]');checkpoint();
  if(ring){serial++;clearTimeout(timer);timer=null;wanted=false;$('ifft-export').disabled=true;selected=Number(ring.dataset.maskResize??ring.dataset.mask);dragging={mode:ring.hasAttribute('data-mask-resize')?'radius':'move',id:e.pointerId,sign:Number(ring.dataset.sign),start:coordinate(e),spot:clone(masks.spots[selected])};$('ifft-editor').setPointerCapture(e.pointerId);controls();draw()}
  else{try{if(masks.spots.length>=128)throw Error('Use at most 128 paired masks.');const [qx,qy]=coordinate(e);masks.spots.push({qx,qy,...defaults()});selected=masks.spots.length-1;changed()}catch(error){history.pop();status(error.message,true)}}
 });
 $('ifft-editor').addEventListener('pointermove',e=>{
  if(!extent)return;const [x,y]=coordinate(e);$('ifft-coords').textContent=`qx ${x.toFixed(3)} · qy ${y.toFixed(3)} nm⁻¹`;
  if(!dragging||dragging.id!==e.pointerId)return;
  const spot=masks.spots[selected];if(dragging.mode==='radius'){spot.radius=Math.round(clamp(Math.hypot(x-dragging.sign*spot.qx,y-dragging.sign*spot.qy),.01,100)*1000)/1000;spot.feather=Math.min(spot.feather,spot.radius);$('ifft-radius').value=spot.radius;$('ifft-feather').value=spot.feather}else{spot.qx=dragging.spot.qx+dragging.sign*(x-dragging.start[0]);spot.qy=dragging.spot.qy+dragging.sign*(y-dragging.start[1])}draw();previewDrag();
 });
 function endDrag(e){if(dragging?.id!==e.pointerId)return;dragging=null;changed(0)}
 $('ifft-editor').addEventListener('pointerup',endDrag);$('ifft-editor').addEventListener('pointercancel',endDrag);
 for(const [id,field] of [['ifft-radius','radius'],['ifft-feather','feather']])$(id).onchange=()=>{try{
  const value=Number($(id).value),targets=selected==='all'?masks.spots:masks.spots[selected]?[masks.spots[selected]]:[];
  if(!$(id).value.trim()||!Number.isFinite(value)||value<0||value>100||(field==='radius'&&value===0))throw Error('Choose a valid radius or edge fade.');
  if(field==='feather'&&targets.some(s=>value>s.radius))throw Error('Edge fade cannot exceed the smallest selected radius.');
  if(targets.length){checkpoint();for(const spot of targets){spot[field]=value;if(field==='radius')spot.feather=Math.min(spot.feather,value)}changed()}
 }catch(e){status(e.message,true)}};
 $('ifft-mode').onchange=()=>{checkpoint();masks.mode=$('ifft-mode').value;changed()};$('ifft-dc').onchange=()=>{checkpoint();masks.keep_dc=$('ifft-dc').checked;changed()};
 $('ifft-delete').onclick=()=>{if(selected==='all'){if(!masks.spots.length)return;checkpoint();masks.spots=[];selected=-1;changed()}else deleteMask(selected)};
 $('ifft-rings').addEventListener('keydown',e=>{const button=e.target.closest('[data-mask-delete]');if(button&&['Enter',' '].includes(e.key)){e.preventDefault();deleteMask(Number(button.dataset.maskDelete))}});
 $('ifft-undo').onclick=()=>{if(!history.length)return;masks=history.pop();selected=-1;changed()};
 $('ifft-clear').onclick=()=>{checkpoint();masks.spots=[];selected=-1;changed()};
 $('ifft-detected').onclick=()=>{try{const size=defaults();checkpoint();for(const p of observations){if(masks.spots.length>=128)break;if(!masks.spots.some(s=>Math.min(Math.hypot(s.qx-p.qx,s.qy-p.qy),Math.hypot(s.qx+p.qx,s.qy+p.qy))<1e-6))masks.spots.push({qx:p.qx,qy:p.qy,...size})}selected=-1;changed()}catch(e){status(e.message,true)}};
 $('ifft-export').onclick=async()=>{
  if(inFlight||exporting||wanted||timer||dragging||sourceLive)return;const version=serial;exporting=true;$('ifft-export').disabled=true;status('Saving PNG, numeric reconstruction and mask recipe…');
  try{const data=await api('ifft',{...snapshot,masks:clone(masks),export:true});if(version===serial&&$('ifft-dialog').open)status('Saved PNG + NPZ + JSON');exportNotice('Inverse FFT exported',data.paths.join(' · '),'saved')}
  catch(e){status(e.message,true)}finally{exporting=false;$('ifft-export').disabled=wanted||version!==serial;if(wanted)pump()}
 };
 $('ifft-import').onclick=()=>$('ifft-import-file').click();
 $('ifft-import-file').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;try{
  const recipe=JSON.parse(await file.text());if(recipe.schema!=='tem-workbench-ifft'||recipe.version!==1)throw Error('Choose a Workbench inverse-FFT recipe JSON.');
  if(recipe.source.id!==snapshot.file_id||canonical(recipe.roi)!==canonical(snapshot.roi))throw Error('Open the original image and saved region used by this mask recipe first.');
  if(recipe.processing.fft_window!==snapshot.settings.fft_window||recipe.processing.remove_mean!==snapshot.settings.remove_mean)throw Error('Match the recipe’s Hann and mean-removal settings before loading.');
  if(!Array.isArray(recipe.masks?.spots)||recipe.masks.spots.length>128||!['keep','reject'].includes(recipe.masks.mode)||typeof recipe.masks.keep_dc!=='boolean'||!recipe.masks.spots.every(s=>['qx','qy','radius','feather'].every(k=>Number.isFinite(s[k]))&&s.radius>0&&s.radius<=100&&s.feather>=0&&s.feather<=s.radius))throw Error('Invalid mask recipe.');
  checkpoint();masks=clone(recipe.masks);selected=-1;changed();
 }catch(error){status(error.message,true)}};
})();

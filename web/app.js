'use strict';
const MAGMA=[[0,0,3],[0,0,4],[0,0,6],[1,0,7],[1,1,9],[1,1,11],[2,2,13],[2,2,15],[3,3,17],[4,3,19],[4,4,21],[5,4,23],[6,5,25],[7,5,27],[8,6,29],[9,7,31],[10,7,34],[11,8,36],[12,9,38],[13,10,40],[14,10,42],[15,11,44],[16,12,47],[17,12,49],[18,13,51],[20,13,53],[21,14,56],[22,14,58],[23,15,60],[24,15,63],[26,16,65],[27,16,68],[28,16,70],[30,16,73],[31,17,75],[32,17,77],[34,17,80],[35,17,82],[37,17,85],[38,17,87],[40,17,89],[42,17,92],[43,17,94],[45,16,96],[47,16,98],[48,16,101],[50,16,103],[52,16,104],[53,15,106],[55,15,108],[57,15,110],[59,15,111],[60,15,113],[62,15,114],[64,15,115],[66,15,116],[67,15,117],[69,15,118],[71,15,119],[72,16,120],[74,16,121],[75,16,121],[77,17,122],[79,17,123],[80,18,123],[82,18,124],[83,19,124],[85,19,125],[87,20,125],[88,21,126],[90,21,126],[91,22,126],[93,23,126],[94,23,127],[96,24,127],[97,24,127],[99,25,127],[101,26,128],[102,26,128],[104,27,128],[105,28,128],[107,28,128],[108,29,128],[110,30,129],[111,30,129],[113,31,129],[115,31,129],[116,32,129],[118,33,129],[119,33,129],[121,34,129],[122,34,129],[124,35,129],[126,36,129],[127,36,129],[129,37,129],[130,37,129],[132,38,129],[133,38,129],[135,39,129],[137,40,129],[138,40,129],[140,41,128],[141,41,128],[143,42,128],[145,42,128],[146,43,128],[148,43,128],[149,44,128],[151,44,127],[153,45,127],[154,45,127],[156,46,127],[158,46,126],[159,47,126],[161,47,126],[163,48,126],[164,48,125],[166,49,125],[167,49,125],[169,50,124],[171,51,124],[172,51,123],[174,52,123],[176,52,123],[177,53,122],[179,53,122],[181,54,121],[182,54,121],[184,55,120],[185,55,120],[187,56,119],[189,57,119],[190,57,118],[192,58,117],[194,58,117],[195,59,116],[197,60,116],[198,60,115],[200,61,114],[202,62,114],[203,62,113],[205,63,112],[206,64,112],[208,65,111],[209,66,110],[211,66,109],[212,67,109],[214,68,108],[215,69,107],[217,70,106],[218,71,105],[220,72,105],[221,73,104],[222,74,103],[224,75,102],[225,76,102],[226,77,101],[228,78,100],[229,80,99],[230,81,98],[231,82,98],[232,84,97],[234,85,96],[235,86,96],[236,88,95],[237,89,95],[238,91,94],[238,93,93],[239,94,93],[240,96,93],[241,97,92],[242,99,92],[243,101,92],[243,103,91],[244,104,91],[245,106,91],[245,108,91],[246,110,91],[246,112,91],[247,113,91],[247,115,92],[248,117,92],[248,119,92],[249,121,92],[249,123,93],[249,125,93],[250,127,94],[250,128,94],[250,130,95],[251,132,96],[251,134,96],[251,136,97],[251,138,98],[252,140,99],[252,142,99],[252,144,100],[252,146,101],[252,147,102],[253,149,103],[253,151,104],[253,153,105],[253,155,106],[253,157,107],[253,159,108],[253,161,110],[253,162,111],[253,164,112],[254,166,113],[254,168,115],[254,170,116],[254,172,117],[254,174,118],[254,175,120],[254,177,121],[254,179,123],[254,181,124],[254,183,125],[254,185,127],[254,187,128],[254,188,130],[254,190,131],[254,192,133],[254,194,134],[254,196,136],[254,198,137],[254,199,139],[254,201,141],[254,203,142],[253,205,144],[253,207,146],[253,209,147],[253,210,149],[253,212,151],[253,214,152],[253,216,154],[253,218,156],[253,220,157],[253,221,159],[253,223,161],[253,225,163],[252,227,165],[252,229,166],[252,230,168],[252,232,170],[252,234,172],[252,236,174],[252,238,176],[252,240,177],[252,241,179],[252,243,181],[252,245,183],[251,247,185],[251,249,187],[251,250,189],[251,252,191]];
const $=id=>document.getElementById(id), NS='http://www.w3.org/2000/svg';
const labels={hcp_compatible:'HCP compatible',bcc_compatible:'BCC compatible',coexisting_candidates:'Two candidate structures',multiple_orientations:'Multiple orientations',ambiguous:'HCP / BCC ambiguous',unresolved:'Phase unresolved',insufficient:'Insufficient evidence'};
const colors={hcp_compatible:'#79bafa',bcc_compatible:'#f4b75e',coexisting_candidates:'#d692fa',multiple_orientations:'#64d6bb',ambiguous:'#df9da6',unresolved:'#a4adba',insufficient:'#596778'};
let config, meta, roi={x:0,y:0,w:684,h:684}, fileId, result=null, fftRaw=null, grid=null, jobId=null;
let chosenFits=new Set(), favorites=new Set();
let generation=0, busy=false, pending=false, timer=null, drag=null, sourceRequest=0, opened=false;
function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error)}
async function api(path,body){const options=body?{method:'POST',headers:{'Content-Type':'application/json','X-TEM-Token':config.token},body:JSON.stringify(body)}:{};const r=await fetch('/api/'+path,options);const data=await r.json();if(!r.ok)throw new Error(data.error||r.statusText);return data}
function readPreference(key, fallback){try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}}
function writePreference(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch{message('Browser storage is unavailable; these preferences will last until this page closes.',true)}}
function favoriteKey(){return 'tem-favorites:'+config.data_root}
function renderFavorites(){
 const select=$('favorites'), rows=config.files.filter(f=>favorites.has(f.id));
 select.replaceChildren(new Option(rows.length?'Choose a favourite…':'No favourites yet',''));
 for(const f of rows)select.append(new Option(`${f.sample} · ${f.name}`,f.id));
 select.disabled=!rows.length;select.value=opened&&favorites.has(fileId)?fileId:'';
 $('favorite-count').textContent=`(${rows.length})`;
 const active=opened&&favorites.has(fileId),button=$('favorite-toggle');
 button.disabled=!opened;button.textContent=active?'★ Favourited':'☆ Favourite open image';
 button.setAttribute('aria-pressed',String(active));
 button.title=opened?`${active?'Remove from':'Add to'} favourites: ${meta.name}`:'Open an image to favourite it';
}
$('favorite-toggle').onclick=()=>{
 if(!opened)return;
 favorites.has(fileId)?favorites.delete(fileId):favorites.add(fileId);
 writePreference(favoriteKey(),[...favorites]);renderFavorites();
};
$('favorites').onchange=()=>{const id=$('favorites').value;if(id){$('file').value=id;openFile()}};
function settings(){return {scale:Number($('model-scale').value),bcc_a:Number($('bcc-a').value),threshold:Number($('threshold').value)}}
function calibrationView(){
 const v=$('scenario').value,field=$('model-scale');
 if(v!=='custom')field.value=v==='1'?'1.000':'0.950';
 field.readOnly=v!=='custom';$('bcc-a').value=v==='reference'?.32452995:.330;
 const scale=Number(field.value).toFixed(3);
 const explanation=v==='1'?'Nominal model sizes; stored DM4 calibration.':v==='reference'?'Provisional BCC a from diffraction 1222; a comparison, not a measured calibration.':v==='.95'?'This preset was estimated on ST1221; on other images it is a comparison only.':'Manual comparison; a better fit is not a measurement of calibration or strain.';
 $('calibration-note').textContent=`Model size ×${scale} for both structures · BCC a = ${Number($('bcc-a').value).toFixed(5)} nm. ${explanation} Measured FFT axes stay unchanged.`;
}
function restoreCalibration(){
 const saved=readPreference('tem-scale:'+meta.sha256_pixels,{});
 const valid=saved&&['1','.95','reference','custom'].includes(saved.mode)&&Number.isFinite(saved.scale)&&saved.scale>=.85&&saved.scale<=1.15;
 $('scenario').value=valid?saved.mode:'1';$('model-scale').value=valid?saved.scale:1;
 calibrationView();
}
function rememberCalibration(){writePreference('tem-scale:'+meta.sha256_pixels,{mode:$('scenario').value,scale:Number($('model-scale').value)})}
function requestBody(){return {file_id:fileId,roi:{...roi},settings:settings()}}
function el(tag,attrs,text){const e=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;return e}
function clamp(v,min,max){return Math.min(max,Math.max(min,v))}
function updateBox(preserveHeight=false){if(!meta)return;const min=32,max=Math.min(meta.width,meta.height);roi.w=clamp(Math.round(roi.w),min,max);roi.h=preserveHeight?roi.h:roi.w;roi.x=clamp(Math.round(roi.x),0,meta.width-roi.w);roi.y=clamp(Math.round(roi.y),0,meta.height-roi.h);for(const[k,v]of Object.entries({x:roi.x,y:roi.y,width:roi.w,height:roi.h}))$('roi-box').setAttribute(k,v);const handle=meta.width*.018;$('roi-handle').setAttribute('width',handle);$('roi-handle').setAttribute('height',handle);$('roi-handle').setAttribute('x',roi.x+roi.w-handle/2);$('roi-handle').setAttribute('y',roi.y+roi.h-handle/2);$('roi-x').value=roi.x;$('roi-y').value=roi.y;$('roi-nm').value=(roi.w*meta.pixel_x_nm).toFixed(2);$('region-size').textContent=`${(roi.w*meta.pixel_x_nm).toFixed(2)} nm · ${roi.w} px`}
// Invalidate the old result immediately; never attach it to a newly moved region.
function schedule(delay=120){generation++;pending=true;result=null;$('save-region').disabled=true;$('phase-label').textContent='Updating…';document.querySelector('.previews').classList.add('stale');if(!timer)timer=setTimeout(()=>{timer=null;analyze()},delay)}
async function analyze(){if(busy||!meta||!pending)return;pending=false;busy=true;const version=generation,body=requestBody();try{const data=await api('analyze',body);if(version===generation||(drag&&body.file_id===fileId&&JSON.stringify(body.settings)===JSON.stringify(settings()))){result=data;await renderResult(data,version,body)}}catch(e){if(version===generation){message(e.message,true);$('phase-label').textContent='Analysis unavailable'}}finally{busy=false;if(pending&&!timer)timer=setTimeout(()=>{timer=null;analyze()},20)}}
async function openFile(){const version=++sourceRequest;generation++;pending=false;meta=null;result=null;opened=false;renderFavorites();$('save-region').disabled=true;const id=$('file').value;message('Opening original DM4 pixels…');try{if(jobId&&grid?.state==='running')await api('cancel',{job_id:jobId});const info=await api('open',{file_id:id});if(version!==sourceRequest)return;meta=info;fileId=id;opened=true;grid=null;jobId=null;drawGrid();$('save-grid').disabled=true;$('cancel-grid').disabled=true;$('run-grid').disabled=false;$('grid-status').textContent='Adaptive subdivides unresolved or ambiguous regions, two candidate structures, and substantial second patterns.';restoreCalibration();renderFavorites();updateGridSizeNote();$('overview').setAttribute('viewBox',`0 0 ${info.width} ${info.height}`);$('source-image').setAttribute('width',info.width);$('source-image').setAttribute('height',info.height);$('source-image').setAttribute('href','/api/preview?id='+encodeURIComponent(id));$('metadata').textContent=`${info.width} × ${info.height} · ${info.pixel_x_nm.toFixed(5)} nm/px · ${info.device}`;const size=Math.min(info.width,info.height,Math.max(32,Math.round(20/info.pixel_x_nm)));roi={x:Math.round((info.width-size)/2),y:Math.round((info.height-size)/2),w:size,h:size};updateBox();schedule(0);message('Drag the box to inspect a region, or run an automatic grid.')}catch(e){if(version===sourceRequest)message(e.message,true)}}
function point(event){const pt=new DOMPoint(event.clientX,event.clientY);return pt.matrixTransform($('overview').getScreenCTM().inverse())}
$('overview').addEventListener('pointerdown',e=>{if(!meta||e.button!==0)return;$('overview').focus({preventScroll:true});e.preventDefault();const cell=e.target.closest('.grid-cell');if(cell){const r=grid.regions.find(r=>r.id===cell.dataset.id);roi={...r.roi};updateBox(true);schedule(0);return}const p=point(e);const inside=p.x>=roi.x&&p.x<=roi.x+roi.w&&p.y>=roi.y&&p.y<=roi.y+roi.h;const resizing=e.target.id==='roi-handle';if(!inside&&!resizing){roi.x=p.x-roi.w/2;roi.y=p.y-roi.h/2;updateBox();schedule()}drag={mode:resizing?'resize':'move',x:p.x,y:p.y,roi:{...roi}};$('overview').setPointerCapture(e.pointerId);e.preventDefault()});
$('overview').addEventListener('pointermove',e=>{if(!drag)return;const p=point(e);if(drag.mode==='resize'){roi.w=clamp(drag.roi.w+Math.max(p.x-drag.x,p.y-drag.y),32,Math.min(meta.width-drag.roi.x,meta.height-drag.roi.y))}else{roi.x=drag.roi.x+p.x-drag.x;roi.y=drag.roi.y+p.y-drag.y}updateBox();schedule(90)});
for(const name of ['pointerup','pointercancel'])$('overview').addEventListener(name,()=>{if(drag){drag=null;schedule(0)}});
$('overview').addEventListener('keydown',e=>{if(!meta||e.altKey||e.ctrlKey||e.metaKey)return;const offsets={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};if(!offsets[e.key])return;const n=e.shiftKey?50:10;roi.x+=offsets[e.key][0]*n;roi.y+=offsets[e.key][1]*n;updateBox(true);schedule();e.preventDefault()});
for(const [id,key]of [['roi-x','x'],['roi-y','y'],['roi-nm','w']])$(id).addEventListener('change',()=>{if(!meta)return;const n=Number($(id).value);if(!Number.isFinite(n))return;roi[key]=key==='w'?n/meta.pixel_x_nm:n;updateBox();schedule(0)});
$('centre').onclick=()=>{if(!meta)return;roi.x=(meta.width-roi.w)/2;roi.y=(meta.height-roi.h)/2;updateBox();schedule(0)};
async function renderResult(data,version,body){$('crop').src=data.images.crop;$('phase-label').textContent=labels[data.classification.label]||data.classification.label;$('phase-label').style.color=colors[data.classification.label]||'#ddd';$('timing').textContent=`${data.elapsed_ms.toFixed(0)} ms · ROI ${data.roi.x}, ${data.roi.y}`;$('pattern-label').textContent={predominantly_one_periodic_pattern:'One periodic pattern predominates.',multiple_periodic_patterns:'A substantial second periodic pattern is supported.',unresolved_pattern:'Pattern count remains unresolved.'}[data.periodicity.status];$('models').replaceChildren();for(const phase of ['HCP','BCC']){const m=data.models.find(m=>m.phase===phase);const row=document.createElement('tr');const vals=m?[phase,m.matched_profile_count,`${(100*m.coverage).toFixed(0)}%`,m.rms_nm_inv.toFixed(3),m.valid?'Pass':'Below threshold']:[phase,'—','—','—','No fit'];for(const v of vals){const td=document.createElement('td');td.textContent=v;row.append(td)}$('models').append(row)}$('result-detail').textContent=`${data.spectrum.peaks.length} independent peak profiles · FFT bins ${data.spectrum.df.toFixed(3)} nm⁻¹. Opposite spots represent the same profile.`;$('flags').replaceChildren();for(const f of data.classification.flags){const li=document.createElement('li');li.textContent=f;$('flags').append(li)}$('peaks').replaceChildren();for(const p of data.spectrum.peaks){const tr=document.createElement('tr');for(const v of [p.profile_id,p.g_nm_inv.toFixed(3),(1/p.g_nm_inv).toFixed(4),p.qx.toFixed(3),p.qy.toFixed(3)]){const td=document.createElement('td');td.textContent=v;tr.append(td)}$('peaks').append(tr)}$('peak-count').textContent=`(${data.spectrum.peaks.length})`;renderFitChoices(data);const img=new Image();img.src=data.images.fft;await img.decode();if(version!==generation&&(!drag||body.file_id!==fileId||JSON.stringify(body.settings)!==JSON.stringify(settings())))return;result=data;const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);fftRaw={canvas,pixels:ctx.getImageData(0,0,img.width,img.height)};drawFFT();document.querySelector('.previews').classList.remove('stale');$('save-region').disabled=version!==generation}
function drawFFT(){if(!result||!fftRaw)return;const {canvas,pixels}=fftRaw,ctx=canvas.getContext('2d'),hist=new Array(256).fill(0);for(let i=0;i<pixels.data.length;i+=4)hist[pixels.data[i]]++;const percentile=f=>{let sum=0;for(let i=0;i<256;i++){sum+=hist[i];if(sum>=canvas.width*canvas.height*f)return i}return 255};const lo=percentile(Number($('contrast').value)/100),hi=percentile(.998),out=ctx.createImageData(canvas.width,canvas.height);for(let i=0;i<out.data.length;i+=4){const v=clamp((pixels.data[i]-lo)/Math.max(hi-lo,1),0,1)*255;const rgb=$('palette').value==='gray'?[v,v,v]:MAGMA[Math.round(v)];out.data[i]=rgb[0];out.data[i+1]=rgb[1];out.data[i+2]=rgb[2];out.data[i+3]=255}ctx.putImageData(out,0,0);$('fft-image').setAttribute('href',canvas.toDataURL());$('contrast-value').textContent=$('contrast').value+'%';const ex=result.spectrum.extent;const qp=(x,y)=>[(x-ex[0])/(ex[1]-ex[0])*420,(ex[3]-y)/(ex[3]-ex[2])*420];$('fft-overlay').replaceChildren();$('fft-axes').replaceChildren();for(const q of [-10,-5,0,5,10]){if(q<ex[0]||q>ex[1])continue;const [px]=qp(q,0);$('fft-axes').append(el('text',{x:px,y:437,fill:'#8c9eaf','font-size':10,'text-anchor':'middle'},q));const[,py]=qp(0,q);$('fft-axes').append(el('text',{x:-7,y:py+3,fill:'#8c9eaf','font-size':10,'text-anchor':'end'},q))}const overlay=$('overlay').value;const marker=$('peak-marker').value;if(marker!=='off')for(const p of result.spectrum.peaks){for(const sign of [1,-1]){const[x,y]=qp(sign*p.qx,sign*p.qy);const attrs={stroke:'#ffffff','stroke-width':1,fill:'none','data-measured-profile':p.profile_id};const shape=marker==='crosshair'?el('path',{...attrs,d:`M${x-4},${y}h8M${x},${y-4}v8`}):el('circle',{...attrs,cx:x,cy:y,r:3});shape.append(el('title',{},`Measured profile ${p.profile_id} · g ${p.g_nm_inv.toFixed(3)} nm⁻¹`));$('fft-overlay').append(shape)}}const fits=[];
if(['HCP','BCC','both'].includes(overlay)){for(const phase of overlay==='both'?['HCP','BCC']:[overlay]){const m=result.models.find(m=>m.phase===phase);if(m)fits.push({model:m,color:phase==='HCP'?colors.hcp_compatible:colors.bcc_compatible,geometry:false})}}
if(overlay==='custom'){
 for(const key of chosenFits){if(key.startsWith('phase-')){const m=result.models[Number(key.slice(6))];if(m)fits.push({model:m,color:m.phase==='HCP'?colors.hcp_compatible:colors.bcc_compatible,geometry:false})}else{const m=result.periodicity[key];if(m)fits.push({model:m,color:'#df92ef',geometry:true})}}
}
for(const f of fits){for(const node of f.model.predicted_nodes){for(const sign of [1,-1]){const[x,y]=qp(sign*node.q[0],sign*node.q[1]);if(x<0||x>420||y<0||y>420)continue;const attrs={stroke:f.color,'stroke-width':1.2,fill:'none'};if(!f.model.valid)attrs['stroke-dasharray']='3 2';const shape=f.geometry?el('path',{...attrs,d:`M${x} ${y-7}L${x+7} ${y}L${x} ${y+7}L${x-7} ${y}Z`}):el('circle',{...attrs,cx:x,cy:y,r:7});shape.append(el('title',{},f.geometry?`Grid (${node.coefficients_mn.join(' ')})`:`${f.model.phase} (${node.hkl.join(' ')}) · ${f.model.valid?'passes screen':'below threshold'}`));$('fft-overlay').append(shape)}}}
}
function renderFitChoices(data){
 chosenFits=new Set();$('fit-list').replaceChildren();
 const add=(key,m,name,geometry=false)=>{const label=document.createElement('label');label.className='fit-choice';const box=document.createElement('input');box.type='checkbox';box.dataset.fit=key;box.addEventListener('change',()=>{box.checked?chosenFits.add(key):chosenFits.delete(key);$('overlay').value='custom';drawFFT()});const text=document.createElement('span');const passed=m.valid?'Pass':'Rejected / below threshold';let reason='';if(!geometry&&!m.valid){const why=[];if(m.matched_profile_count<4)why.push('fewer than 4 profiles');if(m.nonparallel_spread_sine<=.5)why.push('limited directions');if(m.score<=.20)why.push('score ≤ 0.20');if(m.coverage<=.30)why.push('support ≤ 30%');reason=why.length?' · '+why.join(', '):''}text.textContent=`${name} · ${passed} · ${m.matched_profile_count} peaks · RMS ${m.rms_nm_inv.toFixed(3)} nm⁻¹ · support ${(m.coverage*100).toFixed(0)}%${reason}`;label.append(box,text);$('fit-list').append(label)};
 data.models.forEach((m,i)=>add('phase-'+i,m,`${m.phase} [${m.zone_3index.join(' ')}] · ${m.rotation_deg.toFixed(1)}°`));
 for(const [key,name]of [['primary_lattice','Primary geometry-only grid'],['secondary_lattice','Secondary geometry-only grid']])if(data.periodicity[key])add(key,data.periodicity[key],name,true);
 if(!$('fit-list').children.length)$('fit-list').textContent='No retained candidate fits in this region.';
}

$('contrast').oninput=drawFFT;$('peak-marker').onchange=()=>{localStorage.setItem('tem-peak-marker',$('peak-marker').value);drawFFT()};const savedMarker=localStorage.getItem('tem-peak-marker');if(['crosshair','circle','off'].includes(savedMarker))$('peak-marker').value=savedMarker;$('overlay').onchange=()=>{if($('overlay').value==='custom')$('fit-controls').open=true;drawFFT()};$('palette').onchange=()=>{localStorage.setItem('tem-palette',$('palette').value);document.querySelector('.intensity-key').classList.toggle('gray',$('palette').value==='gray');drawFFT()};const savedPalette=localStorage.getItem('tem-palette');if(['gray','magma'].includes(savedPalette))$('palette').value=savedPalette;document.querySelector('.intensity-key').classList.toggle('gray',$('palette').value==='gray');
function updateGridSizeNote(){
 const note=$('grid-size-note');if(!meta){note.textContent='';return}
 const count=Number($('grid-count').value),minimum=Number($('grid-min').value);
 if(!Number.isInteger(count)||count<2||count>24||!Number.isFinite(minimum)||minimum<=0){note.textContent='Choose 2–24 regions per side and a positive stopping limit in nm.';return}
 const extent=Math.min(meta.width,meta.height),pixel=Math.min(meta.pixel_x_nm,meta.pixel_y_nm);
 const start=extent*pixel/count,half=Math.floor(Math.ceil(extent/count)/2);
 note.textContent=`Starting regions: about ${start.toFixed(2)} nm wide. `;
 if(!$('adaptive').checked){note.textContent+='Uniform grid; no subdivision.';return}
 if(half<32||half*pixel<minimum){
  note.textContent+=`The next split would be about ${(start/2).toFixed(2)} nm, below ${half<32?'32 pixels':minimum+' nm'}. Use fewer regions per side to allow subdivision.`;
 }else{
  note.textContent+=`Unresolved, insufficient or ambiguous regions, two candidate structures, and substantial second patterns split into four; each child must remain at least ${minimum} nm and 32 pixels wide.`;
 }
}
for(const id of ['grid-count','grid-min','adaptive'])$(id).addEventListener('input',updateGridSizeNote);
function renderGridSummary(){
 const container=$('grid-summary');container.replaceChildren();container.hidden=!grid;
 if(!grid)return;
 const totalArea=grid.source.width*grid.source.height,counts={};
 for(const key of Object.keys(labels))counts[key]={count:0,area:0};
 let regionCount=0,covered=0;
 for(const region of grid.regions){
  if(!region.leaf)continue;
  const key=Object.hasOwn(counts,region.label)?region.label:'unresolved';
  const area=region.roi.w*region.roi.h;counts[key].count++;counts[key].area+=area;
  regionCount++;covered+=area;
 }
 const heading=document.createElement('h3');heading.textContent='Grid results';
 const summary=document.createElement('p');summary.className='hint';
 summary.textContent=`${regionCount} current map regions · ${(100*covered/totalArea).toFixed(1)}% image coverage · ${grid.state} · started ${grid.grid.count}×${grid.grid.count}, ${grid.grid.adaptive?'adaptive':'uniform'} · model size ×${grid.settings.scale.toFixed(3)}`;
 const table=document.createElement('table'),head=document.createElement('thead'),header=document.createElement('tr');
 for(const title of ['Result','Regions','Image area']){const cell=document.createElement('th');cell.scope='col';cell.textContent=title;header.append(cell)}
 head.append(header);table.append(head);const body=document.createElement('tbody');
 const add=(label,count,area,color)=>{const row=document.createElement('tr');for(const [index,value] of [label,count,`${(100*area/totalArea).toFixed(1)}%`].entries()){const cell=document.createElement('td');cell.textContent=value;if(index===0&&color)cell.style.color=color;row.append(cell)}body.append(row)};
 for(const [key,value]of Object.entries(counts))add(labels[key],value.count,value.area,colors[key]);
 if(covered<totalArea)add('Not yet covered','—',totalArea-covered);
 table.append(body);const note=document.createElement('p');note.className='hint';
 note.textContent='Area is weighted by region size. Counts include current map regions only, excluding subdivided parents. Candidate-labelled image area is not a confirmed phase fraction.';
 container.append(heading,summary,table,note);
}
function drawGrid(){renderGridSummary();const group=$('grid-map');group.replaceChildren();if(!grid||!$('show-grid').checked)return;for(const r of grid.regions){if(!r.leaf)continue;const e=el('rect',{x:r.roi.x,y:r.roi.y,width:r.roi.w,height:r.roi.h,fill:colors[r.label]||'#aaa',stroke:colors[r.label]||'#aaa',class:'grid-cell','data-id':r.id,'fill-opacity':Number($('grid-opacity').value)/100});e.append(el('title',{},labels[r.label]));group.append(e)}}
$('show-grid').onchange=drawGrid;
function updateGridOpacity(){
 const amount=Number($('grid-opacity').value);$('grid-opacity-value').textContent=amount+'%';
 for(const cell of $('grid-map').children)cell.setAttribute('fill-opacity',amount/100);
}
$('grid-opacity').oninput=()=>{updateGridOpacity();writePreference('tem-grid-opacity',Number($('grid-opacity').value))};
const savedOpacity=readPreference('tem-grid-opacity',12);
if(Number.isFinite(savedOpacity))$('grid-opacity').value=clamp(savedOpacity,0,100);
updateGridOpacity();
async function poll(id){try{const status=await api('job?id='+encodeURIComponent(id));if(id!==jobId)return;grid=status;drawGrid();$('grid-status').textContent=`${status.processed} regions analysed · ${status.pending} pending · ${status.state}${status.error?' — '+status.error:''}`;if(status.state==='running')setTimeout(()=>poll(id),600);else{$('run-grid').disabled=false;$('cancel-grid').disabled=true;$('save-grid').disabled=false}}catch(e){message(e.message,true);$('run-grid').disabled=false;$('cancel-grid').disabled=true}}
$('run-grid').onclick=async()=>{if(!meta)return;try{$('run-grid').disabled=true;const d=await api('grid',{...requestBody(),count:Number($('grid-count').value),adaptive:$('adaptive').checked,minimum_nm:Number($('grid-min').value)});jobId=d.id;$('cancel-grid').disabled=false;$('save-grid').disabled=true;poll(jobId)}catch(e){$('run-grid').disabled=false;message(e.message,true)}};
$('cancel-grid').onclick=async()=>{try{await api('cancel',{job_id:jobId})}catch(e){message(e.message,true)}};
async function save(body){try{const d=await api('save',body);message('Saved: '+d.path)}catch(e){message(e.message,true)}}
$('save-region').onclick=()=>{if(result)save({file_id:fileId,roi:result.roi,settings:result.settings})};$('save-grid').onclick=()=>{if(jobId)save({job_id:jobId})};
for(const id of ['scenario','model-scale','threshold'])$(id).onchange=()=>{
 if(!meta)return;
 if(id==='model-scale'&&(!$('model-scale').value||!Number.isFinite(Number($('model-scale').value))||Number($('model-scale').value)<.85||Number($('model-scale').value)>1.15)){
  restoreCalibration();message('Use a model size between 0.850 and 1.150.',true);return;
 }
 if(id==='scenario'||id==='model-scale'){calibrationView();rememberCalibration()}
 if(jobId&&grid?.state==='running')api('cancel',{job_id:jobId}).catch(e=>message(e.message,true));
 jobId=null;grid=null;drawGrid();$('save-grid').disabled=true;$('run-grid').disabled=false;$('cancel-grid').disabled=true;
 $('grid-status').textContent='Settings changed. Run a new grid to use these settings.';schedule(0);
};
$('model-scale').oninput=()=>{
 const field=$('model-scale'),value=Number(field.value);
 if(!field.readOnly&&field.value&&Number.isFinite(value)&&value>=.85&&value<=1.15)field.onchange();
};
$('file').onchange=openFile;
async function start(){try{config=await api('config');const savedFavorites=readPreference(favoriteKey(),[]);favorites=new Set(Array.isArray(savedFavorites)?savedFavorites.filter(id=>typeof id==='string'):[]);renderFavorites();$('connection').textContent='Local Python · connected';$('data-path').textContent='Data: '+config.data_root;$('output-path').textContent='Results: '+config.output_root;for(const sample of ['STA','ST']){const group=document.createElement('optgroup');group.label=sample;for(const f of config.files.filter(f=>f.sample===sample)){const option=document.createElement('option');option.value=f.id;option.textContent=f.name;group.append(option)}$('file').append(group)}if(config.default_file)$('file').value=config.default_file;if(!$('file').value&&config.files.length)$('file').value=config.files[0].id;if(config.files.length)await openFile();else message('No STA/ST DM4 files found. Check the configured TEM folder.',true)}catch(e){$('connection').textContent='Disconnected';message(e.message,true)}}
start();

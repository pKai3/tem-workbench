'use strict';
const MAGMA=[[0,0,3],[0,0,4],[0,0,6],[1,0,7],[1,1,9],[1,1,11],[2,2,13],[2,2,15],[3,3,17],[4,3,19],[4,4,21],[5,4,23],[6,5,25],[7,5,27],[8,6,29],[9,7,31],[10,7,34],[11,8,36],[12,9,38],[13,10,40],[14,10,42],[15,11,44],[16,12,47],[17,12,49],[18,13,51],[20,13,53],[21,14,56],[22,14,58],[23,15,60],[24,15,63],[26,16,65],[27,16,68],[28,16,70],[30,16,73],[31,17,75],[32,17,77],[34,17,80],[35,17,82],[37,17,85],[38,17,87],[40,17,89],[42,17,92],[43,17,94],[45,16,96],[47,16,98],[48,16,101],[50,16,103],[52,16,104],[53,15,106],[55,15,108],[57,15,110],[59,15,111],[60,15,113],[62,15,114],[64,15,115],[66,15,116],[67,15,117],[69,15,118],[71,15,119],[72,16,120],[74,16,121],[75,16,121],[77,17,122],[79,17,123],[80,18,123],[82,18,124],[83,19,124],[85,19,125],[87,20,125],[88,21,126],[90,21,126],[91,22,126],[93,23,126],[94,23,127],[96,24,127],[97,24,127],[99,25,127],[101,26,128],[102,26,128],[104,27,128],[105,28,128],[107,28,128],[108,29,128],[110,30,129],[111,30,129],[113,31,129],[115,31,129],[116,32,129],[118,33,129],[119,33,129],[121,34,129],[122,34,129],[124,35,129],[126,36,129],[127,36,129],[129,37,129],[130,37,129],[132,38,129],[133,38,129],[135,39,129],[137,40,129],[138,40,129],[140,41,128],[141,41,128],[143,42,128],[145,42,128],[146,43,128],[148,43,128],[149,44,128],[151,44,127],[153,45,127],[154,45,127],[156,46,127],[158,46,126],[159,47,126],[161,47,126],[163,48,126],[164,48,125],[166,49,125],[167,49,125],[169,50,124],[171,51,124],[172,51,123],[174,52,123],[176,52,123],[177,53,122],[179,53,122],[181,54,121],[182,54,121],[184,55,120],[185,55,120],[187,56,119],[189,57,119],[190,57,118],[192,58,117],[194,58,117],[195,59,116],[197,60,116],[198,60,115],[200,61,114],[202,62,114],[203,62,113],[205,63,112],[206,64,112],[208,65,111],[209,66,110],[211,66,109],[212,67,109],[214,68,108],[215,69,107],[217,70,106],[218,71,105],[220,72,105],[221,73,104],[222,74,103],[224,75,102],[225,76,102],[226,77,101],[228,78,100],[229,80,99],[230,81,98],[231,82,98],[232,84,97],[234,85,96],[235,86,96],[236,88,95],[237,89,95],[238,91,94],[238,93,93],[239,94,93],[240,96,93],[241,97,92],[242,99,92],[243,101,92],[243,103,91],[244,104,91],[245,106,91],[245,108,91],[246,110,91],[246,112,91],[247,113,91],[247,115,92],[248,117,92],[248,119,92],[249,121,92],[249,123,93],[249,125,93],[250,127,94],[250,128,94],[250,130,95],[251,132,96],[251,134,96],[251,136,97],[251,138,98],[252,140,99],[252,142,99],[252,144,100],[252,146,101],[252,147,102],[253,149,103],[253,151,104],[253,153,105],[253,155,106],[253,157,107],[253,159,108],[253,161,110],[253,162,111],[253,164,112],[254,166,113],[254,168,115],[254,170,116],[254,172,117],[254,174,118],[254,175,120],[254,177,121],[254,179,123],[254,181,124],[254,183,125],[254,185,127],[254,187,128],[254,188,130],[254,190,131],[254,192,133],[254,194,134],[254,196,136],[254,198,137],[254,199,139],[254,201,141],[254,203,142],[253,205,144],[253,207,146],[253,209,147],[253,210,149],[253,212,151],[253,214,152],[253,216,154],[253,218,156],[253,220,157],[253,221,159],[253,223,161],[253,225,163],[252,227,165],[252,229,166],[252,230,168],[252,232,170],[252,234,172],[252,236,174],[252,238,176],[252,240,177],[252,241,179],[252,243,181],[252,245,183],[251,247,185],[251,249,187],[251,250,189],[251,252,191]];
const $=id=>document.getElementById(id), NS='http://www.w3.org/2000/svg';
const labels={hcp_compatible:'HCP compatible',bcc_compatible:'BCC compatible',coexisting_candidates:'Two candidate structures',multiple_orientations:'Multiple orientations',ambiguous:'HCP / BCC ambiguous',unresolved:'Phase unresolved',insufficient:'Insufficient evidence'};
const colors={hcp_compatible:'#79bafa',bcc_compatible:'#f4b75e',coexisting_candidates:'#d692fa',multiple_orientations:'#64d6bb',ambiguous:'#df9da6',unresolved:'#a4adba',insufficient:'#596778'};
let config, meta, roi={x:0,y:0,w:684,h:684}, fileId, result=null, fftRaw=null, grid=null, jobId=null;
let chosenFits=new Set(), favorites=new Set();
let regionProject={revision:0,regions:[]},selectedRegionId=null,regionRequest=0;
let folderTarget=null,folderListing=null,folderBrowseVersion=0;
let rescoreTimer=null, rescoreBusy=false, rescorePending=false, rescoreRevision=0, scalePenalty=.10, peakEvidenceWeight=.10;
let zoneJob=null, zoneSymbols={HCP:new Map(),BCC:new Map()};
const ZONE_SYMBOLS=['●','▲','◆','■','★','✚','✕','▼','⬟','⬢','◀','▶','✦','✳','◉','⊞','⊠','✧'];
const phaseColors={HCP:colors.hcp_compatible,BCC:colors.bcc_compatible};
let generation=0, busy=false, pending=false, timer=null, drag=null, sourceRequest=0, opened=false;
function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error)}
async function api(path,body){const options=body?{method:'POST',headers:{'Content-Type':'application/json','X-TEM-Token':config.token},body:JSON.stringify(body)}:{};const r=await fetch('/api/'+path,options);const data=await r.json();if(!r.ok)throw new Error(data.error||r.statusText);return data}
function readPreference(key,fallback){
 try{
  const text=localStorage.getItem(key);if(text===null)return fallback;
  try{return JSON.parse(text)??fallback}catch{return text} // Accept older plain-text display preferences.
 }catch{return fallback}
}
function writePreference(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch{message('Browser storage is unavailable; these preferences will last until this page closes.',true)}}
const BASIC_NUMBERS={"threshold":[0.15,0.7],"grid-count":[2,24,true],"grid-min":[0,null]};
const BASIC_FLAGS=['adaptive','check-passing','show-grid','fft-hann','fft-mean'];
const OVERLAY_MODES=['none','HCP','BCC','both','geometry','custom'];
let preferredRegionNm=readPreference('tem-region-width-nm',20);
if(typeof preferredRegionNm!=='number'||!Number.isFinite(preferredRegionNm)||preferredRegionNm<=0)preferredRegionNm=20;
function validControlNumber(id,value){
 const [min,max,integer]=BASIC_NUMBERS[id];
 return typeof value==='number'&&Number.isFinite(value)&&value>=min&&(max===null||value<=max)&&(!integer||Number.isInteger(value))&&(id!=='grid-min'||value>0);
}
function restoreBasicControls(){
 const saved=readPreference('tem-basic-settings',{});if(!saved||typeof saved!=='object')return;
 for(const id of Object.keys(BASIC_NUMBERS))if(validControlNumber(id,saved[id]))$(id).value=saved[id];
 for(const id of BASIC_FLAGS)if(typeof saved[id]==='boolean')$(id).checked=saved[id];
 if(OVERLAY_MODES.includes(saved.overlay))$('overlay').value=saved.overlay;
 if($('overlay').value==='custom')$('fit-controls').open=true;
}
function rememberBasicControls(){
 const previous=readPreference('tem-basic-settings',{}),saved={};
 for(const id of Object.keys(BASIC_NUMBERS)){
  const value=$(id).value===''?NaN:Number($(id).value);
  if(validControlNumber(id,value))saved[id]=value;
  else if(previous&&validControlNumber(id,previous[id]))saved[id]=previous[id];
 }
 for(const id of BASIC_FLAGS)saved[id]=$(id).checked;
 if(OVERLAY_MODES.includes($('overlay').value))saved.overlay=$('overlay').value;
 writePreference('tem-basic-settings',saved);
}
function rememberRegionSize(){
 if(!meta)return;
 const width=roi.w*meta.pixel_x_nm;
 if(width!==preferredRegionNm){preferredRegionNm=width;writePreference('tem-region-width-nm',width)}
}
function lastImageKey(){return 'tem-last-image:'+config.data_root}
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
function settings(){const mode=$('scenario').value;return {scale:Number($('model-scale').value),bcc_a:Number($('bcc-a').value),threshold:Number($('threshold').value),scale_penalty_strength:config?.scale_penalty?scalePenalty:0,peak_evidence_weight:config?.peak_evidence?peakEvidenceWeight:0,scale_mode:mode.startsWith('auto_')?mode:'fixed',fft_window:config?.fft_processing&&!$('fft-hann').checked?'none':'hann',remove_mean:config?.fft_processing?$('fft-mean').checked:true}}
function calibrationView(){
 const v=$('scenario').value,field=$('model-scale'),automatic=v.startsWith('auto_');
 updatePenaltyControls();
 field.closest('.scale-input').style.display=automatic?'none':'';
 if(automatic){field.value='1.000';field.readOnly=true;$('bcc-a').value=.330;
  $('calibration-note').textContent=(v==='auto_uniform'?'Each region fits one prediction scale separately for HCP and BCC; HCP c/a stays fixed.':'Each region fits one BCC prediction scale and independent HCP a/c scales where visible.')+' Range ×0.85–1.15 relative to nominal dimensions. Measured FFT axes stay unchanged. Candidate model dimensions are shown below.';return}

 if(v!=='custom')field.value='1.000';
 field.readOnly=v!=='custom';$('bcc-a').value=.330;
 const scale=Number(field.value).toFixed(3);
 const explanation=v==='1'?'Nominal model sizes; stored DM4 calibration.':'Manual comparison; a better fit is not a measurement of calibration or strain.';
 $('calibration-note').textContent=`Model size ×${scale} for both structures · BCC a = ${Number($('bcc-a').value).toFixed(5)} nm. ${explanation} Measured FFT axes stay unchanged.`;
}
function restoreCalibration(){
 const saved=readPreference('tem-scale-last',readPreference('tem-scale:'+meta.sha256_pixels,{}));
 const valid=saved&&['1','custom','auto_uniform','auto_hcp_ac'].includes(saved.mode)&&(!saved.mode.startsWith('auto_')||config.scale_modes?.includes(saved.mode))&&Number.isFinite(saved.scale)&&saved.scale>=.85&&saved.scale<=1.15;
 const defaultMode=config.scale_modes?.includes('auto_hcp_ac')?'auto_hcp_ac':'1';
 $('scenario').value=valid?saved.mode:defaultMode;$('model-scale').value=valid?saved.scale:1;
 calibrationView();rememberCalibration();
}
function rememberCalibration(){writePreference('tem-scale-last',{mode:$('scenario').value,scale:Number($('model-scale').value)})}
function requestBody(){return {file_id:fileId,roi:{...roi},settings:settings()}}
function el(tag,attrs,text){const e=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;return e}
// Convert labels only; numerical fits and saved three-index records stay unchanged.
function indexGcd(a,b){while(b){[a,b]=[b,a%b]}return Math.abs(a)}
function zoneIndices(model){
 const [u,v,w]=model.zone_3index;
 if(model.phase!=='HCP')return [u,v,w];
 const indices=[2*u-v,2*v-u,-u-v,3*w];
 const divisor=indices.reduce((g,n)=>indexGcd(g,Math.abs(n)),0)||1;
 return indices.map(n=>n/divisor);
}
function planeIndices(model,hkl,sign=1){
 const [h,k,l]=hkl.map(n=>n*sign);
 // Preserve reflection order: plane indices must not be reduced by their GCD.
 return model.phase==='HCP'?[h,k,-h-k,l]:[h,k,l];
}
function indexLabel(indices,brackets='[]'){
 // Combining overlines also work in plain-text SVG tooltips.
 return brackets[0]+indices.map(n=>n<0?Array.from(String(-n),digit=>digit+'\u0305').join(''):String(n)).join(' ')+brackets[1];
}
function zoneLabel(model){return indexLabel(zoneIndices(model))}
function planeLabel(model,hkl,sign=1){return indexLabel(planeIndices(model,hkl,sign),'()')}
function clamp(v,min,max){return Math.min(max,Math.max(min,v))}
function updateBox(preserveHeight=false){if(!meta)return;const min=32,max=Math.min(meta.width,meta.height);roi.w=clamp(Math.round(roi.w),min,max);roi.h=preserveHeight?roi.h:roi.w;roi.x=clamp(Math.round(roi.x),0,meta.width-roi.w);roi.y=clamp(Math.round(roi.y),0,meta.height-roi.h);for(const[k,v]of Object.entries({x:roi.x,y:roi.y,width:roi.w,height:roi.h}))$('roi-box').setAttribute(k,v);const handle=meta.width*.018;$('roi-handle').setAttribute('width',handle);$('roi-handle').setAttribute('height',handle);$('roi-handle').setAttribute('x',roi.x+roi.w-handle/2);$('roi-handle').setAttribute('y',roi.y+roi.h-handle/2);$('roi-x').value=roi.x;$('roi-y').value=roi.y;$('roi-nm').value=(roi.w*meta.pixel_x_nm).toFixed(2);$('region-size').textContent=`${(roi.w*meta.pixel_x_nm).toFixed(2)} nm · ${roi.w} px`;rememberRegionSize()}
// Invalidate the old result immediately; never attach it to a newly moved region.
function schedule(delay=120){generation++;pending=true;result=null;$('save-region').disabled=true;$('phase-label').textContent='Updating…';document.querySelector('.previews').classList.add('stale');if(!timer)timer=setTimeout(()=>{timer=null;analyze()},delay)}
async function analyze(){if(busy||!meta||!pending)return;pending=false;busy=true;const version=generation,body=requestBody();try{const data=await api('analyze',body);if(version===generation||(drag&&body.file_id===fileId&&JSON.stringify(body.settings)===JSON.stringify(settings()))){result=data;await renderResult(data,version,body)}}catch(e){if(version===generation){message(e.message,true);$('phase-label').textContent='Analysis unavailable'}}finally{busy=false;if(pending&&!timer)timer=setTimeout(()=>{timer=null;analyze()},20)}}
async function openFile(){rescoreRevision++;rescorePending=false;clearTimeout(rescoreTimer);const version=++sourceRequest;generation++;pending=false;meta=null;result=null;opened=false;resetRegionEditor();renderFavorites();$('save-region').disabled=true;const id=$('file').value;message('Opening source image…');try{if(isGridRunning())await api('cancel',{job_id:jobId});const info=await api('open',{file_id:id});if(version!==sourceRequest)return;meta=info;fileId=id;opened=true;writePreference(lastImageKey(),id);grid=null;jobId=null;drawGrid();$('save-grid').disabled=true;$('cancel-grid').disabled=true;$('run-grid').disabled=false;$('grid-status').textContent='Adaptive subdivides unresolved or ambiguous regions, two candidate structures, and substantial second patterns.';restoreCalibration();renderFavorites();updateGridSizeNote();$('overview').setAttribute('viewBox',`0 0 ${info.width} ${info.height}`);$('source-image').setAttribute('width',info.width);$('source-image').setAttribute('height',info.height);$('source-image').setAttribute('href','/api/preview?id='+encodeURIComponent(id));$('metadata').textContent=`${info.width} × ${info.height} · ${info.pixel_x_nm.toFixed(5)} nm/px · ${info.device}${info.is_demo?' · bundled demo':''}`;const size=Math.min(info.width,info.height,Math.max(32,Math.round(preferredRegionNm/info.pixel_x_nm)));roi={x:Math.round((info.width-size)/2),y:Math.round((info.height-size)/2),w:size,h:size};updateBox();renderSavedRegions();schedule(0);message('Drag the box to inspect a region, or run an automatic grid.')}catch(e){if(version===sourceRequest)message(e.message,true)}}
function point(event){const pt=new DOMPoint(event.clientX,event.clientY);return pt.matrixTransform($('overview').getScreenCTM().inverse())}
$('overview').addEventListener('pointerdown',e=>{if(!meta||e.button!==0)return;$('overview').focus({preventScroll:true});e.preventDefault();const cell=e.target.closest('.grid-cell');if(cell){const r=grid.regions.find(r=>r.id===cell.dataset.id);roi={...r.roi};updateBox(true);schedule(0);return}const p=point(e);const inside=p.x>=roi.x&&p.x<=roi.x+roi.w&&p.y>=roi.y&&p.y<=roi.y+roi.h;const resizing=e.target.id==='roi-handle';if(!inside&&!resizing){roi.x=p.x-roi.w/2;roi.y=p.y-roi.h/2;updateBox();schedule()}drag={mode:resizing?'resize':'move',x:p.x,y:p.y,roi:{...roi}};$('overview').setPointerCapture(e.pointerId);e.preventDefault()});
$('overview').addEventListener('pointermove',e=>{if(!drag)return;const p=point(e);if(drag.mode==='resize'){roi.w=clamp(drag.roi.w+Math.max(p.x-drag.x,p.y-drag.y),32,Math.min(meta.width-drag.roi.x,meta.height-drag.roi.y))}else{roi.x=drag.roi.x+p.x-drag.x;roi.y=drag.roi.y+p.y-drag.y}updateBox();schedule(90)});
for(const name of ['pointerup','pointercancel'])$('overview').addEventListener(name,()=>{if(drag){drag=null;schedule(0)}});
$('overview').addEventListener('keydown',e=>{if(!meta||e.altKey||e.ctrlKey||e.metaKey)return;const offsets={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};if(!offsets[e.key])return;const n=e.shiftKey?50:10;roi.x+=offsets[e.key][0]*n;roi.y+=offsets[e.key][1]*n;updateBox(true);schedule();e.preventDefault()});
for(const [id,key]of [['roi-x','x'],['roi-y','y'],['roi-nm','w']])$(id).addEventListener('change',()=>{if(!meta)return;const n=Number($(id).value);if(!Number.isFinite(n))return;roi[key]=key==='w'?n/meta.pixel_x_nm:n;updateBox();schedule(0)});
$('centre').onclick=()=>{if(!meta)return;roi.x=(meta.width-roi.w)/2;roi.y=(meta.height-roi.h)/2;updateBox();schedule(0)};
function patternExplanation(data){
 const label=data.classification.label;
 if(label==='coexisting_candidates')return 'Separate peak sets support HCP and BCC candidates; their proportions are unknown.';
 if(label==='multiple_orientations')return 'Separate peak sets support multiple orientations of the same candidate structure.';
 if(data.classification.ambiguity_reason==='shared_peaks_model_tradeoff')return 'Both structures explain the same detected peaks. The leading fit also uses extra flexibility or more unsupported predictions; the phase remains ambiguous.';
 if(label==='ambiguous')return 'HCP and BCC fit overlapping evidence; the phase assignment remains ambiguous.';
 if(data.periodicity.status==='multiple_periodic_patterns')return 'Additional periodicity is supported, but a second phase assignment remains unresolved.';
 if(data.periodicity.status==='predominantly_one_periodic_pattern')return ['hcp_compatible','bcc_compatible'].includes(label)?'One periodic pattern predominates in the geometry check.':'A periodic pattern is supported, but its phase remains unresolved.';
 return 'The geometry check could not resolve the number of periodic patterns.';
}
function scaleSummary(settings){
 const label=settings.scale_mode==='auto_uniform'?'automatic single scale per candidate and region':settings.scale_mode==='auto_hcp_ac'?'automatic BCC single / HCP a+c per region':`fixed prediction scale ×${settings.scale.toFixed(3)}`;
 return label+(settings.scale_mode?.startsWith('auto_')?` · scale penalty ${(settings.scale_penalty_strength??0).toFixed(3)} per 5%`:'')+` · peak evidence ${(settings.peak_evidence_weight??0).toFixed(2)}`;
}
function fittedDimensions(model){
 const a=model.fitted_a_nm??model.nominal_a_nm/model.shared_scale;
 const c=model.fitted_c_nm??(model.scale_mode==='auto_hcp_ac'?null:model.nominal_c_nm/model.shared_scale);
 return a.toFixed(4)+(model.phase==='HCP'?' / '+(c===null?'unconstrained':c.toFixed(4)):'');
}
function scaleDetails(model){
 const a=model.scale_a??model.shared_scale,c=model.scale_c;
 if(model.scale_mode==='auto_hcp_ac'&&model.phase==='HCP')return `prediction scale a* ×${a.toFixed(4)}, c* ${c==null?'unconstrained':'×'+c.toFixed(4)}`;
 return `prediction scale ×${a.toFixed(4)}`;
}
function scalePercentages(model){
 const percent=value=>{if(value==null||!Number.isFinite(value))return 'unconstrained';const change=(value-1)*100;return (Math.abs(change)<.05?'0.0':(change>0?'+':'−')+Math.abs(change).toFixed(1))+'%'};
 const a=model.scale_a??model.shared_scale;
 if(model.phase!=='HCP')return percent(a);
 const c=model.scale_c??(model.scale_mode==='auto_hcp_ac'?null:a);
 return `a* ${percent(a)} / c* ${percent(c)}`;
}
function predictionCounts(model){
 const total=model.predicted_nodes?.length??model.predicted_visible_band_node_count;
 const strong=model.matched_prediction_count??model.matched_profile_count;
 return `${strong}${model.peak_evidence?'+'+model.peak_evidence.weak_count+'w':''} / ${total??'—'}`;
}
function evidenceDescription(model){
 const e=model.peak_evidence;if(!e)return 'Original detected profiles / prediction positions.';
 return `${e.detected_count} strong + ${e.weak_count} weak; ${e.unsupported_count} unsupported; ${e.unassessable_count} unchecked. Search radius ${e.search_radius_nm_inv.toFixed(3)} nm⁻¹. Weak maxima do not count toward the initial screen.`;
}
function rankDescription(m){return `Position ${(m.position_score??m.score).toFixed(3)} − scale ${(m.scale_penalty??0).toFixed(3)} + weak ${(m.weak_peak_bonus??0).toFixed(3)} − missing ${(m.missing_peak_penalty??0).toFixed(3)} = rank ${m.score.toFixed(3)}`}
function compareRank(a,b){
 if(!a)return b?1:0;
 if(!b)return -1;
 return b.score-a.score||b.coverage-a.coverage;
}
const COVERAGE_HELP='Weighted share of original detected peak profiles matched by this fit. Peak weights use height above the radial background, capped at 1–6. Extra weak maxima are excluded. Not an intensity fraction or phase probability.';
function renderEvidence(data){
 const container=$('evidence-table');container.replaceChildren();$('evidence-details').hidden=!data.models.some(m=>m.peak_evidence);
 const table=document.createElement('table'),header=document.createElement('tr'),head=document.createElement('thead'),body=document.createElement('tbody');
 for(const label of ['Candidate / zone','Strong','Weak','No peak','Unchecked','+ Bonus','− Missing']){const th=document.createElement('th');th.textContent=label;header.append(th)}
 head.append(header);table.append(head,body);container.append(table);
 for(const m of [...data.models].sort(compareRank)){
  const e=m.peak_evidence;if(!e)continue;const row=document.createElement('tr');row.title=rankDescription(m)+' · '+evidenceDescription(m);
  for(const value of [`${m.phase} ${zoneLabel(m)}`,e.detected_count,e.weak_count,e.unsupported_count,e.unassessable_count,m.weak_peak_bonus.toFixed(3),m.missing_peak_penalty.toFixed(3)]){const td=document.createElement('td');td.textContent=value;row.append(td)}
  body.append(row);
 }
}
function screenReasons(m){
 if(m.valid)return [];
 const reasons=[];
 if(m.matched_profile_count<4)reasons.push(`${m.matched_profile_count}/4 strong profiles`);
 if(m.nonparallel_spread_sine<=.5)reasons.push('limited directions');
 if(m.coverage<=.30)reasons.push('peak coverage ≤ 30%');
 if((m.position_score??m.score)<=.20)reasons.push('position ≤ 0.20');
 if(m.score<=.20)reasons.push('rank ≤ 0.20');
 return reasons;
}
function screenLabel(m){return m.valid?'Pass':'Below\n'+(screenReasons(m)[0]||'fit screen').replace(' strong profiles',' strong').replace('peak coverage','coverage')}
function bestModel(data,phase){return data.models.find(m=>m.phase===phase&&m.valid)??data.models.find(m=>m.phase===phase)}
// Shared column definitions keep both candidate tables aligned.
const FIT_COLUMNS=[["candidate","Candidate\nZone axis","Zone axis: HCP [u v t w], BCC [u v w]. A bar means a negative index; individual overlays also show rotation."],["rank","Rank ↓","Position − scale cost + weak-peak bonus − missing-prediction cost; heuristic rank, not probability; highest first"],["screen","Screen","Candidate acceptance screen; hover for all rejection reasons"],["peaks","Peaks\nS+W / all","Original strong profiles + separately checked weak maxima / prediction positions. Weak maxima do not count toward the four-profile screen."],["coverage","Peak\ncoverage",COVERAGE_HELP],["rms","RMS\nnm⁻¹","Root-mean-square positional residual"],["position","Position","Position-weighted agreement minus chance-match allowance; before scale and peak-evidence adjustments"],["cost","Scale\ncost","Cost of automatic scale changes, subtracted from the position score"],["dimensions","a / c\nnm","Candidate model lattice dimensions, assuming the stored image calibration"],["scale","Scale Δ\n%","100 × (reciprocal prediction multiplier − 1); HCP shows a* and c* separately. Model lattice dimensions change inversely."]];
function renderFitHeader(head, showToggle=false){
 const row=document.createElement('tr');
 const columns=showToggle?[['show','Show','Toggle this overlay'],...FIT_COLUMNS]:FIT_COLUMNS;
 for(const [key,label,help]of columns){
  const cell=document.createElement('th');cell.scope='col';cell.className='col-'+key;cell.dataset.column=key;
  cell.textContent=label;cell.title=help;
  if(key==='rank')cell.setAttribute('aria-sort','descending');
  row.append(cell);
 }
 head.replaceChildren(row);
}
function appendFitCells(row,m,{name,geometry=false,rotation=false}){
 const values={
  candidate:name+(m&&rotation?`\n${m.rotation_deg.toFixed(1)}°`:''),
  rank:m?m.score.toFixed(3):'—',
  screen:m?(geometry?(m.valid?'Pass':'Below'):screenLabel(m)):'No fit',
  peaks:m?(geometry?m.matched_profile_count+' peaks':predictionCounts(m)):'—',
  coverage:m?`${(100*m.coverage).toFixed(0)}%`:'—',
  rms:m?m.rms_nm_inv.toFixed(3):'—',
  position:m&&!geometry?(m.position_score??m.score).toFixed(3):'—',
  cost:m&&!geometry?(m.scale_penalty??0).toFixed(3):'—',
  dimensions:m&&!geometry?fittedDimensions(m).replace(' / ','\n'):'—',
  scale:m&&!geometry?scalePercentages(m).replace(' / ','\n'):'—'
 };
 for(const [key,,help]of FIT_COLUMNS){
  const cell=document.createElement('td');cell.className='col-'+key;cell.dataset.column=key;
  cell.textContent=values[key];cell.title=help;
  if(m){
   if(key==='candidate')cell.className+=' '+(geometry?'geometry-fit':m.phase==='HCP'?'hcp':'bcc');
   if(key==='rank')cell.title=geometry?'Geometry-only score':rankDescription(m);
   if(key==='peaks')cell.title=geometry?'Profiles matched by a freely fitted reciprocal grid':evidenceDescription(m);
   if(key==='screen')cell.title=m.valid?'Passes the screen':geometry?'Below threshold':screenReasons(m).join('; ');
   if(!geometry&&(key==='dimensions'||key==='scale'))cell.title=scaleDetails(m)+(key==='scale'?' · '+help:'');
  }
  row.append(cell);
 }
}
renderFitHeader($('model-head'));
function renderModels(data){
 $('models').replaceChildren();
 const ranked=['HCP','BCC'].map(phase=>({phase,m:bestModel(data,phase)})).sort((a,b)=>compareRank(a.m,b.m));
 for(const {phase,m}of ranked){
  const row=document.createElement('tr');
  appendFitCells(row,m,{name:m?`${phase} ${zoneLabel(m)}`:phase});
  $('models').append(row);
 }
 $('fit-summary').textContent=scaleSummary(data.settings)+'. Rank = position − scale cost + weak-peak bonus − missing-prediction cost. S+W separates strong profiles from weak maxima; peak coverage is the weighted share of original detected profiles matched by the candidate. Prediction-site evidence below shows the separate adjustments. Model dimensions assume the stored calibration; these scores are not phase probabilities.';
}
async function renderResult(data,version,body){$('crop').src=data.images.crop;$('phase-label').textContent=labels[data.classification.label]||data.classification.label;$('phase-label').style.color=colors[data.classification.label]||'#ddd';$('timing').textContent=`${data.elapsed_ms.toFixed(0)} ms · ROI ${data.roi.x}, ${data.roi.y}`;$('pattern-label').textContent=patternExplanation(data);$('geometry-check').textContent='Geometry check: '+({predominantly_one_periodic_pattern:'one periodic pattern predominates.',multiple_periodic_patterns:'a substantial second periodic pattern is supported.',unresolved_pattern:'pattern count remains unresolved.'}[data.periodicity.status]||'pattern count remains unresolved.');renderModels(data);renderEvidence(data);$('result-detail').textContent=`${data.spectrum.peaks.length} independent peak profiles · FFT bins ${data.spectrum.df.toFixed(3)} nm⁻¹. Opposite spots represent the same profile.`;$('flags').replaceChildren();for(const f of data.classification.flags){const li=document.createElement('li');li.textContent=f;$('flags').append(li)}$('peaks').replaceChildren();for(const p of data.spectrum.peaks){const tr=document.createElement('tr');for(const v of [p.profile_id,p.g_nm_inv.toFixed(3),(1/p.g_nm_inv).toFixed(4),p.qx.toFixed(3),p.qy.toFixed(3)]){const td=document.createElement('td');td.textContent=v;tr.append(td)}$('peaks').append(tr)}$('peak-count').textContent=`(${data.spectrum.peaks.length})`;renderFitChoices(data);const img=new Image();const precise=Boolean(data.images.fft_log16);img.src=data.images.fft_log16||data.images.fft;await img.decode();if(version!==generation&&(!drag||body.file_id!==fileId||JSON.stringify(body.settings)!==JSON.stringify(settings())))return;result=data;const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);const pixels=ctx.getImageData(0,0,img.width,img.height),maximum=precise?65535:255,histogram=new Uint32Array(maximum+1);for(let i=0;i<pixels.data.length;i+=4)histogram[precise?(pixels.data[i]<<8)|pixels.data[i+1]:pixels.data[i]]++;fftRaw={canvas,pixels,precise,histogram,maximum,limits:data.images.fft_log_limits||[0,1]};drawFFT();document.querySelector('.previews').classList.remove('stale');$('save-region').disabled=version!==generation}
function drawFFT(){
 if(!result||!fftRaw)return;
 const {canvas,pixels,precise,histogram,maximum,limits}=fftRaw,ctx=canvas.getContext('2d');
 const percentile=f=>{let sum=0;for(let i=0;i<=maximum;i++){sum+=histogram[i];if(sum>=canvas.width*canvas.height*f)return i}return maximum};
 const lo=percentile(Number($('contrast').value)/100),high=clamp(Number($('fft-white').value)||99.8,91,100),hi=percentile(high/100);
 const linear=$('fft-curve').value==='linear'&&precise;
 const transform=code=>linear?Math.sqrt(Math.expm1(limits[0]+code/maximum*(limits[1]-limits[0]))):code;
 const lowValue=transform(lo),span=Math.max(transform(hi)-lowValue,1e-12),lookup=new Uint8ClampedArray((maximum+1)*3);
 for(let code=0;code<=maximum;code++){
  const v=Math.round(clamp((transform(code)-lowValue)/span,0,1)*255),rgb=$('palette').value==='gray'?[v,v,v]:MAGMA[v];
  lookup.set(rgb,code*3);
 }
 const out=ctx.createImageData(canvas.width,canvas.height);
 for(let i=0;i<out.data.length;i+=4){const code=precise?(pixels.data[i]<<8)|pixels.data[i+1]:pixels.data[i];out.data[i]=lookup[code*3];out.data[i+1]=lookup[code*3+1];out.data[i+2]=lookup[code*3+2];out.data[i+3]=255}
 ctx.putImageData(out,0,0);$('fft-image').setAttribute('href',canvas.toDataURL());$('contrast-value').textContent=$('contrast').value+'%';
 const ex=result.spectrum.extent;const qp=(x,y)=>[(x-ex[0])/(ex[1]-ex[0])*420,(ex[3]-y)/(ex[3]-ex[2])*420];$('fft-overlay').replaceChildren();$('fft-axes').replaceChildren();for(const q of [-10,-5,0,5,10]){if(q<ex[0]||q>ex[1])continue;const [px]=qp(q,0);$('fft-axes').append(el('text',{x:px,y:437,fill:'#8c9eaf','font-size':10,'text-anchor':'middle'},q));const[,py]=qp(0,q);$('fft-axes').append(el('text',{x:-7,y:py+3,fill:'#8c9eaf','font-size':10,'text-anchor':'end'},q))}const overlay=$('overlay').value;const marker=$('peak-marker').value;if(marker!=='off')for(const p of result.spectrum.peaks){for(const sign of [1,-1]){const[x,y]=qp(sign*p.qx,sign*p.qy);const attrs={stroke:'#ffffff','stroke-width':1,fill:'none','data-measured-profile':p.profile_id};const shape=marker==='crosshair'?el('path',{...attrs,d:`M${x-4},${y}h8M${x},${y-4}v8`}):el('circle',{...attrs,cx:x,cy:y,r:3});shape.append(el('title',{},`Measured profile ${p.profile_id} · g ${p.g_nm_inv.toFixed(3)} nm⁻¹`));$('fft-overlay').append(shape)}}const fits=[];
if(['HCP','BCC','both'].includes(overlay)){for(const phase of overlay==='both'?['HCP','BCC']:[overlay]){const m=bestModel(result,phase);if(m)fits.push({model:m,color:phase==='HCP'?colors.hcp_compatible:colors.bcc_compatible,geometry:false})}}
if(overlay==='geometry'){for(const [key,color,name]of [['primary_lattice','#df92ef','Primary geometry'],['secondary_lattice','#64d6bb','Secondary geometry']]){const m=result.periodicity[key];if(m)fits.push({model:m,color,geometry:true,name})}}
if(overlay==='custom'){
 for(const key of chosenFits){if(key.startsWith('phase-')){const m=result.models[Number(key.slice(6))];if(m)fits.push({model:m,color:m.phase==='HCP'?colors.hcp_compatible:colors.bcc_compatible,geometry:false})}else{const m=result.periodicity[key];if(m)fits.push({model:m,color:key==='primary_lattice'?'#df92ef':'#64d6bb',geometry:true,name:key==='primary_lattice'?'Primary geometry':'Secondary geometry'})}}
}
for(const f of fits){
 const matched=new Set(f.model.matches.map(m=>m.node_index));
 for(const [nodeIndex,node] of f.model.predicted_nodes.entries()){
  const evidence=f.model.peak_evidence?.nodes.find(n=>n.node_index===nodeIndex);
  const supported=f.geometry||matched.has(nodeIndex),weak=evidence?.status==='weak';
  for(const sign of [1,-1]){
   const[x,y]=qp(sign*node.q[0],sign*node.q[1]);if(x<0||x>420||y<0||y>420)continue;
   const attrs={stroke:f.color,'stroke-width':1.2,fill:'none'};
   if(!f.model.valid)attrs['stroke-dasharray']='5 3';else if(weak)attrs['stroke-dasharray']='2 2';else if(!supported)attrs['stroke-dasharray']='1 3';
   if(evidence?.status==='unassessable')attrs.opacity=.35;
   const shape=f.geometry?el('path',{...attrs,d:`M${x} ${y-7}L${x+7} ${y}L${x} ${y+7}L${x-7} ${y}Z`}):el('circle',{...attrs,cx:x,cy:y,r:7});
   const evidenceText=supported?'matched original detected profile':weak?`weak local maximum ${evidence.weak_id}, local contrast ${evidence.local_contrast.toFixed(1)}, offset ${evidence.offset_nm_inv.toFixed(3)} nm⁻¹`:evidence?.status==='unassessable'?'not reliably assessable':'no strong or qualifying weak maximum assigned';
   shape.append(el('title',{},f.geometry?`${f.name||'Geometry'} ${indexLabel(node.coefficients_mn.map(n=>sign*n),'()')}`:`${f.model.phase} ${planeLabel(f.model,node.hkl,sign)} · ${f.model.valid?'passes screen':'below threshold'} · ${evidenceText}`));$('fft-overlay').append(shape);
   if(weak&&marker!=='off'){const [wx,wy]=qp(sign*evidence.observed_q[0],sign*evidence.observed_q[1]);const dot=el('circle',{cx:wx,cy:wy,r:1.5,fill:'#fff',opacity:.8,'data-weak-profile':evidence.weak_id});dot.append(el('title',{},evidenceText));$('fft-overlay').append(dot)}
  }
 }
}
}
function renderFitChoices(data){
 chosenFits=new Set();$('fit-list').replaceChildren();
 const table=document.createElement('table');table.className='model-table fit-table';
 const head=document.createElement('thead'),body=document.createElement('tbody');
 renderFitHeader(head,true);table.append(head,body);$('fit-list').append(table);
 const add=(key,m,name,geometry=false,target=body)=>{
  const row=document.createElement('tr'),toggle=document.createElement('td'),box=document.createElement('input');
  toggle.className='col-show';toggle.dataset.column='show';
  box.type='checkbox';box.dataset.fit=key;box.setAttribute('aria-label','Overlay '+name);
  box.addEventListener('change',()=>{box.checked?chosenFits.add(key):chosenFits.delete(key);$('overlay').value='custom';drawFFT()});
  toggle.append(box);row.append(toggle);
  appendFitCells(row,m,{name,geometry,rotation:!geometry});target.append(row);
 };
 data.models.map((m,i)=>({m,i})).sort((a,b)=>compareRank(a.m,b.m)).forEach(({m,i})=>add('phase-'+i,m,`${m.phase} ${zoneLabel(m)}`));
 const geometryEntries=[['primary_lattice','Primary geometry'],['secondary_lattice','Secondary geometry']].filter(([key])=>data.periodicity[key]);
 if(geometryEntries.length){
  const geometryBody=document.createElement('tbody'),heading=document.createElement('tr'),cell=document.createElement('td');
  heading.className='fit-section';cell.colSpan=FIT_COLUMNS.length+1;cell.textContent='Geometry-only checks · separate score';heading.append(cell);geometryBody.append(heading);table.append(geometryBody);
  geometryEntries.sort(([a],[b])=>compareRank(data.periodicity[a],data.periodicity[b])).forEach(([key,name])=>add(key,data.periodicity[key],name,true,geometryBody));
 }
 if(!body.children.length&&!geometryEntries.length)$('fit-list').textContent='No retained candidate fits in this region.';
}

function rememberFFTDisplay(){writePreference('tem-fft-display',{curve:$('fft-curve').value,background:Number($('contrast').value),white:Number($('fft-white').value)})}
function autoFFTContrast(){const linear=$('fft-curve').value==='linear';$('contrast').value=linear?30:60;$('fft-white').value=linear?99.9:99.8;rememberFFTDisplay();drawFFT()}
$('fft-curve').onchange=autoFFTContrast;$('fft-auto').onclick=autoFFTContrast;
$('fft-white').onchange=()=>{$('fft-white').value=clamp(Number($('fft-white').value)||99.8,91,100);rememberFFTDisplay();drawFFT()};
const displayPreference=readPreference('tem-fft-display',{});
if(['log','linear'].includes(displayPreference.curve))$('fft-curve').value=displayPreference.curve;
if(Number.isFinite(displayPreference.background))$('contrast').value=clamp(displayPreference.background,0,90);
if(Number.isFinite(displayPreference.white))$('fft-white').value=clamp(displayPreference.white,91,100);
$('contrast').oninput=()=>{rememberFFTDisplay();drawFFT()};$('peak-marker').onchange=()=>{writePreference('tem-peak-marker',$('peak-marker').value);drawFFT()};const savedMarker=readPreference('tem-peak-marker',null);if(['crosshair','circle','off'].includes(savedMarker))$('peak-marker').value=savedMarker;$('overlay').onchange=()=>{if($('overlay').value==='custom')$('fit-controls').open=true;drawFFT()};$('palette').onchange=()=>{writePreference('tem-palette',$('palette').value);document.querySelector('.intensity-key').classList.toggle('gray',$('palette').value==='gray');drawFFT()};const savedPalette=readPreference('tem-palette',null);if(['gray','magma'].includes(savedPalette))$('palette').value=savedPalette;document.querySelector('.intensity-key').classList.toggle('gray',$('palette').value==='gray');
function updateGridSizeNote(){
 $('check-passing').disabled=!config?.check_passing||!$('adaptive').checked;
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
  if($('check-passing').checked)note.textContent+=' Passing regions also trial four children; keep the children when they reveal different phases/zones, a separate pattern, or a mix of passing and unresolved assignments.';
 }
}
for(const id of ['grid-count','grid-min','adaptive','check-passing'])$(id).addEventListener('input',updateGridSizeNote);
function renderZoneBreakdown(phase,totalArea,open){
 const found=new Map();
 for(const region of grid.regions){
  const model=region.leaf&&region.best_zones?.[phase];if(!model)continue;
  const key=zoneKey(model);
  if(!found.has(key))found.set(key,{key,model,count:0,passing:0,area:0});
  const entry=found.get(key);entry.count++;if(model.valid)entry.passing++;entry.area+=region.roi.w*region.roi.h;
 }
 const entries=[...found.values()].sort((a,b)=>b.area-a.area||a.key.localeCompare(b.key));
 const details=document.createElement('details'),summary=document.createElement('summary');
 details.className='zone-breakdown';details.dataset.phase=phase;details.open=open;
 const count=entries.reduce((sum,e)=>sum+e.count,0),passing=entries.reduce((sum,e)=>sum+e.passing,0);
 summary.textContent=`${phase} zone axes · ${count} candidate fits · ${passing} pass`;summary.style.color=phaseColors[phase];details.append(summary);
 const note=document.createElement('p');note.className='hint';
 note.textContent='Best fit for this structure in each current map region, including below-threshold alternatives. Regions may appear in both HCP and BCC lists; image area here is not a phase fraction.';
 details.append(note);
 const table=document.createElement('table'),head=document.createElement('thead'),header=document.createElement('tr'),body=document.createElement('tbody');
 for(const label of ['Zone axis','Regions','Pass','Below','Image area']){
  const cell=document.createElement('th');cell.scope='col';cell.textContent=label;header.append(cell);
 }
 head.append(header);table.append(head,body);details.append(table);
 for(const entry of entries){
  const row=document.createElement('tr'),symbol=zoneSymbols[phase].get(entry.key);
  row.dataset.zone=entry.key;
  const values=[(symbol?symbol+' ':'')+zoneLabel(entry.model),entry.count,entry.passing,entry.count-entry.passing,`${(100*entry.area/totalArea).toFixed(1)}%`];
  for(const [index,value]of values.entries()){
   const cell=document.createElement('td');cell.textContent=value;if(index===0)cell.style.color=phaseColors[phase];row.append(cell);
  }
  body.append(row);
 }
 if(!entries.length)note.textContent='No candidate fits for this structure in the current map.';
 return details;
}
function renderGridSummary(){
 const container=$('grid-summary');
 const expanded=new Set([...container.querySelectorAll('.zone-breakdown')].filter(e=>e.open).map(e=>e.dataset.phase));
 container.replaceChildren();container.hidden=!grid;
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
 summary.textContent=`${regionCount} current map regions · ${(100*covered/totalArea).toFixed(1)}% image coverage · ${grid.state} · started ${grid.grid.count}×${grid.grid.count}, ${grid.grid.adaptive?'adaptive'+(grid.grid.check_passing?' + passing-region checks':''):'uniform'} · ${scaleSummary(grid.settings)}`;
 const table=document.createElement('table'),head=document.createElement('thead'),header=document.createElement('tr');
 for(const title of ['Result','Regions','Image area']){const cell=document.createElement('th');cell.scope='col';cell.textContent=title;header.append(cell)}
 head.append(header);table.append(head);const body=document.createElement('tbody');
 const add=(label,count,area,color)=>{const row=document.createElement('tr');for(const [index,value] of [label,count,`${(100*area/totalArea).toFixed(1)}%`].entries()){const cell=document.createElement('td');cell.textContent=value;if(index===0&&color)cell.style.color=color;row.append(cell)}body.append(row)};
 for(const [key,value]of Object.entries(counts))add(labels[key],value.count,value.area,colors[key]);
 if(covered<totalArea)add('Not yet covered','—',totalArea-covered);
 table.append(body);const note=document.createElement('p');note.className='hint';
 note.textContent='Area is weighted by region size. Counts include current map regions only, excluding subdivided parents. Candidate-labelled image area is not a confirmed phase fraction.';
 if(grid.rescore&&grid.grid.adaptive)note.textContent+=` Labels have been reweighted within the existing cells. Subdivision decisions and stopping reasons remain from the original run. Run a new grid to change its boundaries.`;
 if(grid.lookahead?.checked)note.textContent+=` Child checks: ${grid.lookahead.refined} parents subdivided, ${grid.lookahead.retained} retained. Trial-only children are excluded from map totals.`;
 container.append(heading,summary,table,note);
 for(const phase of ['HCP','BCC'])container.append(renderZoneBreakdown(phase,totalArea,expanded.has(phase)));
}
function zoneKey(model){return zoneIndices(model).join(',')}
function zoneSymbol(phase,key){
 if(!zoneSymbols[phase].has(key)){
  const index=zoneSymbols[phase].size;
  zoneSymbols[phase].set(key,ZONE_SYMBOLS[index]??`◌${index+1}`);
 }
 return zoneSymbols[phase].get(key);
}
function renderClassLegend(){
 const legend=$('class-legend'),shown=new Set(grid?.regions.filter(r=>r.leaf).map(r=>r.label)??[]);
 legend.hidden=!$('show-grid').checked||!shown.size;
 for(const item of legend.children)item.hidden=!shown.has(item.dataset.label);
}
function renderZoneLegend(found){
 const legend=$('zone-legend');legend.replaceChildren();legend.hidden=!found.HCP.size&&!found.BCC.size;
 if(legend.hidden)return;
 const hint=document.createElement('p');hint.className='hint';
 hint.textContent='Best candidate for each structure in every cell: blue HCP on the left, gold BCC on the right. Faded symbols are below the screen threshold. These are alternative fits, not proof that both phases are present. Ordered by image area, largest first.';
 legend.append(hint);
 for(const phase of ['HCP','BCC']){
  if(!found[phase].size)continue;
  const group=document.createElement('div');group.className='zone-legend-group';group.style.color=phaseColors[phase];
  const title=document.createElement('strong');title.textContent=phase;group.append(title);
  for(const [key,entry] of [...found[phase]].sort((a,b)=>b[1].area-a[1].area||b[1].count-a[1].count||a[0].localeCompare(b[0]))){
   const item=document.createElement('span');item.className='zone-key';
   const symbol=document.createElement('b');symbol.textContent=zoneSymbols[phase].get(key);
   const count=document.createElement('small');count.textContent='×'+entry.count;
   item.dataset.phase=phase;item.dataset.zone=key;
   item.append(symbol,document.createTextNode(zoneLabel(entry.model)),count);
   item.title=`${entry.count} cells · ${(100*entry.area/(grid.source.width*grid.source.height)).toFixed(1)}% image area · ${entry.passing} passing fits`;group.append(item);
  }
  legend.append(group);
 }
}
function drawGrid(){
 renderClassLegend();
 if(zoneJob!==grid?.id){zoneJob=grid?.id;zoneSymbols={HCP:new Map(),BCC:new Map()}}
 const shown={HCP:new Map(),BCC:new Map()};
 const group=$('grid-map');group.replaceChildren();
 const showGrid=$('show-grid').checked,showZones=$('show-zones').checked&&!$('show-zones').disabled;
 if(!grid||(!showGrid&&!showZones)){renderZoneLegend(shown);renderGridSummary();updatePenaltyControls();return}
 for(const r of grid.regions){
  if(!r.leaf)continue;
  const e=el('rect',{x:r.roi.x,y:r.roi.y,width:r.roi.w,height:r.roi.h,fill:colors[r.label]||'#aaa',stroke:showGrid?(colors[r.label]||'#aaa'):'none',class:'grid-cell','data-id':r.id,'fill-opacity':showGrid?Number($('grid-opacity').value)/100:0});
  const descriptions=[labels[r.label]];
  for(const phase of ['HCP','BCC']){const m=r.best_zones?.[phase];if(m)descriptions.push(`${phase} ${zoneLabel(m)} · ${m.valid?'passes screen':'below threshold'}`)}
  e.append(el('title',{},descriptions.join(' · ')));group.append(e);
  if(showZones)for(const [i,phase]of ['HCP','BCC'].entries()){
   const model=r.best_zones?.[phase];if(!model)continue;
   const key=zoneKey(model),symbol=zoneSymbol(phase,key);
   const size=Math.min(r.roi.w,r.roi.h)*.30;
   const marker=el('text',{x:r.roi.x+r.roi.w*(i ? .72 : .28),y:r.roi.y+r.roi.h*.5,
    fill:phaseColors[phase],'font-size':size,'stroke-width':size*.12,
    class:'zone-marker','data-phase':phase,'data-zone-key':key,'fill-opacity':model.valid?1:.38,'stroke-opacity':model.valid ? .85 : .38,
    'aria-hidden':'true'},symbol);
   group.append(marker);
   // Only emitted markers contribute to the legend; cached symbols stay stable.
   if(!shown[phase].has(key))shown[phase].set(key,{model,count:0,passing:0,area:0});
   const entry=shown[phase].get(key);entry.count++;entry.area+=r.roi.w*r.roi.h;if(model.valid)entry.passing++;
  }
 }
 renderZoneLegend(shown);renderGridSummary();updatePenaltyControls();
}
$('show-zones').checked=readPreference('tem-grid-zones',true)!==false;
$('show-zones').onchange=()=>{writePreference('tem-grid-zones',$('show-zones').checked);drawGrid()};
$('show-grid').onchange=drawGrid;
function updateGridOpacity(){
 const amount=Number($('grid-opacity').value);$('grid-opacity-value').textContent=amount+'%';
 for(const cell of $('grid-map').querySelectorAll('.grid-cell'))cell.setAttribute('fill-opacity',$('show-grid').checked?amount/100:0);
}
$('grid-opacity').oninput=()=>{updateGridOpacity();writePreference('tem-grid-opacity',Number($('grid-opacity').value))};
const savedOpacity=readPreference('tem-grid-opacity',12);
if(Number.isFinite(savedOpacity))$('grid-opacity').value=clamp(savedOpacity,0,100);
updateGridOpacity();
function isGridRunning(){return Boolean(jobId&&(!grid||grid.state==='running'))}
function gridStatus(){
 if(!grid)return;
 $('grid-status').textContent=`${grid.processed} regions analysed · ${grid.pending} pending · ${grid.state}${grid.error?' — '+grid.error:''}`+(grid.rescore?` · reweighted in ${(grid.rescore.elapsed_ms/1000).toFixed(2)} s using cached fits`:'');
}
async function poll(id){
 try{
  const status=await api('job?id='+encodeURIComponent(id));if(id!==jobId)return;
  grid=status;drawGrid();gridStatus();
  if(status.state==='running')setTimeout(()=>poll(id),600);
  else{$('run-grid').disabled=false;$('cancel-grid').disabled=true;updatePenaltyControls()}
 }catch(e){if(id===jobId){message(e.message,true);$('run-grid').disabled=false;$('cancel-grid').disabled=true}}
}
$('run-grid').onclick=async()=>{
 if(!meta)return;
 try{
  rescoreRevision++;rescorePending=false;clearTimeout(rescoreTimer);
  $('run-grid').disabled=true;$('clear-grid').disabled=true;$('cancel-grid').disabled=true;
  const version=sourceRequest,expectedSettings=JSON.stringify(settings()),d=await api('grid',{...requestBody(),count:Number($('grid-count').value),adaptive:$('adaptive').checked,minimum_nm:Number($('grid-min').value),check_passing:$('adaptive').checked&&$('check-passing').checked});
  if(version!==sourceRequest||JSON.stringify(settings())!==expectedSettings){await api('cancel',{job_id:d.id});$('run-grid').disabled=false;updatePenaltyControls();return}
  jobId=d.id;grid=null;drawGrid();$('cancel-grid').disabled=false;$('save-grid').disabled=true;
  $('scale-penalty').disabled=true;$('scale-penalty-slider').disabled=true;$('peak-evidence-weight').disabled=true;poll(jobId);
 }catch(e){$('run-grid').disabled=false;message(e.message,true);updatePenaltyControls()}
};
$('cancel-grid').onclick=async()=>{try{await api('cancel',{job_id:jobId})}catch(e){message(e.message,true)}};
$('clear-grid').onclick=()=>{
 const id=jobId,running=isGridRunning();
 rescoreRevision++;rescorePending=false;clearTimeout(rescoreTimer);
 jobId=null;grid=null;drawGrid();
 $('run-grid').disabled=false;$('cancel-grid').disabled=true;
 $('grid-status').textContent='Grid cleared. Run grid to create a new map.';
 if(id&&running)api('cancel',{job_id:id}).catch(e=>message(e.message,true));
};
async function save(body){try{const d=await api('save',body);message('Saved: '+d.path)}catch(e){message(e.message,true)}}
$('save-region').onclick=()=>{if(result)save({file_id:fileId,roi:result.roi,settings:result.settings})};$('save-grid').onclick=()=>{if(jobId)save({job_id:jobId})};
function updatePenaltyControls(){
 const automatic=$('scenario').value.startsWith('auto_'),running=isGridRunning();
 const disabled=!config?.grid_rescore||!automatic||running;
 $('scale-penalty').disabled=disabled;$('scale-penalty-slider').disabled=disabled;
 $('peak-evidence-weight').disabled=!config?.peak_evidence||!config?.grid_rescore||running;
 const mismatch=Boolean(grid&&((grid.settings.scale_mode!=='fixed'&&scalePenalty!==grid.settings.scale_penalty_strength)||(config?.peak_evidence&&peakEvidenceWeight!==grid.settings.peak_evidence_weight)));
 const updating=rescorePending||rescoreBusy;
 $('grid-map').classList.toggle('stale',updating||mismatch);
 $('save-grid').disabled=!grid||running||updating||mismatch;
 $('clear-grid').disabled=!grid&&!jobId;
 const note=$('penalty-note');
 note.textContent=!config?.peak_evidence?'Restart TEM Workbench and reload to enable prediction-site evidence.':running?'Finish or cancel this grid to adjust ranking weights.':updating?'Updating the map from cached fits…':mismatch?'This map still shows its previous weights; adjust a control again to retry.':grid?'Updates labels, symbols and totals from cached fits. Existing cell boundaries stay fixed.':automatic?'Zero disables a weight. Scale cost favours smaller adjustments; peak evidence checks weak and missing spots.':'Fixed scale has no scale penalty. Peak-evidence weight adjusts weak and missing spot contributions; zero disables it.';
}
function penaltyChanged(input){
 if(!input.value)return;
 const value=Number(input.value);
 if(!Number.isFinite(value)||value<0||value>.5){message('Use a ranking weight from 0 to 0.5.',true);return}
 if(input.id==='peak-evidence-weight'){peakEvidenceWeight=value;writePreference('tem-peak-evidence-weight',value)}
 else{scalePenalty=value;if(input.id==='scale-penalty-slider')$('scale-penalty').value=value;else $('scale-penalty-slider').value=value;writePreference('tem-scale-penalty',value)}
 rescoreRevision++;clearTimeout(rescoreTimer);
 rescorePending=Boolean(jobId&&grid?.can_rescore);
 updatePenaltyControls();if(meta)schedule(150);
 if(rescorePending)rescoreTimer=setTimeout(rescoreGrid,140);
}
async function rescoreGrid(){
 if(rescoreBusy||!rescorePending)return;
 const id=jobId,version=rescoreRevision,strength=scalePenalty,evidenceWeight=peakEvidenceWeight;
 rescoreBusy=true;rescorePending=false;updatePenaltyControls();
 try{
  const status=await api('rescore-grid',{job_id:id,scale_penalty_strength:strength,peak_evidence_weight:evidenceWeight});
  if(id===jobId&&version===rescoreRevision){grid=status;drawGrid();gridStatus()}
 }catch(e){if(id===jobId&&version===rescoreRevision)message(e.message,true)}
 finally{
  rescoreBusy=false;updatePenaltyControls();
  if(rescorePending){clearTimeout(rescoreTimer);rescoreTimer=setTimeout(rescoreGrid,0)}
 }
}
const savedPenalty=readPreference('tem-scale-penalty',.10);
if(Number.isFinite(savedPenalty)&&savedPenalty>=0&&savedPenalty<=.5)scalePenalty=savedPenalty;
$('scale-penalty').value=scalePenalty;
$('scale-penalty-slider').value=$('scale-penalty').value;
const savedEvidenceWeight=readPreference('tem-peak-evidence-weight',.10);
if(Number.isFinite(savedEvidenceWeight)&&savedEvidenceWeight>=0&&savedEvidenceWeight<=.5)peakEvidenceWeight=savedEvidenceWeight;
$('peak-evidence-weight').value=peakEvidenceWeight;
$('peak-evidence-weight').onblur=()=>{$('peak-evidence-weight').value=peakEvidenceWeight};
for(const id of ['scale-penalty','scale-penalty-slider','peak-evidence-weight'])$(id).oninput=()=>penaltyChanged($(id));
$('scale-penalty').onblur=()=>{$('scale-penalty').value=scalePenalty};
for(const id of ['scenario','model-scale','threshold','fft-hann','fft-mean'])$(id).onchange=()=>{
 if(!meta)return;
 if(id==='model-scale'&&(!$('model-scale').value||!Number.isFinite(Number($('model-scale').value))||Number($('model-scale').value)<.85||Number($('model-scale').value)>1.15)){
  restoreCalibration();message('Use a model size between 0.850 and 1.150.',true);return;
 }
 if(id==='threshold'&&!validControlNumber('threshold',Number($('threshold').value))){message('Use a peak threshold between 0.15 and 0.70.',true);return}
 if(id==='scenario'||id==='model-scale'){calibrationView();rememberCalibration()}
 if(isGridRunning())api('cancel',{job_id:jobId}).catch(e=>message(e.message,true));
 rescoreRevision++;rescorePending=false;clearTimeout(rescoreTimer);jobId=null;grid=null;drawGrid();$('save-grid').disabled=true;$('run-grid').disabled=false;$('cancel-grid').disabled=true;
 $('grid-status').textContent='Settings changed. Run a new grid to use these settings.';schedule(0);
};
$('model-scale').oninput=()=>{
 const field=$('model-scale'),value=Number(field.value);
 if(!field.readOnly&&field.value&&Number.isFinite(value)&&value>=.85&&value<=1.15)field.onchange();
};
$('file').onchange=openFile;
async function start(){try{config=await api('config');$('engine-note').hidden=Boolean(config.grid_rescore&&config.grid_zones&&config.peak_evidence&&config.check_passing&&config.fft_processing&&config.refinement_policy==='passing-children-v2'&&config.folder_picker&&config.saved_regions);for(const id of ['fft-hann','fft-mean']){$(id).disabled=!config.fft_processing;if(!config.fft_processing)$(id).checked=true}$('fft-processing-note').textContent=config.fft_processing?'Changes recalculate the region; run a new grid afterwards.':'Restart TEM Workbench to enable FFT processing controls.';$('show-zones').disabled=!config.grid_zones;updatePenaltyControls();updateGridSizeNote();for(const mode of ['auto_uniform','auto_hcp_ac'])$('scenario').querySelector('option[value="'+mode+'"]').disabled=!config.scale_modes?.includes(mode);if(!config.fft_log16){$('fft-curve').value='log';$('fft-curve').disabled=true}const savedFavorites=readPreference(favoriteKey(),[]);favorites=new Set(Array.isArray(savedFavorites)?savedFavorites.filter(id=>typeof id==='string'):[]);renderFavorites();$('connection').textContent='Local Python · connected';$('data-path').textContent='Data: '+config.data_root;$('output-path').textContent='Results: '+config.output_root;setupFolderControls();await loadSavedRegions();$('file').replaceChildren();for(const sample of [...new Set(config.files.map(f=>f.sample))]){const group=document.createElement('optgroup');group.label=sample;for(const f of config.files.filter(f=>f.sample===sample)){const option=document.createElement('option');option.value=f.id;option.textContent=f.name;group.append(option)}$('file').append(group)}const lastImage=readPreference(lastImageKey(),null),initial=config.files.find(f=>f.id===lastImage)||config.files.find(f=>f.id===config.default_file)||config.files[0];if(initial)$('file').value=initial.id;if(config.files.length)await openFile();else message('No images found. Check the workbench installation and configured TEM folder.',true)}catch(e){$('connection').textContent='Disconnected';message(e.message,true)}}

function setupFolderControls(){
 for(const id of ['browse-data','browse-output','apply-folders','refresh-files'])$(id).disabled=!config.folder_picker;
 $('folder-data').value=config.data_root;$('folder-output').value=config.output_root;
 if(!config.folder_picker)$('folders-note').textContent='Restart TEM Workbench to enable folder selection.';
}
async function browseFolder(path){
 const version=++folderBrowseVersion;$('folder-use').disabled=true;$('folder-status').textContent='Loading folders…';
 try{
  const listing=await api('browse-folders',{path});
  if(version!==folderBrowseVersion)return;
  folderListing=listing;$('folder-path').value=listing.path;$('folder-list').replaceChildren();
  for(const folder of listing.directories){
   const button=document.createElement('button');button.type='button';button.textContent='▸ '+folder.name;button.title=folder.path;
   button.onclick=()=>browseFolder(folder.path);$('folder-list').append(button);
  }
  $('folder-up').disabled=listing.path===listing.parent;$('folder-use').disabled=false;
  $('folder-status').textContent=listing.directories.length?listing.directories.length+' subfolders':'No subfolders. You can select this folder.';
 }catch(e){if(version===folderBrowseVersion)$('folder-status').textContent=e.message}
}
function chooseFolder(target){
 if(!config?.folder_picker)return;
 folderTarget=target;$('folder-picker-title').textContent=target==='folder-data'?'Choose data folder':'Choose output folder';
 $('folder-picker').showModal();browseFolder($(target).value);
}
$('browse-data').onclick=()=>chooseFolder('folder-data');$('browse-output').onclick=()=>chooseFolder('folder-output');
for(const id of ['folder-close','folder-cancel'])$(id).onclick=()=>{$('folder-picker').close();folderBrowseVersion++};
$('folder-up').onclick=()=>browseFolder(folderListing?.parent);
$('folder-home').onclick=()=>browseFolder(folderListing?.home);
$('folder-go').onclick=()=>browseFolder($('folder-path').value);
$('folder-path').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();browseFolder($('folder-path').value)}};
$('folder-use').onclick=()=>{if(folderListing&&folderTarget){$(folderTarget).value=folderListing.path;$('folder-picker').close();folderBrowseVersion++}};
$('apply-folders').onclick=async()=>{
 $('apply-folders').disabled=true;
 try{
  await api('folders',{data_root:$('folder-data').value,output_root:$('folder-output').value});
  await start();message('Folders linked and image collection refreshed.');
 }catch(e){message(e.message,true)}
 finally{$('apply-folders').disabled=!config?.folder_picker}
};
$('refresh-files').onclick=async()=>{if(isGridRunning()){message('Finish or cancel the grid before refreshing images.',true);return}await start()};

function resetRegionEditor(){
 selectedRegionId=null;$('region-name').value='';$('region-tags').value='';$('region-notes').value='';
 $('store-region').textContent='Save region';
}
function renderSavedRegions(){
 const select=$('saved-region-select'),all=$('saved-region-all').checked;
 const entries=regionProject.regions.filter(r=>all||r.source.sha256_pixels===meta?.sha256_pixels);
 select.replaceChildren(new Option('New region…',''));
 for(const region of [...entries].sort((a,b)=>a.source.name.localeCompare(b.source.name)||a.name.localeCompare(b.name))){
  const label=(all?region.source.name+' · ':'')+region.name+(region.tags.length?' ['+region.tags.join(', ')+']':'');
  select.append(new Option(label,region.id));
 }
 select.value=selectedRegionId||'';
 $('saved-region-count').textContent='('+entries.length+')';
 $('store-region').disabled=!meta||!config?.saved_regions;$('copy-region').disabled=!meta||!selectedRegionId||!config?.saved_regions;
 $('reload-regions').disabled=!config?.saved_regions;
}
async function loadSavedRegions(){
 if(!config.saved_regions){$('saved-region-note').textContent='Restart TEM Workbench to enable saved regions.';renderSavedRegions();return}
 try{regionProject=await api('regions');renderSavedRegions()}
 catch(e){$('saved-region-note').textContent=e.message;$('store-region').disabled=true;$('copy-region').disabled=true}
}
function applyRegionSettings(saved){
 $('scenario').value=saved.scale_mode==='fixed'?(saved.scale===1?'1':'custom'):saved.scale_mode;
 $('model-scale').value=saved.scale??1;$('threshold').value=saved.threshold??.35;
 $('fft-hann').checked=(saved.fft_window??'hann')==='hann';$('fft-mean').checked=saved.remove_mean!==false;
 scalePenalty=saved.scale_penalty_strength??.1;peakEvidenceWeight=saved.peak_evidence_weight??.1;
 $('scale-penalty').value=scalePenalty;$('scale-penalty-slider').value=scalePenalty;$('peak-evidence-weight').value=peakEvidenceWeight;
 calibrationView();rememberCalibration();rememberBasicControls();
 writePreference('tem-scale-penalty',scalePenalty);writePreference('tem-peak-evidence-weight',peakEvidenceWeight);
}
$('saved-region-all').onchange=renderSavedRegions;
$('reload-regions').onclick=loadSavedRegions;
$('new-region').onclick=()=>{resetRegionEditor();renderSavedRegions()};
$('saved-region-select').onchange=async()=>{
 const request=++regionRequest,imageRequest=sourceRequest;
 const id=$('saved-region-select').value;if(!id){resetRegionEditor();renderSavedRegions();return}
 try{
  const saved=await api('regions/open',{id});if(request!==regionRequest||imageRequest!==sourceRequest)return;
  $('file').value=saved.source.id;await openFile();
  if(request!==regionRequest||sourceRequest!==imageRequest+1||!meta||fileId!==saved.source.id)return;
  // The server checks the pixel hash, dimensions and calibration before applying.
  selectedRegionId=id;$('region-name').value=saved.name;$('region-tags').value=saved.tags.join(', ');$('region-notes').value=saved.notes;
  $('store-region').textContent='Update region';applyRegionSettings(saved.settings);
  roi={...saved.roi};updateBox(true);renderSavedRegions();schedule(0);
  message('Restored region and analysis settings: '+saved.name);
 }catch(e){message(e.message,true);renderSavedRegions()}
};
async function storeRegion(asNew=false){
 if(!meta)return;
 try{
  const request={...requestBody(),source_hash:meta.sha256_pixels,id:asNew?null:selectedRegionId,revision:regionProject.revision,
   name:$('region-name').value,tags:$('region-tags').value.split(',').map(s=>s.trim()).filter(Boolean),notes:$('region-notes').value};
  const current=sourceRequest,saved=await api('regions/save',request);regionProject=saved.project;
  if(current===sourceRequest){selectedRegionId=saved.region.id;$('store-region').textContent='Update region'}
  renderSavedRegions();message('Region saved: '+saved.region.name);
 }catch(e){message(e.message,true)}
}
$('store-region').onclick=()=>storeRegion();$('copy-region').onclick=()=>storeRegion(true);

restoreBasicControls();
for(const id of [...Object.keys(BASIC_NUMBERS),...BASIC_FLAGS,'overlay']){
 $(id).addEventListener('input',rememberBasicControls);
 $(id).addEventListener('change',rememberBasicControls);
}
start();

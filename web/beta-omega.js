/* Parent-linked diffraction model: shared geometry and explicit assignments. */
function reciprocalUnit(){return meta?.reciprocal_calibrated===false?'rel.':'nm⁻¹'}
const OMEGA_VARIANT_COLORS={omega1:'#b49aff',omega2:'#64e2b0',omega3:'#79bafa',omega4:'#ff8ac3'};
const omegaVariantColors={...OMEGA_VARIANT_COLORS};
function betaOmegaComponents(model){
 return [...(model?.components||[])].sort((a,b)=>(a.id==='beta'?-1:b.id==='beta'?1:0)||Number(b.active)-Number(a.active)||a.id.localeCompare(b.id));
}
function omegaVariantLabel(number){return 'ω'+String(number).replace(/\d/g,digit=>'₀₁₂₃₄₅₆₇₈₉'[Number(digit)])}
function betaOmegaLabel(id,model){
 if(id==='beta')return phaseLabel('BCC')+' parent';
 const variants=betaOmegaComponents(model).filter(c=>c.active&&c.id!=='beta'),index=variants.findIndex(c=>c.id===id);
 return index>=0?omegaVariantLabel(index+1):/^omega/.test(id)?`ω · ID ${id}`:id;
}
function betaOmegaCandidateLabel(component,model){
 const view=component.id==='beta'?{phase:'BCC',zone_3index:model.parent.zone_3index}:component.vector_model;
 const rotation=component.id==='beta'?fitRotationLabel(model.parent.rotation_deg??model.fit?.rotation_deg):'';
 return betaOmegaLabel(component.id,model)+(view?.zone_3index?' '+zoneLabel(view):'')+(rotation?'\n'+rotation:'');
}
function betaOmegaCombinedLabel(model){
 const fit=model.fit||model,ids=model.components?.filter(c=>c.active).map(c=>c.id)||fit.component_ids;
 const count=ids?.filter(id=>id!=='beta').length;
 const suffix=count===0?'':count>1?` + ${count}×ω`:' + ω';
 return `${phaseLabel('BCC')} ${indexLabel(model.parent?.zone_3index||fit.zone_3index)}${suffix}`;
}
function betaOmegaIdentity(component,model){
 return `${betaOmegaLabel(component.id,model)} · orientation ID ${component.id}`+(component.c_axis_beta?` · ω c-axis ∥ ${phaseLabel('BCC')} ${indexLabel(component.c_axis_beta)}`:' · fitted BCC parent; angle is its fitted in-plane rotation')+'. Display numbers are local to this solution; hiding a component does not renumber it. Related variants inherit the parent fit through the orientation relationship; their stored parent angle is not an independent variant rotation.';
}
function betaOmegaComponentHidden(id){
 if($('overlay').value==='passing')return false;
 return $('overlay').value==='custom'?!chosenFits.has('linked-'+id):betaOmegaHidden.has(id);
}
function betaOmegaOverlayActive(data){
 const mode=$('overlay').value;
 return Boolean(data?.beta_omega&&(mode==='related'||(mode==='passing'&&enabledPhases.includes('BCC')&&enabledPhases.includes('OMEGA')&&data.beta_omega.fit?.valid)||(['winner','winner_any'].includes(mode)&&data.beta_omega.selected&&(mode==='winner_any'||data.beta_omega.fit?.valid))||(mode==='custom'&&data.beta_omega.components.some(c=>c.active&&!betaOmegaComponentHidden(c.id)))));
}
function refreshBetaOmegaDisplay(){
 if(!result)return;
 renderModels(result);renderFitChoices(result,true);renderBetaOmega(result);renderEvidence(result);
}
function appendBetaOmegaFitCells(row,model,component=null,data=result){
 if(!component&&model.fit){appendFitCells(row,{...model.fit,double_diffraction:model.fit.double_diffraction??model.double_diffraction},{name:betaOmegaCombinedLabel(model),data,linked:model});row.dataset.linkedFit='combined';return}
 const summary=model.combined,source=component||summary,relative=source?.rms_relative;
 const predicted=component?component.predicted_nodes.length:new Set(model.components.filter(c=>c.active).flatMap(c=>c.predicted_nodes.map(n=>n.q.map(v=>Math.round(v*1e7)).join(',')))).size;
 const values={candidate:component?betaOmegaCandidateLabel(component,model):betaOmegaCombinedLabel(model),
  rank:component?'—':summary.score.toFixed(3),screen:model.status==='unresolved'?'Below':component?'Linked':model.status==='beta_omega_ambiguous'?'Ambiguous':'Candidate',
  peaks:`${component?component.matched_profiles:summary.matched_profiles}+—/${predicted} ${component?'':doubleDiffractionCount(model.double_diffraction)}`,coverage:`${(100*source.coverage).toFixed(1)}%`,
  rms:relative==null?'—':(relative*model.parent.fundamental_spacing).toFixed(3),position:'—',cost:'—',dimensions:'—',scale:'—'};
 row.dataset.linkedFit=component?.id||'combined';
 for(const [key,label] of FIT_COLUMNS){
  const cell=document.createElement('td');cell.className='col-'+key;cell.dataset.column=key;cell.dataset.label=label.replaceAll('\n',' ');cell.textContent=values[key];
  cell.title=key==='candidate'?(component?betaOmegaIdentity(component,model):'BCC parent plus crystallographically related ω variants fitted jointly.'):
   key==='rank'?'Components share one combined score using the ordinary candidate evidence checks; they have no independent rank.':
   key==='screen'?'Linked support is assessed jointly; shared reflections alone cannot establish an omega variant.':
   key==='peaks'?'Component assignments / allowed prediction positions. Weak and DD evidence is assessed on the combined fit; DD counts appear on its row. Shared positions count once.':
   key==='coverage'?'Unweighted share of all observed profiles assigned to allowed reflections. Shared profiles count once in the combined row.':
   key==='rms'?`RMS in the image reciprocal units${relative==null?'':`; ${(relative*100).toFixed(2)}% of the parent’s shortest reflection`}.`:
   'Not independently fitted for linked components. The combined fit uses the common candidate score and prediction-site evidence.';
  if(key==='candidate'&&component)cell.style.color=betaOmegaComponentColor(component,model);
  if(key==='candidate'&&!component)renderCandidateLabel(cell,model.fit||{},{data,linked:model});
  row.append(cell);
 }
}
function betaOmegaColorTarget(component){
 return component.id==='beta'?'phase:BCC':$('omega-color-by').value==='phase'?'phase:OMEGA':'variant:'+component.id;
}
function betaOmegaComponentColor(component,model){
 if(component.id==='beta')return phaseColors.BCC;
 return $('omega-color-by').value==='phase'?phaseColors.OMEGA:omegaVariantColors[component.id]||phaseColors.OMEGA;
}
// Split the chosen outline into equal-length coloured sections. Paths are
// self-contained so preview clones and exports need no clip-path IDs.
function predictionOutlineSection(x,y,mode,r,index,count){
 const gap=.5,start=index/count,end=(index+1)/count;
 if(mode==='circle'){
  const a=-Math.PI/2+start*2*Math.PI+gap/(2*r),b=-Math.PI/2+end*2*Math.PI-gap/(2*r);
  return `M${x+r*Math.cos(a)} ${y+r*Math.sin(a)}A${r} ${r} 0 ${b-a>Math.PI?1:0} 1 ${x+r*Math.cos(b)} ${y+r*Math.sin(b)}`;
 }
 let lines;
 if(mode==='crosshair'||mode==='open-crosshair'){
  const inner=mode==='open-crosshair'?r/2:0;
  lines=[[[0,-r],[0,-inner]],[[inner,0],[r,0]],[[0,inner],[0,r]],[[-r,0],[-inner,0]]];
 }else{
  const vertices=mode==='square'?[[0,-r],[r,-r],[r,r],[-r,r],[-r,-r],[0,-r]]:
   mode==='triangle'?[[0,-r],[r*Math.sqrt(3)/2,r/2],[-r*Math.sqrt(3)/2,r/2],[0,-r]]:
   [[0,-r],[r,0],[0,r],[-r,0],[0,-r]];
  lines=vertices.slice(1).map((p,i)=>[vertices[i],p]);
 }
 const lengths=lines.map(([a,b])=>Math.hypot(b[0]-a[0],b[1]-a[1])),total=lengths.reduce((a,b)=>a+b,0);
 const from=start*total+gap/2,to=end*total-gap/2;let distance=0,path='',previous=null;
 for(const [i,[a,b]] of lines.entries()){
  const length=lengths[i],lo=Math.max(from,distance),hi=Math.min(to,distance+length);
  if(hi>lo){
   const point=t=>[x+a[0]+(b[0]-a[0])*t,y+a[1]+(b[1]-a[1])*t];
   const p=point((lo-distance)/length),q=point((hi-distance)/length);
   if(!previous||Math.hypot(p[0]-previous[0],p[1]-previous[1])>1e-8)path+=`M${p[0]} ${p[1]}`;
   path+=`L${q[0]} ${q[1]}`;previous=q;
  }
  distance+=length;
 }
 return path;
}
function sharedPredictionSymbols(x,y,entries,baseRadius=8,spacing=5,animate=true){
 const group=el('g',{'data-shared-prediction':'true'}),phases=new Map();
 for(const entry of entries){
  const phase=entry.attrs['data-marker-phase'];
  if(!phases.has(phase))phases.set(phase,[]);phases.get(phase).push(entry);
 }
 for(const [layer,[phase,parts]] of [...phases].entries()){
  const r=baseRadius+layer*spacing,mode=parts[0].shapeMode;
  const symbol=el('g',{'data-shared-phase':phase,'data-marker-shape':mode,'data-marker-radius':r,
   ...(animate?{class:'spectrum-marker','data-motion-offset':markerMotionOffset('prediction',phase)}:{})});
  // Symmetric invisible bounds anchor even triangular symbols at the spot,
  // rather than at the centre of the triangle's asymmetric bounding box.
  symbol.append(el('rect',{x:x-r,y:y-r,width:2*r,height:2*r,fill:'none',stroke:'none','aria-hidden':'true'}));
  const halo=markerShape(x,y,mode,{stroke:'#05090e','stroke-width':4},r);halo.removeAttribute('class');symbol.append(halo);
  for(const [i,entry] of parts.entries()){
   const shape=parts.length===1?markerShape(x,y,mode,entry.attrs,r):el('path',{...entry.attrs,fill:'none','stroke-width':2,'stroke-linejoin':'round',d:predictionOutlineSection(x,y,mode,r,i,parts.length)});
   shape.removeAttribute('class');
   if(entry.title)shape.append(el('title',{},entry.title));symbol.append(shape);
  }
  group.append(symbol);
 }
 return group;
}
function betaOmegaSummary(data){
 const model=data.beta_omega;
 if(!model?.combined)return 'No sufficiently supported BCC parent was found. Check the centre, masks and detected spots.';
 const count=model.components.filter(c=>c.active&&c.id!=='beta').length;
 const absenceCount=model.nominal_absence_profile_ids?.length||0;
 const dd=model.double_diffraction;
 return `${phaseLabel('BCC')} ${indexLabel(model.parent.zone_3index)} + ${count} candidate ω variant${count===1?'':'s'} · ${(100*model.combined.coverage).toFixed(1)}% matched to allowed reflections · RMS ${(100*model.combined.rms_relative).toFixed(2)}% of the parent’s shortest reflection.${dd?.profile_count?` ${dd.profile_count} double-diffraction candidates; coverage including candidates ${(100*dd.coverage_with_candidates).toFixed(1)}%. ${dd.remaining_profile_ids.length} remaining unexplained.`:absenceCount?` Including ${absenceCount} nominal ω absences, ${(100*model.combined.geometry_coverage).toFixed(1)}% lie on the combined reciprocal lattices; their intensity is not explained by the ideal basis.`:''} Shared predictions count once.${model.status==='beta_omega_ambiguous'?' A saved legacy result used a separate geometry score; recalculate for the common fit comparison.':''}${model.status==='unresolved'?' This model falls below the joint acceptance screen.':''}${model.status==='beta_only'?' No independently supported ω variant in this fitting band. The linked search needs two nonparallel BCC profiles and additional omega support; increasing the outer fitting limit can expose more parent evidence.':''}`;
}
function renderBetaOmega(data){
 const model=data.beta_omega, panel=$('beta-omega-results');panel.hidden=!model;
 if(!model)return;
 const summaryText=betaOmegaSummary(data),summaryHost=$('beta-omega-summary');
 if(model.combined){renderCandidateLabel(summaryHost,model.fit||{},{data,linked:model});summaryHost.append(document.createTextNode(summaryText.slice(summaryText.indexOf(' · '))))}
 else summaryHost.textContent=summaryText;
 $('beta-omega-components').replaceChildren();$('beta-omega-assignments').replaceChildren();
 for(const component of betaOmegaComponents(model)){
  const row=document.createElement('tr');row.title=betaOmegaIdentity(component,model)+(component.active?'':' Not independently supported.');
  const values=[betaOmegaLabel(component.id,model),component.id,component.c_axis_beta?indexLabel(component.c_axis_beta):'—',
   component.assigned_profile_ids.join(', ')||'—',component.shared_profile_ids.join(', ')||'—',(component.nominal_absence_profile_ids||[]).join(', ')||'—',
   `${(100*component.prediction_coverage).toFixed(1)}%`,component.rms_relative===null?'—':`${(100*component.rms_relative).toFixed(2)}%`];
  for(const value of values){const td=document.createElement('td');td.textContent=value;row.append(td)}
  row.children[0].style.color=betaOmegaComponentColor(component,model);$('beta-omega-components').append(row);
 }
 for(const assignment of model.assignments){
  const row=document.createElement('tr');
  const diagnostic=assignment.geometry_diagnostic;
  const dd=doubleDiffractionHit(model.double_diffraction,assignment);
  const owner=dd?'Candidate double diffraction':diagnostic?`${diagnostic.compatible_components.map(id=>betaOmegaLabel(id,model)).join(' / ')} geometry · nominal absence`:assignment.compatible_components.length>1?`Shared: ${assignment.compatible_components.map(id=>betaOmegaLabel(id,model)).join(' / ')}`:betaOmegaLabel(assignment.component,model);
  const indices=diagnostic?.indices||assignment.indices,residual=diagnostic?.residual_relative??assignment.residual_relative;
  const values=[assignment.profile_id,owner,indices.map(v=>`${betaOmegaLabel(v.component,model)} ${planeLabel({phase:v.component==='beta'?'BCC':'OMEGA'},v.hkl)}`).join('; ')||'—',residual===undefined?'—':`${(100*residual).toFixed(2)}%`];
  for(const value of values){const td=document.createElement('td');td.textContent=value;row.append(td)}
  if(dd)row.title=doubleDiffractionPathLabel(dd.paths[0],model)+` · measured-sum residual ${(100*dd.measured_residual_relative).toFixed(2)}%. See Double-diffraction candidates for paths.`;
  $('beta-omega-assignments').append(row);
 }
 const combined=model.combined;
 $('beta-omega-detail').textContent=combined?`Allowed reflections: ${combined.matched_profiles}/${combined.total_profiles}; BCC alone ${(100*combined.beta_only_coverage).toFixed(1)}%. Nominal ω absences: ${model.nominal_absence_profile_ids?.join(', ')||'none'}. Outside the combined geometry: ${(model.unexplained_geometry_profile_ids||model.unexplained_profile_ids).join(', ')||'none'}. Shared profiles count once in combined totals. Absence IDs are geometry diagnostics, excluded from allowed coverage and model selection.${model.nominal_absence_profile_ids?.length?` Geometry RMS ${(100*combined.rms_geometry_relative).toFixed(2)}%.`:''} RMS is divided by the parent’s shortest reciprocal reflection.${model.parent.requires_variant_support?' Two parent profiles: the linked interpretation also relies on independent omega support.':''}`:model.interpretation;
 if(model.double_diffraction?.profile_count)$('beta-omega-detail').textContent+=` Double-diffraction candidate IDs: ${model.double_diffraction.profile_ids.join(', ')}. Remaining without an allowed reflection or supported two-step path: ${model.double_diffraction.remaining_profile_ids.join(', ')||'none'}. Candidates may overlap the absence IDs; they do not alter ranking or allowed coverage.`;
 const comparison=model.comparison,rival=comparison?.rival;
 const alternatives=$('beta-omega-alternatives');
 alternatives.textContent=model.fit?'No independently passing rival. Inspect the candidate table for attempted fits.':'Saved legacy geometry ranking; recalculate to compare candidates with the common scorer.';
 if(model.fit&&rival){
  const relatedName=document.createElement('span'),rivalName=document.createElement('span');
  renderCandidateLabel(relatedName,model.fit,{data,linked:model});renderCandidateLabel(rivalName,rival,{data});
  alternatives.replaceChildren(document.createTextNode('Common-score comparison: '),relatedName,document.createTextNode(` ${model.fit.score.toFixed(3)}; `),rivalName,
   document.createTextNode(` ${rival.score.toFixed(3)}. ${comparison.ambiguous?'Both pass and differ by at most '+comparison.near_tie_margin.toFixed(2)+'.':'The higher passing score is preferred.'} ${comparison.preferred==='related'?'The related combination':'The independent fit'} is selected. Scores use the same intensity weighting and prediction evidence; see the candidate table and individual overlays.`));
 }
}
const betaOmegaHidden=new Set();
function drawBetaOmega(data,qp){
 const model=data.beta_omega;if(!betaOmegaOverlayActive(data))return;
 const positions=new Map();
 for(const component of [...model.components].sort((a,b)=>a.id.localeCompare(b.id))){
  if(!component.active||betaOmegaComponentHidden(component.id))continue;
  const phase=component.id==='beta'?'BCC':'OMEGA',shapeMode=$(phase.toLowerCase()+'-marker').value,color=betaOmegaComponentColor(component,model);
  if(shapeMode==='off')continue;
  for(const node of component.predicted_nodes)for(const sign of [1,-1]){
   const q=node.q.map(v=>v*sign),[x,y]=qp(...q);if(x<0||x>420||y<0||y>420)continue;
   const matched=model.assignments.some(a=>a.compatible_components.includes(component.id)&&a.predicted_q&&Math.min(Math.hypot(a.predicted_q[0]-q[0],a.predicted_q[1]-q[1]),Math.hypot(a.predicted_q[0]+q[0],a.predicted_q[1]+q[1]))<1e-6);
   const key=q.map(v=>Math.round(v*1e7)).join(',');
   if(!positions.has(key))positions.set(key,{x,y,entries:[]});
   const entries=positions.get(key).entries;
   if(entries.some(e=>e.attrs['data-beta-omega-component']===component.id))continue;
   entries.push({shapeMode,attrs:{stroke:color,'stroke-width':1.5,'stroke-dasharray':matched?'':'1 3','data-marker-kind':'prediction','data-marker-phase':phase,'data-marker-shape':shapeMode,'data-beta-omega-component':component.id,'data-parent-linked':'true','data-legend-label':betaOmegaLabel(component.id,model),'data-legend-color-target':betaOmegaColorTarget(component)},title:`${betaOmegaLabel(component.id,model)} ${planeLabel({phase},node.hkl,sign)} · ${matched?'assigned or shared observation':'prediction without assigned observation'}`});
  }
 }
 for(const {x,y,entries} of positions.values()){
  if(entries.length>1){
   const shared=sharedPredictionSymbols(x,y,entries);
   shared.append(el('title',{},'Shared prediction: '+entries.map(e=>e.attrs['data-legend-label']).join(' / ')));$('fft-overlay').append(shared);
  }else{
   const entry=entries[0],shape=markerShape(x,y,entry.shapeMode,entry.attrs,8);
   shape.append(el('title',{},entry.title));$('fft-overlay').append(shape);
  }
 }
 for(const assignment of model.assignments){
  const diagnostic=assignment.geometry_diagnostic,owners=diagnostic?.compatible_components||assignment.compatible_components,shared=owners.length>1;
  const dd=doubleDiffractionHit(model.double_diffraction,assignment);
  const peak=data.spectrum?.peaks.find(p=>p.profile_id===assignment.profile_id);
  const showDD=dd&&$('double-diffraction-marker').value!=='off'&&dd.paths.some(p=>p.steps.every(s=>!betaOmegaComponentHidden(s.component)));
  const showAbsence=diagnostic&&!showDD&&$('show-forbidden').checked&&owners.some(id=>!betaOmegaComponentHidden(id)),measuredMode=$('peak-marker').value;
  if(measuredMode==='off'&&!showAbsence)continue;
  for(const q of assignment.observed_spots){
   const [x,y]=qp(...q);if(x<0||x>420||y<0||y>420)continue;
   const manual=(peak?.manual_observed_spots||[]).some(p=>Math.hypot(p[0]-q[0],p[1]-q[1])<1e-8),color=manual?'#ff8ac3':'#ffffff';
   const description=`Profile ${assignment.profile_id}: ${dd?'candidate double diffraction · '+doubleDiffractionPathLabel(dd.paths[0],model):diagnostic?'nominally absent '+owners.map(id=>betaOmegaLabel(id,model)).join(' / ')+' reflection; geometry only':shared?'shared '+owners.map(id=>betaOmegaLabel(id,model)).join(' / '):betaOmegaLabel(assignment.component,model)}`;
   const mark=peakMarker(x,y,measuredMode,{fill:'none',stroke:color,'stroke-width':1,'data-beta-omega-assignment':assignment.profile_id,'data-measured-profile':assignment.profile_id,'data-manual-peak':manual?'true':'false'});
   if(mark){mark.append(el('title',{},description));$('fft-overlay').append(mark)}
   if(showAbsence){
    const absence=el('circle',{cx:x,cy:y,r:5,fill:'none',stroke:'#ffab72','stroke-dasharray':'2 1','data-beta-omega-absence':assignment.profile_id,'data-marker-kind':'assignment','data-legend-label':'ω geometry · nominal absence','data-marker-shape':'circle'});
    absence.append(el('title',{},description));$('fft-overlay').append(absence);
   }
   const label=peakNumberLabel(x,y,assignment.profile_id,1,{fill:showAbsence?'#ffab72':color});if(label)$('fft-overlay').append(label);
  }
 }
}
const reciprocalLabels=new Map();
function syncRelativeUnits(){
 const relative=meta?.reciprocal_calibrated===false;
 for(const id of ['diff-sx','diff-sy','diff-radius','g-max','diff-snap-radius','diff-dedupe-radius']){
  const label=$(id).closest('label');if(!label)continue;
  for(const node of label.childNodes)if(node.nodeType===3){
   if(!reciprocalLabels.has(node))reciprocalLabels.set(node,node.textContent);
   const original=reciprocalLabels.get(node);node.textContent=relative?original.replaceAll('nm⁻¹','rel.').replace('Cal ','Units '):original;
  }
 }
 for(const id of ['diff-sx','diff-sy'])$(id).disabled=relative;
 $('diff-calibration-reset').disabled=relative;
 const headers=$('peaks').closest('table').querySelectorAll('thead th');
 for(const th of headers){if(!reciprocalLabels.has(th))reciprocalLabels.set(th,th.textContent);th.textContent=relative?reciprocalLabels.get(th).replaceAll('nm⁻¹','rel.').replace('d, nm','d (uncalibrated)'):reciprocalLabels.get(th)}
 syncSignalToggle();
}
function relatedPhasesSelected(){return isDiffraction()&&enabledPhases.includes('BCC')&&enabledPhases.includes('OMEGA')}
function phaseSearchDescription(){
 if(!enabledPhases.length)return 'Phase search disabled. Peak and geometry checks remain available.';
 return 'Searching '+enabledPhases.map(phase=>phaseLabel(phase)).join(' + ')+'. '+(meta?.reciprocal_calibrated===false?'Relative geometry; no absolute cell dimensions. ':'')+(relatedPhasesSelected()?'Related omega orientations are also tested against a BCC parent. Greek names follow the material preset; the fit tests the stated structure, not phase stability.':'Disabled skips matching.');
}
function migratedPhaseSelection(saved){
 const phases=analysisPhases(saved);
 return !saved.phase_search_version&&(saved.search_beta_omega||saved.diffraction_model==='beta_omega')?[...new Set([...phases,'BCC','OMEGA'])]:phases;
}
function syncBetaOmegaControls(){
 syncPhaseMarkerControls();
 document.querySelector('.beta-anchor-controls').hidden=!isDiffraction()||!enabledPhases.includes('BCC');
 $('phase-search-note').textContent=phaseSearchDescription();
}
function setupBetaOmegaSearch(){
 const saved=diffractionSettings;
 if(isDiffraction()&&!saved?.phase_search_version&&(saved?.search_beta_omega||saved?.indexing_model==='beta_omega'))setPhaseSelection([...new Set([...enabledPhases,'BCC','OMEGA'])]);
 if($('overlay').value==='beta_omega')$('overlay').value='winner';
 syncOverlayMenus(readPreference('tem-basic-settings',{}).overlay??$('overlay').value,readPreference('tem-reflection-vectors',$('reflection-vectors').value));
 betaOmegaHidden.clear();syncRelativeUnits();syncBetaOmegaControls();syncBetaAnchorInputs();
}
function syncBetaAnchorInputs(){
 const anchors=diffractionSettings?.beta_parent_anchors||[];
 for(let i=0;i<2;i++){
  $('beta-anchor-'+i).value=anchors[i]?.profile_id??'';
  $('beta-hkl-'+i).value=anchors[i]?.hkl?.join(' ')||'';
 }
}
function applyBetaAnchorInputs(){
 if(!result||!isDiffraction())throw new Error('Analyse this diffraction image before choosing parent anchors.');
 const anchors=[0,1].map(i=>{
  const profile=result.spectrum.peaks.find(p=>p.profile_id===Number($('beta-anchor-'+i).value));
  const hkl=$('beta-hkl-'+i).value.trim().split(/[ ,]+/).map(Number);
  if(!profile||hkl.length!==3||hkl.some(v=>!Number.isInteger(v)))throw new Error('Choose two detected profile IDs and three integer indices for each beta reflection.');
  const [cx,cy]=result.spectrum.beam_center_px,[sx,sy]=result.spectrum.reciprocal_pixel_size;
  return {profile_id:profile.profile_id,hkl,detector_position:[cx+profile.qx/sx,cy-profile.qy/sy]};
 });
 diffractionSettings.beta_parent_anchors=anchors;rememberDiffraction();schedule(0);
}

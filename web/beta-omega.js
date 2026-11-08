/* Parent-linked diffraction model: shared geometry and explicit assignments. */
function reciprocalUnit(){return meta?.reciprocal_calibrated===false?'rel.':'nm⁻¹'}
function betaOmegaComponentColor(component,model){
 if(component.id==='beta')return phaseColors.BCC;
 // Start with the chosen omega colour; keep all four variants distinguishable.
 // Visibility switches do not change this order or recolour the remaining variants.
 const variants=model.components.filter(c=>c.id!=='beta');
 const ordered=[...variants.filter(c=>c.active),...variants.filter(c=>!c.active)];
 const factor=[1,.8,.65,.5][ordered.findIndex(c=>c.id===component.id)]??1;
 return '#'+phaseColors.OMEGA.slice(1).match(/../g).map(v=>Math.round(parseInt(v,16)*factor).toString(16).padStart(2,'0')).join('');
}
function betaOmegaSummary(data){
 const model=data.beta_omega;
 if(!model?.combined)return 'No sufficiently supported beta parent was found. Check the centre, masks and detected spots.';
 const count=model.components.filter(c=>c.active&&c.id!=='beta').length;
 const absenceCount=model.nominal_absence_profile_ids?.length||0;
 return `β ${indexLabel(model.parent.zone_3index)} + ${count} candidate ω variant${count===1?'':'s'} · ${(100*model.combined.coverage).toFixed(1)}% matched to allowed reflections · RMS ${(100*model.combined.rms_relative).toFixed(2)}% of the parent’s shortest reflection.${absenceCount?` Including ${absenceCount} nominal ω absences, ${(100*model.combined.geometry_coverage).toFixed(1)}% lie on the combined reciprocal lattices; their intensity is not explained by the ideal basis.`:''} Absolute lattice scale is not scored.${model.status==='beta_omega_ambiguous'?' A competing beta-only interpretation scores similarly; parent indexing is ambiguous.':''}${model.status==='unresolved'?' This model falls below the joint acceptance screen.':''}${model.status==='beta_only'?' No independently supported ω variant in this fitting band. The linked search needs two nonparallel beta profiles and additional omega support; increasing the outer fitting limit can expose more parent evidence.':''}`;
}
function renderBetaOmega(data){
 const model=data.beta_omega, panel=$('beta-omega-results');panel.hidden=!model;
 const noIndependent=(model||data.spectrum.coordinate_units==='relative')&&!data.models.length;
 $('models').closest('.candidate-table').hidden=!!noIndependent;$('fit-summary').hidden=!!noIndependent;
 if(!model)return;
 $('beta-omega-summary').textContent=betaOmegaSummary(data);
 $('beta-omega-components').replaceChildren();$('beta-omega-assignments').replaceChildren();
 for(const component of model.components){
  const row=document.createElement('tr');
  const toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=component.active;
  toggle.disabled=!component.active;toggle.setAttribute('aria-label',`Show ${component.label}`);
  toggle.onchange=()=>{betaOmegaHidden.has(component.id)?betaOmegaHidden.delete(component.id):betaOmegaHidden.add(component.id);$('overlay').value='beta_omega';drawFFT()};
  toggle.checked=component.active&&!betaOmegaHidden.has(component.id);
  const cell=document.createElement('td');cell.append(toggle);row.append(cell);
  const values=[component.label,component.active?(model.status==='unresolved'?'Below joint screen':'Candidate support'):'Not independently supported',component.assigned_profile_ids.join(', ')||'—',component.shared_profile_ids.join(', ')||'—',(component.nominal_absence_profile_ids||[]).join(', ')||'—',
   `${(100*component.coverage).toFixed(1)}%`,`${(100*component.prediction_coverage).toFixed(1)}%`,component.rms_relative===null?'—':`${(100*component.rms_relative).toFixed(2)}%`];
  for(const value of values){const td=document.createElement('td');td.textContent=value;row.append(td)}
  row.children[1].style.color=betaOmegaComponentColor(component,model);row.title=component.c_axis_beta?`ω c-axis parallel to β [${component.c_axis_beta.join(' ')}]. Variant numbering is local to this parent solution.`:'BCC parent fitted before testing omega variants.';
  $('beta-omega-components').append(row);
 }
 for(const assignment of model.assignments){
  const row=document.createElement('tr');
  const diagnostic=assignment.geometry_diagnostic;
  const owner=diagnostic?`${diagnostic.compatible_components.join(' / ')} geometry · nominal absence`:assignment.compatible_components.length>1?`Shared: ${assignment.compatible_components.join(' / ')}`:assignment.component;
  const indices=diagnostic?.indices||assignment.indices,residual=diagnostic?.residual_relative??assignment.residual_relative;
  const values=[assignment.profile_id,owner,indices.map(v=>`${v.component} (${v.hkl.join(' ')})`).join('; ')||'—',residual===undefined?'—':`${(100*residual).toFixed(2)}%`];
  for(const value of values){const td=document.createElement('td');td.textContent=value;row.append(td)}
  $('beta-omega-assignments').append(row);
 }
 const combined=model.combined;
 $('beta-omega-detail').textContent=combined?`Allowed reflections: ${combined.matched_profiles}/${combined.total_profiles}; beta alone ${(100*combined.beta_only_coverage).toFixed(1)}%. Nominal ω absences: ${model.nominal_absence_profile_ids?.join(', ')||'none'}. Outside the combined geometry: ${(model.unexplained_geometry_profile_ids||model.unexplained_profile_ids).join(', ')||'none'}. Shared profiles count once in combined totals. Absence IDs are geometry diagnostics, excluded from allowed coverage and model selection.${model.nominal_absence_profile_ids?.length?` Geometry RMS ${(100*combined.rms_geometry_relative).toFixed(2)}%.`:''} RMS is divided by the parent’s shortest reciprocal reflection.${model.parent.requires_variant_support?' Two parent profiles: the linked interpretation also relies on independent omega support.':''}`:model.interpretation;
 $('beta-omega-alternatives').textContent=model.alternatives.length?'Other tested solutions: '+model.alternatives.map(m=>`β [${m.zone.join(' ')}] + ${m.variants.join(', ')||'no ω'} (score ${m.score.toFixed(3)})`).join('; ')+'. Scores are heuristic, not probabilities.':'';
}
const betaOmegaHidden=new Set();
function drawBetaOmega(data,qp){
 const model=data.beta_omega;if(!model||$('overlay').value!=='beta_omega')return;
 for(const [i,component] of model.components.entries()){
  if(!component.active||betaOmegaHidden.has(component.id))continue;
  const phase=component.id==='beta'?'BCC':'OMEGA',shapeMode=$(phase.toLowerCase()+'-marker').value,color=betaOmegaComponentColor(component,model);
  if(shapeMode==='off')continue;
  for(const node of component.predicted_nodes)for(const sign of [1,-1]){
   const q=node.q.map(v=>v*sign),[x,y]=qp(...q);if(x<0||x>420||y<0||y>420)continue;
   const matched=model.assignments.some(a=>a.compatible_components.includes(component.id)&&a.predicted_q&&Math.min(Math.hypot(a.predicted_q[0]-q[0],a.predicted_q[1]-q[1]),Math.hypot(a.predicted_q[0]+q[0],a.predicted_q[1]+q[1]))<1e-6);
   const shape=markerShape(x,y,shapeMode,{stroke:color,'stroke-width':1.5,'stroke-dasharray':matched?'':'1 3','data-marker-kind':'prediction','data-marker-phase':phase,'data-beta-omega-component':component.id,'data-parent-linked':'true','data-legend-label':component.label},7+i*.7);
   shape.append(el('title',{},`${component.label} (${node.hkl.map(v=>v*sign).join(' ')}) · ${matched?'assigned or shared observation':'prediction without assigned observation'}`));$('fft-overlay').append(shape);
  }
 }
 for(const assignment of model.assignments){
  const diagnostic=assignment.geometry_diagnostic,owners=diagnostic?.compatible_components||assignment.compatible_components,shared=owners.length>1;
  const peak=data.spectrum?.peaks.find(p=>p.profile_id===assignment.profile_id);
  const showAbsence=diagnostic&&$('show-forbidden').checked&&owners.some(id=>!betaOmegaHidden.has(id)),measuredMode=$('peak-marker').value;
  if(measuredMode==='off'&&!showAbsence)continue;
  for(const q of assignment.observed_spots){
   const [x,y]=qp(...q);if(x<0||x>420||y<0||y>420)continue;
   const manual=(peak?.manual_observed_spots||[]).some(p=>Math.hypot(p[0]-q[0],p[1]-q[1])<1e-8),color=manual?'#ff8ac3':'#ffffff';
   const description=`Profile ${assignment.profile_id}: ${diagnostic?'nominally absent '+owners.join(' / ')+' reflection; geometry only':shared?'shared '+owners.join(' / '):assignment.component}`;
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
 if(relative){$('fft-zoom-title').textContent='Diffraction · relative units';$('spectrum-title').textContent='Diffraction · relative units';}
 $('spectrum-units').textContent=relative?'relative units':'nm⁻¹';
}
function syncBetaOmegaControls(){
 const direct=isDiffraction();
 $('search-beta-omega').disabled=!direct;syncPhaseMarkerControls();
 document.querySelector('.beta-anchor-controls').hidden=!direct||!$('search-beta-omega').checked;
 $('phase-search-note').textContent=direct&&meta?.reciprocal_calibrated===false?'Uncalibrated: peak and geometry checks remain available. Independent reference-cell searches need calibration. Beta + Omega is optional.':enabledPhases.length?'Searching '+enabledPhases.join(' + ')+'. Disabled skips matching.':'Phase search disabled. Peak and geometry checks remain available.';
}
function setupBetaOmegaSearch(){
 const direct=isDiffraction(),saved=diffractionSettings;
 $('search-beta-omega').checked=direct&&(saved?.search_beta_omega??(saved?.indexing_model!==undefined?saved.indexing_model==='beta_omega':readPreference('tem-search-beta-omega',false)));
 if(direct&&$('search-beta-omega').checked)$('overlay').value='beta_omega';
 else if($('overlay').value==='beta_omega')$('overlay').value='winner';
 betaOmegaHidden.clear();syncRelativeUnits();syncBetaOmegaControls();
 syncBetaAnchorInputs();
}
function syncBetaAnchorInputs(){
 const anchors=diffractionSettings?.beta_parent_anchors||[];
 for(let i=0;i<2;i++){
  $('beta-anchor-'+i).value=anchors[i]?.profile_id??'';
  $('beta-hkl-'+i).value=anchors[i]?.hkl?.join(' ')||'';
 }
}
function applyBetaAnchorInputs(){
 if(!result?.beta_omega||!isDiffraction())throw new Error('Analyse this diffraction image before choosing parent anchors.');
 const anchors=[0,1].map(i=>{
  const profile=result.spectrum.peaks.find(p=>p.profile_id===Number($('beta-anchor-'+i).value));
  const hkl=$('beta-hkl-'+i).value.trim().split(/[ ,]+/).map(Number);
  if(!profile||hkl.length!==3||hkl.some(v=>!Number.isInteger(v)))throw new Error('Choose two detected profile IDs and three integer indices for each beta reflection.');
  const [cx,cy]=result.spectrum.beam_center_px,[sx,sy]=result.spectrum.reciprocal_pixel_size;
  return {profile_id:profile.profile_id,hkl,detector_position:[cx+profile.qx/sx,cy-profile.qy/sy]};
 });
 diffractionSettings.beta_parent_anchors=anchors;rememberDiffraction();schedule(0);
}

/* Candidate two-step scattering paths. Optional bounded score evidence; paths remain distinct from allowed reflections. */
function doubleDiffractionPathLabel(path,linked=null){
 const name=id=>{if(linked)return betaOmegaLabel(id,linked);const match=id.match(/^(HCP|BCC|FCC|ORT|OMEGA)(\d+)?$/);return match?phaseLabel(match[1])+(match[2]?' '+match[2]:''):id.replace(/^omega/,'ω variant ').replace(/^beta$/,phaseLabel('BCC')+' parent')};
 const steps=path.steps.map(s=>`${name(s.component)} ${planeLabel({phase:s.phase},s.hkl)} [peak ${s.profile_id}]`).join(' + ');
 return steps+(path.sum_hkl?` → ${name(path.steps[0].component)} ${planeLabel({phase:path.steps[0].phase},path.sum_hkl)}`:'');
}
function doubleDiffractionHit(report,assignment){
 return report?.hits.filter(h=>h.profile_id===assignment.profile_id).sort((a,b)=>{
  const q=assignment.observed_q||assignment.observed_spots[0];
  return Math.hypot(a.observed_q[0]-q[0],a.observed_q[1]-q[1])-Math.hypot(b.observed_q[0]-q[0],b.observed_q[1]-q[1]);
 })[0];
}
function doubleDiffractionSummary(report){
 if(!report)return 'Reanalyse to check double-diffraction paths.';
 if(report.status==='unavailable')return 'Not enough indexed directions to check two-step paths.';
 const rms=report.profile_count?` · measured-sum RMS ${(100*report.measured_rms_relative).toFixed(2)}%`:'';
 return `${report.allowed_profile_count} single-scattering profiles + ${report.profile_count} double-diffraction candidates; ${report.remaining_profile_ids.length} remaining. Coverage including candidates ${(100*report.coverage_with_candidates).toFixed(1)}%${report.rms_with_candidates_relative!=null?` · combined positional RMS ${(100*report.rms_with_candidates_relative).toFixed(2)}%`:''}${rms}.${report.status==='partial'?` Partial check: ${report.truncated_beams} source beams omitted.`:''}`;
}
function doubleDiffractionColor(path,linked,display=null){
 if(linked){
  const owner=path.steps.find(s=>s.component!=='beta')||path.steps[0];
  const component=linked.components.find(c=>c.id===owner.component);
  return component?betaOmegaComponentColor(component,linked):phaseColors.BCC;
 }
 return display?.color||phaseColors[path.steps[0].phase];
}
function drawDoubleDiffraction(fits,qp){
 const host=$('double-diffraction-list'),details=$('double-diffraction-details');host.replaceChildren();
 const joint=betaOmegaOverlayActive(result)?result.beta_omega:null;
 const union=result.classification?.combined_fit,components=typeof combinedFitComponents==='function'?combinedFitComponents(result):[];
 const unionVisible=union?.double_diffraction&&components.length&&components.every(c=>fits.some(f=>!f.geometry&&f.model.phase===c.phase&&JSON.stringify(f.model.predicted_nodes)===JSON.stringify(c.predicted_nodes)));
 const models=[...(joint?[{label:phaseLabel('BCC')+' + ω'+(joint.status==='unresolved'?' · below fit screen':''),report:joint.double_diffraction,linked:joint,model:joint.fit}]:[]),
  ...(unionVisible?[{label:candidateName(union),report:union.double_diffraction,model:union}]:[]),
  ...[...new Set(fits.filter(f=>!f.geometry).map(f=>f.model))].map(m=>{const display=fits.find(f=>f.model===m);return {label:`${display.name||phaseLabel(m.phase)} ${zoneLabel(m)}${m.valid===false?' · below fit screen':''}`,report:m.double_diffraction,linked:null,model:m,display}})];
 details.hidden=!models.length;
 for(const {label,report,linked,model,display} of models){
  const section=document.createElement('div');section.className='forbidden-fit';
  const heading=document.createElement('strong');heading.textContent=label;section.append(heading);
  const summary=document.createElement('p');summary.textContent=doubleDiffractionSummary(report)+(model?.double_diffraction_weight?` DD rank +${(model.double_diffraction_bonus||0).toFixed(3)} · weight ${model.double_diffraction_weight.toFixed(2)} × quality-weighted additional coverage ${(100*(model.double_diffraction_factor||0)).toFixed(1)}%.`:' DD weight is zero; diagnostic only.');section.append(summary);
  if(report?.status==='checked'||report?.status==='partial'){
   const help=document.createElement('p');help.className='hint';
   help.textContent=`Both source reflections must be observed and assigned to allowed fitted nodes. Both their measured and fitted sums must reach the target. RMS combines supported opposite spots once per profile; the table shows one path. Residuals are divided by the ${report.normalization_label}. The DD weight can add ranking evidence; candidates never supply the single-scattering acceptance screen.${report.observation_kind==='image_fft'?' In an image FFT these are frequency coincidences; image formation can also produce them.':''}`;
   section.append(help);
   if(report.hits.length){
    const table=document.createElement('table'),head=document.createElement('thead'),header=document.createElement('tr'),body=document.createElement('tbody');
    for(const text of ['Profile','Contributing reflections','Fitted-sum RMS','Measured-sum RMS']){const th=document.createElement('th');th.textContent=text;header.append(th)}
    head.append(header);table.append(head,body);
    const listed=new Set();
    for(const hit of report.hits){
     const paths=hit.paths.filter(p=>!linked||p.steps.every(s=>!betaOmegaComponentHidden(s.component)));
     const path=paths[0];
     if(!listed.has(hit.profile_id)){
      listed.add(hit.profile_id);
      // Table retains all diagnostic evidence, even when component overlays hide.
      const best=hit.paths[0],row=document.createElement('tr'),id=document.createElement('td'),cell=document.createElement('td');id.textContent=hit.profile_id;
      const text=document.createElement('span');text.textContent=doubleDiffractionPathLabel(best,linked);cell.append(text);
      if(hit.paths.length>1){const alternatives=document.createElement('details'),title=document.createElement('summary'),list=document.createElement('ul');
       title.textContent=`${hit.path_count} candidate paths${hit.path_count>hit.paths.length?` · best ${hit.paths.length} shown`:''}`;
       for(const p of hit.paths){const li=document.createElement('li');li.textContent=`${doubleDiffractionPathLabel(p,linked)} · measured residual ${(100*p.measured_residual_relative).toFixed(2)}%`;list.append(li)}
       alternatives.append(title,list);cell.append(alternatives);
      }
      row.append(id,cell);
      const profile=report.profiles?.find(p=>p.profile_id===hit.profile_id)||best;
      for(const value of [profile.residual_relative,profile.measured_residual_relative]){const td=document.createElement('td');td.textContent=`${(100*value).toFixed(2)}%`;row.append(td)}
      body.append(row);
     }
     const mode=$('double-diffraction-marker').value;
     if(!path||mode==='off')continue;
     const [x,y]=qp(...hit.observed_q);if(x<0||x>420||y<0||y>420)continue;
     const color=doubleDiffractionColor(path,linked,display);
     const owner=linked?betaOmegaLabel((path.steps.find(s=>s.component!=='beta')||path.steps[0]).component,linked):phaseLabel(path.steps[0].phase);
     const shape=markerShape(x,y,mode,{stroke:color,fill:'none','stroke-width':1.5,'stroke-dasharray':'4 2','data-marker-kind':'double-diffraction','data-double-diffraction-profile':hit.profile_id,'data-marker-phase':path.steps[0].phase,'data-legend-label':`DD candidate · ${owner}`},11);
     const colorOwner=path.steps.find(s=>s.component!=='beta')||path.steps[0];
     shape.setAttribute('data-legend-color-target',linked?betaOmegaColorTarget({id:colorOwner.component}):display?.colorTarget||'phase:'+colorOwner.phase);
     shape.removeAttribute('class');shape.append(el('title',{},`Peak ${hit.profile_id}: candidate double diffraction · ${doubleDiffractionPathLabel(path,linked)} · fitted residual ${(100*path.residual_relative).toFixed(2)}%, measured residual ${(100*path.measured_residual_relative).toFixed(2)}%. Geometry only; not an intensity simulation.`));$('fft-overlay').append(shape);
    }
    const scroll=document.createElement('div');scroll.className='scroll';scroll.append(table);section.append(scroll);
   }
  }
  host.append(section);
 }
}

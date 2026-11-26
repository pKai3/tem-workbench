const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context={window:{}};vm.createContext(context);vm.runInContext(fs.readFileSync('web/crystal-viewer.js','utf8'),context);
const viewer=context.window.CrystalViewer,plain=x=>JSON.parse(JSON.stringify(x));
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
// Conventional cell contents and shared boundary sites: 2/2/4/3/1 atoms per
// cell, with weighted faces/edges/corners rather than counting all as interior.
for(const [phase,count,displayed] of [['HCP',2,9],['BCC',2,9],['FCC',4,14],['OMEGA',3,10],['ORT',1,8]]){
 const d=viewer.describe(phase),g=viewer.geometry(d,1);
 assert.equal(g.atoms.length,displayed);
 close(g.atoms.reduce((s,a)=>s+2**-a.fractional.filter(v=>v===0||v===1).length,0),count);
 assert.equal(new Set(g.atoms.map(a=>a.point.join(','))).size,displayed);
 assert.equal(g.edges.length,12);assert.ok(g.bonds.length>0);
 const grown=viewer.geometry(d,4);assert.ok(grown.atoms.length<500);assert.ok(grown.bonds.every(([a,b])=>Math.hypot(...a.map((v,i)=>v-b[i]))>0));
}
// Basis structure factors must reproduce the matcher's systematic absences.
for(const [phase,s] of Object.entries(viewer.structures))for(let h=-3;h<=3;h++)for(let k=-3;k<=3;k++)for(let l=-3;l<=3;l++){
 const amplitude=s.basis.reduce(([re,im],f)=>{const angle=2*Math.PI*(h*f[0]+k*f[1]+l*f[2]);return [re+Math.cos(angle),im+Math.sin(angle)]},[0,0]);
 const even=v=>v%2===0;
 const allowed=phase==='BCC'?even(h+k+l):phase==='FCC'?even(h)===even(k)&&even(k)===even(l):phase==='HCP'?even(l)||(h-k)%3!==0:phase==='OMEGA'?!even(l)||(h-k)%3===0:true;
 assert.equal(Math.hypot(...amplitude)>1e-7,allowed,`${phase} ${h} ${k} ${l}`);
}
// Independent, non-cubic metric check: viewing [1 1 0] is a+b, not the
// reciprocal plane normal and not a normalized bare index vector.
for(const phase of ['HCP','ORT']){
 const d=viewer.describe(phase),g=viewer.geometry(d,1),r=viewer.zoneRotation(d,[1,1,0]),direction=g.vectors[0].map((v,i)=>v+g.vectors[1][i]);
 close(dot(r[0],direction),0);close(dot(r[1],direction),0);close(dot(r[2],direction),Math.hypot(...direction));
 for(const row of r)close(Math.hypot(...row),1);
}
const bcc={phase:'BCC',fitted_a_nm:.35,zone_3index:[1,1,1],valid:true};
const snapshot=JSON.stringify(bcc),d=viewer.describe('BCC',bcc,{bcc_a:.6});
assert.deepEqual(plain(d.cell),[.35,.35,.35]);assert.equal(JSON.stringify(bcc),snapshot);
const custom=viewer.describe('HCP',null,{hcp_a:.4,hcp_c:.7});assert.deepEqual(plain(custom.cell),[.4,.4,.7]);
const missing=viewer.describe('HCP',{fitted_a_nm:.3,fitted_c_nm:null,nominal_c_nm:.47,scale_mode:'auto_hcp_ac',shared_scale:2});
close(missing.cell[2],.47);assert.equal(missing.sources[2],'unconstrained');
const ort=viewer.describe('ORT',{fitted_a_nm:.3,fitted_b_nm:.9,fitted_c_nm:.5,axis_observable:[true,false,true]},{ort_b:.4});close(ort.cell[1],.4);assert.equal(ort.sources[1],'unconstrained');
// Unknown-material geometry searches can still be calibrated; mode alone
// must not strip nm. Conversely uncalibrated fitted ratios remain available.
assert.equal(viewer.describe('FCC',{coordinate_units:'nm^-1',scale_mode:'relative_geometry',fitted_a_nm:.44}).relative,false);
const relative=viewer.describe('HCP',{coordinate_units:'relative',scale_mode:'relative_geometry',nominal_a_nm:.3,nominal_c_nm:.5,scale_a:2,scale_c:2.5});
close(relative.cell[0],1);close(relative.cell[2],4/3);assert.equal(relative.relative,true);
assert.equal(viewer.describe('BCC',{zone_3index:[0,0,0]}).zone,null);
assert.throws(()=>viewer.describe('UNKNOWN'));assert.throws(()=>viewer.geometry(d,5));assert.throws(()=>viewer.geometry(d,1.5));
const second={...bcc,zone_3index:[0,0,1],rotation_deg:30},combined={independent_combination:true,phase:'BCC+BCC',component_zones:[[1,1,1],[0,0,1]],component_rotations_deg:[0,30]};
assert.deepEqual(plain(viewer.candidateModels(combined,{models:[{...bcc,rotation_deg:0},second]})).map(m=>m.zone_3index),[[1,1,1],[0,0,1]]);
const linked={components:[{id:'beta',active:true,vector_model:bcc},{id:'omega1',active:true,vector_model:{phase:'OMEGA',zone_3index:[0,0,1]}},{id:'omega2',active:false,vector_model:{phase:'OMEGA'}}]};
assert.deepEqual(plain(viewer.candidateModels({related_pattern:true},null,linked)).map(m=>m.phase),['BCC','OMEGA']);
assert.equal(viewer.candidateModels({phase:'GEOMETRY'}).length,0);
// Reconstruct detector orientation from predictions, including reflected
// templates. All recovered frames must be proper rotations, never mirrors.
vm.runInContext(fs.readFileSync('web/kinematic-diffraction.js','utf8'),context);
const diffraction=context.window.KinematicDiffraction;
// The fitted-zone guide uses the same orthographic scale as the atomic model:
// it collapses on axis (also under pure roll), scales with zoom, and shortens
// continuously while the candidate returns from an off-axis orientation.
const identity=[[1,0,0],[0,1,0],[0,0,1]],axis=[0,0,1];
close(viewer.projectZoneGuide(identity,axis,400,600).length,0);
const sideways=viewer.projectZoneGuide(diffraction.tilt(identity,0,90),axis,400,600);close(sideways.x1,38.5);close(sideways.x2,361.5);close(sideways.y1,300);close(sideways.length,323);
const tiltedGuide=diffraction.tilt(identity,20,12);let previousLength=Infinity;
for(const progress of [0,.25,.5,.75,1]){const frame=viewer.interpolateSnap(tiltedGuide,identity,progress),guide=viewer.projectZoneGuide(frame,axis,400,600);assert.ok(guide.length<previousLength);previousLength=guide.length;close(viewer.projectZoneGuide(frame,axis,400,600,2).length,guide.length*2)}
close(viewer.projectZoneGuide([[0,-1,0],[1,0,0],[0,0,1]],axis,400,600).length,0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function checkFrame(matrix){for(let i=0;i<3;i++)for(let j=0;j<3;j++)close(dot(matrix[i],matrix[j]),Number(i===j));close(dot(cross(matrix[0],matrix[1]),matrix[2]),1)}
for(const phase of Object.keys(viewer.structures))for(const hand of [1,-1])for(const relativeScale of [1,3.7]){
 const model={phase,zone_3index:[1,1,0]},detail=viewer.describe(phase,model);
 detail.relative=relativeScale!==1;
 const frame=viewer.zoneRotation(detail,model.zone_3index),reciprocal=diffraction.reciprocalBasis(viewer.geometry(detail,1).vectors),c=Math.cos(.73),s=Math.sin(.73);
 const expected=[frame[0].map((v,i)=>c*v-hand*s*frame[1][i]),frame[0].map((v,i)=>s*v+hand*c*frame[1][i]),frame[2].map(v=>hand*v)];
 const vectors=[[1,-1,0],[0,0,1],[2,-2,1],[-1,1,2]];
 model.predicted_nodes=vectors.map(hkl=>{const g=[0,1,2].map(i=>hkl.reduce((n,h,j)=>n+h*reciprocal[j][i],0));return {hkl,q:expected.slice(0,2).map(row=>dot(row,g)*relativeScale)}});
 const before=JSON.stringify(model),aligned=viewer.fittedOrientation(detail,model);assert.ok(aligned,`${phase}, hand ${hand}, scale ${relativeScale}`);checkFrame(aligned.matrix);close(aligned.scale,relativeScale);close(aligned.error,0);
 expected.forEach((row,i)=>row.forEach((value,j)=>close(aligned.matrix[i][j],value)));assert.equal(JSON.stringify(model),before);
 const incompatible={...detail,cell:detail.cell.map(v=>v*1.2),relative:false};assert.equal(viewer.fittedOrientation(incompatible,model),null);
 assert.equal(viewer.fittedOrientation(detail,{...model,predicted_nodes:model.predicted_nodes.slice(0,1)}),null);
 assert.equal(viewer.fittedOrientation(detail,{...model,predicted_nodes:model.predicted_nodes.map((n,i)=>({...n,q:n.q.map(v=>v*(i===0?1.2:1))}))}),null);
}
// Minimal zone correction uses the direct-cell metric, preserves screen roll,
// and interpolates continuously through orthonormal frames in both panes.
for(const phase of ['BCC','HCP','ORT']){
 const detail=viewer.describe(phase),exact=viewer.zoneRotation(detail,[1,0,0]),from=diffraction.tilt(exact,2,-1),before=JSON.stringify(from);
 const nearest=viewer.nearestZone(detail,from);assert.deepEqual(plain(nearest.zone),[1,0,0]);assert.ok(nearest.angle>2&&nearest.angle<2.3);checkFrame(nearest.matrix);
 nearest.matrix[2].forEach((v,i)=>close(v,exact[2][i]));
 let last=Infinity;
 for(const progress of [0,.1,.25,.5,.75,.9,1]){
  const interpolated=viewer.interpolateSnap(from,nearest.matrix,progress);checkFrame(interpolated);
  const remaining=Math.acos(Math.min(1,dot(interpolated[2],nearest.matrix[2])))*180/Math.PI;
  assert.ok(remaining<=last);assert.ok(Math.abs(remaining-nearest.angle*(1-progress))<1e-5);last=remaining;
  if(progress===0)interpolated.forEach((row,i)=>row.forEach((v,j)=>close(v,from[i][j])));
  if(progress===1)interpolated.forEach((row,i)=>row.forEach((v,j)=>close(v,nearest.matrix[i][j])));
 }
 assert.equal(JSON.stringify(from),before);
 const selected=[7,1,2],high=viewer.zoneRotation(detail,selected);
 assert.deepEqual(plain(viewer.nearestZone(detail,high,3,[selected]).zone),selected);
 assert.deepEqual(plain(viewer.nearestZone(detail,viewer.zoneRotation(detail,selected.map(v=>-v)),3,[selected]).zone),selected.map(v=>-v));
 assert.notDeepEqual(plain(viewer.nearestZone(detail,high).zone),selected);
 // A dropdown half-turn and an in-plane correction are full rotations too.
 const opposite=viewer.alignZone(detail,exact,[-1,0,0]);checkFrame(opposite.matrix);
 for(const progress of [.1,.5,.9])checkFrame(viewer.interpolateSnap(exact,opposite.matrix,progress));
 const rolled=exact.map(row=>[...row]),c=Math.cos(.37),s=Math.sin(.37);
 rolled[0]=exact[0].map((v,i)=>c*v-s*exact[1][i]);rolled[1]=exact[0].map((v,i)=>s*v+c*exact[1][i]);
 const aligned=viewer.realignZone(detail,rolled,[1,0,0]);checkFrame(aligned.matrix);aligned.matrix[2].forEach((v,i)=>close(v,rolled[2][i]));
 const reciprocal=diffraction.reciprocalBasis(viewer.geometry(detail,1).vectors),g=[0,1,2].map(i=>aligned.hkl.reduce((n,h,j)=>n+h*reciprocal[j][i],0));
 assert.ok(Math.min(Math.abs(dot(aligned.matrix[0],g)),Math.abs(dot(aligned.matrix[1],g)))<1e-9);assert.ok(aligned.angle<=45);
 const intermediate=viewer.interpolateSnap(rolled,aligned.matrix,.5);checkFrame(intermediate);intermediate[2].forEach((v,i)=>close(v,rolled[2][i]));
 close(viewer.viewRotation(detail,exact,{rotation_deg:23},{matrix:exact},[1,0,0]),23);
 close(viewer.viewRotation(detail,rolled,{rotation_deg:23},{matrix:exact},[1,0,0]),23+.37*180/Math.PI);
}
// The FFT action follows the selected overlays and is unavailable while a new
// region is being fitted. Custom selections include parent-linked components.
const fftButton={},browseButton={},chosenFits=new Set(),fit={phase:'BCC',score:.8,valid:true,zone_3index:[0,0,1]},other={phase:'FCC',score:.9,valid:false,zone_3index:[1,1,0]};
const fftContext={result:{models:[other,fit],settings:{bcc_a:.33},beta_omega:{components:[{id:'omega1',active:true,vector_model:{phase:'OMEGA'}},{id:'omega2',active:false,vector_model:{phase:'OMEGA'}}]}},busy:false,pending:false,fftRaw:{},PHASES:Object.keys(viewer.structures),chosenFits,$:id=>id==='overlay'?{value:'all'}:fftButton,overlayModels:(data,choice,options)=>{assert.equal(options.vectors,true);return choice==='none'?[]:data.models},phaseLabel:p=>p,zoneLabel:m=>String(m.zone_3index),CrystalViewer:{open:options=>fftContext.opened=options}};
const originalLookup=fftContext.$;fftContext.$=id=>id==='browse-crystals'?browseButton:originalLookup(id);vm.createContext(fftContext);
const source=fs.readFileSync('web/app.js','utf8');vm.runInContext(source.slice(source.indexOf('function spectrumCrystalModels('),source.indexOf('let materialDefaultPreset=')),fftContext);
assert.deepEqual(plain(fftContext.spectrumCrystalModels()).map(m=>m.phase),['BCC','FCC']);assert.equal(fftContext.spectrumCrystalModels(fftContext.result,'none').length,0);
chosenFits.add('phase-1');chosenFits.add('linked-omega1');chosenFits.add('linked-omega2');assert.deepEqual(plain(fftContext.spectrumCrystalModels(fftContext.result,'custom')).map(m=>m.phase),['BCC','OMEGA']);
fftContext.syncCrystalViewerControl();assert.equal(fftButton.disabled,false);fftButton.onclick();assert.equal(fftContext.opened.settings,fftContext.result.settings);assert.deepEqual(plain(fftContext.opened.models).map(m=>m.phase),['BCC','FCC']);
const fftModels=fftContext.opened.models;browseButton.onclick();assert.deepEqual(plain(fftContext.opened.models),plain(fftModels));assert.equal(fftContext.opened.anchor,browseButton);
for(const name of ['busy','pending']){fftContext[name]=true;fftContext.syncCrystalViewerControl();assert.equal(fftButton.disabled,true);fftContext.opened=null;fftButton.onclick();assert.equal(fftContext.opened,null);fftContext[name]=false}
fftContext.fftRaw=null;fftContext.syncCrystalViewerControl();assert.equal(fftButton.disabled,true);
// Fitted-mode drags restore the full frame (including roll/handedness), while
// explicit free rotation leaves a candidate at the released pose.
const viewerSource=fs.readFileSync('web/crystal-viewer.js','utf8'),candidateDetail=viewer.describe('BCC',bcc),candidateBase=viewer.zoneRotation(candidateDetail,[1,1,1]);
const candidateFrame=[candidateBase[0].map((v,i)=>.8*v+.6*candidateBase[1][i]),candidateBase[0].map((v,i)=>.6*v-.8*candidateBase[1][i]),candidateBase[2].map(v=>-v)];checkFrame(candidateFrame);
let cancelled=0,scheduled=null,finished=null;
const returnContext={detail:candidateDetail,zoom:2.5,alignment:{matrix:candidateFrame},view:{value:'free'},setRotationMode:choice=>returnContext.mode=choice,zoneRotation:viewer.zoneRotation,nearestZone:viewer.nearestZone,initialRotation:()=>[[1,0,0],[0,1,0],[0,0,1]],cancelSnap:()=>cancelled++,animateTo:(target,complete,message,duration)=>scheduled={target,complete,message,duration},finishSnap:(target,choice)=>finished={target,choice},snapStatus:{textContent:''}};
vm.createContext(returnContext);vm.runInContext(viewerSource.slice(viewerSource.indexOf('  function returnToCandidate('),viewerSource.indexOf('  function resetView(')),returnContext);
returnContext.returnToCandidate();assert.equal(cancelled,1);assert.equal(returnContext.mode,'zone');assert.equal(returnContext.view.value,'zone');assert.equal(scheduled.duration,900);assert.match(scheduled.message,/Returning/);assert.deepEqual(plain(scheduled.target.matrix),plain(candidateFrame));assert.notEqual(scheduled.target.matrix,candidateFrame);assert.equal(finished,null);scheduled.complete();assert.equal(finished.choice,'zone');assert.equal(returnContext.snapStatus.textContent,'');
assert.equal(returnContext.zoom,2.5,'Automatic candidate return preserves the explored zoom');returnContext.returnToCandidate(true);assert.equal(returnContext.zoom,1,'Explicit Return to fit restores default framing');scheduled.complete();
returnContext.alignment=null;returnContext.returnToCandidate();scheduled.complete();assert.match(returnContext.snapStatus.textContent,/unavailable/);
let returns=0,snaps=0;const pointerContext={canvas:{},pointers:new Map(),gestureRotated:true,pinched:false,followCandidate:true,snap:{checked:false},detail:{candidate:true},returnToCandidate:()=>returns++,snapNow:()=>snaps++};
vm.createContext(pointerContext);vm.runInContext(viewerSource.slice(viewerSource.indexOf('  canvas.onpointerup='),viewerSource.indexOf('  canvas.onpointercancel=')),pointerContext);
pointerContext.canvas.onpointerup({pointerId:1});assert.equal(returns,1);assert.equal(snaps,0);
pointerContext.pinched=true;pointerContext.canvas.onpointerup({pointerId:1});assert.equal(returns,1);
pointerContext.pinched=false;pointerContext.gestureRotated=false;pointerContext.canvas.onpointerup({pointerId:1});assert.equal(returns,1);
pointerContext.gestureRotated=true;pointerContext.followCandidate=false;pointerContext.snap.checked=true;pointerContext.canvas.onpointerup({pointerId:1});assert.equal(returns,1,'Free candidate never returns on release');assert.equal(snaps,0,'Reference snapping cannot override candidate free mode');
pointerContext.detail.candidate=false;pointerContext.snap.checked=false;pointerContext.canvas.onpointerup({pointerId:1});assert.equal(snaps,0);pointerContext.snap.checked=true;pointerContext.canvas.onpointerup({pointerId:1});assert.equal(snaps,1);
// Selecting Free rotation must not jump to an unrelated initial frame or
// reset zoom; the next explicit fitted selection restores release behaviour.
const freeContext={detail:candidateDetail,followCandidate:true,hint:{textContent:''},view:{value:'free'},matrix:candidateFrame,baseMatrix:null,zoom:2.5,customWrap:{},orientationError:{},snapStatus:{},cancelSnap(){},resetTilts(){},paint(){},alignment:{matrix:candidateFrame},nearestZone:viewer.nearestZone,animateTo(target){freeContext.target=target}};
vm.createContext(freeContext);vm.runInContext(viewerSource.slice(viewerSource.indexOf('  function setRotationMode('),viewerSource.indexOf('  function applyTilt(')),freeContext);vm.runInContext(viewerSource.slice(viewerSource.indexOf('  function orient('),viewerSource.indexOf('  function tourNext(')),freeContext);
freeContext.orient();assert.equal(freeContext.followCandidate,false);assert.equal(freeContext.matrix,candidateFrame);assert.equal(freeContext.baseMatrix,candidateFrame);assert.equal(freeContext.zoom,2.5);assert.doesNotMatch(freeContext.hint.textContent,/return to fit/);
freeContext.view.value='zone';freeContext.orient();assert.equal(freeContext.followCandidate,true);assert.match(freeContext.hint.textContent,/return to fit/);assert.deepEqual(plain(freeContext.target.matrix),plain(candidateFrame));
const labels={STRUCTURES:viewer.structures};vm.createContext(labels);vm.runInContext(viewerSource.slice(viewerSource.indexOf(' function entryLabel('),viewerSource.indexOf(' let snapEnabled=')),labels);
assert.equal(labels.entryLabel({phase:'BCC',model:{zone_3index:[0,0,1],rotation_deg:0}}),'Candidate · BCC [0 0 1] · 0.0°');
assert.equal(labels.entryLabel({phase:'OMEGA',model:{zone_3index:[1,0,0],rotation_deg:98.94,linked_parent_rotation:true}}),'Candidate · ω [1 0 0] · parent 98.9°');
assert.equal(labels.entryLabel({phase:'HCP',model:null}),'Reference · HCP');assert.doesNotMatch(labels.entryLabel({phase:'HCP',model:{}}),/undefined|NaN|°/);
console.log('Crystal models: cells, absences, fitted/reflected registration, relative scale, metric zone snapping, continuous proper rotations, FFT action and combined candidates passed.');

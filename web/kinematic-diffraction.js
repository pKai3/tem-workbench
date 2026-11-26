/* Equal-point-scatterer, single-scattering orientation preview.
 * All lengths are nm and reciprocal vectors omit 2*pi. For an illuminated slab
 * of beam-path thickness t: I = |sum exp(2*pi*i*h.r)/N|^2 sinc^2(pi*t*s).
 * s is the signed longitudinal distance to the forward Ewald sphere.
 * No elemental scattering factors, absorption or dynamical coupling are used.
 * Background: https://diffsims.readthedocs.io/en/stable/reference/generated/
 * diffsims.generators.simulation_generator.SimulationGenerator.html
 * This implementation uses the equations directly; no third-party code/data.
 */
(() => {
 'use strict';
 const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const mul=(a,s)=>a.map(v=>v*s),add=(a,b)=>a.map((v,i)=>v+b[i]);
 function wavelength(voltageKV){
  if(!Number.isFinite(voltageKV)||voltageKV<20||voltageKV>1000)throw new Error('Voltage must be 20–1,000 kV.');
  const h=6.62607015e-34,m=9.1093837139e-31,e=1.602176634e-19,c=299792458,energy=voltageKV*1000*e;
  return h/Math.sqrt(2*m*energy*(1+energy/(2*m*c*c)))*1e9;
 }
 function reciprocalBasis(vectors){
  const volume=dot(vectors[0],cross(vectors[1],vectors[2]));
  if(!Number.isFinite(volume)||volume<=0)throw new Error('The cell must have positive volume.');
  return [cross(vectors[1],vectors[2]),cross(vectors[2],vectors[0]),cross(vectors[0],vectors[1])].map(v=>mul(v,1/volume));
 }
 function structureIntensity(hkl,sites){
  let real=0,imaginary=0;
  for(const site of sites){const angle=2*Math.PI*dot(hkl,site);real+=Math.cos(angle);imaginary+=Math.sin(angle)}
  return Math.min(1,(real*real+imaginary*imaginary)/(sites.length*sites.length));
 }
 function reflectionLibrary(vectors,sites,gMax){
  if(!Number.isFinite(gMax)||gMax<2||gMax>30)throw new Error('Max g must be 2–30 nm⁻¹.');
  if(!sites?.length)throw new Error('An atomic basis is required.');
  const reciprocal=reciprocalBasis(vectors),limits=vectors.map(v=>Math.ceil(gMax*Math.hypot(...v))),reflections=[];
  // h = g.a, so these bounds include every reciprocal point in the sphere.
  if(limits.reduce((n,v)=>n*(2*v+1),1)>600000)throw new Error('Too many reflections for this cell. Lower Max g.');
  for(let h=-limits[0];h<=limits[0];h++)for(let k=-limits[1];k<=limits[1];k++)for(let l=-limits[2];l<=limits[2];l++){
   if(h===0&&k===0&&l===0)continue;
   const hkl=[h,k,l],g=[0,1,2].map(i=>h*reciprocal[0][i]+k*reciprocal[1][i]+l*reciprocal[2][i]),length=Math.hypot(...g);
   if(length>gMax+1e-9)continue;
   const basisIntensity=structureIntensity(hkl,sites);
   if(basisIntensity>1e-12){
    reflections.push({hkl,g,length,basisIntensity,d:1/length});
    if(reflections.length>50000)throw new Error('Too many reflections for this cell. Lower Max g.');
   }
  }
  return {reflections,gMax};
 }
 function excitation(q,lambda){
  const k=1/lambda,r2=q[0]*q[0]+q[1]*q[1];
  // Stable k-sqrt(k²-r²), positive toward the incident-beam direction.
  return r2>=k*k?Infinity:q[2]+r2/(k+Math.sqrt(k*k-r2));
 }
 function thicknessIntensity(s,thickness){const x=Math.PI*thickness*s;return Math.abs(x)<1e-8?1:(Math.sin(x)/x)**2}
 function simulate(library,matrix,{voltageKV=200,thickness=10}={}){
  const lambda=wavelength(voltageKV);
  if(!Number.isFinite(thickness)||thickness<1||thickness>200)throw new Error('Thickness must be 1–200 nm.');
  const spots=library.reflections.map(reflection=>{
   const q=matrix.map(row=>dot(row,reflection.g)),s=excitation(q,lambda);
   return {...reflection,q,s,intensity:reflection.basisIntensity*thicknessIntensity(s,thickness)};
  });
  return {spots,lambda,gMax:library.gMax};
 }
 function parseZone(text,isHex=false){
  const parts=String(text).trim().replace(/[\[\]]/g,'').replace(/−/g,'-').split(/[\s,]+/);
  if(![3,4].includes(parts.length)||parts.some(p=>!/^[-+]?\d+$/.test(p)))throw new Error('Enter three integer indices, for example 1 1 0.');
  let zone=parts.map(Number);
  if(zone.some(v=>!Number.isSafeInteger(v)||Math.abs(v)>100))throw new Error('Zone indices must be between −100 and 100.');
  if(zone.length===4){if(!isHex||zone[0]+zone[1]+zone[2]!==0)throw new Error('Hexagonal [u v t w] requires u + v + t = 0.');zone=[zone[0]-zone[2],zone[1]-zone[2],zone[3]]}
  if(!zone.some(v=>v!==0))throw new Error('The zone axis cannot be [0 0 0].');
  const gcd=(a,b)=>b?gcd(b,a%b):a,divisor=zone.reduce((g,v)=>gcd(g,Math.abs(v)),0);
  return zone.map(v=>v/divisor);
 }
 function tilt(matrix,xDegrees,yDegrees){
  const x=xDegrees*Math.PI/180,y=yDegrees*Math.PI/180;
  // Rotate the crystal around screen X, then screen Y. The beam is screen +Z.
  const rows=[matrix[0],add(mul(matrix[1],Math.cos(x)),mul(matrix[2],-Math.sin(x))),add(mul(matrix[1],Math.sin(x)),mul(matrix[2],Math.cos(x)))];
  return [add(mul(rows[0],Math.cos(y)),mul(rows[2],Math.sin(y))),rows[1],add(mul(rows[0],-Math.sin(y)),mul(rows[2],Math.cos(y)))];
 }
 function plotGeometry(width,height,gMax,viewport=null){
  if(!viewport){const radius=Math.max(20,Math.min(width,height)/2-35),scale=radius/gMax;return {cx:width/2,cy:height/2,sx:scale,sy:scale,outer:gMax,clip:null,project:q=>[width/2+scale*q[0],height/2-scale*q[1]]}}
  const {extent:e,viewBox:v,imageRect:r,outerRadius:outer}=viewport;
  if(![e,v,r].every(a=>Array.isArray(a)&&a.length===4&&a.every(Number.isFinite))||e[1]<=e[0]||e[3]<=e[2]||v[2]<=0||v[3]<=0||r[2]<=0||r[3]<=0||!Number.isFinite(outer)||outer<=0)throw new Error('The FFT display scale is unavailable.');
  // Match SVG's xMidYMid meet transform, including its asymmetric axis margins.
  const scale=Math.min(width/v[2],height/v[3]),ox=(width-v[2]*scale)/2,oy=(height-v[3]*scale)/2;
  const svgPoint=(x,y)=>[ox+(x-v[0])*scale,oy+(y-v[1])*scale],project=q=>svgPoint(r[0]+(q[0]-e[0])*r[2]/(e[1]-e[0]),r[1]+(e[3]-q[1])*r[3]/(e[3]-e[2]));
  const [cx,cy]=project([0,0]),[x,y]=svgPoint(r[0],r[1]);
  return {cx,cy,sx:scale*r[2]/(e[1]-e[0]),sy:scale*r[3]/(e[3]-e[2]),outer,clip:{x,y,width:r[2]*scale,height:r[3]*scale},project,svgPoint,svgScale:scale};
 }
 function createPlot(canvas,readout){
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Diffraction drawing is unavailable.');
  let points=[],selected=null,last=null;
  const label=spot=>'('+spot.hkl.join(' ')+')';
  const announce=spot=>{selected=spot?.hkl.join(',')||null;readout.dataset.selected=String(Boolean(spot));readout.textContent=spot?`${label(spot)} · d ${spot.d.toFixed(4)} nm · g ${spot.length.toFixed(3)} nm⁻¹ · relative I ${spot.intensity.toPrecision(3)} · excitation ${spot.s.toFixed(4)} nm⁻¹`:'Hover or tap a spot · Arrow keys inspect reflections';if(last)draw(...last)};
  function draw(pattern,{labels=true,minimum=.001,viewport=null,displayScale=1}={}){
   last=[pattern,{labels,minimum,viewport,displayScale}];
   const rect=canvas.getBoundingClientRect(),w=Math.max(1,rect.width),h=Math.max(1,rect.height),dpr=Math.min(window.devicePixelRatio||1,2);
   canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#060b11';ctx.fillRect(0,0,w,h);
   if(!pattern){points=[];return}
   const frame=plotGeometry(w,h,pattern.gMax,viewport),{cx,cy,sx,sy,outer,clip}=frame,rx=outer*sx,ry=outer*sy;
   ctx.save();if(clip){ctx.beginPath();ctx.rect(clip.x,clip.y,clip.width,clip.height);ctx.clip()}
   ctx.strokeStyle='#263343';ctx.lineWidth=1;ctx.setLineDash([3,5]);ctx.beginPath();ctx.moveTo(cx-rx,cy);ctx.lineTo(cx+rx,cy);ctx.moveTo(cx,cy-ry);ctx.lineTo(cx,cy+ry);ctx.stroke();ctx.setLineDash([]);
   ctx.beginPath();ctx.ellipse(cx,cy,rx,ry,0,0,2*Math.PI);ctx.stroke();
   if(viewport?.innerRadius>0){ctx.setLineDash([3,3]);ctx.beginPath();ctx.ellipse(cx,cy,viewport.innerRadius*sx,viewport.innerRadius*sy,0,0,2*Math.PI);ctx.stroke();ctx.setLineDash([])}
   ctx.strokeStyle='#8094aa';ctx.beginPath();ctx.moveTo(cx-4,cy);ctx.lineTo(cx+4,cy);ctx.moveTo(cx,cy-4);ctx.lineTo(cx,cy+4);ctx.stroke();
   points=pattern.spots.filter(s=>s.intensity>=minimum&&Math.hypot(s.q[0],s.q[1])>1e-6&&Math.hypot(s.q[0],s.q[1])*displayScale<=outer+1e-9).map(s=>{const [x,y]=frame.project(s.q.map(v=>v*displayScale));return {...s,x,y}}).filter(p=>!clip||(p.x>=clip.x&&p.x<=clip.x+clip.width&&p.y>=clip.y&&p.y<=clip.y+clip.height)).sort((a,b)=>a.intensity-b.intensity);
   const selectedPoint=points.find(p=>p.hkl.join(',')===selected);
   if(selected&&!selectedPoint){selected=null;readout.dataset.selected='false';readout.textContent='Selected reflection is below the display threshold.'}
   else if(selectedPoint)readout.textContent=`${label(selectedPoint)} · d ${selectedPoint.d.toFixed(4)} nm · g ${selectedPoint.length.toFixed(3)} nm⁻¹ · relative I ${selectedPoint.intensity.toPrecision(3)} · excitation ${selectedPoint.s.toFixed(4)} nm⁻¹`;
   for(const p of points){
    // Fixed fourth-root display curve, never renormalized after a tilt.
    const strength=p.intensity**.25,r=1.4+3.2*strength;
    ctx.fillStyle=`rgba(158,225,255,${.15+.85*strength})`;ctx.beginPath();ctx.arc(p.x,p.y,r,0,2*Math.PI);ctx.fill();
    if(p.hkl.join(',')===selected){ctx.strokeStyle='#ffd483';ctx.beginPath();ctx.arc(p.x,p.y,r+4,0,2*Math.PI);ctx.stroke()}
   }
   ctx.restore();ctx.fillStyle='#94a5b8';ctx.textAlign='center';
   if(viewport){
    const e=viewport.extent,r=viewport.imageRect,limit=Math.min(Math.abs(e[0]),Math.abs(e[1])),step=limit<=5.5?2:limit<=12?5:10,count=Math.floor(limit/step),font=10*frame.svgScale;
    ctx.font=`${font}px system-ui`;
    for(let i=-count;i<=count;i++){const q=i*step,[x,y]=frame.project([q,q]);if(q>=e[0]&&q<=e[1])ctx.fillText(String(q),x,frame.svgPoint(0,r[1]+r[3]+17)[1]);if(q>=e[2]&&q<=e[3]){ctx.textAlign='right';ctx.fillText(String(q),frame.svgPoint(r[0]-7,0)[0],y+3*frame.svgScale);ctx.textAlign='center'}}
    ctx.textAlign='left';ctx.font=`${9*frame.svgScale}px system-ui`;ctx.fillText(viewport.units==='relative'?'rel.':'nm⁻¹',cx+12*frame.svgScale,frame.svgPoint(0,r[1]+r[3]+17)[1]);
    ctx.textAlign='right';ctx.font=`${8*frame.svgScale}px system-ui`;ctx.fillText(`${outer.toFixed(1)} ${viewport.units==='relative'?'rel.':'nm⁻¹'}`,Math.min(w-8,cx+rx-5),Math.max(20,cy-ry+14));
   }else{ctx.font='11px system-ui';ctx.fillText('0',cx+9,cy+14);ctx.fillText(`${pattern.gMax} nm⁻¹`,cx,cy+ry+22)}
   if(labels){
    const occupied=[];ctx.font='10px system-ui';ctx.textAlign='left';
    for(const p of [...points].reverse().slice(0,40)){
     const text=label(p),tw=ctx.measureText(text).width,x=p.x+7,y=p.y-7;
     if(x+tw>w-4||y<12||occupied.some(b=>x<b.x+b.w&&x+tw>b.x&&y<b.y+13&&y+2>b.y))continue;
     ctx.fillStyle='#b7c9dd';ctx.fillText(text,x,y);occupied.push({x,y:y-11,w:tw});
    }
   }
   canvas.setAttribute('aria-label',`Kinematic diffraction preview, ${points.length} displayed reflections. Use arrow keys to inspect spots.`);
  }
  const nearest=e=>{const b=canvas.getBoundingClientRect(),x=e.clientX-b.left,y=e.clientY-b.top;return [...points].sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y)).find(p=>Math.hypot(p.x-x,p.y-y)<14)};
  canvas.onpointermove=e=>{if(e.pointerType!=='touch'){const p=nearest(e);if((p?.hkl.join(',')||null)!==selected)announce(p)}};
  canvas.onclick=e=>{canvas.focus();announce(nearest(e))};
  canvas.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)||!points.length)return;e.preventDefault();const ordered=[...points].sort((a,b)=>b.intensity-a.intensity||a.hkl.join(',').localeCompare(b.hkl.join(','))),index=ordered.findIndex(p=>p.hkl.join(',')===selected),step=['ArrowLeft','ArrowUp'].includes(e.key)?-1:1;announce(ordered[e.key==='Home'?0:e.key==='End'?ordered.length-1:(index+step+ordered.length)%ordered.length])};
  return {draw,clear(){last=null;points=[];selected=null;readout.dataset.selected='false';ctx.clearRect(0,0,canvas.width,canvas.height)},count:()=>points.length};
 }
 window.KinematicDiffraction={wavelength,reciprocalBasis,structureIntensity,reflectionLibrary,excitation,thicknessIntensity,simulate,parseZone,tilt,plotGeometry,createPlot};
})();

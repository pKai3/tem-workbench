/* Local, read-only crystal models. No network assets or analysis mutations.
 * Fractional bases use a 120-degree hexagonal cell and an atom at the origin.
 * HCP is an origin-shifted AFLOW A_hP2_194_c-001:
 * https://aflow.org/p/A_hP2_194_c-001
 * Omega follows analysis/crystal_templates.py (the ideal monatomic C32 basis).
 */
(() => {
 'use strict';
 const STRUCTURES={
  HCP:{name:'HCP',description:'Hexagonal close-packed',basis:[[0,0,0],[1/3,2/3,1/2]],cell:[.295,.295,.468],colour:[.47,.73,.98]},
  BCC:{name:'BCC',description:'Body-centred cubic',basis:[[0,0,0],[.5,.5,.5]],cell:[.33,.33,.33],colour:[.96,.72,.37]},
  FCC:{name:'FCC',description:'Face-centred cubic',basis:[[0,0,0],[0,.5,.5],[.5,0,.5],[.5,.5,0]],cell:[.417,.417,.417],colour:[.39,.84,.73]},
  OMEGA:{name:'ω',description:'Hexagonal omega',basis:[[0,0,0],[2/3,1/3,1/2],[1/3,2/3,1/2]],cell:[.4614,.4614,.2832],colour:[.71,.60,1]},
  ORT:{name:'ORT',description:'Primitive orthorhombic',basis:[[0,0,0]],cell:[.3,.4,.5],colour:[.97,.57,.65]},
 };
 const hex=phase=>phase==='HCP'||phase==='OMEGA';
 const positive=value=>Number.isFinite(value)&&value>0;
 const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,s)=>a.map(v=>v*s);
 const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const unit=a=>mul(a,1/Math.hypot(...a));
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 function basis(phase,cell){return hex(phase)?[[cell[0],0,0],[-cell[0]/2,Math.sqrt(3)*cell[0]/2,0],[0,0,cell[2]]]:[[cell[0],0,0],[0,cell[1],0],[0,0,cell[2]]]}
 function cartesian(fractional,vectors){return [0,1,2].map(i=>fractional.reduce((sum,v,j)=>sum+v*vectors[j][i],0))}
 function referenceCell(phase,settings={}){
  const values=STRUCTURES[phase].cell.map((v,i)=>positive(settings[phase.toLowerCase()+'_'+'abc'[i]])?settings[phase.toLowerCase()+'_'+'abc'[i]]:v);
  if(phase!=='ORT')values[1]=values[0];
  if(!hex(phase)&&phase!=='ORT')values[2]=values[0];
  return values;
 }
 function describe(phase,model=null,settings={}){
  if(!STRUCTURES[phase])throw new Error('This crystal structure is not available.');
  const cell=referenceCell(phase,settings),sources=['reference','reference','reference'];
  const relative=model?.coordinate_units==='relative'||(!model?.coordinate_units&&model?.scale_mode==='relative_geometry');
  const axes=phase==='ORT'?[0,1,2]:hex(phase)?[0,2]:[0];
  if(model)for(const i of axes){
   const axis='abc'[i],unconstrained=model.axis_observable?.[i]===false||(i===2&&model.c_axis_visible===false);
   let value=model['fitted_'+axis+'_nm'];
   const independent=phase==='ORT'||(i===2&&['auto_hcp_ac','auto_hcp_ratio'].includes(model.scale_mode));
   if(!positive(value)&&(!independent||relative)){
    const scale=model['scale_'+axis]??(!independent?model.shared_scale:null);
    if(positive(scale))value=model['nominal_'+axis+'_nm']/scale;
   }
   if(!unconstrained&&positive(value)){cell[i]=value;sources[i]=relative?'relative':'fitted'}
   else{const nominal=model['nominal_'+axis+'_nm'];if(positive(nominal))cell[i]=nominal;sources[i]='unconstrained'}
  }
  if(phase!=='ORT'){cell[1]=cell[0];sources[1]=sources[0]}
  if(!hex(phase)&&phase!=='ORT'){cell[2]=cell[0];sources[2]=sources[0]}
  // Uncalibrated cells are shown in a-normalized units, never as measured nm.
  if(relative){const a=cell[0];for(let i=0;i<3;i++)cell[i]/=a}
  const zone=Array.isArray(model?.zone_3index)&&model.zone_3index.length===3&&model.zone_3index.every(Number.isFinite)&&Math.hypot(...model.zone_3index)>0?[...model.zone_3index]:null;
  return {phase,cell,sources,relative,axes,zone,candidate:Boolean(model),valid:model?.valid};
 }
 function geometry(description,repeats=2){
  if(!Number.isInteger(repeats)||repeats<1||repeats>4)throw new Error('Choose one to four cells per axis.');
  const {phase,cell}=description;
  if(cell.some(v=>!positive(v)))throw new Error('Cell dimensions must be positive.');
  const vectors=basis(phase,cell),atoms=[],edges=[],bonds=[];
  // Include the far faces once; fractional sites are unique within [0,n]^3.
  for(let x=0;x<=repeats;x++)for(let y=0;y<=repeats;y++)for(let z=0;z<=repeats;z++){
   for(const [site,f] of STRUCTURES[phase].basis.entries()){
    const fractional=add([x,y,z],f);
    if(fractional.every(v=>v<=repeats+1e-8))atoms.push({fractional,point:cartesian(fractional,vectors),site});
   }
   for(let axis=0;axis<3;axis++)if([x,y,z][axis]<repeats){
    const end=[x,y,z];end[axis]++;
    edges.push([cartesian([x,y,z],vectors),cartesian(end,vectors)]);
   }
  }
  // Near-neighbour distances are measured in the infinite lattice, not at the
  // clipped display boundary. Lines are geometric guides, not chemical bonds.
  const nearest=STRUCTURES[phase].basis.map(f=>{
   let distance=Infinity;
   for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)for(const g of STRUCTURES[phase].basis){
    const d=Math.hypot(...cartesian(sub(add([x,y,z],g),f),vectors));if(d>1e-8)distance=Math.min(distance,d);
   }
   return distance;
  });
  for(let i=0;i<atoms.length;i++)for(let j=i+1;j<atoms.length;j++){
   const a=atoms[i],b=atoms[j],delta=sub(a.fractional,b.fractional),distance=Math.hypot(...sub(a.point,b.point));
   const linked=phase==='ORT'?delta.filter(v=>Math.abs(v)>1e-8).length===1&&Math.abs(Math.hypot(...delta)-1)<1e-8:distance<=1.12*Math.max(nearest[a.site],nearest[b.site]);
   if(linked)bonds.push([a.point,b.point]);
  }
  const centre=cartesian([repeats/2,repeats/2,repeats/2],vectors),radius=Math.max(...atoms.map(a=>Math.hypot(...sub(a.point,centre))))+Math.min(...nearest)/2;
  return {atoms,edges,bonds,centre,radius,vectors,nearest:Math.min(...nearest)};
 }
 function zoneRotation(description,zone){
  const z=unit(cartesian(zone,basis(description.phase,description.cell)));
  const seed=Math.abs(z[2])<.9?[0,0,1]:[0,1,0],x=unit(cross(seed,z)),y=cross(z,x);
  return [x,y,z];
 }
 function fittedOrientation(description,model){
  if(!description.zone||!model?.predicted_nodes?.length)return null;
  const frame=zoneRotation(description,description.zone),vectors=basis(description.phase,description.cell),volume=dot(vectors[0],cross(vectors[1],vectors[2]));
  const reciprocal=[cross(vectors[1],vectors[2]),cross(vectors[2],vectors[0]),cross(vectors[0],vectors[1])].map(v=>mul(v,1/volume));
  const pairs=model.predicted_nodes.filter(n=>n.hkl?.length===3&&n.hkl.every(Number.isFinite)&&n.q?.length===2&&n.q.every(Number.isFinite)).map(n=>{
   const g=cartesian(n.hkl,reciprocal);return {x:dot(frame[0],g),y:dot(frame[1],g),target:n.q,g};
  });
  // Need two non-collinear predictions. The fitted q coordinates include
  // template mirrors, in-plane rotation and metric refinement; angle alone
  // would miss mirror conventions and parent-linked variant orientations.
  let xx=0,yy=0,xy=0;
  for(const p of pairs){xx+=p.x*p.x;yy+=p.y*p.y;xy+=p.x*p.y}
  if(xx*yy-xy*xy<1e-10*(xx+yy)**2)return null;
  const candidates=[1,-1].map(hand=>{
   let a=0,b=0;for(const {x,y,target:[u,v]}of pairs){a+=x*u+hand*y*v;b+=x*v-hand*y*u}
   const length=Math.hypot(a,b),c=a/length,s=b/length;
   const matrix=[add(mul(frame[0],c),mul(frame[1],-hand*s)),add(mul(frame[0],s),mul(frame[1],hand*c)),mul(frame[2],hand)];
   const predicted=pairs.map(p=>matrix.slice(0,2).map(row=>dot(row,p.g)));
   const norm=predicted.reduce((sum,p)=>sum+dot(p,p),0),scale=predicted.reduce((sum,p,i)=>sum+dot(p,pairs[i].target),0)/norm;
   const error=Math.sqrt(predicted.reduce((sum,p,i)=>sum+p.reduce((n,v,j)=>n+(v*scale-pairs[i].target[j])**2,0),0)/pairs.reduce((sum,p)=>sum+dot(p.target,p.target),0));
   return {matrix,scale,error};
  }).filter(c=>Number.isFinite(c.error)&&c.scale>0).sort((a,b)=>a.error-b.error);
  const best=candidates[0];
  // Reject incompatible/stale metrics rather than claiming registration. An
  // uncalibrated fit permits a uniform scale; calibrated cells must agree too.
  return best&&best.error<.002&&(description.relative||Math.abs(best.scale-1)<.002)?best:null;
 }
 function nearestZone(description,matrix,maxIndex=3,extraZones=[]){
  const vectors=basis(description.phase,description.cell),gcd=(a,b)=>b?gcd(b,a%b):a;let best=null;
  const zones=[];
  for(let u=-maxIndex;u<=maxIndex;u++)for(let v=-maxIndex;v<=maxIndex;v++)for(let w=-maxIndex;w<=maxIndex;w++){const zone=[u,v,w];if(zone.reduce((g,n)=>gcd(g,Math.abs(n)),0)===1)zones.push(zone)}
  for(const zone of [...zones,...extraZones.filter(z=>Array.isArray(z)&&z.length===3&&z.every(Number.isFinite)&&Math.hypot(...z)>0).flatMap(z=>[z,mul(z,-1)])]){
   const direction=unit(cartesian(zone,vectors)),cosine=dot(direction,matrix[2]),complexity=zone.reduce((s,n)=>s+Math.abs(n),0);
   if(!best||cosine>best.cosine+1e-12||(Math.abs(cosine-best.cosine)<1e-12&&complexity<best.complexity))best={zone,direction,cosine,complexity};
  }
  return alignZone(description,matrix,best.zone);
 }
 function alignZone(description,matrix,zone){
  const direction=unit(cartesian(zone,basis(description.phase,description.cell)));
  return {zone,matrix:transportFrame(matrix,direction),angle:Math.acos(clamp(dot(matrix[2],direction),-1,1))*180/Math.PI};
 }
 function transportFrame(matrix,direction){
  const axis=cross(matrix[2],direction),s=Math.hypot(...axis),c=clamp(dot(matrix[2],direction),-1,1);
  // Minimal beam-direction rotation retains screen roll. For opposite zones,
  // use the current screen X axis to choose a stable half-turn.
  const k=s>1e-12?mul(axis,1/s):matrix[0];
  return c>1-1e-14?matrix.map(row=>[...row]):matrix.map(row=>add(add(mul(row,c),mul(cross(k,row),s)),mul(k,dot(k,row)*(1-c))));
 }
 function viewRotation(description,matrix,model,alignment,zone){
  const reference=transportFrame(alignment?.matrix||zoneRotation(description,zone),matrix[2]),offset=alignment&&Number.isFinite(model?.rotation_deg)?model.rotation_deg:0;
  const degrees=offset+Math.atan2(dot(matrix[1],reference[0]),dot(matrix[0],reference[0]))*180/Math.PI;
  return (degrees%360+360)%360;
 }
 function realignZone(description,matrix,zone){
  const vectors=basis(description.phase,description.cell),volume=dot(vectors[0],cross(vectors[1],vectors[2])),reciprocal=[cross(vectors[1],vectors[2]),cross(vectors[2],vectors[0]),cross(vectors[0],vectors[1])].map(v=>mul(v,1/volume));
  const candidates=[[-zone[1],zone[0],0],[-zone[2],0,zone[0]],[0,-zone[2],zone[1]]];
  for(let h=-3;h<=3;h++)for(let k=-3;k<=3;k++)for(let l=-3;l<=3;l++)if(h*zone[0]+k*zone[1]+l*zone[2]===0)candidates.push([h,k,l]);
  const gcd=(a,b)=>b?gcd(b,a%b):a;let best=null;
  for(const indices of candidates){
   const divisor=indices.reduce((g,n)=>gcd(g,Math.abs(n)),0);if(!divisor)continue;
   const hkl=indices.map(n=>n/divisor),g=cartesian(hkl,reciprocal),length=Math.hypot(...g),angle=Math.atan2(dot(matrix[1],g),dot(matrix[0],g)),roll=Math.round(angle/(Math.PI/2))*Math.PI/2-angle;
   if(!best||length<best.length-1e-9||(Math.abs(length-best.length)<1e-9&&Math.abs(roll)<Math.abs(best.roll)))best={hkl,length,roll};
  }
  const c=Math.cos(best.roll),s=Math.sin(best.roll);
  return {zone,hkl:best.hkl,angle:Math.abs(best.roll)*180/Math.PI,matrix:[sub(mul(matrix[0],c),mul(matrix[1],s)),add(mul(matrix[0],s),mul(matrix[1],c)),[...matrix[2]]]};
 }
 function interpolateSnap(from,to,fraction){
  // Spherical interpolation of the full orientation also handles the second
  // in-plane realignment and a 180-degree change to the opposite zone.
  if(fraction<=0)return from.map(row=>[...row]);if(fraction>=1)return to.map(row=>[...row]);
  const quaternion=m=>{
   const trace=m[0][0]+m[1][1]+m[2][2];let q;
   if(trace>0){const s=2*Math.sqrt(trace+1);q=[s/4,(m[2][1]-m[1][2])/s,(m[0][2]-m[2][0])/s,(m[1][0]-m[0][1])/s]}
   else{const i=m[0][0]>m[1][1]?(m[0][0]>m[2][2]?0:2):(m[1][1]>m[2][2]?1:2),j=(i+1)%3,k=(j+1)%3,s=2*Math.sqrt(1+m[i][i]-m[j][j]-m[k][k]);q=[(m[k][j]-m[j][k])/s,0,0,0];q[i+1]=s/4;q[j+1]=(m[j][i]+m[i][j])/s;q[k+1]=(m[k][i]+m[i][k])/s}
   return unit(q);
  };
  const a=quaternion(from);let b=quaternion(to),cosine=dot(a,b);if(cosine<0){b=mul(b,-1);cosine=-cosine}
  const angle=Math.acos(clamp(cosine,-1,1)),s=Math.sin(angle),q=unit(angle<1e-6?add(mul(a,1-fraction),mul(b,fraction)):add(mul(a,Math.sin((1-fraction)*angle)/s),mul(b,Math.sin(fraction*angle)/s))),[w,x,y,z]=q;
  return [[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]];
 }
 function rotate(matrix,dx,dy){
  const c=Math.cos(dx),s=Math.sin(dx),d=Math.cos(dy),t=Math.sin(dy);
  const x=add(mul(matrix[0],c),mul(matrix[2],s)),z=sub(mul(matrix[2],c),mul(matrix[0],s));
  return [x,sub(mul(matrix[1],d),mul(z,t)),add(mul(matrix[1],t),mul(z,d))];
 }
 const initialRotation=()=>rotate([[1,0,0],[0,1,0],[0,0,1]],-.62,.48);
 function projectZoneGuide(matrix,axis,width,height,zoom=1){
  // Project a line through the model centre with the renderer's orthographic
  // scale. Its 3D half-length is 0.95 of the model radius, which cancels here.
  const half=.85*.95*zoom*Math.min(width,height)/2,dx=half*dot(matrix[0],axis),dy=-half*dot(matrix[1],axis),length=2*Math.hypot(dx,dy);
  return {x1:width/2-dx,y1:height/2-dy,x2:width/2+dx,y2:height/2+dy,length,opacity:Math.min(1,length/8)};
 }

 // Small native WebGL renderer: depth-tested sphere/cylinder surfaces give
 // correct occlusion in every orientation without a downloaded dependency.
 const colourListeners=new Set();
 function phaseColour(phase){
  const value=typeof document==='undefined'?'':document.documentElement?.style.getPropertyValue('--'+phase.toLowerCase()+'-color').trim();
  if(/^#[\da-f]{6}$/i.test(value))return [1,3,5].map(i=>parseInt(value.slice(i,i+2),16)/255);
  return [...STRUCTURES[phase].colour];
 }
 function refreshColours(){for(const refresh of colourListeners)refresh()}
 function renderer(canvas){
  const gl=canvas.getContext('webgl',{antialias:true,alpha:false});
  if(!gl)throw new Error('3D drawing is unavailable. Enable WebGL / hardware acceleration in your browser.');
  const shaders=[];
  function shader(type,source){const s=gl.createShader(type);shaders.push(s);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error('Could not start the 3D renderer.');return s}
  const program=gl.createProgram();
  gl.attachShader(program,shader(gl.VERTEX_SHADER,'attribute vec3 p;attribute vec3 n;attribute vec3 c;uniform mat3 r;uniform vec3 scale;varying vec3 normal;varying vec3 colour;void main(){gl_Position=vec4((r*p)*scale,1.0);normal=r*n;colour=c;}'));
  gl.attachShader(program,shader(gl.FRAGMENT_SHADER,'precision mediump float;varying vec3 normal;varying vec3 colour;void main(){vec3 n=normalize(normal);vec3 l=normalize(vec3(-0.4,0.6,1.0));float light=0.32+0.68*max(0.0,dot(n,l));float shine=pow(max(0.0,dot(reflect(-l,n),vec3(0.0,0.0,1.0))),32.0);gl_FragColor=vec4(colour*light+vec3(0.32)*shine,1.0);}'));
  gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Could not start the 3D renderer.');
  gl.useProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  for(const [i,key] of ['p','n','c'].entries()){const a=gl.getAttribLocation(program,key);gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,3,gl.FLOAT,false,36,i*12)}
  const rotation=gl.getUniformLocation(program,'r'),scale=gl.getUniformLocation(program,'scale');let count=0,radius=1;
  gl.enable(gl.DEPTH_TEST);gl.clearColor(.025,.043,.067,1);
  function upload(scene,style,showCell){
   const vertices=[],colour=phaseColour(scene.phase);
   function vertex(p,n,c){vertices.push(...sub(p,scene.centre),...n,...c)}
   function sphere(point,size){
    const slices=20,rings=12,normal=(i,j)=>{const a=i*Math.PI/rings,b=j*2*Math.PI/slices;return [Math.sin(a)*Math.cos(b),Math.sin(a)*Math.sin(b),Math.cos(a)]};
    for(let i=0;i<rings;i++)for(let j=0;j<slices;j++){
     const ns=[normal(i,j),normal(i+1,j),normal(i+1,j+1),normal(i,j+1)];
     for(const k of [0,1,2,0,2,3])vertex(add(point,mul(ns[k],size)),ns[k],colour);
    }
   }
   function cylinder(a,b,size,c){
    const axis=unit(sub(b,a)),seed=Math.abs(axis[2])<.9?[0,0,1]:[0,1,0],x=unit(cross(axis,seed)),y=cross(axis,x);
    const normal=i=>add(mul(x,Math.cos(i*Math.PI/5)),mul(y,Math.sin(i*Math.PI/5)));
    for(let i=0;i<10;i++){
     const n=normal(i),m=normal(i+1),ps=[add(a,mul(n,size)),add(b,mul(n,size)),add(b,mul(m,size)),add(a,mul(m,size))];
     for(const k of [0,1,2,0,2,3])vertex(ps[k],k<2?n:m,c);
    }
   }
   if(style!=='bubbles')for(const [a,b] of scene.bonds)cylinder(a,b,scene.nearest*(style==='wire'?.012:.045),[.52,.62,.73]);
   if(style!=='wire')for(const atom of scene.atoms)sphere(atom.point,scene.nearest*(style==='bubbles'?.5:.19));
   if(showCell)for(const [a,b] of scene.edges)cylinder(a,b,scene.nearest*.009,[.35,.45,.56]);
   const axisColours=[[1,.38,.38],[.40,.87,.56],[.43,.68,1]];
   scene.vectors.forEach((v,i)=>cylinder([0,0,0],v,scene.nearest*.025,axisColours[i]));
   count=vertices.length/9;radius=scene.radius;
   gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);
  }
  function draw(matrix,zoom){
   const box=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2),w=Math.max(1,Math.round(box.width*dpr)),h=Math.max(1,Math.round(box.height*dpr));
   if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
   gl.viewport(0,0,w,h);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
   gl.uniformMatrix3fv(rotation,false,new Float32Array([0,1,2].flatMap(i=>matrix.map(row=>row[i]))));
   const fit=.85*zoom/radius;gl.uniform3f(scale,fit*Math.min(1,h/w),fit*Math.min(1,w/h),-.8/radius);
   gl.drawArrays(gl.TRIANGLES,0,count);
  }
  return {upload,draw,destroy(){gl.deleteBuffer(buffer);gl.deleteProgram(program);shaders.forEach(s=>gl.deleteShader(s));gl.getExtension('WEBGL_lose_context')?.loseContext()}};
 }
 function currentReferences(){
  const settings={};for(const phase of Object.keys(STRUCTURES))for(const axis of 'abc'){
   const input=document.getElementById(phase.toLowerCase()+'-'+axis),value=Number(input?.value);if(positive(value))settings[phase.toLowerCase()+'_'+axis]=value;
  }return settings;
 }
 const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n};
 function entryLabel({phase,model}){return (model?'Candidate · ':'Reference · ')+STRUCTURES[phase].name+(model?.zone_3index?' ['+model.zone_3index.join(' ')+']':'')+(Number.isFinite(model?.rotation_deg)?' · '+(model.linked_parent_rotation?'parent ':'')+model.rotation_deg.toFixed(1)+'°':'')+(model?.display_label?' · '+model.display_label:'')}
 const STANDARD_ZONES=[[0,0,1],[1,0,0],[1,1,0],[1,-1,0],[1,1,1],[1,1,2],[1,0,1]];
 let snapEnabled=true,realignEnabled=false,viewerHelpId=0;
 function open({models=[],settings=currentReferences(),anchor=document.activeElement,host=null,reciprocalView=null}={}){
  const diffraction=window.KinematicDiffraction;
  let entries=models.filter(m=>STRUCTURES[m.phase]).map(m=>({model:structuredClone(m),phase:m.phase}));
  for(const phase of Object.keys(STRUCTURES))entries.push({phase,model:null});
  const dialog=make(host?'section':'dialog',null,'crystal-dialog'+(host?' crystal-embedded':''));dialog.setAttribute('aria-label','Crystal structures and diffraction');
  const head=make('div',null,'panel-head'),heading=make('h2','Crystal structures & diffraction'),close=make('button','×');close.type='button';close.setAttribute('aria-label','Close crystal structures');close.onclick=()=>dialog.close();head.append(heading,close);
  const button=(text,label,action)=>{const b=make('button',text);b.type='button';b.setAttribute('aria-label',label);b.onclick=action;return b};
  const select=(host,text,options)=>{const label=make('label',text),input=make('select');input.setAttribute('aria-label',text);for(const [value,name] of options)input.append(new Option(name,value));label.append(input);host.append(label);return input};
  const number=(host,text,value,min,max,step)=>{const label=make('label',text),input=make('input');input.setAttribute('aria-label',text);Object.assign(input,{type:'number',value:String(value),min:String(min),max:String(max),step:String(step)});label.append(input);host.append(label);return input};
  const check=(host,text,checked=true)=>{const label=make('label',null,'check'),input=make('input');input.type='checkbox';input.checked=checked;label.append(input,document.createTextNode(text));host.append(label);return input};
  function help(host,label,text){const wrap=make('span',null,'settings-help'),info=button('ⓘ',label,()=>{}),popup=make('span',text,'settings-help-popup');info.className='settings-help-button';popup.setAttribute('role','tooltip');wrap.append(info,popup);host.append(wrap)}
  const controls=make('div',null,'crystal-controls');
  const structure=select(controls,'Structure',entries.map((entry,i)=>[i,entryLabel(entry)]));
  const style=select(controls,'Model',[['bubbles','Bubbles'],['ball-stick','Ball and stick'],['wire','Wireframe']]);style.value='ball-stick';
  const repeat=select(controls,'Cells',[[1,'1 × 1 × 1'],[2,'2 × 2 × 2'],[3,'3 × 3 × 3'],[4,'4 × 4 × 4']]);repeat.value='2';
  const cell=check(controls,'Unit cells');
  help(controls,'About crystal models','Ideal monatomic models of the matcher’s five structures. Sphere sizes are illustrative; sticks join near neighbours (ORT joins axial neighbours), not identified chemical bonds. Hexagonal cells use a = b and γ = 120°. Atom colours follow the app’s configured phase colours and identify structures, not chemical species. Unconstrained dimensions use reference values. Fitted views recover the in-plane orientation and handedness from stored reciprocal predictions. An unavailable or inconsistent orientation is identified explicitly. Displayed cell repeats do not set the diffraction thickness.');
  const orientation=make('div',null,'crystal-orientation');
  const view=select(orientation,'Zone axis',[['zone','Fitted orientation'],['free','Free rotation'],['tour','Tour standard zones'],...STANDARD_ZONES.map(zone=>[zone.join(' '),'['+zone.join(' ').replaceAll('-','−')+']']),['custom','Custom…']]);
  const customWrap=make('label','Indices','crystal-custom-zone'),customRow=make('span'),custom=make('input');custom.type='text';custom.value='1 1 0';custom.setAttribute('aria-label','Custom zone indices');customRow.append(custom,button('Apply','Apply custom zone',()=>orient()));customWrap.append(customRow);orientation.append(customWrap);customWrap.hidden=true;
  const tilts=['X','Y'].map(axis=>{const input=number(orientation,'Tilt '+axis+', °',0,-15,15,.1);input.setAttribute('aria-label','Tilt '+axis+' degrees');input.parentElement.classList.add('crystal-tilt');return {input}});
  const snapControls=make('div',null,'crystal-snap-controls');
  const snap=check(snapControls,'Snap',snapEnabled);snap.setAttribute('aria-label','Snap to nearest zone after rotating');
  const realign=check(snapControls,'Align',realignEnabled);realign.setAttribute('aria-label','Realign after snap');
  const snapTooltip=make('div','Snap rotates to the nearest zone after a drag or tilt. Align adds an in-plane rotation to line up an axis with the window. Both apply to reference structures; candidates use Fitted orientation or Free rotation.','crystal-snap-tooltip');snapTooltip.id='crystal-snap-help-'+(++viewerHelpId);snapTooltip.setAttribute('role','tooltip');snapTooltip.hidden=true;
  const snapHelp=button('ⓘ','About Snap and Align',()=>showSnapHelp());snapHelp.className='settings-help-button';snapHelp.setAttribute('aria-describedby',snapTooltip.id);snapHelp.setAttribute('aria-expanded','false');snapControls.append(snapHelp);
  function showSnapHelp(){
   snapTooltip.hidden=false;snapHelp.setAttribute('aria-expanded','true');const anchor=snapHelp.getBoundingClientRect(),box=snapTooltip.getBoundingClientRect();
   snapTooltip.style.left=clamp(anchor.right-box.width,8,Math.max(8,innerWidth-box.width-8))+'px';snapTooltip.style.top=clamp(anchor.top-box.height-8,8,Math.max(8,innerHeight-box.height-8))+'px';
  }
  function hideSnapHelp(){snapTooltip.hidden=true;snapHelp.setAttribute('aria-expanded','false')}
  snapHelp.onmouseenter=snapHelp.onfocus=showSnapHelp;snapHelp.onmouseleave=()=>{if(document.activeElement!==snapHelp)hideSnapHelp()};snapHelp.onblur=hideSnapHelp;
  const snapButton=button('Snap now','Snap to nearest zone axis',()=>snapNow());
  const snapStatus=make('span',null,'hint crystal-snap-status');snapStatus.setAttribute('role','status');
  help(orientation,'About zone axes and tilts','Use three-index [u v w] directions. Hexagonal custom entries also accept [u v t w], with u + v + t = 0. Tilt X then Tilt Y rotates the crystal about the screen axes relative to the selected zone. The beam travels toward you, along screen +Z. Dragging changes the preview orientation and resets tilt offsets. Both panes share one orientation. For reference structures, Snap to zone smoothly rotates after a drag or a committed numeric tilt, to the nearest primitive direction with indices from −3 to 3, also retaining the selected/fitted zone. Selecting a zone rotates smoothly even with snapping off. Tour standard zones loops through the listed standard axes with a 1.5-second pause at each one, moving both views together. Choose another zone, drag, tilt or reset to stop the tour. Changing the structure or receiving a new region fit also stops it. The tour previews candidate orientations without changing the fit. Realign after snap adds a separate in-plane rotation, making a short reciprocal-lattice direction perpendicular to the zone horizontal or vertical. It preserves the zone but can change the detector alignment. A new drag or tilt interrupts either rotation. Reduced-motion preferences disable animation. Snap now also works after keyboard rotation.');
  const currentZone=make('output',null,'crystal-current-zone');currentZone.setAttribute('aria-label','Current zone axis');
  const currentRotation=make('output',null,'crystal-current-rotation');currentRotation.setAttribute('aria-label','Current in-plane rotation');
  const zonePrefix=make('span',null,'crystal-readout-label'),zoneValue=make('span'),rotationPrefix=make('span',null,'crystal-readout-label'),rotationValue=make('span');currentZone.append(zonePrefix,zoneValue);currentRotation.append(rotationPrefix,rotationValue);
  const orientationReadout=make('div',null,'crystal-orientation-readout');orientationReadout.append(currentZone,currentRotation);
  help(orientation,'About current rotation','At the fitted view, Rotation matches the solution list. While exploring, it follows in-plane rotation relative to that fitted view; off-zone rotations are a preview, not a new fit. Reference models use the chosen zone’s default orientation as zero. Linked omega variants report the parent’s fitted angle separately. In Fitted orientation, candidate drags return to the fit on release. The dashed line marks the fitted zone axis while off-axis and collapses as the view returns. Choosing Free rotation keeps the current pose and lets you rotate without returning. Return to fit or selecting Fitted orientation restores that behaviour. Other zone choices and the tour are exploratory views. Snap to zone and Realign after snap apply only to reference structures.');
  const orientationError=make('p',null,'crystal-input-error');orientationError.hidden=true;orientationError.setAttribute('role','alert');
  const description=make('p',null,'crystal-description'),dimensions=make('p',null,'crystal-dimensions');
  const panes=make('div',null,'crystal-panes'),modelPane=make('section'),diffPane=make('section');modelPane.append(make('h3','Atomic model'));diffPane.append(make('h3','Kinematic diffraction'));
  const stage=make('div',null,'crystal-stage'),canvas=make('canvas'),error=make('p',null,'crystal-error');
  canvas.tabIndex=0;canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Rotatable crystal model. Arrow keys rotate; plus and minus zoom; Home resets.');error.setAttribute('role','alert');error.hidden=true;stage.append(canvas,error);
  const svg=tag=>document.createElementNS('http://www.w3.org/2000/svg',tag),triad=svg('svg');triad.setAttribute('viewBox','0 0 110 110');triad.setAttribute('aria-hidden','true');triad.classList.add('crystal-triad');
  const axisMarks=[...'abc'].map(axis=>{const line=svg('line'),text=svg('text');line.classList.add('crystal-axis-'+axis);text.classList.add('crystal-axis-'+axis);text.textContent=axis;triad.append(line,text);return {line,text}});stage.append(triad);
  const zoneGuide=svg('svg'),zoneGuideLine=svg('line');zoneGuide.classList.add('crystal-zone-guide');zoneGuide.setAttribute('aria-hidden','true');zoneGuide.setAttribute('hidden','');zoneGuide.append(zoneGuideLine);stage.append(zoneGuide);
  const diffStage=make('div',null,'crystal-stage crystal-diffraction-stage'),diffCanvas=make('canvas'),diffError=make('p',null,'crystal-error');diffCanvas.tabIndex=0;diffCanvas.setAttribute('role','img');diffCanvas.setAttribute('aria-label','Kinematic diffraction preview');diffError.hidden=true;diffError.setAttribute('role','alert');diffStage.append(diffCanvas,diffError);
  const readout=make('p','Hover or tap a spot · Arrow keys inspect reflections','crystal-spot-readout');readout.setAttribute('role','status');
  const diffStatus=make('p',null,'crystal-diffraction-status');diffStatus.setAttribute('role','status');
  const previewControls=make('div',null,'crystal-preview-controls');
  const voltage=number(previewControls,'Voltage, kV',200,20,1000,1),thickness=number(previewControls,'Thickness, nm',10,1,200,.1),gMax=number(previewControls,'Max g, nm⁻¹',clamp(Number(settings.g_max)||10,2,30),2,30,.1);
  const assumedA=number(previewControls,'Assumed a, nm',.3,.05,2,.00001),labels=check(previewControls,'hkl');
  const minimum=select(previewControls,'Show ≥',[[.01,'1%'],[.001,'0.1%'],[.0001,'0.01%']]);minimum.value='0.001';
  help(previewControls,'About kinematic diffraction','Voltage and beam-path thickness are assumed preview parameters, not measured specimen properties. Relative intensity is |Σ exp(2πi h·r)/N|² × sinc²(π t s), with equal point scatterers and longitudinal excitation error s to the curved Ewald sphere. No elemental scattering-factor falloff, absorption, thermal motion, multiple scattering or microscope transfer function is included. Brightness uses a fixed fourth-root display curve; it is not renormalized after tilting. Show ≥ is a display threshold relative to full constructive basis intensity. Max g limits the full reciprocal-vector magnitude. The centre cross marks the direct beam without simulating its intensity.');
  const assumptions=make('p',null,'crystal-assumptions');
  const foot=make('div',null,'crystal-footer'),hint=make('span','Drag to rotate both views · Scroll / pinch to zoom model','hint'),status=make('span',null,'hint');status.setAttribute('role','status');
  let drawing=null,plot=null,scene=null,detail=null,alignment=null,activeZone=null,snapAnimation=null,followCandidate=false,touring=false,tourTimer=0,tourIndex=0,matrix=initialRotation(),baseMatrix=matrix,zoom=1,frame=0,closed=false,dirty=true,library=null,libraryKey='',pattern=null;
  const paint=()=>{if(!frame&&!closed)frame=requestAnimationFrame(time=>{
   frame=0;
   if(snapAnimation){
    const progress=clamp((time-snapAnimation.start)/snapAnimation.duration,0,1),ease=progress*progress*(3-2*progress);matrix=interpolateSnap(snapAnimation.from,snapAnimation.target.matrix,ease);dirty=true;
    if(progress>=1){const animation=snapAnimation;snapAnimation=null;matrix=animation.target.matrix;animation.complete()}
   }
   if(detail){
    const nearest=nearestZone(detail,matrix,3,[detail.zone,activeZone]),entry=entries[Number(structure.value)],atFit=alignment&&matrix.every((row,i)=>row.every((v,j)=>Math.abs(v-alignment.matrix[i][j])<1e-7));
    zonePrefix.textContent=nearest.angle<.01?'Current zone ':'Nearest zone ';zoneValue.textContent='['+nearest.zone.join(' ')+']'+(nearest.angle<.01?'':' · '+nearest.angle.toFixed(2)+'° off zone');
    const parent=entry.model?.linked_parent_rotation&&Number.isFinite(entry.model.rotation_deg),angle=viewRotation(detail,matrix,parent?null:entry.model,parent?null:alignment,activeZone||nearest.zone);
    rotationPrefix.textContent=parent?'View rotation ':'Rotation ';rotationValue.textContent=angle.toFixed(1)+'°'+(parent?' · parent '+entry.model.rotation_deg.toFixed(1)+'°':detail.candidate&&!atFit?' · preview':'');
    currentZone.title=currentZone.textContent;currentRotation.title=currentRotation.textContent;
    structure.title=structure.selectedOptions[0]?.textContent||'';view.title=view.selectedOptions[0]?.textContent||'';snapButton.title=snapButton.getAttribute('aria-label');
   }
   if(drawing&&scene)drawing.draw(matrix,zoom);
   zoneGuide.toggleAttribute('hidden',true);
   if(followCandidate&&alignment&&scene){
    const box=canvas.getBoundingClientRect(),guide=projectZoneGuide(matrix,alignment.matrix[2],box.width,box.height,zoom);
    if(guide.length>.5){zoneGuide.setAttribute('viewBox',`0 0 ${box.width} ${box.height}`);for(const key of ['x1','y1','x2','y2'])zoneGuideLine.setAttribute(key,guide[key]);zoneGuideLine.setAttribute('opacity',guide.opacity);zoneGuide.removeAttribute('hidden')}
   }
   snapStatus.title=snapStatus.textContent;if(!snapTooltip.hidden)showSnapHelp();
   if(scene)scene.vectors.forEach((v,i)=>{const direction=unit(v),x=dot(matrix[0],direction),y=-dot(matrix[1],direction),{line,text}=axisMarks[i];line.setAttribute('x1',50);line.setAttribute('y1',60);line.setAttribute('x2',50+30*x);line.setAttribute('y2',60+30*y);text.setAttribute('x',50+41*x);text.setAttribute('y',60+41*y)});
   drawDiffraction();if(snapAnimation)paint();
  })};
  function drawDiffraction(){
   if(!detail||!plot)return;
   try{
    const displayScale=reciprocalView?.units==='relative'&&detail.relative&&alignment?Number(assumedA.value)*alignment.scale:1;
    if(reciprocalView?.units==='relative'&&(!detail.relative||!alignment))throw new Error('This structure has no fitted scale for the relative FFT.');
    if(dirty){
     for(const input of [voltage,thickness,gMax,...(detail.relative?[assumedA]:[])])if(!input.checkValidity()||!positive(Number(input.value)))throw new Error('Enter a valid '+input.parentElement.firstChild.textContent.toLowerCase()+'.');
     const physicalCell=detail.relative?detail.cell.map(v=>v*Number(assumedA.value)):detail.cell,physicalLimit=Number(gMax.value)/displayScale,key=JSON.stringify([detail.phase,physicalCell,physicalLimit]);
     if(key!==libraryKey){library=diffraction.reflectionLibrary(basis(detail.phase,physicalCell),STRUCTURES[detail.phase].basis,physicalLimit);libraryKey=key}
     pattern=diffraction.simulate(library,matrix,{voltageKV:Number(voltage.value),thickness:Number(thickness.value)});dirty=false;
    }
    plot.draw(pattern,{labels:labels.checked,minimum:Number(minimum.value),viewport:reciprocalView,displayScale});diffError.hidden=true;
    diffStatus.textContent=plot.count()?`${plot.count()} reflections · λ ${(pattern.lambda*1000).toFixed(3)} pm`:'No reflections above the display threshold. Try another tilt or a lower threshold.';
    const fittedBase=alignment&&baseMatrix.every((row,i)=>row.every((v,j)=>Math.abs(v-alignment.matrix[i][j])<1e-7));
    assumptions.textContent='Equal-atom approximation · assumed voltage / thickness'+(detail.relative?` · uncalibrated: assumed a = ${Number(assumedA.value).toFixed(4)} nm`:detail.sources.includes('unconstrained')?' · includes unconstrained reference dimensions':'')+(reciprocalView?' · scale / fitting radius linked to FFT':'')+' · '+(fittedBase&&!snapAnimation?(tilts.some(({input})=>Number(input.value)!==0)?'tilted from fitted orientation':'aligned to fitted spot geometry'):detail.candidate&&!alignment?'fitted detector orientation unavailable':'preview orientation');
   }catch(e){pattern=null;dirty=true;plot.clear();diffStatus.textContent='Preview unavailable';diffError.textContent=e.message;diffError.hidden=false}
  }
  const setZoom=value=>{zoom=clamp(value,.4,3.5);paint()};
  function setReciprocalView(view){
   const changed=JSON.stringify(reciprocalView)!==JSON.stringify(view);reciprocalView=view?structuredClone(view):null;
   if(view)gMax.value=view.outerRadius;gMax.readOnly=Boolean(view);
   const label=view?'Outer fitting radius, '+(view.units==='relative'?'rel.':'nm⁻¹'):'Max g, nm⁻¹';gMax.parentElement.firstChild.textContent=label;gMax.setAttribute('aria-label',label);gMax.title=view?'Linked to the FFT. Adjust the outer fitting limit or drag its handle in the FFT pane.':'';
   if(changed){dirty=true;paint()}
  }
  function resetTilts(){tilts.forEach(({input})=>{input.value='0'})}
  function setRotationMode(choice){
   followCandidate=Boolean(detail.candidate&&choice==='zone');
   hint.textContent=followCandidate?'Drag to explore · Release to return to fit · Scroll / pinch to zoom':'Drag to rotate both views · Scroll / pinch to zoom model';
  }
  function applyTilt(){
   const values=tilts.map(({input})=>input.value);cancelSnap();tilts.forEach(({input},i)=>{input.value=values[i]});
   if(tilts.some(({input})=>!input.checkValidity()||input.value==='')){orientationError.textContent='Tilt must be between −15° and 15°.';orientationError.hidden=false;return}
   orientationError.hidden=true;snapStatus.textContent='';matrix=diffraction.tilt(baseMatrix,...tilts.map(({input})=>Number(input.value)));dirty=true;paint();
  }
  function orient(animate=true){
   const choice=view.value;cancelSnap();view.value=choice;setRotationMode(choice);
   customWrap.hidden=view.value!=='custom';
   try{
    if(choice==='free'){baseMatrix=matrix;resetTilts();orientationError.hidden=true;snapStatus.textContent='';dirty=true;paint();return}
    if(choice==='tour'){touring=true;tourIndex=0;orientationError.hidden=true;resetTilts();tourNext();return}
    const zone=view.value==='zone'?detail.zone:view.value==='custom'?diffraction.parseZone(custom.value,hex(detail.phase)):view.value==='free'?null:diffraction.parseZone(view.value);
    const fitted=choice==='zone'&&alignment,target=fitted?{...nearestZone(detail,alignment.matrix,3,[zone]),matrix:alignment.matrix.map(row=>[...row])}:zone?(animate?alignZone(detail,matrix,zone):{zone,matrix:zoneRotation(detail,zone)}):{zone:null,matrix:initialRotation()};
    activeZone=target.zone;resetTilts();orientationError.hidden=true;snapStatus.textContent='';
    if(animate&&zone)animateTo(target,()=>settleSnap(target,choice),'Rotating to ['+target.zone.join(' ')+']…');
    else{baseMatrix=matrix=target.matrix;zoom=1;dirty=true;paint()}
   }catch(e){orientationError.textContent=e.message;orientationError.hidden=false}
  }
  function tourNext(){
   tourTimer=0;if(!touring||closed)return;
   const zone=STANDARD_ZONES[tourIndex];tourIndex=(tourIndex+1)%STANDARD_ZONES.length;
   const target=alignZone(detail,matrix,zone);activeZone=zone;view.value='tour';
   const hold=settled=>{
    if(!touring||closed)return;
    finishSnap(settled,'tour');snapStatus.textContent='Tour · ['+zone.join(' ')+']';
    tourTimer=setTimeout(tourNext,1500);
   };
   animateTo(target,()=>{
    if(realign.checked&&!detail.candidate){const aligned=realignZone(detail,matrix,zone);animateTo(aligned,()=>hold(aligned),'Tour · Realigning ['+zone.join(' ')+']…',1200)}
    else hold(target);
   },'Tour · Rotating to ['+zone.join(' ')+']…',1800);
  }
  function freeRotate(dx,dy){cancelSnap();matrix=rotate(matrix,dx,dy);baseMatrix=matrix;resetTilts();view.value=followCandidate?'zone':'free';customWrap.hidden=true;orientationError.hidden=true;snapStatus.textContent='';dirty=true;paint()}
  function cancelSnap(){const active=snapAnimation||touring;clearTimeout(tourTimer);tourTimer=0;touring=false;if(active){snapAnimation=null;baseMatrix=matrix;resetTilts();view.value=followCandidate?'zone':'free';customWrap.hidden=true;snapStatus.textContent=''}}
  function finishSnap(snapped,choice=null){
   const key=snapped.zone.join(' ');matrix=snapped.matrix;baseMatrix=matrix;activeZone=snapped.zone;resetTilts();custom.value=key;view.value=choice||([...view.options].some(option=>option.value===key)?key:'custom');customWrap.hidden=view.value!=='custom';orientationError.hidden=true;snapStatus.textContent='Snapped ['+key+']';dirty=true;
  }
  function animateTo(target,complete,message,duration=600){
   if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches||matrix.every((row,i)=>row.every((v,j)=>Math.abs(v-target.matrix[i][j])<1e-9))){matrix=target.matrix;complete();dirty=true}
   else{snapAnimation={from:matrix.map(row=>[...row]),target,start:performance.now(),duration,complete};snapStatus.textContent=message}
   paint();
  }
  function settleSnap(target,choice=null){
   finishSnap(target,choice);
   if(realign.checked&&!detail.candidate){const aligned=realignZone(detail,matrix,target.zone);animateTo(aligned,()=>finishSnap(aligned,choice),'Realigning ['+target.zone.join(' ')+']…')}
  }
  function snapNow(){
   if(detail.candidate){returnToCandidate(true);return}
   cancelSnap();const target=nearestZone(detail,matrix,3,[detail.zone,activeZone]);resetTilts();view.value='free';customWrap.hidden=true;
   animateTo(target,()=>settleSnap(target),'Snapping to ['+target.zone.join(' ')+']…');
  }
  function returnToCandidate(recenter=false){
   cancelSnap();setRotationMode(detail.zone?'zone':'free');view.value=detail.zone?'zone':'free';if(recenter)zoom=1;const targetMatrix=alignment?.matrix||(detail.zone?zoneRotation(detail,detail.zone):initialRotation()),target={...nearestZone(detail,targetMatrix,3,[detail.zone]),matrix:targetMatrix.map(row=>[...row])};
   animateTo(target,()=>{finishSnap(target,detail.zone?'zone':'free');snapStatus.textContent=alignment?'':'Initial candidate view · detector orientation unavailable'},'Returning to candidate…',900);
  }
  function resetView(animate=true){zoom=1;view.value=detail.zone?'zone':'0 0 1';orient(animate)}
  foot.append(hint,status);
  function rebuild(reset=false){
   try{
    if(reset)cancelSnap();const entry=entries[Number(structure.value)];detail=describe(entry.phase,entry.model,settings);alignment=fittedOrientation(detail,entry.model);
    view.querySelector('[value="zone"]').disabled=!detail.zone;view.querySelector('[value="zone"]').textContent=alignment?'Fitted orientation':'Fitted zone';
    realign.disabled=detail.candidate;realign.checked=!detail.candidate&&realignEnabled;realign.parentElement.title=detail.candidate?'Candidate views preserve their fitted detector alignment. Choose a reference structure to enable realignment.':'After reaching the zone, rotate in-plane to align a reciprocal-lattice direction with the window.';
    snap.disabled=detail.candidate;snap.checked=!detail.candidate&&snapEnabled;snap.parentElement.title=detail.candidate?'Fitted orientation returns after dragging; choose Free rotation to keep the explored view. Zone snapping applies to reference structures.':'Smoothly rotate to the nearest zone after a drag or committed tilt.';
    for(const input of [snap,realign])input.setAttribute('aria-description',input.parentElement.title);
    snapButton.textContent=detail.candidate?'Return to fit':'Snap now';snapButton.setAttribute('aria-label',detail.candidate?'Return to candidate orientation':'Snap to nearest zone axis');
    assumedA.parentElement.hidden=!detail.relative;
    if(reset){assumedA.value=referenceCell(detail.phase,settings)[0];resetView(false)}
    scene={...geometry(detail,Number(repeat.value)),phase:entry.phase};
    const definition=STRUCTURES[entry.phase];description.textContent=definition.description+' · '+definition.basis.length+' site'+(definition.basis.length===1?'':'s')+' per cell'+(detail.candidate?' · '+(detail.valid===false?'Below-screen candidate':'Fitted candidate'):' · Reference model');
    dimensions.textContent=(detail.relative?'Relative geometry · a = 1 · absolute scale unavailable · ':'')+detail.axes.map(i=>'abc'[i]+' '+detail.cell[i].toFixed(4)+(detail.relative?'':' nm')+(detail.sources[i]==='unconstrained'?' (reference; unconstrained)':detail.sources[i]==='reference'?' (reference)':'')).join(' · ');
    status.textContent=scene.atoms.length+' displayed sites';status.title='Includes boundary copies shared with neighbouring cells.';canvas.setAttribute('aria-description',description.textContent+'. '+dimensions.textContent);
    drawing?.upload(scene,style.value,cell.checked);dirty=true;paint();
   }catch(e){error.textContent=e.message;error.hidden=false}
  }
  structure.onchange=()=>rebuild(true);repeat.onchange=()=>rebuild();style.onchange=()=>rebuild();cell.onchange=()=>rebuild();view.onchange=()=>{orient();if(view.value==='custom'){settingsReturn=view;settingsDialog.showModal();custom.focus();custom.select()}};
  custom.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();orient()}};
  tilts.forEach(({input})=>{input.oninput=applyTilt;input.onchange=()=>{if(snap.checked&&tilts.every(({input})=>input.value!==''&&input.checkValidity()))snapNow()}});
  for(const input of [voltage,thickness,gMax,assumedA])input.oninput=()=>{dirty=true;paint()};
  labels.onchange=minimum.onchange=paint;
  snap.onchange=()=>{snapEnabled=snap.checked;if(!snap.checked){cancelSnap();paint()}};
  realign.onchange=()=>{realignEnabled=realign.checked;if(!realign.checked&&snapAnimation&&snapStatus.textContent.startsWith('Realigning')){cancelSnap();paint()}};
  const pointers=new Map();let gestureRotated=false,pinched=false;
  canvas.onpointerdown=e=>{if(e.button!==0&&e.pointerType!=='touch')return;cancelSnap();canvas.focus({preventScroll:true});canvas.setPointerCapture(e.pointerId);if(!pointers.size){gestureRotated=false;pinched=false}pointers.set(e.pointerId,[e.clientX,e.clientY]);if(pointers.size>1)pinched=true};
  canvas.onpointermove=e=>{if(!pointers.has(e.pointerId))return;const old=pointers.get(e.pointerId),next=[e.clientX,e.clientY];if(pointers.size===2){const other=[...pointers].find(([id])=>id!==e.pointerId)[1],before=Math.hypot(old[0]-other[0],old[1]-other[1]),after=Math.hypot(next[0]-other[0],next[1]-other[1]);if(before>2)setZoom(zoom*after/before)}else if(!pinched){gestureRotated=gestureRotated||Math.hypot(next[0]-old[0],next[1]-old[1])>0;freeRotate((next[0]-old[0])*.008,(next[1]-old[1])*.008)}pointers.set(e.pointerId,next)};
  canvas.onpointerup=e=>{pointers.delete(e.pointerId);if(!pointers.size&&gestureRotated&&!pinched){if(followCandidate)returnToCandidate();else if(!detail.candidate&&snap.checked)snapNow()}};
  canvas.onpointercancel=canvas.onlostpointercapture=e=>pointers.delete(e.pointerId);
  canvas.addEventListener('wheel',e=>{e.preventDefault();setZoom(zoom*Math.exp(-clamp(e.deltaY,-100,100)*.005))},{passive:false});
  canvas.onkeydown=e=>{const movement={ArrowLeft:[-.06,0],ArrowRight:[.06,0],ArrowUp:[0,-.06],ArrowDown:[0,.06]}[e.key];if(movement)freeRotate(...movement);else if(e.key==='+'||e.key==='=')setZoom(zoom*1.2);else if(e.key==='-')setZoom(zoom/1.2);else if(e.key==='Home')resetView();else return;e.preventDefault()};
  const observer=new ResizeObserver(paint);
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();if(!closed){cancelSnap();error.textContent='3D drawing was interrupted. Close and reopen this viewer to retry.';error.hidden=false}});
  const refreshColour=()=>{if(drawing&&scene){drawing.upload(scene,style.value,cell.checked);paint()}};
  function destroy(){closed=true;cancelSnap();colourListeners.delete(refreshColour);helpDialog.removeEventListener('cancel',cancelSnapHelp);if(settingsDialog.open)settingsDialog.close();if(host)settingsButton.onclick=null;cancelAnimationFrame(frame);observer.disconnect();pointers.clear();drawing?.destroy();dialog.remove();if(!host&&anchor?.isConnected)anchor.focus({preventScroll:true})}
  if(!host)dialog.addEventListener('close',destroy,{once:true});
  const modelHud=make('div',null,'crystal-model-hud'),modelSelectors=make('div',null,'crystal-model-selectors'),modelReadout=make('div',null,'crystal-model-readout'),modelStatus=make('div',null,'crystal-model-status'),modelViewport=make('div',null,'crystal-model-viewport');modelSelectors.append(structure.parentElement,view.parentElement,snapButton);modelStatus.append(snapStatus,snapControls);modelReadout.append(orientationReadout,modelStatus);modelViewport.append(canvas,error,triad,zoneGuide);modelHud.append(modelSelectors,modelViewport,modelReadout);stage.append(modelHud);
  modelPane.append(stage);diffStage.append(readout);diffPane.append(diffStage);panes.append(modelPane,diffPane);
  const paneStatuses=[stage,diffStage].map(pane=>{
   const overlay=make('div',null,'crystal-pane-status'),spinner=make('span',null,'fft-spinner'),label=make('span');
   overlay.setAttribute('role','status');overlay.hidden=true;spinner.setAttribute('aria-hidden','true');spinner.hidden=true;overlay.append(spinner,label);pane.append(overlay);return {pane,overlay,spinner,label};
  });
  const settingsDialog=make('dialog',null,'crystal-settings-dialog');settingsDialog.setAttribute('aria-label','Crystal viewer settings');
  const settingsHead=make('div',null,'panel-head'),settingsClose=button('×','Close crystal viewer settings',()=>settingsDialog.close());settingsHead.append(make('h2','Crystal viewer settings'),settingsClose);
  const settingsPanel=make('div',null,'crystal-comparison-settings');settingsPanel.append(make('h3','Atomic model'),controls,description,dimensions,foot,make('h3','Orientation'),orientation,orientationError,make('h3','Diffraction'),previewControls,assumptions,diffStatus);settingsDialog.append(settingsHead,settingsPanel);
  const settingsButton=host?document.getElementById('crystal-comparison-settings-button'):button('Settings','Open crystal viewer settings',()=>{});let settingsReturn=settingsButton;settingsButton.setAttribute('aria-haspopup','dialog');settingsButton.onclick=()=>{settingsReturn=settingsButton;settingsDialog.showModal();settingsClose.focus({preventScroll:true})};
  settingsDialog.addEventListener('close',()=>{if(!closed&&settingsReturn.isConnected)settingsReturn.focus({preventScroll:true})});
  if(!host){head.insertBefore(settingsButton,close);dialog.append(head)}
  dialog.append(panes,settingsDialog,snapTooltip);
  const helpDialog=host?host.closest('dialog'):dialog,cancelSnapHelp=event=>{if(!snapTooltip.hidden){event.preventDefault();hideSnapHelp();snapHelp.blur()}};helpDialog.addEventListener('cancel',cancelSnapHelp);
  (host||document.body).append(dialog);if(!host)dialog.showModal();
  try{drawing=renderer(canvas)}catch(e){error.textContent=e.message;error.hidden=false}
  try{plot=diffraction.createPlot(diffCanvas,readout)}catch(e){diffError.textContent=e.message;diffError.hidden=false}
  setReciprocalView(reciprocalView);rebuild(true);colourListeners.add(refreshColour);observer.observe(stage);observer.observe(modelViewport);observer.observe(diffStage);if(!host)canvas.focus({preventScroll:true});
  return {destroy,setReciprocalView,setPending(message,loading=false){
   if(message)hideSnapHelp();
   if(message&&(touring||snapAnimation)){cancelSnap();paint()}
   const waiting=Boolean(message&&loading);for(const {pane,overlay,spinner,label}of paneStatuses){overlay.hidden=!message;spinner.hidden=!waiting;label.textContent=waiting?'Updating…':message||'';pane.setAttribute('aria-busy',String(waiting))}
   dialog.classList.toggle('crystal-pending',Boolean(message));dialog.setAttribute('aria-busy',String(waiting));structure.disabled=view.disabled=snapButton.disabled=Boolean(message);for(const element of [controls,orientation,previewControls,snapControls])element.inert=Boolean(message);
  },update(next){
   settings=next.settings||{};setReciprocalView(next.reciprocalView||null);entries=next.models.filter(m=>STRUCTURES[m.phase]).map(m=>({model:structuredClone(m),phase:m.phase}));for(const phase of Object.keys(STRUCTURES))entries.push({phase,model:null});
   structure.replaceChildren(...entries.map((entry,i)=>new Option(entryLabel(entry),i)));structure.value='0';rebuild(true);
  }};
 }
 function candidateModels(model,data,linked){
  if(model?.related_pattern||linked)return (linked||data?.beta_omega)?.components?.filter(c=>c.active&&c.vector_model).map(c=>({...c.vector_model,display_label:c.id==='beta'?'Parent':c.id,linked_parent_rotation:c.id!=='beta'}))||[];
  if(model?.independent_combination){
   const available=[...(data?.classification?.combined_fit_components||[]),...(data?.models||[])];
   return model.phase.split('+').map((phase,i)=>available.find(m=>m.phase===phase&&JSON.stringify(m.zone_3index)===JSON.stringify(model.component_zones?.[i])&&(!Number.isFinite(model.component_rotations_deg?.[i])||Math.abs(m.rotation_deg-model.component_rotations_deg[i])<1e-6))).filter(Boolean);
  }
  return model&&STRUCTURES[model.phase]?[data?.beta_omega?.components?.some(c=>c.id!=='beta'&&c.vector_model===model)?{...model,linked_parent_rotation:true}:model]:[];
 }
 function addButton(host,model,{data=null,linked=null,settings=data?.settings}={}){
  const models=candidateModels(model,data,linked);if(!models.length)return;
  const button=make('button','3D','crystal-open');button.type='button';button.title='View crystal structure and diffraction';button.setAttribute('aria-label','View '+models.map(m=>STRUCTURES[m.phase].name+(m.zone_3index?' ['+m.zone_3index.join(' ')+']':'')).join(' + ')+' in 3D with diffraction');button.setAttribute('aria-haspopup','dialog');
  button.onclick=e=>{e.stopPropagation();open({models,settings:settings||currentReferences(),anchor:button})};host.append(button);
 }
 window.CrystalViewer={open,addButton,describe,geometry,zoneRotation,fittedOrientation,nearestZone,alignZone,realignZone,viewRotation,interpolateSnap,projectZoneGuide,referenceCell,candidateModels,refreshColours,structures:STRUCTURES};
})();

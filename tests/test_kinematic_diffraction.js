const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context={window:{}};vm.createContext(context);
for(const file of ['kinematic-diffraction','crystal-viewer'])vm.runInContext(fs.readFileSync('web/'+file+'.js','utf8'),context);
const K=context.window.KinematicDiffraction,V=context.window.CrystalViewer,plain=x=>JSON.parse(JSON.stringify(x));
const close=(a,b,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const identity=[[1,0,0],[0,1,0],[0,0,1]],lookup=(pattern,hkl)=>pattern.spots.find(s=>String(s.hkl)===String(hkl));
// Relativistic wavelengths, independently tabulated values in picometres.
close(K.wavelength(100)*1000,3.70144,.0001);close(K.wavelength(200)*1000,2.50793,.0001);close(K.wavelength(300)*1000,1.96875,.0001);
for(const bad of [0,-100,NaN,Infinity,19,1001])assert.throws(()=>K.wavelength(bad));
for(const [input,hex,expected] of [['[2 2 0]',false,[1,1,0]],['1, 0, -1',false,[1,0,-1]],['1 0 -1 0',true,[2,1,0]],['0 0 0 1',true,[0,0,1]],['−1 0 1 0',true,[-2,-1,0]]])assert.deepEqual(plain(K.parseZone(input,hex)),expected);
for(const input of ['0 0 0','1 2','1.2 0 0','1x 0 0','NaN 0 1','101 0 0'])assert.throws(()=>K.parseZone(input));
assert.throws(()=>K.parseZone('1 0 -1 0'));assert.throws(()=>K.parseZone('1 0 0 0',true));
for(const phase of Object.keys(V.structures)){
 const d=V.describe(phase),g=V.geometry(d,1),reciprocal=K.reciprocalBasis(g.vectors),sites=V.structures[phase].basis;
 for(let i=0;i<3;i++)for(let j=0;j<3;j++)close(dot(g.vectors[i],reciprocal[j]),Number(i===j));
 const library=K.reflectionLibrary(g.vectors,sites,10);
 assert.ok(library.reflections.length>0);assert.ok(library.reflections.every(r=>r.length<=10+1e-9&&r.length>0&&r.basisIntensity>1e-12));
 // No missing points in an independent brute force hkl cube for these cells.
 const keys=new Set(library.reflections.map(r=>String(r.hkl)));
 for(let h=-6;h<=6;h++)for(let k=-6;k<=6;k++)for(let l=-6;l<=6;l++){
  if(!h&&!k&&!l)continue;
  const hkl=[h,k,l],q=[0,1,2].map(i=>h*reciprocal[0][i]+k*reciprocal[1][i]+l*reciprocal[2][i]);
  const even=v=>v%2===0,allowed=phase==='BCC'?even(h+k+l):phase==='FCC'?even(h)===even(k)&&even(k)===even(l):phase==='HCP'?even(l)||(h-k)%3!==0:phase==='OMEGA'?!even(l)||(h-k)%3===0:true;
  assert.equal(keys.has(String(hkl)),allowed&&Math.hypot(...q)<=10+1e-9,phase+' '+hkl);
 }
 // Unit-cell population affects the basis only; viewer replication is absent
 // from diffraction inputs and therefore cannot imitate specimen thickness.
 const p=K.simulate(library,V.zoneRotation(d,[0,0,1]));
 assert.ok(p.spots.every(s=>Number.isFinite(s.intensity)&&s.intensity>=0&&s.intensity<=1));
}
const bcc=V.describe('BCC'),cell=V.geometry(bcc,1),library=K.reflectionLibrary(cell.vectors,V.structures.BCC.basis,10),snapshot=JSON.stringify(library);
const p=K.simulate(library,identity),r=lookup(p,[1,1,0]);
close(r.length,Math.sqrt(2)/.33);close(r.d,.33/Math.sqrt(2));close(r.intensity,lookup(p,[-1,-1,0]).intensity);
assert.equal(lookup(p,[1,0,0]),undefined);assert.equal(lookup(p,[0,0,0]),undefined);
// An exact Bragg tilt brings 200 onto the Ewald sphere, with unit excitation
// factor. Reversing hkl at the same tilt need not preserve the intensity.
const bragg=Math.asin(K.wavelength(200)*(2/.33)/2)*180/Math.PI;
const tilted=K.simulate(library,K.tilt(identity,0,bragg));
close(lookup(tilted,[2,0,0]).s,0);close(lookup(tilted,[2,0,0]).intensity,1);
assert.ok(lookup(tilted,[-2,0,0]).intensity<.1);
close(K.thicknessIntensity(0,10),1);close(K.thicknessIntensity(.1,10),0);close(K.thicknessIntensity(.05,10),4/(Math.PI*Math.PI));
const thin=K.simulate(library,identity,{thickness:5}),thick=K.simulate(library,identity,{thickness:10});assert.notEqual(lookup(thin,[2,0,0]).intensity,lookup(thick,[2,0,0]).intensity);
// Check an off-axis projection against a hand-computed Y rotation.
const off=lookup(K.simulate(library,K.tilt(identity,0,10)),[2,0,0]);close(off.q[0],2/.33*Math.cos(Math.PI/18));close(off.q[2],-2/.33*Math.sin(Math.PI/18));
// Crystal rotations preserve a right-handed orthonormal frame.
const matrix=K.tilt(V.zoneRotation(V.describe('HCP'),[1,0,1]),-3.2,7.9);
for(let i=0;i<3;i++)for(let j=0;j<3;j++)close(dot(matrix[i],matrix[j]),Number(i===j));
assert.equal(JSON.stringify(library),snapshot,'Simulation cannot alter retained reciprocal geometry');
for(const thickness of [0,201,NaN])assert.throws(()=>K.simulate(library,identity,{thickness}));
assert.throws(()=>K.reflectionLibrary(cell.vectors,V.structures.BCC.basis,NaN));
assert.throws(()=>K.reflectionLibrary([[10,0,0],[0,10,0],[0,0,10]],[[0,0,0]],20));
assert.throws(()=>K.reflectionLibrary([[2,0,0],[0,2,0],[0,0,2]],[[0,0,0]],20),/Too many reflections/);
const extended=K.reflectionLibrary(cell.vectors,V.structures.BCC.basis,30);assert.ok(extended.reflections.some(r=>r.length>20));assert.ok(extended.reflections.every(r=>r.length<=30+1e-9));assert.throws(()=>K.reflectionLibrary(cell.vectors,V.structures.BCC.basis,31));
// The FFT's asymmetric SVG margins and bitmap extent determine the simulated
// spot coordinates, independently of the radius bounding the reflection set.
const viewport={extent:[-12,12,-12,12],viewBox:[-28,-12,464,452],imageRect:[0,0,420,420],outerRadius:10,innerRadius:2.5,units:'nm^-1'};
const frame=K.plotGeometry(464,464,10,viewport);assert.deepEqual(plain(frame.project([4,-2])),[308,263]);assert.deepEqual([frame.cx,frame.cy,frame.sx,frame.sy],[238,228,17.5,17.5]);assert.deepEqual(plain(frame.clip),{x:28,y:18,width:420,height:420});
const resized=K.plotGeometry(232,232,10,viewport);assert.deepEqual(plain(resized.project([4,-2])),[154,131.5]);
const offset=K.plotGeometry(928,904,10,{...viewport,extent:[-14,10,-7,9]});assert.deepEqual([offset.cx,offset.cy,offset.sx,offset.sy],[546,496.5,35,52.5]);
assert.throws(()=>K.plotGeometry(400,400,10,{...viewport,extent:[0,0,-10,10]}));
const standalone=K.plotGeometry(464,464,10);assert.deepEqual([standalone.cx,standalone.cy,standalone.sx],[232,232,19.7]);
// Exercise the actual renderer: same coordinates, same outer ellipse, clipped
// out-of-band spots, and reflection picking at the displayed location.
const arcs=[],ellipses=[],drawing=new Proxy({measureText:text=>({width:text.length*5}),arc:(...args)=>arcs.push(args),ellipse:(...args)=>ellipses.push(args)},{get:(object,key)=>object[key]||(()=>{})}),canvas={getContext:()=>drawing,getBoundingClientRect:()=>({width:464,height:464,left:20,top:30}),setAttribute(){},focus(){}},readout={dataset:{}};
const plot=K.createPlot(canvas,readout),testPattern={gMax:30,spots:[{hkl:[1,1,0],q:[4,-2,0],intensity:1,d:.2236,length:Math.sqrt(20),s:0},{hkl:[5,0,0],q:[25,0,0],intensity:1,d:.04,length:25,s:0}]};
plot.draw(testPattern,{viewport});assert.equal(plot.count(),1);assert.deepEqual(arcs[0].slice(0,2),[308,263]);assert.deepEqual(ellipses[0].slice(0,4),[238,228,175,175]);canvas.onclick({clientX:328,clientY:293});assert.match(readout.textContent,/\(1 1 0\)/);assert.equal(readout.dataset.selected,'true');
console.log('Kinematic preview: relativistic wavelengths, reciprocal duality, complete bounded reflection sets, absences, exact Bragg tilt, thickness minima, off-axis positions/intensities, zone notation and input isolation passed.');

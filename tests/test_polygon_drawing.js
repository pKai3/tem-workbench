const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const handlers={},nodes={};let dialog=false,finishes=0,cancels=0,preview;
const $=id=>nodes[id]??=( {addEventListener(){},focus(){},getBoundingClientRect:()=>({width:1000})} );
const c=vm.createContext({$,document:{addEventListener:(name,fn)=>handlers[name]=fn,querySelector:()=>dialog},meta:{width:1000,height:800},roi:{},isDiffraction:()=>false,overlapPlanning:()=>false,point:e=>({x:e.clientX,y:e.clientY}),clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),setTimeout,clearTimeout});
vm.runInContext(fs.readFileSync('web/region-selection.js','utf8'),c);
c.finishPolygonDrawing=()=>finishes++;c.cancelPolygonDrawing=()=>cancels++;c.syncRegionSelection=()=>{};c.updateBox=()=>{};c.drawPolygonSelection=p=>preview=p;
const run=s=>vm.runInContext(s,c);
const event=(extra={})=>({button:0,target:{closest:()=>null},preventDefault(){this.prevented=true},stopImmediatePropagation(){},...extra});
run('polygonDrawing={points:[]}');
handlers.pointerdown(event({clientX:-30,clientY:250}));
handlers.pointerdown(event({clientX:1200,clientY:1000}));
assert.equal(run('JSON.stringify(polygonDrawing.points)'), '[[0,250],[999,799]]');
handlers.pointermove(event({clientX:300,clientY:-40}));assert.equal(JSON.stringify(preview),'{'+'"x":300,"y":0}');
handlers.pointerdown(event({clientX:450,clientY:450,target:{closest:()=>({})}}));assert.equal(run('polygonDrawing.points.length'),2);
handlers.keydown(event({key:'Enter'}));assert.equal(finishes,1);
handlers.keydown(event({key:'Escape'}));assert.equal(cancels,1);
handlers.keydown(event({key:'Backspace',target:{closest:()=>({})}}));assert.equal(run('polygonDrawing.points.length'),2);
handlers.dblclick(event());assert.equal(finishes,2);
handlers.dblclick(event({target:{closest:()=>({})}}));assert.equal(finishes,2);
dialog=true;handlers.keydown(event({key:'Enter'}));assert.equal(finishes,2);
console.log('Polygon outside clicks, clamped preview, unfocused shortcuts and control guards passed.');

// A rebuilt SVG target can suppress native dblclick entirely. Two nearby
// pointer presses must still close, without adding a fourth near-duplicate.
dialog=false;
run('polygonDrawing={points:[[100,100],[500,100]]}');
handlers.pointerdown(event({clientX:500,clientY:500,timeStamp:1000}));
const before=finishes;
handlers.pointermove(event({clientX:502,clientY:501,timeStamp:1100}));
handlers.pointerdown(event({clientX:502,clientY:501,timeStamp:1200}));
assert.equal(finishes,before+1);
assert.equal(run('polygonDrawing.points.length'),3);
console.log('Double-click completion works without a native dblclick event.');
// The inset is physical distance, including unequal X/Y calibration.
const contour=run('polygonFadeContour({w:100,h:80,polygon:[[0,0],[100,0],[100,80],[0,80]],edge_fade_nm:2},.1,.2)');
const coords=Array.from(contour.matchAll(/[ML]([\d.]+),([\d.]+)/g),m=>[+m[1],+m[2]]);
assert.ok(coords.length>0);
assert.ok(Math.abs(Math.min(...coords.map(p=>p[0]))-20)<.01);
assert.ok(Math.abs(Math.max(...coords.map(p=>p[0]))-80)<.01);
assert.ok(Math.abs(Math.min(...coords.map(p=>p[1]))-10)<.01);
assert.ok(Math.abs(Math.max(...coords.map(p=>p[1]))-70)<.01);
assert.equal(run('polygonFadeContour({w:100,h:80,polygon:[[0,0],[100,0],[100,80],[0,80]],edge_fade_nm:100},.1,.2)'), '');
assert.equal(run('polygonFadeContour({w:100,h:80,polygon:[[0,0],[100,0],[100,80],[0,80]],edge_fade_nm:0},.1,.2)'), '');
console.log('Calibrated fade inset, zero fade and fully faded selection passed.');

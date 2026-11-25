const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const window={},draws=[],context={drawImage(...args){draws.push(args)}};
vm.runInNewContext(fs.readFileSync('web/image-detail.js','utf8'),{window,innerWidth:900,innerHeight:600,
 document:{createElement(){return {getContext:()=>context,toDataURL:()=> 'data:image/png;test'}}}});
const detail=window.WorkbenchImageDetail,plain=value=>JSON.parse(JSON.stringify(value));
assert.deepEqual(plain(detail.crop({width:400,height:300,u:.5,v:.5})),{x:160,y:120,width:80,height:60});
assert.deepEqual(plain(detail.crop({width:400,height:300,u:0,v:1})),{x:0,y:240,width:80,height:60});
assert.deepEqual(plain(detail.crop({x:410,y:310,width:400,height:300,u:1,v:0})),{x:730,y:310,width:80,height:60},'Whole-figure crop stays within the chosen panel');
detail.draw('pixels',{x:100,y:50,width:200,height:150,u:.5,v:.5},'brightness(2)');
assert.deepEqual(draws[0],['pixels',180,110,40,30,0,0,560,420]);assert.equal(context.filter,'brightness(2)');
assert.equal(context.imageSmoothingEnabled,true,'Figures and electron images keep existing rendering');
detail.draw('ebsd',{width:400,height:300,u:.5,v:.5},'none',false);
assert.equal(context.imageSmoothingEnabled,false,'EBSD detail preserves discrete measured pixels');
const host={style:{},getBoundingClientRect:()=>({width:558,height:460})};
detail.position(host,890,590);assert.deepEqual(host.style,{left:'318px',top:'132px'});
detail.position(host,0,0);assert.deepEqual(host.style,{left:'14px',top:'14px'});
vm.runInNewContext(fs.readFileSync('web/aztec-export.js','utf8'),{window});
const bar=window.aztecScaleBar;
for(const [field,expected] of [[1000,200],[40000,5000],[20000,5000],[10000,2000],[100,20]]){
 const geometry=bar.geometry(320,field,'nm');assert.equal(geometry.value,expected);
 assert.equal(geometry.pixels,320*expected/field);assert.ok(geometry.pixels<128);
 assert.equal(bar.geometry(640,field,'nm').pixels,2*geometry.pixels,'Resizing retains physical scale');
}
assert.equal(bar.geometry(320,40000,'nm').label,'5 µm');assert.equal(bar.geometry(320,400,'px').label,'50 px');
assert.equal(bar.geometry(320,0,'nm'),null);assert.equal(bar.geometry(0,1000,'nm'),null);
const geometry=bar.geometry(320,40000,'nm'),bounds={left:20,right:340,top:30,bottom:270};
for(const corner of window.aztecOverlayPlacement.corners){
 const placed=bar.position(geometry,bounds,50,corner,30);
 assert.ok(placed.x>=bounds.left&&placed.x+geometry.pixels<=bounds.right);
 assert.ok(placed.labelY-geometry.fontSize>=bounds.top&&placed.y+geometry.height<=bounds.bottom);
 assert.equal(placed.x>180,corner.endsWith('right'));assert.equal(placed.y<150,corner.startsWith('top'));
}
console.log('Shared Figures/Maps 5× crops, image filters, viewport placement and calibrated Figures-style bars passed.');

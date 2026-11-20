const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync('web/figures.js','utf8');
let cssWidth=1500;
const context={previewLayout:null,window:{devicePixelRatio:2},document:{querySelector(){return {getBoundingClientRect(){return {width:cssWidth}}}}}};
vm.createContext(context);
vm.runInContext(app.slice(app.indexOf(' function figurePreviewWidth(){'),app.indexOf(' function refreshPreviewSize(){')),context);
assert.equal(context.figurePreviewWidth(),3008);
context.window.devicePixelRatio=1;assert.equal(context.figurePreviewWidth(),1536);
cssWidth=700;context.window.devicePixelRatio=2;assert.equal(context.figurePreviewWidth(),1408);
cssWidth=3000;context.window.devicePixelRatio=4;assert.equal(context.figurePreviewWidth(),6000);
cssWidth=100;assert.equal(context.figurePreviewWidth(),448);
vm.runInContext(app.slice(app.indexOf(' function previewPanelHit('),app.indexOf(' function highlightPanel(')),context);
for(const panelWidth of [420,1458,258]){
 const margin=13,columns=3,rows=2,panelHeight=Math.ceil(panelWidth/.8);
 const width=columns*panelWidth+(columns+1)*margin,height=rows*panelHeight+(rows+1)*margin;
 context.previewLayout={width,height,panel_width:panelWidth,panel_height:panelHeight,columns,rows,margin};
 const image={naturalWidth:width,naturalHeight:height,getBoundingClientRect(){return {left:60,top:20,width:width/2}}};
 const hit=(x,y)=>context.previewPanelHit({currentTarget:image,clientX:60+x/2,clientY:20+y/2});
 for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
  const x=margin+column*(panelWidth+margin),y=margin+row*(panelHeight+margin);
  const found=hit(x+panelWidth*.4,y+panelHeight*.6);
  assert.equal(found.index,row*columns+column);
  assert.equal(found.width,panelWidth);assert.equal(found.height,panelHeight);
  assert.equal(found.x,x);assert.equal(found.y,y);
  assert.ok(Math.abs(found.localX-panelWidth*.4)<1e-8);
  assert.ok(Math.abs(found.localY-panelHeight*.6)<1e-8);
 }
 assert.equal(hit(5,30),null,'Outer padding is not a panel');
 assert.equal(hit(margin+panelWidth+5,30),null,'Panel gaps are not selectable');
 image.naturalWidth--;
 assert.equal(hit(margin+20,margin+20),null,'Old image pixels never use new layout geometry');
 context.previewLayout=null;assert.equal(hit(20,20),null);
}
console.log('Display density, resizing, bounded request width and variable-resolution panel hit coordinates passed.');

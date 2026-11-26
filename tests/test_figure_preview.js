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

// Delayed render/decode responses must never expose an empty image or clear a newer loader.
const tick=()=>new Promise(resolve=>setImmediate(resolve)),fields={},requests=[],decodes=[],spinner={hidden:false};
const field=id=>fields[id]??={dataset:{},hidden:false,setAttribute(key,value){this[key]=value},
 getAttribute(key){return this[key]||null},querySelector:()=>spinner};
field('fig-preview').hidden=true;
const pending={timer:0,renderVersion:0,detailCache:new Map(),previewLayout:null,panelHighlight:{hidden:false},
 recipe:{name:'Montage'},requestedPreviewWidth:0,$:field,clearTimeout(){},setTimeout(fn){pending.run=fn;return 1},
 hideOutputHover(){},updateExportEstimate(){},figurePreviewWidth:()=>1000,status(message,error){pending.notice={message,error}},
 api:()=>new Promise((resolve,reject)=>requests.push({resolve,reject})),
 Image:class{decode(){return new Promise((resolve,reject)=>decodes.push({resolve,reject}))}}};
vm.createContext(pending);
vm.runInContext(app.slice(app.indexOf(' function setFigurePreviewState('),app.indexOf(' function changed(')),pending);
(async()=>{
 pending.schedulePreview();const first=pending.run();
 assert.equal(field('fig-preview-content')['aria-busy'],'true');assert.equal(field('fig-preview').hidden,true);
 assert.equal(field('fig-preview-loading').hidden,false);assert.equal(spinner.hidden,false);
 assert.equal(field('fig-preview-loading-text').textContent,'Loading preview…');
 requests[0].resolve({image:'first',layout:{width:1000}});await tick();
 assert.equal(field('fig-preview').src,undefined,'The image remains hidden until decoding finishes');
 pending.schedulePreview();const second=pending.run();decodes[0].resolve();await first;
 assert.equal(field('fig-preview-content').dataset.state,'loading','A stale decode cannot dismiss the spinner');
 requests[1].resolve({image:'second',layout:{width:1000}});await tick();decodes[1].resolve();await second;
 assert.equal(field('fig-preview').src,'second');assert.equal(field('fig-preview').hidden,false);
 assert.equal(field('fig-preview-loading').hidden,true);assert.equal(field('fig-preview-content')['aria-busy'],'false');
 pending.schedulePreview();const failed=pending.run();
 assert.equal(field('fig-preview-loading-text').textContent,'Updating preview…');
 requests[2].reject(Error('Source unavailable'));await failed;
 assert.equal(field('fig-preview-content').dataset.state,'error');assert.equal(spinner.hidden,true);
 assert.equal(field('fig-preview').hidden,true);assert.equal(pending.notice.message,'Source unavailable');
 pending.schedulePreview();const retry=pending.run();requests[3].resolve({image:'retry',layout:{width:1000}});
 await tick();decodes[2].reject(Error('Invalid image'));await retry;
 assert.equal(spinner.hidden,true);assert.equal(pending.notice.error,true);
 const html=fs.readFileSync('web/figures.html','utf8');
 assert.match(html,/<img id="fig-preview"[^>]*hidden/,'The image must start hidden before scripts run');
 console.log('Figure loading/decode, stale replies, visible errors and retry spinner states passed.');
})().catch(error=>{console.error(error);process.exitCode=1});

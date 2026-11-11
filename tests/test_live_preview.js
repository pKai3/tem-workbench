// Delayed requests and decodes must not attach old imagery or fits to a moved ROI.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {element}=require('./svg_fixture');
const nodes=new Map(),timers=new Map(),requests=[];
const $=id=>{if(!nodes.has(id)){const n=element('div');const classes=new Set();n.classList={add:k=>classes.add(k),remove:k=>classes.delete(k),contains:k=>classes.has(k)};nodes.set(id,n)}return nodes.get(id)};
const context={$ ,AbortController,JSON,setTimeout(fn){const key={};timers.set(key,fn);return key},clearTimeout:key=>timers.delete(key),
 meta:{width:1024,height:1024,sha256_pixels:'original',pixel_x_nm:.02},fileId:'image',roi:{x:0,y:0,w:128,h:128},result:null,drag:null,
 config:{live_spectrum_previews:true},fftRaw:null,detectorRaw:null,showDetectorSignal:false,inspectorLayout:'paired',innerWidth:1200,innerHeight:800,
 isDiffraction:()=>false,settings:()=>({threshold:.35}),
 api(path,body,signal){return new Promise((resolve,reject)=>requests.push({path,body,signal,resolve,reject}))},
 decodeSpectrumImage:async images=>images.fft,colourSpectrum:raw=>raw,syncSignalToggle(){},drawSpectrumAxes(){},setSpectrumSpinner(){},syncFFTZoom(){},
 setRegionPreviewImage(region,src,cropped){context.hoverImage={region,src,cropped}},clamp:(v,a,b)=>Math.max(a,Math.min(b,v))};
context.requestBody=()=>({file_id:context.fileId,roi:{...context.roi},settings:context.settings()});
vm.createContext(context);vm.runInContext(fs.readFileSync('web/live-preview.js','utf8'),context);
const run=s=>vm.runInContext(s,context),tick=()=>new Promise(resolve=>setImmediate(resolve));
function reply(i){const request=requests[i];request.resolve({roi:request.body.roi,images:{fft:`fft-${i}`,crop:`crop-${i}`},spectrum:{extent:[-10,10,-10,10]}})}
function flush(){const [id,fn]=timers.entries().next().value;timers.delete(id);return fn()}
(async()=>{
 $('source-image').setAttribute('href','source');context.showLiveRegionCrop();
 assert.equal($('crop-live').hidden,false);assert.equal($('crop').hidden,true);
 assert.equal($('crop-live-view').getAttribute('viewBox'),'0 0 128 128','Crop moves synchronously, with no request');
 context.queueLiveRegionPreview();const first=flush();
 context.drag={mode:'move'};context.roi.x=10;context.showLiveRegionCrop();context.queueLiveRegionPreview();
 context.roi.x=20;context.showLiveRegionCrop();context.queueLiveRegionPreview();
 assert.equal(requests.length,1,'Only one preview is in flight; rapid movement coalesces');
 reply(0);await first;
 assert.equal($('fft-image').getAttribute('href'),'fft-0');
 assert.equal($('crop-live-view').getAttribute('viewBox'),'20 0 128 128');assert.equal($('crop').hidden,true,'Old FFT frame cannot move the crop backwards');
 const latest=flush();assert.equal(requests[1].body.roi.x,20);
 context.drag=null;reply(1);await latest;assert.equal($('crop').src,'crop-1');assert.equal(context.result,null);
 // A source switch during asynchronous decoding cannot replace the new source.
 let resolveDecode;context.decodeSpectrumImage=()=>new Promise(resolve=>resolveDecode=resolve);
 context.roi.x=30;context.queueLiveRegionPreview();const old=flush();reply(2);await tick();
 context.fileId='new-image';context.resetLiveRegionPreview();resolveDecode('wrong-source');await old;
 assert.notEqual($('fft-image').getAttribute('href'),'wrong-source');assert.equal(run('liveSpectrumPreview'),null);
 // A completed fit wins even when a preview response was already decoding.
 context.fileId='image';context.queueLiveRegionPreview();const late=flush();reply(3);await tick();
 context.result={classification:{}};context.resetLiveRegionPreview();resolveDecode('late-preview');await late;
 assert.notEqual($('fft-image').getAttribute('href'),'late-preview');
 context.result=null;context.drag={};context.inspectorLayout='fft';
 $('overview').getBoundingClientRect=()=>({left:0,right:600});context.showDragRegionPreview({clientX:200,clientY:400});
 assert.equal($('region-hover').hidden,false);assert.equal($('region-hover').classList.contains('drag-crop'),true);assert.equal(context.hoverImage.src,'source');
 assert.equal(context.hoverImage.region.roi.x,30);
 // Exercise the actual full-result guard before any UI mutation, including late decode.
 const app=fs.readFileSync('web/app.js','utf8');const render=app.match(/async function renderResult\(data,version,body\)\{[^\n]+/)[0];
 let mutations=0;context.renderAutoStrength=()=>{mutations++};context.generation=5;
 vm.runInContext(render,context);
 const stale=context.renderResult({images:{fft:'old'}},5,{file_id:'image'});context.generation++;
 resolveDecode('old');await stale;assert.equal(mutations,0);assert.equal(context.result,null);
 // Older replies also stay rejected after dragging ends, even without a new file.
 context.decodeSpectrumImage=async images=>images.fft;context.drag=null;context.queueLiveRegionPreview();const moved=flush();
 context.roi.x=50;reply(4);await moved;assert.equal(run('liveSpectrumPreview'),null);
 // Taper gestures may show intermediate alpha values, never other changed settings.
 context.settings=()=>({fft_window:'tukey',fft_tukey_alpha:1,threshold:.35});context.fftTaperAdjusting=true;
 assert.equal(context.previewSettingsRelevant({fft_window:'tukey',fft_tukey_alpha:.6,threshold:.35}),true);
 assert.equal(context.previewSettingsRelevant({fft_window:'tukey',fft_tukey_alpha:.6,threshold:.4}),false);
 context.fftTaperAdjusting=false;
 assert.equal(context.previewSettingsRelevant({fft_window:'tukey',fft_tukey_alpha:.6,threshold:.35}),false);
 console.log('Immediate crops, coalesced FFT previews, drag loupe and stale-response isolation passed.');
})().catch(error=>{console.error(error);process.exitCode=1});

// Image previews have their own coalesced request. They never become fit results.
let liveSpectrumPreview=null, livePreviewRequest=null, livePreviewQueued=null, livePreviewTimer=null, livePreviewEpoch=0;
const sameRegion=(a,b)=>['x','y','w','h'].every(k=>a[k]===b[k])&&JSON.stringify(a.polygon||null)===JSON.stringify(b.polygon||null)&&(a.edge_fade_nm??null)===(b.edge_fade_nm??null);
function livePreviewKey(body){return JSON.stringify([body.file_id,meta?.sha256_pixels,body.roi,body.settings])}
function resetLiveRegionPreview(){
 livePreviewEpoch++;clearTimeout(livePreviewTimer);livePreviewTimer=null;livePreviewQueued=null;
 livePreviewRequest?.controller.abort();livePreviewRequest=null;liveSpectrumPreview=null;
 $('crop-live').hidden=true;$('crop-live-image').removeAttribute('href');$('crop').hidden=false;
}
function showLiveRegionCrop(){
 if(!meta||isDiffraction())return;
 const image=$('crop-live-image');
 $('crop-live-view').setAttribute('viewBox',`${roi.x} ${roi.y} ${roi.w} ${roi.h}`);
 image.setAttribute('width',meta.width);image.setAttribute('height',meta.height);
 image.setAttribute('href',$('source-image').getAttribute('href'));
 if(typeof clipPolygonPreview==='function')clipPolygonPreview($('crop-live-view'),image,roi,'live-polygon-clip');
 $('crop-live').hidden=false;$('crop').hidden=true;
}
function queueLiveRegionPreview(){
 if(!meta||isDiffraction()||!config?.live_spectrum_previews)return;
 const body=requestBody(),key=livePreviewKey(body);
 if(liveSpectrumPreview?.key===key){drawLiveSpectrumPreview();return}
 if(livePreviewRequest?.key===key){livePreviewQueued=null;return}
 livePreviewQueued={body,key,epoch:livePreviewEpoch,sourceHash:meta.sha256_pixels};
 if(!livePreviewTimer&&!livePreviewRequest)livePreviewTimer=setTimeout(runLiveRegionPreview,70);
}
function previewStillRelevant(request){
 return request.epoch===livePreviewEpoch&&request.body.file_id===fileId&&request.sourceHash===meta?.sha256_pixels&&
  !result&&!isDiffraction()&&JSON.stringify(request.body.settings)===JSON.stringify(settings())&&
  (sameRegion(request.body.roi,roi)||Boolean(drag));
}
async function runLiveRegionPreview(){
 livePreviewTimer=null;
 if(livePreviewRequest||!livePreviewQueued)return;
 const request=livePreviewQueued;livePreviewQueued=null;
 request.controller=new AbortController();livePreviewRequest=request;
 try{
  const data=await api('spectrum-preview',request.body,request.controller.signal);
  if(!previewStillRelevant(request))return;
  const [raw,detector]=await Promise.all([decodeSpectrumImage(data.images),data.images.detector_signal16?
   decodeSpectrumImage({fft_log16:data.images.detector_signal16,fft_log_limits:data.images.detector_signal_limits}).then(raw=>({...raw,detector:true})):null]);
  if(!previewStillRelevant(request))return;
  liveSpectrumPreview={...request,data,raw,detector};drawLiveSpectrumPreview();
 }catch(error){
  if(error.name!=='AbortError'&&previewStillRelevant(request))$('timing').textContent='Preview unavailable · fitting…';
 }finally{
  if(livePreviewRequest===request){livePreviewRequest=null;if(livePreviewQueued)livePreviewTimer=setTimeout(runLiveRegionPreview,20)}
 }
}
function drawLiveSpectrumPreview(){
 const frame=liveSpectrumPreview;if(!frame||result||isDiffraction())return;
 fftRaw=frame.raw;detectorRaw=frame.detector;syncSignalToggle();
 $('fft-image').setAttribute('href',colourSpectrum(showDetectorSignal&&detectorRaw?detectorRaw:fftRaw,'real_space'));
 $('fft-overlay').replaceChildren();$('fft-legend').hidden=true;
 const ex=frame.data.spectrum.extent;
 drawSpectrumAxes(ex,(x,y)=>[(x-ex[0])/(ex[1]-ex[0])*420,(ex[3]-y)/(ex[3]-ex[2])*420],frame.data);
 $('fft-stage').classList.remove('spectrum-empty');setSpectrumSpinner(false);syncFFTZoom();
 $('timing').textContent=`FFT preview · ROI ${frame.data.roi.x}, ${frame.data.roi.y} · fitting…`;
 // An older FFT frame can keep dragging fluid; its crop must never replace the
 // immediate source crop at the new box position.
 if(sameRegion(frame.data.roi,roi)){
  $('crop').src=frame.data.images.crop;$('crop').hidden=false;$('crop-live').hidden=true;
  if(drag&&$('region-hover').classList.contains('drag-crop'))setRegionPreviewImage({roi},frame.data.images.crop,true);
 }
}
function showDragRegionPreview(event){
 if(!drag||inspectorLayout!=='fft'||isDiffraction())return;
 const box=$('region-hover');box.classList.add('drag-crop');
 $('region-hover-size').textContent=`${(roi.w*meta.pixel_x_nm).toFixed(2)} nm · ${roi.w} × ${roi.h} px`;
 setRegionPreviewImage({roi},$('source-image').getAttribute('href'),false);
 box.hidden=false;
 const bounds=box.getBoundingClientRect(),source=$('overview').getBoundingClientRect();
 const inward=event.clientX<(source.left+source.right)/2?event.clientX+18:event.clientX-18-bounds.width;
 box.style.left=clamp(inward,8,Math.max(8,innerWidth-bounds.width-8))+'px';
 box.style.top=clamp(event.clientY-18-bounds.height,8,Math.max(8,innerHeight-bounds.height-8))+'px';
}

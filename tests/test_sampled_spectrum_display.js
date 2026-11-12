const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const controls={contrast:{value:50},'fft-white':{value:100},'fft-curve':{value:'log'},palette:{value:'gray'}};
const palette=Array.from({length:256},(_,i)=>[i,i,i]);
function canvas(){return {width:0,height:0,getContext(){return {createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:image=>{this.output=image.data}}},toDataURL(){return Array.from(this.output)}}}
const context=vm.createContext({$:id=>controls[id],document:{createElement:canvas},atob:s=>Buffer.from(s,'base64').toString('binary'),SPECTRUM_PALETTES:{gray:palette},MAGMA:palette,clamp:(v,a,b)=>Math.min(b,Math.max(a,v))});
const app=fs.readFileSync('web/app.js','utf8'),source=fs.readFileSync('web/shared-spectra.js','utf8');
vm.runInContext(app.slice(app.indexOf('function colourSpectrum('),app.indexOf('function spectrumTicks(')),context);
vm.runInContext(source.slice(source.indexOf('const sampledSpectrumCache='),source.indexOf('function drawComponentFitOverlay(')),context);
const spec={size:2,raster:Buffer.from([0,64,128,255]).toString('base64'),limits:[0,10]};
const raw=context.sampledSpectrumRaster(spec);assert.equal(raw.sampleCount,3);assert.deepEqual(Array.from(raw.mask),[1,1,1,0]);assert.equal(raw.histogram[64],1);assert.equal(raw.histogram[128],1);
const output=context.sampledSpectrumUrl(spec);assert.deepEqual(output,[0,0,0,255,0,0,0,255,255,255,255,255,0,0,0,255],'Masked annulus is black and excluded from brightness percentiles');
assert.equal(context.sampledSpectrumRaster(spec),raw,'Recolour without decoding again');
assert.equal(context.sampledSpectrumUrl({image:'old-result'}),'old-result');
const companion={...spec,raster:Buffer.from([0,32,64,255]).toString('base64')};
assert.equal(context.sampledSpectrumUrl(companion,spec)[8],0,'Original and reconstruction share a brightness reference');
controls.contrast.value=0;const changed=context.sampledSpectrumUrl(spec);assert.ok(changed[4]>0);assert.deepEqual(changed.slice(12),[0,0,0,255]);
console.log('Sampled spectra: main palette/contrast, masked annulus, shared preview range, cache and legacy fallback passed.');

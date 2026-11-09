// Both image kinds share the display toggle; direct mode has no FFT strength field.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/app.js','utf8'),controls=new Map();
function $(id){if(!controls.has(id))controls.set(id,{attrs:{},setAttribute(k,v){this.attrs[k]=v},querySelector:q=>$(id+q)});return controls.get(id)}
const context={$,direct:true,isDiffraction:()=>context.direct,showDetectorSignal:false,detectorRaw:{detector:true},
 config:{fft_log16:true,diffraction_processed_view:true},reciprocalUnit:()=> 'rel.',draws:0,drawFFT(){context.draws++},readPreference:(key,fallback)=>fallback};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function processedSignalCaption('),source.indexOf('function rememberFFTDisplay(')),context);
context.syncSignalToggle();
assert.equal($('fft-signal-toggle').hidden,false);assert.equal($('show-original-fft').textContent,'Raw');
$('show-detector-signal').onclick();
assert.equal($('show-detector-signal').attrs['aria-pressed'],'true');assert.equal($('fft-curve').disabled,true);
assert.equal($('spectrum-title').textContent,'Processed');assert.match($('fft-zoom-title').textContent,/Processed diffraction/);
assert.match(context.processedSignalCaption({image_kind:'diffraction',spectrum:{profile_threshold:9}}),/display only/);
$('show-original-fft').onclick();assert.equal($('fft-curve').disabled,false);assert.equal(context.draws,2);
context.direct=false;context.showDetectorSignal=true;context.syncSignalToggle();
assert.equal($('show-original-fft').textContent,'Raw FFT');assert.match($('fft-zoom-title').textContent,/Processed FFT/);
assert.match(context.processedSignalCaption({image_kind:'real_space',spectrum:{profile_threshold:2,minimum_peak_enrichment:3}}),/minimum strength 3.000/);
// A new/older image without a processed field falls back to Raw with no stale signal.
context.direct=true;context.detectorRaw=null;context.syncSignalToggle();
assert.equal($('show-original-fft').attrs['aria-pressed'],'true');assert.equal($('show-detector-signal').disabled,true);
assert.equal($('fft-curve').disabled,false);
console.log('Image signal: shared FFT/diffraction toggle, captions, curves and missing-field fallback passed.');

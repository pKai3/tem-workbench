// Fake-clock regression: continued interaction must not conceal fresh results.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('web/app.js','utf8');
let now=0,next=0;const timers=new Map(),elements=new Map();
function node(id){
 if(!elements.has(id)){
  const classes=new Set();
  elements.set(id,{hidden:true,textContent:'old',attrs:{href:'old-image',src:'old-crop'},children:['old'],
   classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle:(x,on)=>on?classes.add(x):classes.delete(x)},
   setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]},replaceChildren(){this.children=[]}});
 }
 return elements.get(id);
}
function advance(ms){now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn()}}
let hoverHides=0,detectorHides=0;
const context=vm.createContext({assert,$:node,document:{querySelector:()=>node('previews')},hideSpectrumHover(){hoverHides++},hideCentreLoupe(){detectorHides++},
 liveSpectrumPreview:null,isDiffraction:()=>false,resetLiveRegionPreview(){},
 setTimeout(fn,ms){const id=++next;timers.set(id,{fn,at:now+ms});return id},clearTimeout:id=>timers.delete(id)});
vm.runInContext(`let spectrumLoadingTimer=null,spectrumLoading=false,fftRaw={},pending=true,editing=false;const peakEditing=()=>editing;`+
 source.slice(source.indexOf('function clearSpectrumDisplay(){'),source.indexOf('\nfunction syncLargeSpectrumSize()')),context);
const run=s=>vm.runInContext(s,context),visible=()=>!node('fft-loading').hidden;
run('beginSpectrumLoading()');
for(let i=0;i<20;i++){
 advance(200);run('beginSpectrumLoading();spectrumResultArrived()');
 assert.equal(visible(),false,'Fresh results stay visible throughout a long drag');
}
advance(800);run('beginSpectrumLoading()');assert.equal(visible(),false);
advance(200);assert.equal(visible(),true,'Pointer activity must not postpone the stall indicator');
assert.equal(node('previews').classList.contains('analysis-stalled'),true);
run('spectrumResultArrived()');assert.equal(visible(),false);
assert.equal(node('previews').classList.contains('analysis-stalled'),false);
run('pending=false;finishSpectrumLoading()');advance(2000);assert.equal(visible(),false);
run('fftRaw=null;clearSpectrumDisplay();beginSpectrumLoading()');assert.equal(visible(),true,'New image immediately shows loading');
assert.equal(node('fft-image').attrs.href,undefined);assert.equal(node('crop').attrs.src,undefined);
for(const id of ['fft-overlay','fft-axes','fft-zoom-view','fft-legend','fft-zoom-legend'])assert.deepEqual(node(id).children,[]);
assert.equal(node('fft-legend').hidden,true);
assert.equal(node('fft-stage').classList.contains('spectrum-empty'),true);
run('fftRaw={};spectrumResultArrived()');assert.equal(visible(),false);
assert.equal(node('fft-stage').classList.contains('spectrum-empty'),false);
const hidesBefore=hoverHides;
run('editing=true;pending=true;beginSpectrumLoading()');advance(1100);assert.equal(visible(),false,'Peak editing remains unblocked');
assert.equal(hoverHides,hidesBefore,'Background fitting retains the editing hover');
assert.equal(detectorHides,1,'Changing file clears the old detector preview');
console.log('Spectrum freshness, stalled feedback, source clearing and peak editing passed');

const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/map-export.js','utf8');
const state={ready:false,calls:[],scheduled:[],composed:null};
const nodes={'.map-export-status':{textContent:''},'.map-export-save':{disabled:true},'.map-export-message':{hidden:true},'.map-export-intensity input':{},'.map-export-intensity output':{}};
class Image {
 constructor(){this.naturalWidth=1864;this.naturalHeight=964;this.hidden=false}
 async decode(){}
 replaceWith(image){nodes['.map-export-preview img']=image}
}
nodes['.map-export-preview img']=new Image();
const provider={ready:()=>state.ready,
 placeholder:async choice=>{state.calls.push('placeholder');return {url:'placeholder',file_id:'current-image'}},
 render:async choice=>{state.calls.push('map');return {url:'computed-map',file_id:'current-image'}}};
const dialog={open:true,querySelector:key=>nodes[key]};
const context=vm.createContext({Image,Event:class{constructor(type,options){this.type=type;Object.assign(this,options)}},dialog,providers:new Map([['main',provider]]),activeSource:'main',revision:0,preview:null,timer:null,saving:false,
 settings:()=>({mode:'paper'}),setTimeout:callback=>state.scheduled.push(callback),clearTimeout:()=>{state.scheduled=[]},
 compose:args=>{state.composed=args;return {toDataURL:()=> 'placeholder-png'}}});
vm.runInContext(source.slice(source.indexOf(' async function placeholder('),source.indexOf(' function syncControls()'))+
 source.slice(source.indexOf(' const intensitySource='),source.indexOf(' const ready='))+
 source.slice(source.indexOf(' const ready='),source.indexOf(' function open(')),context);
const run=code=>vm.runInContext(code,context);
(async()=>{
 let events=0;const intensity={min:'0',max:'100',step:'1',value:'42',disabled:false,dispatchEvent(event){assert.equal(event.type,'input');assert.equal(event.bubbles,true);events++}};provider.intensity=()=>intensity;
 run('syncIntensity()');assert.equal(nodes['.map-export-intensity input'].value,42);assert.equal(nodes['.map-export-intensity output'].textContent,'42%');
 run('setIntensity(67)');assert.equal(intensity.value,67);assert.equal(events,1);
 Object.assign(intensity,{max:'1',step:'.05',value:'.35'});run('syncIntensity()');assert.equal(nodes['.map-export-intensity input'].value,35);assert.equal(nodes['.map-export-intensity input'].step,5);
 run('setIntensity(80)');assert.equal(intensity.value,.8);assert.equal(events,2);
 intensity.disabled=true;run('syncIntensity();setIntensity(10)');assert.equal(nodes['.map-export-intensity input'].disabled,true);assert.equal(intensity.value,.8);assert.equal(events,2);
 const rendered=await run("placeholder({source:'/api/preview?id=current-image',width:400,height:200,fieldNm:40,name:'Sample'})");
 assert.equal(rendered.placeholder,true);assert.equal(state.composed.map.src,'/api/preview?id=current-image');
 assert.equal(state.composed.width,1800);assert.equal(state.composed.height,900);assert.equal(state.composed.fieldNm,40);
 assert.equal(state.composed.legend[0].text,'Legend placeholder');assert.equal(state.composed.name,'Sample');
 await assert.rejects(run('placeholder({})'),/Select an image/);

 run('queuePreview()');assert.equal(nodes['.map-export-message'].hidden,false);
 await state.scheduled.pop()();
 assert.deepEqual(state.calls,['placeholder']);assert.equal(nodes['.map-export-preview img'].src,'placeholder');
 assert.equal(nodes['.map-export-save'].disabled,true);assert.equal(run('preview.placeholder'),true);
 assert.equal(nodes['.map-export-status'].textContent,'1864 × 964 px');

 // A completed grid may arrive while an image-only preview is still decoding.
 let resolvePlaceholder;provider.placeholder=()=>new Promise(resolve=>{resolvePlaceholder=resolve});
 run('queuePreview()');const pending=state.scheduled.pop()();state.ready=true;resolvePlaceholder({url:'old-placeholder'});await pending;
 assert.equal(nodes['.map-export-save'].disabled,true);assert.equal(run('preview'),null);
 await state.scheduled.pop()();assert.equal(nodes['.map-export-preview img'].src,'computed-map');
 assert.equal(nodes['.map-export-message'].hidden,true);assert.equal(nodes['.map-export-save'].disabled,false);assert.equal(run('preview.placeholder'),false);

 state.ready=false;provider.placeholder=async()=>{throw new Error('Image unavailable')};run('queuePreview()');await state.scheduled.pop()();
 assert.match(nodes['.map-export-status'].textContent,/Image unavailable/);assert.equal(nodes['.map-export-save'].disabled,true);assert.equal(nodes['.map-export-message'].hidden,true);
 console.log('Export preview: current image before mapping, placeholder legend, calibrated proportions, export gating and in-flight completion transition passed.');
})().catch(error=>{console.error(error);process.exitCode=1});

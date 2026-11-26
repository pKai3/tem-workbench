/* Reproduce edit/export/reopen and same-image replacement without manual Save. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/figures.js','utf8');
const savedKey='preference:tem-figures-saved-v1',draftKey='preference:tem-figures-draft-v1';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const panel=()=>({path:'/old/ab.tif',name:'ab.tif',sha256:'same-image',width:100,height:80,content_height:75,
 label:'AB',zoom:2,center_x:.4,center_y:.6,annotations:[],metadata:{magnification:{value:8000,source:'Manual'}},
 metadata_sidecar:{path:'/old/ab.txt',sha256:'same-text'},scale_nm:1000,bar_px:20});
const figure=()=>({schema_version:2,name:'AB comparison',rows:1,columns:1,slots:[panel()]});
function setup(seed){
 const disk=structuredClone(seed||{[savedKey]:JSON.stringify({one:figure(),two:{...figure(),name:'Other figure'}}),
  [draftKey]:JSON.stringify(figure()),'preference:tem-figures-current-v1':'one'});
 const local=new Map(),fields={},requests=[];
 const c={structuredClone,console:{warn(){}},Event,window:{WorkbenchWorkspaceData:{records:disk},addEventListener(){}},
  document:{getElementById:id=>fields[id]??={value:'',textContent:'',dataset:{},classList:{toggle(){}},setAttribute(){}},addEventListener(){}},
  localStorage:{get length(){return local.size},key:i=>[...local.keys()][i],getItem:k=>local.get(k)??null,
   setItem:(k,v)=>local.set(k,v),removeItem:k=>local.delete(k)},
  setTimeout(){return 1},clearTimeout(){},setInterval(){},
  fetch(url,options){return new Promise((resolve,reject)=>requests.push({body:JSON.parse(options.body),reject,
   finish(){Object.assign(disk,this.body.records);resolve({ok:true,json:async()=>({records:{...disk}})})}}))},
  selectedPanel:0,sync(){},renderCards(){},schedulePreview(){},scheduleEstimate(){},schedulePanelPreview(){},renderAnnotationOverlay(){},
  exportNotices:[],exportNotice(...args){c.exportNotices.push(args)},chooseSaved(){},reconnectSources:async()=>{},refreshLegacySlots(){},status(message,error){c.notice={message,error}},
  api:async()=>{throw Error('Unexpected API request')},crypto:{randomUUID:()=> 'created'}};
 vm.createContext(c);vm.runInContext(fs.readFileSync('web/workspace-state.js','utf8'),c);
 c.WorkbenchWorkspace=c.window.WorkbenchWorkspace;c.$=c.document.getElementById;
 c.saved=JSON.parse(disk[savedKey]);c.recipe=JSON.parse(disk[draftKey]);c.currentId='one';
 const section=(start,end)=>vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end)),c);
 section(' const blank=',' const parse=');
 section(' function draft(',' function sourceReference(');
 section(' function annotationChanged(',' function renderAnnotationOverlay(');
 section(' function changed(',' function sourceSelection(');
 section(' async function add(',' async function refreshLegacySlots(');
 // Bind the real save, switch, deletion and export button handlers.
 section("   $('fig-new').onclick=","   $('fig-tag-open').onclick=");
 return {c,disk,requests,fields,async save(){const pending=c.WorkbenchWorkspace.flush();await tick();requests.at(-1).finish();assert.equal(await pending,true)}};
}
(async()=>{
 const {c,disk,requests,fields,save}=setup();await c.WorkbenchWorkspace.configure({token:'test',sources:[]});
 const beta={type:'text',text:'β',x:.3,y:.4,size:30,color:'#ffffff'};
 c.recipe.slots[0].annotations.push(beta);c.annotationChanged();
 const saving=c.WorkbenchWorkspace.flush();await tick();
 assert.equal(JSON.parse(requests[0].body.records[savedKey]).one.slots[0].annotations[0].text,'β');
 // A subsequent edit while saving must survive the first reply and be sent next.
 c.recipe.slots[0].annotations[0].text='α_p';c.annotationChanged();requests[0].finish();await tick();
 assert.equal(requests.length,2);requests[1].finish();assert.equal(await saving,true);
 assert.equal(JSON.parse(disk[savedKey]).one.slots[0].annotations[0].text,'α_p');
 c.recipe.slots[0].annotations[0].x=.55;c.annotationChanged();
 c.api=async(path,body)=>{assert.equal(path,'figures/export');assert.equal(body.recipe.slots[0].annotations[0].x,.55);return {png:'/export.png',recipe:'/export.json',size_bytes:1}};
 c.fileSize=()=> '1 B';await fields['fig-export'].onclick();
 fields['fig-saved'].value='two';fields['fig-saved'].onchange();
 assert.equal(c.recipe.name,'Other figure');
 fields['fig-saved'].value='one';fields['fig-saved'].onchange();
 assert.equal(c.recipe.slots[0].annotations[0].x,.55,'Reopening must not discard edits after export');
 await save();
 const reopened=setup(disk);assert.equal(reopened.c.recipe.slots[0].annotations[0].text,'α_p');
 assert.equal(reopened.c.saved.one.slots[0].annotations[0].x,.55,'Named edits survive a full reload');

 // Disk errors are visible and a retry retains the latest annotation edit.
 c.recipe.slots[0].annotations[0].text='β^2';c.annotationChanged();
 const failed=c.WorkbenchWorkspace.flush();await tick();requests.at(-1).reject(Error('Disk unavailable'));
 assert.equal(await failed,false);assert.match(fields['workspace-save-status'].textContent,/Save failed/);
 c.recipe.slots[0].annotations[0].text='β^3';c.annotationChanged();await save();
 assert.equal(JSON.parse(disk[savedKey]).one.slots[0].annotations[0].text,'β^3');
 assert.equal(fields['workspace-save-status'].textContent,'Saved');

 // Source-only maintenance must not replace a legacy independent saved recipe.
 c.saved.one.slots[0].zoom=1;c.recipe.slots[0].path='/moved/ab.tif';c.changed(true,false);
 assert.equal(c.saved.one.slots[0].zoom,1);
 // Switching away checkpoints such a legacy draft before it can be discarded.
 c.selectFigure('two');assert.equal(c.saved.one.slots[0].zoom,2);c.selectFigure('one');

 // Re-selecting identical pixels preserves annotations, manual scale, labels and crop.
 c.api=async()=>({...panel(),path:'/new/renamed.tif',name:'renamed.tif',metadata_sidecar:{path:'/new/renamed.txt',sha256:'same-text'}});
 assert.equal(await c.add('/new/renamed.tif'),true);
 assert.equal(c.recipe.slots[0].annotations[0].text,'β^3');assert.equal(c.recipe.slots[0].zoom,2);
 assert.equal(c.recipe.slots[0].label,'AB');assert.equal(c.recipe.slots[0].metadata_sidecar.path,'/new/renamed.txt');
 assert.equal(c.saved.one.slots[0].path,'/new/renamed.tif');
 // A genuinely different image must not inherit old scientific annotations.
 c.api=async()=>({...panel(),sha256:'different',path:'/different.tif',name:'different.tif'});
 await c.add('/different.tif');assert.equal(c.recipe.slots[0].annotations.length,0);assert.equal(c.recipe.slots[0].zoom,1);
 // A slow inspection cannot overwrite another figure selected in the meantime.
 let finish;c.api=()=>new Promise(resolve=>finish=resolve);const inspecting=c.add('/slow.tif');
 c.selectFigure('two');const target=JSON.stringify(c.recipe);finish({...panel(),path:'/slow.tif'});
 assert.equal(await inspecting,false);assert.equal(JSON.stringify(c.recipe),target);

 // Failed manual saves must not report success; deletion detaches the draft.
 c.$('fig-name').value='Other figure';const manual=fields['fig-save'].onclick();await tick();requests.at(-1).reject(Error('Disk unavailable'));
 await manual;assert.equal(c.notice.error,true);assert.match(c.notice.message,/Could not save figure/);
 assert.equal(c.exportNotices.at(-2)[0],'Saving figure…');assert.equal(c.exportNotices.at(-1)[2],'error');
 const retry=fields['fig-save'].onclick();await tick();requests.at(-1).finish();await retry;
 assert.deepEqual(c.exportNotices.at(-1),['✓ Figure saved','Other figure','saved']);
 const deletion=fields['fig-delete'].onclick();await tick();requests.at(-1).finish();await deletion;
 assert.equal(c.currentId,'');assert.equal(c.saved.two,undefined);
 c.recipe.slots[0].annotations.push(beta);c.annotationChanged();assert.equal(c.saved.two,undefined,'Editing a detached draft cannot resurrect a deletion');
 assert.equal(JSON.parse(disk['preference:tem-figures-current-v1']||'""'),'');

 // Numeric edits are saved as they are entered, without waiting for blur.
 const editing=setup().c;editing.slot=editing.recipe.slots[0];editing.slot.annotations=[structuredClone(beta)];
 Object.assign(editing,{selectedAnnotation:0,size:{value:'34'},width:{value:'5'},annotationDefaults:{size:30,width:3,text:'β',arrowColor:'#ff2020'},updateControls(){}});
 vm.runInContext(source.slice(source.indexOf('  size.oninput='),source.indexOf('  const point=event=>')),editing);
 editing.size.oninput();assert.equal(editing.saved.one.slots[0].annotations[0].size,34);
 editing.size.value='';editing.size.oninput();assert.equal(editing.saved.one.slots[0].annotations[0].size,34);

 // Completed gestures persist; cancelled gestures restore their starting state.
 Object.assign(editing,{annotationTool:'arrow',annotationDrag:null,clamp:value=>Math.max(0,Math.min(1,value)),
  svg:{getBoundingClientRect:()=>({left:0,top:0,width:100,height:100}),setPointerCapture(){},hasPointerCapture:()=>true,releasePointerCapture(){}},
  textInput:{focus(){},select(){}}});
 vm.runInContext(source.slice(source.indexOf('  const point=event=>'),source.indexOf('  updateControls();renderAnnotationOverlay();\n }')),editing);
 const event=(x,y)=>({clientX:x,clientY:y,pointerId:1,target:{closest:()=>null},preventDefault(){}});
 editing.svg.onpointerdown(event(10,20));editing.svg.onpointermove(event(60,70));editing.svg.onpointerup(event(60,70));
 assert.equal(editing.saved.one.slots[0].annotations[1].x2,.6);assert.equal(editing.saved.one.slots[0].annotations[1].y2,.7);
 editing.width.oninput();assert.equal(editing.saved.one.slots[0].annotations[1].width,5);
 editing.svg.onpointerdown(event(10,20));editing.svg.onpointerup(event(10,20));assert.equal(editing.slot.annotations.length,2,'A click does not create a zero-length arrow');
 editing.svg.onpointerdown(event(10,20));editing.svg.onpointermove(event(90,90));editing.svg.onpointercancel();
 assert.equal(editing.slot.annotations.length,2,'Cancelled new arrows do not leave unsaved visible items');
 editing.annotationTool='select';const pick=event(30,40);pick.target.closest=()=>({dataset:{annotation:'0'}});
 editing.svg.onpointerdown(pick);editing.svg.onpointermove(event(60,70));editing.svg.onpointercancel();
 assert.equal(editing.slot.annotations[0].x,beta.x,'Cancelled text movement restores its saved position');
 console.log('Figure edits autosave across export, switching and reload; retries, identity-safe replacement, stale inspections and deletion passed.');
})().catch(error=>{console.error(error);process.exitCode=1});

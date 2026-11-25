const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/figures.js','utf8');
const section=source.slice(source.indexOf(' function sourceReference('),source.indexOf(' function exportGeometry('));
const slot=()=>({path:'/old/image.tif',name:'image.tif',sha256:'hash',label:'Original',zoom:2,
 metadata_sidecar:{path:'/old/image.txt',sha256:'txt',checks:{title:true}},annotations:[{text:'Keep me'}]});
function setup(){
 const fields=Object.fromEntries(['fig-reconnect','fig-reconnect-help','fig-reconnect-status','fig-reconnect-errors','fig-reconnect-error-list'].map(id=>[id,{textContent:'',hidden:false,items:[],replaceChildren(){this.items=[]},append(item){this.items.push(item)}}]));
 const writes=[],calls=[];
 const context={config:{figure_source_reconnect:true},recipe:{slots:[slot()]},saved:{one:{slots:[{...slot(),label:'Saved separately',zoom:1}]}},
  reconnectVersion:0,Set,Map,JSON,
  $:id=>fields[id],sourceSelection:()=>({folder:'/chosen'}),
  document:{createElement:()=>({})},WorkbenchWorkspace:{writeRaw:(key,value)=>writes.push([key,JSON.parse(value)]),flush:async()=>{}},
  changed(){writes.push(['draft',JSON.parse(JSON.stringify(context.recipe))])},
  api:async(path,body)=>new Promise(resolve=>calls.push({path,body,resolve}))};
 vm.createContext(context);vm.runInContext(section,context);
 const response=()=>({repairs:[{before:context.sourceReference(slot()),after:{path:'/new/image.tif',name:'renamed.tif',metadata_sidecar:{path:'/new/image.txt',sha256:'txt'}}}],issues:[]});
 return {context,fields,writes,calls,response};
}
(async()=>{
 {
  const {context:c,calls,writes,response,fields}=setup();
  const pending=c.reconnectSources('/new');
  assert.equal(calls[0].path,'figures/reconnect');assert.equal(calls[0].body.slots.length,1,'Deduplicate provenance, not recipes');
  c.recipe.slots[0].label='Edited while checking';c.recipe.slots.reverse();
  calls[0].resolve(response());await pending;
  assert.equal(c.recipe.slots[0].path,'/new/image.tif');assert.equal(c.recipe.slots[0].label,'Edited while checking');
  assert.equal(c.recipe.slots[0].zoom,2);assert.equal(c.saved.one.slots[0].zoom,1);
  assert.equal(c.saved.one.slots[0].label,'Saved separately');assert.equal(c.saved.one.slots[0].metadata_sidecar.path,'/new/image.txt');
  assert.equal(c.recipe.slots[0].metadata_sidecar.checks.title,true);assert.equal(c.recipe.slots[0].annotations[0].text,'Keep me');
  assert.ok(writes.some(([key])=>key==='tem-figures-saved-v1'));assert.ok(writes.some(([key])=>key==='draft'));
  assert.ok(!writes.some(([key])=>key==='tem-figures-source-folders-v1'),'One-time recovery never adds future search folders');
  assert.equal(calls[0].body.folders,undefined);assert.match(fields['fig-reconnect-status'].textContent,/Reconnected 1/);
  assert.equal(fields['fig-reconnect'].hidden,true,'Successful recovery has no manual button');
 }
 {
  const {context:c,calls,fields}=setup();
  const project=c.reconnectSources();calls[0].resolve({repairs:[],issues:[{kind:'missing',custom_folder:false,message:'Check project folder.'}]});await project;
  assert.equal(fields['fig-reconnect'].hidden,true,'Missing project sources never ask for an external folder');
  const custom=c.reconnectSources();calls[1].resolve({repairs:[],issues:[{kind:'missing',custom_folder:true,message:'Choose the custom folder.'}]});await custom;
  assert.equal(fields['fig-reconnect'].hidden,false,'Only missing custom sources expose the recovery picker');
 }
 {
  const {context:c,calls,response}=setup(),pending=c.reconnectSources();
  c.recipe.slots[0].path='/replacement.tif';c.recipe.slots[0].sha256='new';
  delete c.saved.one;
  calls[0].resolve(response());await pending;
  assert.equal(c.recipe.slots[0].path,'/replacement.tif');assert.equal(c.saved.one,undefined,'A deleted saved figure stays deleted');
 }
 {
  const {context:c,calls,response}=setup(),pending=c.reconnectSources();
  c.recipe={slots:[{...slot(),label:'New draft'}]};
  calls[0].resolve(response());await pending;
  assert.equal(c.recipe.slots[0].path,'/old/image.tif','A response for a previous draft cannot mutate the new draft');
  assert.equal(c.saved.one.slots[0].path,'/new/image.tif');
 }
 {
  const {context:c,calls,response,fields}=setup();
  const older=c.reconnectSources('/first'),newer=c.reconnectSources('/second');
  calls[1].resolve({repairs:[],issues:[{message:'Choose one copy.'}]});await newer;
  calls[0].resolve(response());await older;
  assert.equal(c.recipe.slots[0].path,'/old/image.tif');assert.equal(fields['fig-reconnect-status'].textContent,'Choose one copy.');
  assert.equal(fields['fig-reconnect-errors'].hidden,false);
 }
 {
  const {context:c,calls,response}=setup(),pending=c.reconnectSources();
  c.recipe.slots[0].metadata_sidecar.sha256='reviewed';
  calls[0].resolve(response());await pending;
  assert.equal(c.recipe.slots[0].path,'/old/image.tif','A revised provenance reference is not overwritten');
 }
 assert.match(source,/if\(version===scanVersion\)\{await reconnectSources\(\);refreshLegacySlots\(\)\}/,'Rescan includes source recovery');
 assert.match(source,/function loadRecipe\([^\n]+reconnectSources\(\)/,'Opening a saved figure checks recovery');
 console.log('Figures recovery preserves independent drafts, saved edits, metadata and in-flight changes; stale replies and deleted recipes are ignored.');
})().catch(error=>{console.error(error);process.exitCode=1});

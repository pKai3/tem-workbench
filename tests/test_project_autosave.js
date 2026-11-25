/* Exercise serialized source saves and the popup-session revert handler. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/project-tools.js','utf8'),requests=[],notices=[],fields={'folder-output':{value:'/output'},'apply-folders':{}},tick=()=>new Promise(resolve=>setImmediate(resolve));
const baseline={sources:[{id:'a',name:'Paper',path:'/data',folders:[{path:'/data',folder_modes:{}}]}],output_root:'/output'};
const context={structuredClone,sourceDraft:structuredClone(baseline.sources),sessionStart:structuredClone(baseline),sourceNameSaveQueue:Promise.resolve(),saveVersion:0,saving:false,
 $:id=>fields[id],snapshot:()=>({sources:structuredClone(context.sourceDraft),output_root:fields['folder-output'].value}),updateRevert(){},saveStatus(text,error){notices.push({text,error})},drawSources(){},panPaths(){},
 api(path,body){return new Promise((resolve,reject)=>requests.push({path,body,resolve,reject}))},
 WorkbenchWorkspace:{acceptSavedPatch(){},async configure(){}},async onSave(data){context.saved=data}};
vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  function queueSourceSave(){'),source.indexOf("  const status=document.createElement('span');status.id='project-settings-status'")),context);
(async()=>{
 context.sourceDraft[0].folders[0].folder_modes={exports:{figures:true}};const one=context.queueSourceSave();await tick();
 assert.equal(requests[0].path,'sources');assert.equal(requests[0].body.sources[0].folders[0].folder_modes.exports.figures,true);
 context.sourceDraft[0].output='/new';const two=context.queueSourceSave();requests[0].resolve({sources:requests[0].body.sources});await one;await tick();
 assert.equal(context.sourceDraft[0].output,'/new','Earlier saves never reset edits made in flight');assert.equal(requests[1].body.sources[0].output,'/new');
 requests[1].resolve({sources:requests[1].body.sources});await two;
 fields['apply-folders'].onclick();await tick();assert.deepEqual(requests[2].body,baseline,'Revert saves exactly the values captured on popup opening');
 requests[2].resolve({sources:requests[2].body.sources});await tick();
 context.sessionStart=context.snapshot();context.sourceDraft[0].name='Changed again';const next=context.queueSourceSave();await tick();requests[3].reject(new Error('Disk unavailable'));await next;
 assert.equal(context.sourceDraft[0].name,'Changed again');assert.equal(notices.at(-1).error,true,'Failed saves retain the draft and show an actionable error');
 fields['apply-folders'].onclick();await tick();assert.equal(requests[4].body.sources[0].name,'Paper');requests[4].resolve({sources:requests[4].body.sources});await tick();
 context.sourceDraft.push({name:'New',folders:[{path:''}]});await context.queueSourceSave();assert.equal(requests.length,5,'Incomplete new projects never replace saved sources');
 console.log('Project source autosave preserves in-flight edits, retries errors and reverts only the popup-session snapshot.');
})().catch(error=>{console.error(error);process.exitCode=1});

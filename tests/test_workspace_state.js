const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');

async function main(){
 const disk={'active_project':'g9','preference:tem-display':'"disk"'},local=new Map([['tem-display','"old"'],['tem-comparisons','{"presets":["ST vs STA"]}']]);
 const requests=[],listeners={},status={classList:{toggle(){}},setAttribute(){}};let fail=false;
 const context=vm.createContext({console,Event,window:{WorkbenchWorkspaceData:{records:disk,path:'/settings/tem-workbench.workspace.json'},addEventListener(){}},
  document:{getElementById:()=>status,addEventListener:(name,callback)=>{listeners[name]=callback}},
  localStorage:{get length(){return local.size},key:i=>[...local.keys()][i],getItem:k=>local.get(k)??null,setItem:(k,v)=>local.set(k,v),removeItem:k=>local.delete(k)},
  setTimeout(){return 1},clearTimeout(){},setInterval(){},
  fetch:async(url,options)=>{const body=JSON.parse(options.body);requests.push(body);if(fail)throw new Error('Disk unavailable');for(const [key,value]of Object.entries(body.records))if(!body.only_missing||!(key in disk))disk[key]=value;return {ok:true,json:async()=>({records:{...disk}})}}
 });
 vm.runInContext(fs.readFileSync('web/workspace-state.js','utf8'),context);
 const workspace=context.window.WorkbenchWorkspace;
 assert.equal(local.get('tem-display'),'"disk"');
 await workspace.configure({token:'local',sources:[]});
 assert.equal(disk['preference:tem-comparisons'],'{"presets":["ST vs STA"]}');
 assert.ok(requests[0].only_missing);
 workspace.remember('g9','aztec',{file:'Project.oipx',comparison:'map'});
 workspace.remember('g9','diffraction',{file:'image.dm4',roi:{x:17}});
 await workspace.flush();
 assert.equal(disk['bookmark:g9:aztec'].comparison,'map');
 assert.equal(disk['bookmark:g9:diffraction'].roi.x,17);
 fail=true;workspace.writeRaw('tem-comparisons','{"presets":["Updated"]}');await workspace.flush();
 assert.match(status.textContent,/Save failed/);
 fail=false;await workspace.flush();assert.equal(status.textContent,'Saved');
 assert.equal(disk['preference:tem-comparisons'],'{"presets":["Updated"]}');
 local.delete('tem-display');workspace.capture();await workspace.flush();
 assert.equal(disk['preference:tem-display'],null);

 // Project changes must not save the previous image over the target project's location.
 const app=fs.readFileSync('web/app.js','utf8'),start=app.indexOf('let diffractionBookmarkProject='),end=app.indexOf("$('source-filter').onchange=",start);
 const stored={},controls={value:'new-project'},events={};
 const c=vm.createContext({config:{files:[{id:'old.dm4',source_id:'old-project'}]},meta:{},fileId:'old.dm4',roi:{x:12,y:24,w:128,h:128},$:()=>controls,
  document:{addEventListener:(name,callback)=>events[name]=callback},
  WorkbenchWorkspace:{bookmark:(p,m)=>stored[p]||{},remember:(p,m,v)=>stored[p]=v}});
 vm.runInContext(app.slice(start,end),c);
 vm.runInContext("diffractionBookmarkProject='old-project';rememberDiffractionLocation()",c);
 assert.equal(stored['old-project'].roi.x,12);assert.equal(stored['new-project'],undefined);
 controls.value='';events['workbench-bookmark']();assert.equal(stored[''],undefined);
 vm.runInContext("diffractionBookmarkProject='';rememberDiffractionLocation()",c);assert.equal(stored[''].file,'old.dm4');
 assert.equal((app.match(/function rememberDiffractionLocation\(/g)||[]).length,1);
 assert.equal((app.match(/function rememberDiffraction\(/g)||[]).length,1);
 console.log('Workspace migration, disk retry, comparisons and separate mode/project bookmarks passed');
}
main().catch(error=>{console.error(error);process.exitCode=1});

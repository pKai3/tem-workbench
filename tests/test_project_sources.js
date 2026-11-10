// Name-only saves keep unsaved folder edits and do not restart the current view.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const app=fs.readFileSync('web/app.js','utf8'),requests=[];
const context={config:{source_name_autosave:true,sources:[{id:'a',name:'Original'},{id:'b',name:'Second'}]},WeakMap,Promise,
 api(path,body){return new Promise((resolve,reject)=>requests.push({path,body,resolve,reject}))},renderProjectFilter(){},applyCatalogue(data){context.catalogue=data}};
vm.createContext(context);vm.runInContext(app.slice(app.indexOf('let sourceNameSaveQueue='),app.indexOf('const seenFileEvents=')),context);
const status=()=>({textContent:'',classList:{add(){},remove(){}}}),tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 const source={id:'a',name:'New',path:'unsaved-folder'},input={value:'New'},notice=status();
 const one=context.saveSourceName(source,input,notice);await tick();
 assert.equal(notice.textContent,'Saving…');assert.equal(requests[0].path,'sources/rename');assert.deepEqual(Object.keys(requests[0].body).sort(),['name','source_id']);
 input.value='Newer';source.name='Newer';const two=context.saveSourceName(source,input,notice);
 requests[0].resolve({sources:[{id:'a',name:'New'},{id:'b',name:'Second'}]});await one;await tick();
 assert.equal(input.value,'Newer','Earlier saves never overwrite a newer edit');assert.equal(source.path,'unsaved-folder');
 requests[1].resolve({sources:[{id:'a',name:'Newer'},{id:'b',name:'Second'}]});await two;assert.equal(notice.textContent,'Saved');
 input.value='Second';const duplicate=context.saveSourceName(source,input,notice);await tick();requests[2].reject(new Error('Another project already uses that name.'));await duplicate;
 assert.match(notice.textContent,/already uses/);assert.equal(context.config.sources[0].name,'Newer');assert.equal(input.value,'Second');
 input.value='Newer';await context.saveSourceName(source,input,notice);assert.equal(requests.length,3,'Unchanged names do not write');
 await context.saveSourceName({name:'Unsaved'},input,notice);assert.equal(notice.textContent,'Use Save source changes');
 input.value='Queued';const skipped=context.saveSourceName(source,input,notice);input.value='Still typing';await skipped;
 input.value='Queued';const retry=context.saveSourceName(source,input,notice);await tick();
 assert.equal(requests.length,4,'A coalesced edit can be saved again later');
 requests[3].resolve({sources:[{id:'a',name:'Queued'},{id:'b',name:'Second'}]});await retry;
 assert.equal(notice.textContent,'Saved');
 console.log('Project-name autosave, queued edits, visible errors and folder-draft preservation passed.');
})().catch(error=>{console.error(error);process.exitCode=1});

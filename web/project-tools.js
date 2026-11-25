/* Shared project choices, settings and folder navigation for all workspaces. */
window.WorkbenchProjectTools=(()=>{
 const $=id=>document.getElementById(id);
 function projectChoices(sources,{customFolder=false}={}){
  return [{value:'',label:'All projects'},...(sources||[]).map(source=>({value:source.id,label:source.name||source.path})),
   ...(customFolder?[{value:'__custom__',label:'Custom folder'}]:[])];
 }
 function relativeProjectFolder(root,folder){
  const clean=value=>String(value).replaceAll('\\','/').replace(/\/+$/,'');
  const base=clean(root),path=clean(folder),windows=/^[a-z]:\//i.test(base);
  const a=windows?base.toLowerCase():base,b=windows?path.toLowerCase():path;
  if(b===a)return '.';
  if(!b.startsWith(a+'/'))throw new Error('Choose a folder inside this project.');
  return path.slice(base.length+1);
 }
 const MODES=['tem','aztec','figures'];
 const within=(path,parent)=>parent==='.'||path===parent||path.startsWith(parent+'/');
 function folderEnabled(folder,path,mode){
  const entries=Object.entries(folder.folder_modes||{}).filter(([parent,values])=>mode in values&&within(path,parent));
  entries.sort((a,b)=>b[0].length-a[0].length);
  return entries.length?entries[0][1][mode]:true;
 }
 function folderModes(folder){
  if(folder.folder_modes)return structuredClone(folder.folder_modes);
  const rules=folder.folder_rules||{},paths=new Set(['.']);
  for(const rule of Object.values(rules))for(const kind of ['include','ignore'])for(const path of rule[kind]||[])paths.add(path);
  const result={};
  for(const path of [...paths].sort((a,b)=>a.length-b.length))for(const mode of MODES){
   const enabled=[rules.all||{},rules[mode]||{}].every(rule=>(!rule.include?.length||rule.include.some(parent=>within(path,parent)))&&!rule.ignore?.some(parent=>within(path,parent)));
   if(enabled!==folderEnabled({folder_modes:result},path,mode)){result[path]??={};result[path][mode]=enabled}
  }
  return result;
 }
 function sourceFolders(source){return source.folders?.length?source.folders:[{path:source.path||'',folder_modes:folderModes(source)}]}
 function setFolderEnabled(folder,path,mode,enabled){
  folder.folder_modes??={};
  for(const [child,values] of Object.entries(folder.folder_modes))if(within(child,path)){delete values[mode];if(!Object.keys(values).length)delete folder.folder_modes[child]}
  const inherited=folderEnabled(folder,path,mode);
  if(enabled!==inherited){folder.folder_modes[path]??={};folder.folder_modes[path][mode]=enabled}
 }
 function outputPaths(folder,outputs){return outputs.flatMap(output=>{try{return [relativeProjectFolder(folder.path,output)]}catch{return []}})}
 function outputIncluded(folder,path,mode,outputs){
  const containing=outputPaths(folder,outputs).filter(output=>within(path,output));
  return !containing.length||containing.every(output=>Object.entries(folder.folder_modes||{}).some(([rule,values])=>values[mode]===true&&within(rule,output)&&within(path,rule)));
 }
 function sourceFolderEnabled(folder,path,mode,outputs){return folderEnabled(folder,path,mode)&&outputIncluded(folder,path,mode,outputs)}
 function setSourceFolderEnabled(folder,path,mode,enabled,outputs){
  setFolderEnabled(folder,path,mode,enabled);
  if(outputPaths(folder,outputs).some(output=>within(path,output))){folder.folder_modes[path]??={};folder.folder_modes[path][mode]=enabled}
 }
 const mount=(markup)=>{const template=document.createElement('template');template.innerHTML=markup;document.body.append(template.content)};
 function panPath(input){input.title=input.value;if(document.activeElement!==input)input.scrollLeft=input.scrollWidth}
 function pathInput(input){
  input.classList.add('path-input');
  input.addEventListener('input',()=>{input.title=input.value});
  input.addEventListener('change',()=>panPath(input));
  input.addEventListener('blur',()=>requestAnimationFrame(()=>panPath(input)));
  requestAnimationFrame(()=>panPath(input));
 }
 function panPaths(){requestAnimationFrame(()=>document.querySelectorAll('.path-input').forEach(panPath))}
 function showSources(dialog){if(!dialog.open){dialog.dispatchEvent(new Event('projectsettingsopen'));dialog.showModal()}panPaths()}
 document.addEventListener('toggle',panPaths,true);window.addEventListener('resize',panPaths);
 function pathText(node,value){
  node.classList.add('path-tail');node.title=value;
  const text=document.createElement('bdi');text.dir='ltr';text.textContent=value;node.replaceChildren(text);return node;
 }
 function browser(api){
  if(!$('folder-picker'))mount("<dialog id=\"folder-picker\" aria-labelledby=\"folder-picker-title\"><div class=\"panel-head\"><h2 id=\"folder-picker-title\">Choose folder</h2><button id=\"folder-close\" type=\"button\" aria-label=\"Close folder picker\">\u00d7</button></div><div class=\"folder-nav\"><button id=\"folder-up\" type=\"button\">\u2191 Up</button><button id=\"folder-home\" type=\"button\">Home</button><select id=\"folder-drive\" aria-label=\"Switch drive\" hidden><option value=\"\">Drive\u2026</option></select><input id=\"folder-path\" aria-label=\"Folder path\" type=\"text\"><button id=\"folder-go\" type=\"button\">Go</button></div><p id=\"folder-status\" class=\"hint\" role=\"status\"></p><label class=\"folder-filter\">Find<input id=\"folder-filter\" type=\"search\" placeholder=\"Filter names\"></label><div id=\"folder-list\"></div><div class=\"dialog-actions\"><button id=\"folder-cancel\" type=\"button\">Cancel</button><button id=\"folder-use\" type=\"button\" class=\"primary\">Use this folder</button></div></dialog>");
  const dialog=$('folder-picker');let listing=null,version=0,options={};
  pathInput($('folder-path'));
  function close(){version++;dialog.close()}
  async function select(path){close();await options.onSelect(path)}
  function render(){
   const host=$('folder-list'),query=$('folder-filter').value.toLowerCase();host.replaceChildren();
   for(const folder of listing.directories.filter(f=>f.name.toLowerCase().includes(query))){
    const button=document.createElement('button');button.type='button';button.textContent='▸ '+folder.name;button.title=folder.path;button.onclick=()=>browse(folder.path);host.append(button);
   }
   if(!host.childElementCount){const note=document.createElement('p');note.className='hint';note.textContent=query?'No matching names.':'No subfolders.';host.append(note)}
  }
  async function browse(path){
   const request=++version;$('folder-use').disabled=true;$('folder-status').textContent='Loading…';listing=null;
   try{
    const next=await api('browse-folders',{path});if(request!==version||!dialog.open)return;listing=next;
    $('folder-path').value=listing.path;panPath($('folder-path'));$('folder-up').disabled=listing.path===listing.parent;
    const drives=$('folder-drive');drives.replaceChildren(new Option('Drive…',''));for(const drive of listing.drives||[])drives.add(new Option(drive,drive));drives.hidden=!(listing.drives||[]).length;
    $('folder-use').disabled=false;$('folder-filter').value='';render();
    $('folder-status').textContent=`${listing.directories.length} subfolders`;
   }catch(error){if(request===version)$('folder-status').textContent=error.message}
  }
  for(const id of ['folder-close','folder-cancel'])$(id).onclick=close;
  dialog.addEventListener('cancel',()=>version++);
  $('folder-up').onclick=()=>browse(listing?.parent);$('folder-home').onclick=()=>browse(listing?.home);
  $('folder-drive').onchange=()=>browse($('folder-drive').value);$('folder-go').onclick=()=>browse($('folder-path').value);
  $('folder-path').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();browse($('folder-path').value)}};
  $('folder-filter').oninput=()=>{if(listing)render()};$('folder-use').onclick=()=>{if(listing)select(listing.path)};
  function open(settings){options=settings;$('folder-picker-title').textContent=settings.title||'Choose folder';$('folder-filter').value='';$('folder-list').replaceChildren();dialog.showModal();browse(settings.path)}
  return {open,choose(target){const input=$(target);open({path:input.value,title:target==='folder-data'||target.endsWith('-path')?'Choose source folder':'Choose output folder',onSelect:path=>{input.value=path;input.dispatchEvent(new Event('change'))}})}};
 }
 function sources({api,getConfig,onRename,onSave,chooseFolder,browseFolder}){
  $('project-settings').innerHTML=`<div class="folder-settings fallback-output"><label hidden>Data folder<span class="folder-input"><input id="folder-data" type="text" value="./data"><button id="browse-data" type="button" disabled>Browse…</button></span></label><label><span>Fallback output folder <span class="settings-help"><button class="settings-help-button" type="button" aria-label="About fallback output">ⓘ</button><span class="settings-help-popup" role="tooltip">Used when a project has no output folder, or an export combines projects with different destinations.</span></span></span><span class="folder-input"><input id="folder-output" aria-label="Fallback output folder" type="text" value="./output"><button id="browse-output" type="button" disabled>Browse…</button></span></label></div><div class="source-editor-controls"><label>Edit project<select id="source-editor-project"></select></label><button id="add-source" type="button">Add project</button></div><div class="source-actions"><button id="apply-folders" type="button" disabled>Revert changes</button><span class="hint">Changes save automatically.</span></div><div id="source-list"></div>`;
  for(const id of ['folder-data','folder-output'])pathInput($(id));
  let sourceDraft=[],editorIndex=0,sessionStart=null,saveVersion=0,saving=false;
  const snapshot=()=>({sources:structuredClone(sourceDraft),output_root:$('folder-output').value});
  const updateRevert=()=>{const button=$('apply-folders');button.disabled=!getConfig()?.folder_picker;button.hidden=!sessionStart||JSON.stringify(snapshot())===JSON.stringify(sessionStart)};
  const saveStatus=(text,error=false)=>{const status=$('project-settings-status');status.textContent=text;status.classList.toggle('error',error);$('retry-source-save').hidden=!error};
let sourceNameSaveQueue=Promise.resolve();
const pendingSourceNames=new WeakMap();
function saveSourceName(source,input,status){
 const name=input.value.trim();
 if(!source.id||!getConfig().source_name_autosave){status.textContent='';return queueSourceSave()}
 if(pendingSourceNames.get(source)===name)return sourceNameSaveQueue;
 pendingSourceNames.set(source,name);updateRevert();status.textContent='Saving…';status.classList.remove('error');
 sourceNameSaveQueue=sourceNameSaveQueue.then(async()=>{
  // Coalesce edits queued behind a different project's save.
  if(input.value.trim()!==name){if(pendingSourceNames.get(source)===name)pendingSourceNames.delete(source);return}
  try{
   if(getConfig().sources.find(s=>s.id===source.id)?.name!==name){
    const data=await api('sources/rename',{source_id:source.id,name});
    await onRename(data);
   }
   if(input.value.trim()===name){source.name=name;input.value=name;status.textContent='Saved'}
  }catch(error){
   if(input.value.trim()===name){status.textContent=error.message;status.classList.add('error')}
  }finally{if(pendingSourceNames.get(source)===name)pendingSourceNames.delete(source)}
 });
 return sourceNameSaveQueue;
}

function renderSources(){
 const previous=sourceDraft[editorIndex]?.id;
 sourceDraft=JSON.parse(JSON.stringify(getConfig().sources||[{id:'primary',name:'Images',path:getConfig().data_root,output:''}]));
 for(const source of sourceDraft){source.folders=sourceFolders(source).map(folder=>({path:folder.path,folder_modes:folderModes(folder)}));delete source.folder_rules;delete source.folder_modes}
 if(previous){const index=sourceDraft.findIndex(source=>source.id===previous);editorIndex=index<0?0:index}
 drawSources();
}
function drawSources(){
 const host=$('source-list');host.replaceChildren();editorIndex=Math.max(0,Math.min(editorIndex,sourceDraft.length-1));
 const selector=$('source-editor-project');selector.replaceChildren(...sourceDraft.map((source,index)=>new Option(source.name||'New project',String(index))));selector.value=String(editorIndex);
 selector.onchange=()=>{editorIndex=Number(selector.value);drawSources()};
 sourceDraft.forEach((source,index)=>{
  if(index!==editorIndex)return;
  const row=document.createElement('div');row.className='source-row';
  for(const [key,title] of [['name','Project name'],['output','Output folder (blank = fallback)']]){
   const label=document.createElement('label');label.textContent=title;
   const wrap=document.createElement('span');wrap.className='folder-input';
   const input=document.createElement('input');input.type='text';input.value=source[key]||'';input.id=`source-${index}-${key}`;
   input.oninput=()=>{source[key]=input.value};wrap.append(input);
   if(key==='name'){
    const status=document.createElement('span');status.className='source-name-status';status.setAttribute('role','status');label.append(status);
    input.title='Project name saves when you leave this field or press Enter';
    input.oninput=()=>{source.name=input.value;selector.options[index].textContent=input.value||'New project';status.textContent='';status.classList.remove('error');updateRevert()};
    input.onblur=()=>saveSourceName(source,input,status);
    input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();input.blur()}};
   }else{
    pathInput(input);
    const browse=document.createElement('button');browse.type='button';browse.textContent='Browse…';
    browse.onclick=()=>chooseFolder(input.id);wrap.append(browse);
    input.addEventListener('change',()=>{source[key]=input.value;queueSourceSave()});
   }
   label.append(wrap);row.append(label);
  }
  const remove=document.createElement('button');remove.type='button';remove.textContent='Remove project';remove.disabled=sourceDraft.length===1;
  remove.onclick=()=>{sourceDraft.splice(index,1);drawSources();queueSourceSave()};row.append(remove);host.append(row);
  drawSourceFolders(source,row,index);
 });
}
function drawSourceFolders(source,row,index){
 const host=document.createElement('div');host.className='project-source-folders';row.append(host);
 source.folders??=sourceFolders(source);
 for(const [i,folder] of source.folders.entries()){
  const label=document.createElement('label');label.textContent=source.folders.length>1?`Source folder ${i+1}`:'Source folder';
  const wrap=document.createElement('span');wrap.className='folder-input';
  const input=document.createElement('input');input.type='text';input.value=folder.path;input.id=i?`source-${index}-folder-${i}-path`:`source-${index}-path`;pathInput(input);
  input.oninput=()=>{folder.path=input.value;if(!i)source.path=input.value};
  input.addEventListener('change',()=>{folder.path=input.value;if(!i)source.path=input.value;renderTable();queueSourceSave()});
  const browse=document.createElement('button');browse.type='button';browse.textContent='Browse…';browse.onclick=()=>chooseFolder(input.id);
  const remove=document.createElement('button');remove.type='button';remove.textContent='Remove folder';remove.disabled=source.folders.length===1;
  remove.onclick=()=>{source.folders.splice(i,1);source.path=source.folders[0].path;drawSources();queueSourceSave()};
  wrap.append(input,browse,remove);label.append(wrap);host.append(label);
 }
 const add=document.createElement('button');add.type='button';add.textContent='Add source folder…';add.disabled=!browseFolder;
 add.onclick=()=>browseFolder({path:source.path,title:`Add source folder · ${source.name}`,onSelect:path=>{source.folders.push({path,folder_modes:{}});drawSources();queueSourceSave()}});host.append(add);
 const details=document.createElement('details');details.className='source-folder-rules';details.open=true;
 const summary=document.createElement('summary');summary.textContent='Folders by mode';details.append(summary);
 const help=document.createElement('span');help.className='settings-help';help.innerHTML='<button class="settings-help-button" type="button" aria-label="About folder checkboxes">ⓘ</button><span class="settings-help-popup" role="tooltip">Checked folders and all their subfolders are included. Untick to ignore a folder in that mode. Expand a folder to change its subfolders. New folders are included unless their parent is ignored. Export folders start excluded. You may explicitly include one; its exported images can then reappear as sources. Orange markers identify export folders, including inside collapsed parents. Changes save automatically and keep your files and saved work.</span>';summary.append(help);
 const table=document.createElement('table');table.className='source-mode-table';details.append(table);
 const notice=document.createElement('span');notice.className='source-scope-status';notice.setAttribute('role','status');details.append(notice);host.append(details);
 const children=new Map(),expanded=new Set(),pending=new Set();let generation=0;
 const key=(folder,path)=>folder.path+'\n'+path;
 const absolute=(folder,path)=>folder.path.replace(/[\\/]$/,'')+(path==='.'?'':'/'+path);
 const outputs=()=>[$('folder-output').value,...sourceDraft.map(project=>project.output),...sourceDraft.flatMap(project=>project.excluded_outputs||[])].filter(Boolean).map(path=>path.replaceAll('\\','/').replace(/\/$/,''));
 let warningTimer;
 function warnOutput(){clearTimeout(warningTimer);notice.textContent='Export folder included: exported images can reappear as source images.';notice.classList.add('source-output-warning');warningTimer=setTimeout(()=>{notice.textContent='';notice.classList.remove('source-output-warning')},7000)}
 async function load(folder,path){
  const identity=key(folder,path);if(children.has(identity)||pending.has(identity)||!folder.path)return;
  pending.add(identity);notice.textContent='Loading folders…';const version=generation;
  try{const data=await api('browse-folders',{path:absolute(folder,path)});if(version!==generation)return;
   children.set(identity,data.directories.flatMap(dir=>{try{return [{path:relativeProjectFolder(folder.path,dir.path),name:dir.name}]}catch{return []}}));notice.textContent='';renderTable(false);
  }catch(error){if(version===generation){notice.textContent=error.message;notice.classList.add('error')}}finally{pending.delete(identity)}
 }
 function renderTable(reset=true){
  if(reset){generation++;children.clear();pending.clear()}
  table.replaceChildren();const multi=source.folders.length>1,head=document.createElement('thead'),tr=document.createElement('tr');
  for(const title of [...(multi?['Source folder']:[]),'Folder name','TEM','AZtec','Figures']){const th=document.createElement('th');th.scope='col';th.textContent=title;if(title.includes('folder')||title==='Folder name')th.className='folder-name-heading';tr.append(th)}head.append(tr);table.append(head);
  for(const folder of source.folders){
   const body=document.createElement('tbody'),rows=[];
   function visit(path,name,depth){rows.push({path,name,depth});if(path==='.'||expanded.has(key(folder,path)))for(const child of children.get(key(folder,path))||[])visit(child.path,child.name,depth+1)}
   visit('.','All subfolders',0);
   const warnings=new Set(outputPaths(folder,outputs()).map(output=>rows.filter(item=>within(output,item.path)).sort((a,b)=>b.path.length-a.path.length)[0]?.path));
   for(const [i,item] of rows.entries()){
    const tr=document.createElement('tr');
    if(multi&&!i){const th=document.createElement('th');th.scope='rowgroup';th.rowSpan=rows.length;th.className='source-group-name';th.textContent=folder.path.split(/[\\/]/).filter(Boolean).at(-1)||'Source folder';th.title=folder.path;tr.append(th)}
    const name=document.createElement('th');name.scope='row';name.style.paddingLeft=`${8+item.depth*16}px`;
    if(item.path!=='.'){const toggle=document.createElement('button');toggle.type='button';toggle.className='folder-expand';toggle.textContent=(expanded.has(key(folder,item.path))?'▾  ':'▸  ')+item.name;toggle.setAttribute('aria-label',`Expand ${item.name}`);toggle.setAttribute('aria-expanded',String(expanded.has(key(folder,item.path))));toggle.onclick=()=>{const identity=key(folder,item.path);if(expanded.has(identity))expanded.delete(identity);else{expanded.add(identity);load(folder,item.path)}renderTable(false)};name.append(toggle)}
    if(item.path==='.'){const text=document.createElement('span');text.textContent=item.name;name.append(text)}name.title=absolute(folder,item.path);if(warnings.has(item.path)){const warning=document.createElement('button');warning.type='button';warning.className='source-output-marker';warning.textContent='⚠';warning.title='Export folder here or inside this folder. Including it can show exported images as sources.';warning.setAttribute('aria-label','Export folder warning for '+item.name);warning.onclick=warnOutput;name.append(warning)}tr.append(name);
    for(const mode of MODES){const td=document.createElement('td'),input=document.createElement('input');input.type='checkbox';const enabled=sourceFolderEnabled(folder,item.path,mode,outputs());
     input.checked=enabled;input.indeterminate=Object.entries(folder.folder_modes||{}).some(([path,values])=>path!==item.path&&within(path,item.path)&&mode in values&&values[mode]!==enabled)||outputPaths(folder,outputs()).some(output=>output!==item.path&&within(output,item.path)&&sourceFolderEnabled(folder,output,mode,outputs())!==enabled);
     input.setAttribute('aria-label',`${item.name} · ${mode==='aztec'?'AZtec':mode==='tem'?'TEM':'Figures'} · ${folder.path}`);input.title='Include folder and subfolders';
     input.onchange=()=>{const enabled=input.checked;setSourceFolderEnabled(folder,item.path,mode,enabled,outputs());renderTable(false);if(enabled&&outputPaths(folder,outputs()).some(output=>within(item.path,output)))warnOutput();queueSourceSave()};td.append(input);tr.append(td)}body.append(tr);
   }table.append(body);load(folder,'.');
  }
 }
 renderTable();
}
$('add-source').onclick=()=>{sourceDraft.push({name:'',path:'',output:'',folders:[{path:'',folder_modes:{}}]});editorIndex=sourceDraft.length-1;drawSources();updateRevert()};

  $('browse-data').onclick=()=>chooseFolder('folder-data');$('browse-output').onclick=()=>chooseFolder('folder-output');
  function queueSourceSave(){
   updateRevert();const revision=++saveVersion,payload=snapshot(),drafts=[...sourceDraft];
   if(payload.sources.some(source=>source.folders.some(folder=>!folder.path.trim()))){saveStatus('Choose a source folder to finish this project.');return sourceNameSaveQueue}
   saveStatus('Saving…');
   sourceNameSaveQueue=sourceNameSaveQueue.then(async()=>{
    if(revision!==saveVersion)return;
    saving=true;
    try{
     for(const [index,source] of drafts.entries())if(source.id)payload.sources[index].id=source.id;
     const data=await api('sources',payload);
     // Retain edits made while this save was in flight, including a new project's identity.
     for(const [index,source] of drafts.entries())if(!source.id&&data.sources[index])source.id=data.sources[index].id;
     if(data.workspace_patch)WorkbenchWorkspace.acceptSavedPatch(data.workspace_patch);
     await WorkbenchWorkspace.configure(data);await onSave(data);
     if(revision===saveVersion)saveStatus('Saved');
    }catch(error){if(revision===saveVersion)saveStatus(error.message,true)}
    finally{saving=false;updateRevert()}
   });return sourceNameSaveQueue;
  }
  $('apply-folders').onclick=()=>{
   if(!sessionStart)return;
   sourceDraft=structuredClone(sessionStart.sources);$('folder-output').value=sessionStart.output_root;
   drawSources();panPaths();queueSourceSave();
  };
  const status=document.createElement('span');status.id='project-settings-status';status.className='hint';status.setAttribute('role','status');$('apply-folders').after(status);
  const retry=document.createElement('button');retry.id='retry-source-save';retry.type='button';retry.textContent='Retry save';retry.hidden=true;retry.onclick=queueSourceSave;status.after(retry);
  $('folder-output').addEventListener('change',queueSourceSave);
  const dialog=$('project-settings').closest('dialog');
  dialog?.addEventListener('projectsettingsopen',()=>{sessionStart=snapshot();saveStatus('');updateRevert()});
  $('project-settings').addEventListener('input',updateRevert);
  return {render(){
   const config=getConfig();for(const id of ['browse-data','browse-output'])$(id).disabled=!config.folder_picker;
   if(!saving&&!dialog?.open){$('folder-data').value=config.data_root||'';$('folder-output').value=config.output_root||'';renderSources();panPaths()}
   updateRevert();
  },saveSourceName};
 }
 return {browser,sources,pathText,showSources,projectChoices,relativeProjectFolder,sourceFolders,folderModes,folderEnabled,setFolderEnabled,outputPaths,sourceFolderEnabled,setSourceFolderEnabled};
})();

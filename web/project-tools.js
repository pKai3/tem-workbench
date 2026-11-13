/* Shared project settings and folder navigation for both workspaces. */
window.WorkbenchProjectTools=(()=>{
 const $=id=>document.getElementById(id);
 const mount=(markup)=>{const template=document.createElement('template');template.innerHTML=markup;document.body.append(template.content)};
 function browser(api){
  if(!$('folder-picker'))mount("<dialog id=\"folder-picker\" aria-labelledby=\"folder-picker-title\"><div class=\"panel-head\"><h2 id=\"folder-picker-title\">Choose folder</h2><button id=\"folder-close\" type=\"button\" aria-label=\"Close folder picker\">\u00d7</button></div><div class=\"folder-nav\"><button id=\"folder-up\" type=\"button\">\u2191 Up</button><button id=\"folder-home\" type=\"button\">Home</button><select id=\"folder-drive\" aria-label=\"Switch drive\" hidden><option value=\"\">Drive\u2026</option></select><input id=\"folder-path\" aria-label=\"Folder path\" type=\"text\"><button id=\"folder-go\" type=\"button\">Go</button></div><p id=\"folder-status\" class=\"hint\" role=\"status\"></p><label class=\"folder-filter\">Find<input id=\"folder-filter\" type=\"search\" placeholder=\"Filter names\"></label><div id=\"folder-list\"></div><div class=\"dialog-actions\"><button id=\"folder-cancel\" type=\"button\">Cancel</button><button id=\"folder-use\" type=\"button\" class=\"primary\">Use this folder</button></div></dialog>");
  const dialog=$('folder-picker');let listing=null,version=0,options={};
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
    $('folder-path').value=listing.path;$('folder-up').disabled=listing.path===listing.parent;
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
 function sources({api,getConfig,onRename,onSave,chooseFolder}){
  $('project-settings').innerHTML="<div class=\"source-actions\"><button id=\"apply-folders\" type=\"button\" disabled>Save source changes</button><span class=\"hint\">Project names save automatically.</span></div><div id=\"source-list\"></div><button id=\"add-source\" type=\"button\">Add project source</button><div class=\"folder-settings\"><label hidden>Data folder<span class=\"folder-input\"><input id=\"folder-data\" type=\"text\" value=\"./data\"><button id=\"browse-data\" type=\"button\" disabled>Browse\u2026</button></span></label><label>Main output folder<span class=\"folder-input\"><input id=\"folder-output\" type=\"text\" value=\"./output\"><button id=\"browse-output\" type=\"button\" disabled>Browse\u2026</button></span></label></div>";
  let sourceDraft=[];
let sourceNameSaveQueue=Promise.resolve();
const pendingSourceNames=new WeakMap();
function saveSourceName(source,input,status){
 const name=input.value.trim();
 if(!source.id||!getConfig().source_name_autosave){status.textContent='Use Save source changes';return sourceNameSaveQueue}
 if(pendingSourceNames.get(source)===name)return sourceNameSaveQueue;
 pendingSourceNames.set(source,name);status.textContent='Saving…';status.classList.remove('error');
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
 sourceDraft=(getConfig().sources||[{id:'primary',name:'Images',path:getConfig().data_root,output:''}]).map(s=>({...s}));
 drawSources();
}
function drawSources(){
 const host=$('source-list');host.replaceChildren();
 sourceDraft.forEach((source,index)=>{
  const row=document.createElement('div');row.className='source-row';
  for(const [key,title] of [['name','Project'],['path','Source folder'],['output','Output folder (blank = main)']]){
   const label=document.createElement('label');label.textContent=title;
   const wrap=document.createElement('span');wrap.className='folder-input';
   const input=document.createElement('input');input.type='text';input.value=source[key]||'';input.id=`source-${index}-${key}`;
   input.oninput=()=>{source[key]=input.value};wrap.append(input);
   if(key==='name'){
    const status=document.createElement('span');status.className='source-name-status';status.setAttribute('role','status');label.append(status);
    input.title='Project name saves when you leave this field or press Enter';
    input.oninput=()=>{source.name=input.value;status.textContent='Unsaved';status.classList.remove('error')};
    input.onblur=()=>saveSourceName(source,input,status);
    input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();input.blur()}};
   }else{
    const browse=document.createElement('button');browse.type='button';browse.textContent='Browse…';
    browse.onclick=()=>chooseFolder(input.id);wrap.append(browse);
    input.addEventListener('change',()=>{source[key]=input.value});
   }
   label.append(wrap);row.append(label);
  }
  const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.disabled=sourceDraft.length===1;
  remove.onclick=()=>{sourceDraft.splice(index,1);drawSources()};row.append(remove);host.append(row);
 });
}
$('add-source').onclick=()=>{sourceDraft.push({name:'',path:'',output:''});drawSources()};

  $('browse-data').onclick=()=>chooseFolder('folder-data');$('browse-output').onclick=()=>chooseFolder('folder-output');
  $('apply-folders').onclick=async()=>{
   $('apply-folders').disabled=true;const status=$('project-settings-status');status.textContent='Saving…';status.classList.remove('error');
   try{await sourceNameSaveQueue;const data=await api('sources',{sources:sourceDraft,output_root:$('folder-output').value});await onSave(data);status.textContent='Saved'}
   catch(error){status.textContent=error.message;status.classList.add('error')}
   finally{$('apply-folders').disabled=!getConfig()?.folder_picker}
  };
  const status=document.createElement('span');status.id='project-settings-status';status.className='hint';status.setAttribute('role','status');$('apply-folders').after(status);
  return {render(){const config=getConfig();$('folder-data').value=config.data_root||'';$('folder-output').value=config.output_root||'';for(const id of ['browse-data','browse-output','apply-folders'])$(id).disabled=!config.folder_picker;renderSources()},saveSourceName};
 }
 return {browser,sources};
})();

/* Shared disk state is loaded before either viewer reads its browser preferences. */
(() => {
 'use strict';
 const seed=window.WorkbenchWorkspaceData||{records:{}},records={...seed.records};
 const prefix='preference:',snapshot=new Map(),pending=new Map();
 let token='',timer=null,saving=null,error=seed.error||'',sources=[];
 const local=()=>{const values={};try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith('tem-'))values[key]=localStorage.getItem(key)}}catch{}return values};
 const legacy=local();
 for(const [key,value] of Object.entries(records))if(key.startsWith(prefix)){
  try{if(value===null)localStorage.removeItem(key.slice(prefix.length));else localStorage.setItem(key.slice(prefix.length),value)}catch{}
 }
 for(const [key,value] of Object.entries(local()))snapshot.set(key,value);
 function status(){
  const node=document.getElementById('workspace-save-status');if(!node)return;
  node.textContent=error?'Save failed · retry':saving||pending.size?'Saving…':'Saved';
  node.classList.toggle('workspace-save-error',!!error);
  node.title=error?`${error}\nSettings file: ${seed.path}`:`Settings, locations and named comparisons are saved automatically to ${seed.path}`;
  node.setAttribute('aria-label',node.title);node.onclick=()=>{capture();flush()};
 }
 function set(key,value){
  const copy=value===undefined?null:JSON.parse(JSON.stringify(value));
  if(JSON.stringify(records[key])===JSON.stringify(copy))return;
  records[key]=copy;pending.set(key,copy);clearTimeout(timer);timer=setTimeout(flush,300);status();
 }
 function capture(){
  const values=local();
  for(const [key,value] of Object.entries(values))if(snapshot.get(key)!==value){snapshot.set(key,value);set(prefix+key,value)}
  for(const key of [...snapshot.keys()])if(!(key in values)){snapshot.delete(key);set(prefix+key,null)}
 }
 async function post(changes,onlyMissing=false){
  const response=await fetch('/api/workspace',{method:'POST',headers:{'Content-Type':'application/json','X-TEM-Token':token},body:JSON.stringify({records:changes,only_missing:onlyMissing}),keepalive:JSON.stringify(changes).length<50000});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not save workspace settings.');return data;
 }
 async function flush(){
  clearTimeout(timer);if(!token)return;
  if(saving){await saving;if(pending.size&&!error)return flush();return}
  if(!pending.size){status();return}
  const changes=Object.fromEntries(pending);pending.clear();
  saving=(async()=>{try{await post(changes);error=''}catch(e){error=e.message;for(const [k,v] of Object.entries(changes))if(!pending.has(k))pending.set(k,v);console.warn('Workspace save failed:',e.message)}})();
  status();await saving;saving=null;status();if(pending.size&&!error)return flush();
 }
 async function configure(config){
  token=config.token;sources=config.sources||[];
  const migration=Object.fromEntries(Object.entries(legacy).filter(([k])=>!(prefix+k in records)).map(([k,v])=>[prefix+k,v]));
  try{if(Object.keys(migration).length){const saved=await post(migration,true);for(const [key,value] of Object.entries(saved.records))if(!(key in records))records[key]=value}error=seed.error||''}catch(e){error=e.message}
  capture();await flush();status();
 }
 function readRaw(key){try{return localStorage.getItem(key)??records[prefix+key]??null}catch{return records[prefix+key]??null}}
 function writeRaw(key,value){try{localStorage.setItem(key,value);snapshot.set(key,value)}catch{}set(prefix+key,value)}
 const bookmarkKey=(project,mode)=>'bookmark:'+encodeURIComponent(project||'all')+':'+mode;
 window.WorkbenchWorkspace={configure,set,get:(key,fallback)=>records[key]??fallback,flush,capture,readRaw,writeRaw,
  bookmark:(project,mode)=>records[bookmarkKey(project,mode)]||{},
  remember:(project,mode,value)=>set(bookmarkKey(project,mode),value),
  projectForPath(path){const normalized=String(path||'').replaceAll('\\','/');return [...sources].sort((a,b)=>b.path.length-a.path.length).find(s=>normalized===s.path.replaceAll('\\','/')||normalized.startsWith(s.path.replaceAll('\\','/').replace(/\/$/,'')+'/'))?.id||''}
 };
 document.addEventListener('DOMContentLoaded',status);
 for(const name of ['input','change','click'])document.addEventListener(name,()=>setTimeout(capture,0),true);
 setInterval(capture,1000);
 window.addEventListener('pagehide',()=>{document.dispatchEvent(new Event('workbench-bookmark'));capture();flush()});
 document.addEventListener('click',async event=>{
  const link=event.target.closest('a.workspace-link');if(!link||event.ctrlKey||event.metaKey||event.shiftKey||event.button)return;
  event.preventDefault();document.dispatchEvent(new Event('workbench-bookmark'));capture();await flush();if(error)return;location.assign(link.href);
 });
})();

/* Consistent dismissal for every dialog, including dynamically created/nested views. */
(() => {
 'use strict';
 const opened=[];
 let pressedOutside=null;
 function track(dialog){const index=opened.indexOf(dialog);if(index>=0)opened.splice(index,1);opened.push(dialog)}
 document.addEventListener('beforetoggle',event=>{
  if(event.target.tagName==='DIALOG'&&event.newState==='open')track(event.target);
 },true);
 function topDialog(){
  const current=[...document.querySelectorAll('dialog[open]')];
  for(const dialog of current)if(!opened.includes(dialog))track(dialog);
  for(let i=opened.length-1;i>=0;i--)if(!current.includes(opened[i]))opened.splice(i,1);
  const modal=opened.filter(dialog=>dialog.matches(':modal')).at(-1);
  return modal?opened.filter(dialog=>dialog===modal||modal.contains(dialog)).at(-1):opened.at(-1);
 }
 function outside(dialog,event){
  if(event.target!==dialog&&dialog.contains(event.target))return false;
  const box=dialog.getBoundingClientRect();
  return event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom;
 }
 function dismiss(dialog){
  // Keep existing cleanup/bookmark hooks and cancel handlers in the normal lifecycle.
  if(dialog.dispatchEvent(new Event('cancel',{cancelable:true})))dialog.close();
 }
 document.addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  const dialog=topDialog();if(!dialog)return;
  event.preventDefault();event.stopImmediatePropagation();dismiss(dialog);
 },true);
 document.addEventListener('pointerdown',event=>{
  const dialog=topDialog();pressedOutside=event.button===0&&dialog&&outside(dialog,event)?dialog:null;
 },true);
 document.addEventListener('pointercancel',()=>{pressedOutside=null},true);
 document.addEventListener('click',event=>{
  const dialog=topDialog(),pressed=pressedOutside;pressedOutside=null;
  if(!dialog||pressed!==dialog||!outside(dialog,event))return;
  event.preventDefault();event.stopImmediatePropagation();dismiss(dialog);
 },true);
})();

/* Saved-item previews never switch or save the active workspace. */
window.WorkbenchPreviewPicker={
 createCache(render){
  const cache=new Map();let queue=Promise.resolve();
  return (entry,wanted=()=>true)=>{
   const snapshot=structuredClone(entry),key=JSON.stringify([snapshot.table||snapshot.value,snapshot.item]);
   const task=queue.then(async()=>{
    if(!wanted())return null;
    const hit=cache.get(key);if(hit&&Date.now()-hit.time<60000){cache.delete(key);cache.set(key,hit);return hit.image}
    const image=await render(snapshot);cache.set(key,{image,time:Date.now()});while(cache.size>8)cache.delete(cache.keys().next().value);return image;
   });queue=task.catch(()=>{});return task;
  };
 },
 open({anchor,entries,selected,preview,onSelect,title:heading='Saved comparisons',noun='comparison',plural='comparisons'}){
  const make=(tag,text,cls)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(cls)node.className=cls;return node};
  const dialog=make('dialog',null,'saved-preview-picker'),head=make('div',null,'saved-preview-picker-head'),close=make('button','×');
  dialog.setAttribute('aria-label',heading+' preview picker');close.type='button';close.setAttribute('aria-label','Close '+noun+' picker');close.onclick=()=>dialog.close();head.append(make('strong',heading),close);
  const body=make('div',null,'saved-preview-picker-body'),list=make('div',null,'saved-preview-picker-list'),pane=make('div',null,'saved-preview-picker-preview'),title=make('strong'),stage=make('div',null,'saved-preview-picker-image'),status=make('p','Hover or focus a '+noun+' to preview it.','hint'),open=make('button','Open '+noun);
  list.setAttribute('aria-label',heading);status.setAttribute('role','status');open.type='button';open.disabled=true;pane.append(title,stage,status,open);body.append(list,pane);dialog.append(head,body);
  let active=null,timer=null,revision=0;const buttons=[];
  const choose=()=>{if(!active)return;const value=active.value;dialog.close();onSelect(value)};open.onclick=choose;
  function show(entry,button){
   if(active===entry)return;active=entry;clearTimeout(timer);const turn=++revision;
   for(const item of buttons)item.classList.toggle('saved-preview-active',item===button);
   title.textContent=entry.item.name;stage.replaceChildren();status.textContent='Loading preview…';open.disabled=false;
   timer=setTimeout(async()=>{
    const wanted=()=>dialog.open&&turn===revision;
    try{const source=await preview(entry,wanted);if(!wanted()||!source)return;const image=make('img');image.alt=entry.item.name+' '+noun+' preview';image.src=source;await image.decode();if(!wanted())return;stage.replaceChildren(image);status.textContent='';}
    catch(error){if(wanted())status.textContent='Preview unavailable: '+error.message}
   },160);
  }
  let family=null;
  for(const entry of entries){
   if(entry.family&&entry.family!==family){family=entry.family;list.append(make('div',family,'saved-preview-picker-group'))}
   const button=make('button',entry.item.name);button.type='button';button.setAttribute('aria-current',String(entry.value===selected));buttons.push(button);list.append(button);
   button.onmouseenter=()=>show(entry,button);button.onfocus=()=>show(entry,button);
   button.onclick=event=>{show(entry,button);if(event.pointerType!=='touch')choose()};
   button.onkeydown=event=>{const index=buttons.indexOf(button),next=event.key==='ArrowDown'?Math.min(buttons.length-1,index+1):event.key==='ArrowUp'?Math.max(0,index-1):event.key==='Home'?0:event.key==='End'?buttons.length-1:null;if(next!==null){event.preventDefault();buttons[next].focus()}};
  }
  if(!entries.length){list.append(make('p','No saved '+plural+' yet.','hint'));status.textContent='Save a '+noun+' to preview it here.'}
  const dismiss=()=>dialog.close();
  dialog.addEventListener('close',()=>{++revision;clearTimeout(timer);window.removeEventListener('resize',dismiss);anchor.setAttribute('aria-expanded','false');dialog.remove();if(anchor.isConnected)anchor.focus({preventScroll:true})},{once:true});
  document.body.append(dialog);dialog.showModal();anchor.setAttribute('aria-expanded','true');window.addEventListener('resize',dismiss);
  const box=anchor.getBoundingClientRect(),size=dialog.getBoundingClientRect();dialog.style.left=Math.max(8,Math.min(box.left,innerWidth-size.width-8))+'px';dialog.style.top=Math.max(8,Math.min(box.bottom+6,innerHeight-size.height-8))+'px';
  (buttons.find(button=>button.getAttribute('aria-current')==='true')||buttons[0]||close).focus({preventScroll:true});
 }
};

/* Shared colour memory across Figures and AZtec comparisons; no automatic assignment. */
(() => {
 'use strict';
 const storageKey='tem-aztec-label-colours-v1',limit=128;
 const normalise=value=>{const hex=String(value||'').trim().replace(/^#/,'');return /^(?:[\da-f]{3}|[\da-f]{6})$/i.test(hex)?'#'+(hex.length===3?[...hex].map(c=>c+c).join(''):hex).toLowerCase():null};
 const name=value=>String(value||'').trim().replace(/\s+/g,' ').toLowerCase();
 const clean=entry=>({colour:normalise(entry?.colour),label:String(entry?.label||'').trim().slice(0,120),sample:String(entry?.sample||'').trim().slice(0,120),used:Number(entry?.used)||0});
 const identity=entry=>[entry.colour,name(entry.label),name(entry.sample)].join('|');
 function suggestions(history,inUse,context){
  const wantedLabel=name(context.label),wantedSample=name(context.sample),colours=new Map();
  for(const entry of [...history.map(e=>({...e,inUse:false})),...inUse.map(e=>({...e,inUse:true}))]){
   const item={...clean(entry),inUse:entry.inUse};if(!item.colour)continue;
   const names=[name(item.label),name(item.sample)].filter(Boolean);
   const labelMatch=!!wantedLabel&&names.includes(wantedLabel),sampleMatch=!!wantedSample&&names.includes(wantedSample);
   item.rank=labelMatch?0:sampleMatch?1:item.inUse?2:3;
   item.reason=labelMatch?'Matches '+context.label:sampleMatch?'Matches '+context.sample:item.inUse?'In use':'Recent';
   const previous=colours.get(item.colour);
   if(!previous||item.rank<previous.rank||item.rank===previous.rank&&(item.inUse>previous.inUse||item.inUse===previous.inUse&&item.used>previous.used))colours.set(item.colour,item);
  }
  return [...colours.values()].sort((a,b)=>a.rank-b.rank||Number(b.inUse)-Number(a.inUse)||b.used-a.used||a.colour.localeCompare(b.colour)).slice(0,24);
 }
 function create(storage){
  let history=[];
  const refresh=()=>{try{const stored=JSON.parse(storage.readRaw(storageKey)||'[]');if(Array.isArray(stored))history=stored.map(clean).filter(e=>e.colour).sort((a,b)=>b.used-a.used).slice(0,limit)}catch{}};
  refresh();
  const save=()=>storage.writeRaw(storageKey,JSON.stringify(history));
  function remember(entry){refresh();const item=clean(entry);if(!item.colour)return;item.used=Math.max(Date.now(),(history[0]?.used||0)+1);history=[item,...history.filter(e=>identity(e)!==identity(item))].slice(0,limit);save()}
  function seed(entries){refresh();let changed=false;for(const entry of entries){const item=clean(entry);if(item.colour&&!history.some(e=>identity(e)===identity(item))){history.push(item);changed=true}}if(changed){history=history.slice(0,limit);save()}}
  return {remember,seed,suggestions:(inUse,context)=>{refresh();return suggestions(history,inUse,context)}};
 }
 let active=null;
 function open({anchor,title,colour,choices,onSelect,focus=true}){
  if(active){active.close();active=null}
  const make=(tag,text,cls)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(cls)node.className=cls;return node};
  const dialog=make('dialog',null,'eds-colour-palette'),head=make('div',null,'eds-colour-palette-head'),heading=make('strong','Label colour'),close=make('button','×');
  dialog.setAttribute('aria-label','Label colours for '+title);close.type='button';close.setAttribute('aria-label','Close colour suggestions');close.onclick=()=>dialog.close();head.append(heading,close);dialog.append(head);
  let section=null,grid=null;
  for(const choice of choices){
   const group=choice.rank<2?'Suggested':choice.rank===2?'In use':'Recent';
   if(group!==section){section=group;dialog.append(make('span',group,'eds-colour-palette-heading'));grid=make('div',null,'eds-colour-swatches');dialog.append(grid)}
   const button=make('button'),swatch=make('span',null,'eds-colour-swatch'),caption=make('span',choice.colour);button.type='button';swatch.style.backgroundColor=choice.colour;
   button.title=choice.reason+(choice.label?' · '+choice.label:'');button.setAttribute('aria-label',choice.colour+' · '+choice.reason);button.setAttribute('aria-pressed',String(choice.colour===normalise(colour)));button.append(swatch,caption);button.onclick=()=>{onSelect(choice.colour);dialog.close()};grid.append(button);
  }
  if(!choices.length)dialog.append(make('p','Your chosen colours will appear here.','hint'));
  const custom=make('label','Custom colour'),picker=make('input');picker.type='color';picker.value=normalise(colour)||'#0c131c';picker.setAttribute('aria-label','Custom label colour');picker.onchange=()=>{onSelect(picker.value);dialog.close()};custom.append(picker);dialog.append(custom);
  const parent=anchor.closest('dialog[open]')||document.body,closeWithParent=()=>dialog.close();
  parent.addEventListener('close',closeWithParent);
  dialog.addEventListener('close',()=>{if(active===dialog)active=null;parent.removeEventListener('close',closeWithParent);anchor.setAttribute('aria-expanded','false');dialog.remove();if(anchor.isConnected)anchor.focus({preventScroll:true})},{once:true});
  parent.append(dialog);dialog.show();active=dialog;anchor.setAttribute('aria-expanded','true');
  const box=anchor.getBoundingClientRect(),size=dialog.getBoundingClientRect();
  dialog.style.left=Math.max(8,Math.min(box.left,innerWidth-size.width-8))+'px';
  dialog.style.top=Math.max(8,Math.min(box.bottom+6,innerHeight-size.height-8))+'px';
  (focus?(dialog.querySelector('.eds-colour-swatches button')||picker):anchor).focus({preventScroll:true});
 }
 window.WorkbenchLabelColours={normalise,create,suggestions,open};
})();

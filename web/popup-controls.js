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
  return opened.filter(dialog=>dialog.matches(':modal')).at(-1)||opened.at(-1);
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

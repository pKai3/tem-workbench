/* Shared export progress and result notice for both Workbench views. */
window.WorkbenchExportNotice=(()=>{
 const $=id=>document.getElementById(id);
 let timer=null;
 function hide(){
  clearTimeout(timer);timer=null;
  const notice=$('export-notice');
  if(notice.hidePopover&&notice.matches(':popover-open'))notice.hidePopover();
  notice.hidden=true;
 }
 function show(title,detail='',state='busy'){
  clearTimeout(timer);timer=null;
  const notice=$('export-notice');notice.dataset.state=state;
  // A modal makes elements outside it inert, including top-layer popovers.
  const host=[...document.querySelectorAll('dialog:modal')].at(-1)||document.body;
  if(notice.parentElement!==host)host.append(notice);
  notice.setAttribute('role',state==='error'?'alert':'status');
  notice.setAttribute('aria-live',state==='error'?'assertive':'polite');
  $('export-notice-title').textContent=title;$('export-notice-detail').textContent=detail;notice.hidden=false;
  if(notice.showPopover&&!notice.matches(':popover-open'))notice.showPopover();
  if(state==='saved')timer=setTimeout(hide,5000);
 }
 document.addEventListener('close',event=>{
  const notice=$('export-notice');
  if(event.target.contains?.(notice)&&!notice.hidden)show($('export-notice-title').textContent,$('export-notice-detail').textContent,notice.dataset.state);
 },true);
 $('export-notice-close').onclick=hide;
 return {show,hide};
})();

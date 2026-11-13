/* Local interaction/error log. No pixels, spectra, keystrokes or polling noise. */
function diagnosticControl(target){
 const id=target?.dataset?.diagnosticControl||target?.id;if(!id||target.type==='password'||target.type==='file')return null;
 if(target.type==='checkbox')return {control:id,value:target.checked};
 return {control:id,value:String(target.value??'').slice(0,160)};
}
if(typeof module!=='undefined')module.exports={diagnosticControl};
if(typeof document!=='undefined'){
 let queued=[],timer=null,sending=false,transport=null,context=()=>({});
 window.configureWorkbenchDiagnostics=options=>{transport=options.send;context=options.context||context;log('connection',{message:'Workspace connected'})};
 function log(kind,fields){
  queued.push({kind,...fields,file_id:typeof fileId==='string'?fileId:undefined,...context()});
  if(queued.length>100)queued.shift();
  if(!timer)timer=setTimeout(flush,800);
 }
 async function flush(){
  timer=null;
  if(sending||(!transport&&(typeof config==='undefined'||!config?.diagnostics)))return;
  const events=queued.splice(0,30);if(!events.length)return;
  sending=true;
  try{await (transport?transport({events}):api('diagnostics',{events}))}catch{/* Logging must never break analysis or recursively log itself. */}
  finally{sending=false;if(queued.length&&!timer)timer=setTimeout(flush,800)}
 }
 document.addEventListener('change',event=>{const value=diagnosticControl(event.target);if(value)log('change',value)});
 document.addEventListener('click',event=>{
  const button=event.target.closest?.('button,summary,[role="tab"]');
  if(button)log('action',{control:button.dataset.diagnosticControl||button.id||button.closest('[id]')?.id||button.tagName,value:button.textContent.trim().slice(0,100)});
 });
 window.addEventListener('error',event=>log('error',{message:event.message||'Resource failed to load',stack:String(event.error?.stack||event.filename||'').slice(0,3000)}));
 window.addEventListener('unhandledrejection',event=>log('rejection',{message:String(event.reason?.message||event.reason),stack:String(event.reason?.stack||'').slice(0,3000)}));
 document.addEventListener('tem-image-opened',()=>log('connection',{message:'Viewer opened image / restored retained jobs'}));
 window.addEventListener('online',()=>log('connection',{message:'Browser online'}));
 window.addEventListener('offline',()=>log('connection',{message:'Browser offline'}));
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flush()});
}

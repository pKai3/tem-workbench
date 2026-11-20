const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync('web/figures.js','utf8'),fields={};
const metadataFilters=[['fig-filter-mag','magnification'],['fig-filter-kv','voltage_kv'],['fig-filter-probe','probe'],['fig-filter-wd','working_distance'],['fig-filter-date','acquisition_date']];
for(const id of ['fig-browser-search','fig-filter-type','fig-filter-folder','fig-filter-sidecar','fig-browser-sort',...metadataFilters.map(([id])=>id)])fields[id]={value:''};
fields['fig-filter-subfolders']={checked:true};fields['fig-browser-sort'].value='folder';
const rows=[
 {name:'image10.TIF',path:'/source/image10.TIF',folder:'.',has_sidecar:true,metadata:{magnification:{value:8000},acquisition_date:{value:'2026-11-19'}}},
 {name:'image2.tiff',path:'/source/image2.tiff',folder:'.',has_sidecar:false},
 {name:'native.dm4',path:'/source/site 2/native.dm4',folder:'site 2',thumbnail_path:'/source/site 2/native.PNG',has_sidecar:null},
 {name:'photo.jpg',path:'/source/site 2/deeper/photo.jpg',folder:'site 2/deeper',has_sidecar:true,metadata:{acquisition_date:{value:'2026-11-20'}}},
 {name:'photo.JPEG',path:'/source/site 20/photo.JPEG',folder:'site 20',has_sidecar:false},
 {name:'native.png',path:'/source/native.png',folder:'.',has_sidecar:false}
];
let saved,rendered=0;
const context={$:id=>fields[id],files:rows,metadataFilters,cachedMetadata:row=>row.metadata||{},
 WorkbenchWorkspace:{writeRaw(key,value){saved=JSON.parse(value)}},renderBrowser(){rendered++}};
vm.createContext(context);
vm.runInContext(app.slice(app.indexOf(' function naturalCompare('),app.indexOf(' function renderBrowser(){')),context);
const found=()=>Array.from(context.matchingBrowserFiles(),row=>row.path);
assert.deepEqual(found().slice(0,3),['/source/image2.tiff','/source/image10.TIF','/source/native.png']);
fields['fig-filter-type'].value='tiff';assert.equal(found().length,2);
fields['fig-filter-type'].value='jpeg';assert.equal(found().length,2);
fields['fig-filter-type'].value='png';assert.equal(found().length,1);
fields['fig-filter-type'].value='dm4';assert.deepEqual(found(),['/source/site 2/native.dm4']);
fields['fig-filter-sidecar'].value='no';assert.equal(found().length,0,'DM4 does not count as missing a TXT sidecar');fields['fig-filter-sidecar'].value='';
fields['fig-filter-type'].value='';fields['fig-filter-folder'].value='site 2';assert.equal(found().length,2);
fields['fig-filter-subfolders'].checked=false;assert.deepEqual(found(),['/source/site 2/native.dm4']);
fields['fig-filter-subfolders'].checked=true;fields['fig-browser-search'].value='PHOTO deeper';assert.deepEqual(found(),['/source/site 2/deeper/photo.jpg']);
fields['fig-filter-sidecar'].value='no';assert.equal(found().length,0);
context.resetBrowserFilters();assert.equal(rendered,1);assert.deepEqual(saved,{type:'',sort:'folder',subfolders:true});
fields['fig-filter-mag'].value='8000';assert.deepEqual(found(),['/source/image10.TIF']);
fields['fig-filter-mag'].value='';fields['fig-browser-sort'].value='date';assert.deepEqual(found().slice(0,2),['/source/site 2/deeper/photo.jpg','/source/image10.TIF']);
fields['fig-filter-folder'].value='.';fields['fig-filter-subfolders'].checked=false;assert.equal(found().length,3);
assert.equal(rows[0].name,'image10.TIF','Sorting never mutates the source list');
console.log('Figures format aliases, DM4 previews, nested-folder boundaries, combined search, metadata, ordering and reset passed.');

(async()=>{
 const base={path:'/tem.tif',sha256:'same',inspection_version:7,width:1024,height:1056,content_height:1056,footer_detected:false};
 const automatic={...base},manual={...base,content_height:990,scale_nm:500,scale_source:'Manual',bar_px:100,
  metadata:{magnification:{value:45000,source:'Manual'}}};
 const manualScale={...base,scale_nm:500,scale_source:'Manual',bar_px:100,scale_mode:'replace'};
 const changed={...base,sha256:'changed'};
 const ctx={recipe:{slots:[automatic,manual,manualScale,changed]},status(){},changed(){},
  api:async()=>({...base,inspection_version:10,content_height:1024,footer_detected:true,bar:{w:362},bar_px:362,
   scale_nm:200,scale_source:'Footer OCR',scale_mode:'replace',metadata:{magnification:{value:40000,source:'Footer OCR'}}})};
 vm.createContext(ctx);
 vm.runInContext(app.slice(app.indexOf(' async function refreshLegacySlots(){'),app.indexOf('\n function ',app.indexOf(' async function refreshLegacySlots(){'))),ctx);
 await ctx.refreshLegacySlots();
 assert.equal(automatic.content_height,1024);assert.equal(automatic.scale_nm,200);assert.equal(automatic.bar_px,362);
 assert.equal(manual.content_height,990);assert.equal(manual.scale_nm,500);assert.equal(manual.bar_px,100);
 assert.equal(manual.metadata.magnification.value,45000);assert.equal(manual.inspection_version,10);
 assert.equal(manualScale.content_height,1024);assert.equal(manualScale.scale_nm,500);assert.equal(manualScale.bar_px,100);
 assert.equal(changed.inspection_version,7);assert.equal(changed.content_height,1056);
 console.log('Footer upgrades preserve manual metadata, crop and scale, and reject changed source bytes.');
})().catch(error=>{console.error(error);process.exitCode=1});

/* Figures uses the same progress/result popup and allows exports above 120 MP. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/figures.js','utf8'),html=fs.readFileSync('web/figures.html','utf8');
const markup=text=>text.match(/<aside id="export-notice"[\s\S]*?<\/aside>/)[0];
assert.equal(markup(html),markup(fs.readFileSync('web/aztec.html','utf8')));
assert.ok(html.indexOf('/export-notice.js')<html.indexOf('/figures.js'));
const fields={},notices=[],requests=[];
const slot={path:'/original.tif',label:'AB',scale_mode:'replace',bar_px:64,scale_nm:1000,zoom:1};
const c={structuredClone,Boolean,String,Number,hoverEnabled:true,recipe:{name:'Large montage',rows:11,columns:11,slots:[slot],export_scale_percent:100,metadata_overlay:[]},
 $:id=>fields[id]??={value:'',dataset:{},setAttribute(key,value){this[key]=value}},document:{querySelectorAll:()=>[]},
 isPlaceholder:()=>false,hasPanel:item=>!!item.path,exportGeometry:()=>({pixels:121_000_000}),updateExportEstimate(){},
 exportNotice:(...args)=>notices.push(args),status(){},fileSize:()=> '1 MB',tagError(){},
 api:(path,body)=>new Promise((resolve,reject)=>requests.push({path,body,resolve,reject})),
 validateTags(){c.$('fig-tags-export').disabled=c.$('fig-tags-export').dataset.exporting==='true'},
 tagRows:[{label:'AB',colour:'#123456'}],files:[],normaliseHex:value=>value};
vm.createContext(c);
vm.runInContext(source.slice(source.indexOf(' function sync(){'),source.indexOf(' function saveTags(')),c);
vm.runInContext(source.slice(source.indexOf("   $('fig-export').onclick="),source.indexOf("   $('fig-tag-open').onclick=")),c);
vm.runInContext(source.slice(source.indexOf("   $('fig-tags-export').onclick="),source.indexOf('\n   scan();',source.indexOf("   $('fig-tags-export').onclick="))),c);
(async()=>{
 c.sync();assert.equal(fields['fig-export'].disabled,false,'A valid figure above 120 MP can export');
 const exporting=fields['fig-export'].onclick();assert.equal(fields['fig-export'].disabled,true);assert.equal(notices.at(-1)[0],'Exporting figure…');
 c.recipe.slots[0].zoom=2;c.sync();assert.equal(fields['fig-export'].disabled,true,'Preview updates cannot re-enable an in-flight export');
 await fields['fig-export'].onclick();assert.equal(requests.length,1,'A second click cannot duplicate the export');
 assert.equal(requests[0].body.recipe.slots[0].zoom,1,'Export uses the settings captured when clicked');
 requests[0].resolve({png:'/large.png',recipe:'/large.json',size_bytes:1_000_000});await exporting;
 assert.equal(fields['fig-export'].disabled,false);assert.equal(notices.at(-1)[2],'saved');assert.match(notices.at(-1)[1],/large.png\n\/large.json/);
 const failed=fields['fig-export'].onclick();requests.at(-1).reject(Error('Disk full'));await failed;
 assert.deepEqual(notices.at(-1),['Export failed','Disk full','error']);assert.equal(fields['fig-export'].disabled,false);
 const tags=fields['fig-tags-export'].onclick();assert.equal(notices.at(-1)[0],'Exporting label tags…');
 const count=requests.length;await fields['fig-tags-export'].onclick();assert.equal(requests.length,count);
 requests.at(-1).resolve({files:['/tags/AB.png'],folder:'/tags'});await tags;
 assert.deepEqual(notices.at(-1),['✓ 1 label tags exported','/tags','saved']);
 const tagFailure=fields['fig-tags-export'].onclick();requests.at(-1).reject(Error('Cannot write tags'));await tagFailure;
 assert.deepEqual(notices.at(-1),['Tag export failed','Cannot write tags','error']);
 console.log('Figures permits >120 MP exports and shows shared busy/saved/error notices for PNG and tags without duplicate exports.');
})().catch(error=>{console.error(error);process.exitCode=1});

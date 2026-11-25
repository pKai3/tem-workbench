const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const listeners={},dialogs=[];
const document={addEventListener(name,fn){listeners[name]=fn},querySelectorAll(){return dialogs.filter(dialog=>dialog.open)}};
vm.runInNewContext(fs.readFileSync('web/popup-controls.js','utf8'),{document,Event});
function dialog(modal=true){const value={tagName:'DIALOG',open:true,closed:0,cancels:0,blocked:false,matches:()=>modal,contains:target=>target?.parent===value,getBoundingClientRect:()=>({left:10,top:10,right:100,bottom:100}),dispatchEvent(){value.cancels++;return !value.blocked},close(){value.closed++;value.open=false}};dialogs.push(value);listeners.beforetoggle({target:value,newState:'open'});return value}
function event(values={}){return {key:'Escape',button:0,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true},...values}}
const outer=dialog(),inner=dialog();const escape=event();listeners.keydown(escape);
assert.equal(inner.closed,1);assert.equal(outer.closed,0);assert.equal(inner.cancels,1);assert.ok(escape.prevented&&escape.stopped);
const child={parent:outer};listeners.pointerdown(event({target:child,clientX:30,clientY:30}));listeners.click(event({target:outer,clientX:0,clientY:0}));assert.equal(outer.closed,0,'Drag-out does not dismiss');
listeners.pointerdown(event({target:outer,clientX:0,clientY:0}));listeners.click(event({target:outer,clientX:0,clientY:0}));assert.equal(outer.closed,1);
const floating=dialog(false);listeners.keydown(event());assert.equal(floating.closed,1,'Non-modal popup also closes');
const blocked=dialog();blocked.blocked=true;listeners.keydown(event());assert.equal(blocked.closed,0,'Existing cancel handlers still apply');blocked.blocked=false;
const inside=event({target:{parent:blocked},clientX:20,clientY:20});listeners.pointerdown(inside);listeners.click(inside);assert.equal(blocked.closed,0);
console.log('Nested, modal and floating popups dismiss consistently; inside clicks, drag-out and cancel hooks are preserved.');
const app=fs.readFileSync('web/app.js','utf8');const badgeContext={document:{createElement(){return {setAttribute(){}}}}};vm.createContext(badgeContext);
vm.runInContext(app.slice(app.indexOf('function imageBrowserSidecarIcon('),app.indexOf('function imageBrowserNameParts(')),badgeContext);
assert.equal(badgeContext.imageBrowserSidecarIcon({extension:'.dm4',id:'stable-id',has_sidecar:false}),null);
assert.equal(badgeContext.imageBrowserSidecarIcon({id:'old/IMAGE.DM4',has_sidecar:true}),null);
assert.match(badgeContext.imageBrowserSidecarIcon({extension:'.tif',id:'raster',has_sidecar:false}).title,/No matching/);
console.log('DM4 cards omit TXT badges; raster sidecar information remains available.');

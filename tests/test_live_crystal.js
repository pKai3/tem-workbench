const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
// Exercise the real layout lifecycle and freshness gate. Moving the existing
// surfaces must keep their identities/handlers and put them back in order.
class Element{
 constructor(name){this.name=name;this.children=[];this.parent=null;this.hidden=false}
 append(child){if(child.parent)child.parent.children.splice(child.parent.children.indexOf(child),1);this.children.push(child);child.parent=this}
 before(other){const at=this.parent.children.indexOf(this);this.parent.children.splice(at,0,other);other.parent=this.parent}
 replaceWith(other){if(other.parent)other.parent.children.splice(other.parent.children.indexOf(other),1);const at=this.parent.children.indexOf(this);this.parent.children.splice(at,1,other);other.parent=this.parent;this.parent=null}
 showModal(){this.open=true}
 close(){this.open=false}
 querySelector(selector){return get(selector)}
 getAttribute(name){return this.attributes?.[name]??null}
}
const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Element(id));return nodes.get(id)};
const source=new Element('source'),inspector=new Element('inspector');
for(const key of ['.image-panel>.panel-head','.image-panel>.image-caption','.image-panel>.image-wrap'])source.append(get(key));
for(const key of ['.inspector>.panel-head','.inspector>.previews'])inspector.append(get(key));
const originalSource=[...source.children],originalInspector=[...inspector.children];
let opens=0,destroys=0,updates=[],scales=[],status='',loading=false;const models=[{phase:'BCC',zone_3index:[0,0,1],rotation_deg:12,predicted_nodes:[{hkl:[1,1,0],q:[2,3]}]}];
get('fft').attributes={viewBox:'-28 -12 464 452'};get('fft-image').attributes={x:'0',y:'0',width:'420',height:'420'};
const result={models,settings:{bcc_a:.33},spectrum:{extent:[-12,12,-12,12],g_max:10,g_min:2.5,coordinate_units:'nm^-1'}},snapshot=JSON.stringify(result);
const context={document:{createComment:name=>new Element(name),querySelector:get},$:get,result,fftRaw:{},busy:false,pending:false,fittingLimitDrag:null,currentFittingLimits:()=>({inner:3,outer:12.5}),currentCrystalModels:()=>context.result?.models||[],CrystalViewer:{open:options=>{opens++;assert.equal(options.host,get('crystal-live-view'));return {destroy(){destroys++},setPending(message,inProgress=false){status=message;loading=inProgress},update(data){updates.push(data)},setReciprocalView(view){scales.push(view)}}}}};
vm.createContext(context);const app=fs.readFileSync('web/app.js','utf8');vm.runInContext(app.slice(app.indexOf('let liveCrystal=null'),app.indexOf('const savedInspectorLayout=')),context);
context.setLiveCrystalLayout(true);assert.equal(opens,1);assert.equal(updates.length,1);assert.equal(status,'');assert.equal(updates[0].models,models);assert.equal(get('crystal-comparison').hidden,false);
assert.equal(updates[0].reciprocalView.outerRadius,10);assert.deepEqual(Array.from(updates[0].reciprocalView.viewBox),[-28,-12,464,452]);assert.notEqual(updates[0].reciprocalView.extent,result.spectrum.extent);
context.fittingLimitDrag={};context.syncLiveCrystalScale();assert.equal(scales.at(-1).outerRadius,12.5);assert.equal(scales.at(-1).innerRadius,3);assert.equal(updates.length,1,'Changing radius must preserve the explored orientation');context.fittingLimitDrag=null;context.syncLiveCrystalScale();assert.equal(scales.at(-1).outerRadius,10);
assert.equal(originalSource[2].parent,get('crystal-source-pane'));assert.equal(originalInspector[1].parent,get('crystal-fft-pane'));
context.setLiveCrystalLayout(true);context.syncLiveCrystal();assert.equal(opens,1);assert.equal(updates.length,1,'Redraws do not reset the orientation');
context.pending=true;context.result=null;context.syncLiveCrystal();assert.match(status,/Updating/);assert.equal(loading,true);assert.equal(updates.length,1,'Pending regions never reuse the old fit');
context.result={models:[{...models[0],rotation_deg:45}],settings:{bcc_a:.35}};context.syncLiveCrystal();assert.equal(updates.length,1,'An unfinished replacement stays pending');
context.pending=false;context.syncLiveCrystal();assert.equal(updates.length,2);assert.equal(status,'');assert.equal(loading,false);assert.equal(updates[1].models[0].rotation_deg,45);
context.result={models:[],settings:{}};context.syncLiveCrystal();assert.match(status,/No crystal candidate/);assert.equal(loading,false);
context.result=null;context.syncLiveCrystal();assert.match(status,/No current fit/);assert.equal(loading,false);
context.result=result;context.syncLiveCrystal();assert.equal(status,'');assert.equal(JSON.stringify(result),snapshot);
context.setLiveCrystalLayout(false);assert.equal(destroys,1);assert.equal(get('crystal-comparison').open,false);assert.deepEqual(source.children,originalSource);assert.deepEqual(inspector.children,originalInspector);
context.setLiveCrystalLayout(true);assert.equal(opens,2);context.setLiveCrystalLayout(false);assert.equal(destroys,2);assert.deepEqual(source.children,originalSource);
console.log('Live crystal comparison: original surface identity/restoration, freshness, pending/absent fits, recovery and unchanged analysis passed.');

/* Exercise actual shared hover/focus/touch handlers and late-render dismissal. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/popup-controls.js','utf8'),timers=new Map();let serial=0,focused=null;
class Element{
 constructor(tag){Object.assign(this,{tag,children:[],attributes:{},style:{},isConnected:true,textContent:'',listeners:{}});this.classes=new Set();this.classList={toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)}}
 append(...nodes){this.children.push(...nodes)}
 replaceChildren(...nodes){this.children=nodes}
 setAttribute(key,value){this.attributes[key]=value}
 getAttribute(key){return this.attributes[key]}
 addEventListener(name,fn){this.listeners[name]=fn}
 getBoundingClientRect(){return {left:50,bottom:100,width:860,height:540}}
 showModal(){this.open=true}
 close(){this.open=false;this.listeners.close?.()}
 remove(){this.isConnected=false}
 focus(){focused=this;this.onfocus?.()}
 async decode(){}
 all(){return [this,...this.children.flatMap(node=>node.all())]}
}
const body=new Element('body'),c={window:{addEventListener(){},removeEventListener(){}},document:{body,createElement:tag=>new Element(tag)},innerWidth:1280,innerHeight:720,structuredClone,Date,
 setTimeout(fn){timers.set(++serial,fn);return serial},clearTimeout(id){timers.delete(id)}};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('/* Saved-item previews')),c);
const next=async()=>{const tasks=[...timers.values()];timers.clear();for(const task of tasks)task();await new Promise(resolve=>setImmediate(resolve))};
const entries=[{value:'a',item:{name:'Alpha'}},{value:'b',item:{name:'Beta'}}],anchor=new Element('button'),calls=[],pending=[],chosen=[];
(async()=>{
 c.window.WorkbenchPreviewPicker.open({anchor,entries,selected:'a',title:'Saved figures',noun:'figure',plural:'figures',preview(entry,wanted){calls.push(entry.value);return new Promise(resolve=>pending.push({resolve,wanted}))},onSelect:value=>chosen.push(value)});
 const dialog=body.children.at(-1),nodes=dialog.all(),button=name=>nodes.find(node=>node.tag==='button'&&node.textContent===name),stage=nodes.find(node=>node.className==='saved-preview-picker-image');
 assert.equal(focused,button('Alpha'));await next();button('Beta').onmouseenter();await next();assert.deepEqual(calls,['a','b']);assert.deepEqual(chosen,[]);
 pending[1].resolve('beta');await next();assert.equal(stage.children[0].src,'beta');pending[0].resolve('alpha');await next();assert.equal(stage.children[0].src,'beta','A late hover cannot replace the latest preview');
 button('Beta').onkeydown({key:'Home',preventDefault(){}});assert.equal(focused,button('Alpha'));await next();
 button('Alpha').onclick({pointerType:'touch'});assert.deepEqual(chosen,[],'Touch first previews the figure');
 button('Open figure').onclick();assert.deepEqual(chosen,['a']);assert.equal(dialog.open,false);assert.equal(anchor.attributes['aria-expanded'],'false');assert.equal(focused,anchor);
 pending[2].resolve('closed');await next();assert.equal(stage.children.length,0,'Closing invalidates pending image display');
 c.window.WorkbenchPreviewPicker.open({anchor,entries:[],selected:'',preview(){throw Error('No previews expected')},onSelect(){throw Error('No selection expected')},title:'Saved figures',noun:'figure',plural:'figures'});
 const empty=body.children.at(-1);assert.equal(empty.all().find(node=>node.textContent==='Open figure').disabled,true);assert.ok(empty.all().some(node=>node.textContent==='No saved figures yet.'));empty.close();
 console.log('Shared preview picker supports hover, focus, keyboard and touch without implicit selection; late replies and closed dialogs stay inert.');
})().catch(error=>{console.error(error);process.exitCode=1});

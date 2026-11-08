// Minimal SVG tree for preview-cloning regressions; no browser emulation.
function element(tag,attrs={},text){
 const node={tag,attrs:{...attrs},text,children:[],hidden:true,style:{},isConnected:true,value:'view',
  append(...nodes){for(const child of nodes){child.parentElement=this;this.children.push(child)}},
  replaceChildren(...nodes){for(const child of this.children)child.parentElement=null;this.children=[];this.append(...nodes)},
  setAttribute(k,v){this.attrs[k]=v},getAttribute(k){return this.attrs[k]},removeAttribute(k){delete this.attrs[k]},
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this)},
  getBoundingClientRect(){return {width:270,height:320}},
  cloneNode(deep){const copy=element(this.tag,this.attrs,this.text);if(deep)copy.append(...this.children.map(child=>child.cloneNode(true)));return copy},
  querySelectorAll(selector){
   const selectors=selector.split(','),found=[];
   function matches(child,s){return s.startsWith('.')?(child.attrs.class||'').split(' ').includes(s.slice(1)):s.startsWith('[')?s.slice(1,-1) in child.attrs:child.tag===s}
   function visit(parent){for(const child of parent.children){if(selectors.some(s=>matches(child,s)))found.push(child);visit(child)}}
   visit(this);return found;
  },
  querySelector(selector){return this.querySelectorAll(selector)[0]||null},
  getScreenCTM(){return {a:1,b:0,inverse(){return {}}}}
 };
 node.attributes=node.attrs;
 node.classList={add(name){node.attrs.class=[node.attrs.class,name].filter(Boolean).join(' ')}};
 return node;
}
module.exports={element};

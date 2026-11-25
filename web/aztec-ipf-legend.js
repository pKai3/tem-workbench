/* AZtec colour fields from the supplied reference; provenance: assets/ipf/reference.json. */
window.aztecIpfLegend=(()=>{
 const artwork={"hexagonal":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEoAAAAoCAIAAADWjvt3AAAH3klEQVR42u2Zy44jtxVAD1msh6TuHsfJwA4QwFkFCZBtkF/IJ/sXvJ/1rIK8ZoLxeLqlKvKSzIKPop7dHieLBCEuiCuVqroOD3lVVKvD9oGmTT20MZzkiqG8ORzHCINiZI0phcrJBraKDWxhBzv1RHyCPXEPezgQD3CAA3GGA8zEGRaYiQukvL5s4uTl2jT/0+3/eP/NzVx477BFQMCDB1FNXvohvaPy+/78pSI0bwaIighBEQEF7HYKIsRIjBCJgRjAEz3R5wRPNCDEDjrQxNRr0KCIChSk6wKsyTmebHMyb/Eqc1YqIb/pL8FXksQW0kuV2UJhi6rG7q5SreFLn0LAEM0KmcBiYquElP6qvUkVNr89MnlCIoUka1T56BGkKg4LWFCNwDLiSu92KhIiIRIDoVAFyWw5uqOgI2qizheKamWLz01OvW1Nzodp8l0zXdWF5Gp/jFcjDToKtELtdjriA6HghRKJLbhsL1SqwhbLmFWwGC9OzlVdamoHzDI1GouxmgxXkNZEnYIltqgg3Z4GrZXebVXAB4LPfZAm+gwZir1QTg6XIG+sPb1CrmyyPYJcV6BaJ62oMj/VUYSa65Ut1JnVoTRKd6rbbQj4gPd4wXuCxyeqnuAIhmAIHUHn8xNbmuu1dl2yd66usk36/mxB7la87LABk3M8TVCE2ifOWv860Kiu12Y3Ro/3iEcEL3iHdwSH7/GJzRA6fLey5doFIRLJ+UV7Rd3qbT20KyZ3gOwnM3SIyqVFmqhgKQ8690d4OpfAXO07VIcyoza7PnhESjjE4R3eIj3B4Aubr1es6xtCJEww82nFO1E3+5+vC7Kqy1bvAJHNscYCWSehNHnuSxzhFTZMwkP321e970RwgnM4hzjEIgNi8Qbp8F25XJn6ic0nPGDkfuEvx/b09oTtgrqWTe5WyNaeFLycnIB1eL3WiNgRDbFD9QkPPdx/0QtWsA7rcA5ncRbpcQYx+A7p8BrR65NEAB9zAjDyAJjTVdd+DZ6pq2xGvzqF3N+teKtDfRxl6BNeWkfREHuUgR41oAe64f7eCLPDOhaLXbADrsclwg5X2NaCliLgL33vvUDd6m09VPjlHpDD1ojJVJmzBat4HaHLZSKxRZO3WAlPT8ZMd5vomC2zZbEsC3bAGmyHS6FxulRtkIiPSLyMd8Z2ok786/Wcqi5bfQDElwm8vy9TVOM10pW8a/BMEz2xbB/VgJ7Q4yxq3sDmftpgO7swz8wzS8/SYztsh9U4hVM4EHAgEYnIGZ7eXt9R7E7YLqhr2aRsjp/ukcJW1UmHNxnPG0KfI+ONPpp5YfnEPDFvOEwcJg6bwU2Dmh6GiUEthtmwaBaNVTkcuIgLuA0c+PupvdvqjsbjTF1lM+rLAvkKeHzs76Yd0h2FN2uEHt8Thhj6xWEPLJ9YRpaJecr9YWSeCufIPI1+GtVENwTNovPu3EZsxAYcMPJ64U3B09vLS+5l6lZv66EvgEc3Fo0Phc1kPDFIj++jN9bhFuwBO2JHlhE7sYwsI/PEMjKPzBPzyGHMhIeR/cQ8ajdu/LRhJBofWQJLwKa/2fPV1Ufq6WjWvb6hTsIv10NVXcvmflYgX+WqLiY4nYv9jBuxY+5rLENGnZv+MBbIEvPIMrCMuLGTcevHbRjP5tptdVcO3Z+wteoq2133qzIMmfzwaZD0FbbgRtyAjNgBlwgHbNMnhwlgLn2imoeVLX3ejcjABPM3N3frL1d3dKioW73V1uWLHNwWePc4d3ZyA2JxA7LghszmBlwlHIrDoUSiGhq2obCVc4HuH/g/3N7vAXp3ecndVPfov6r5qi6xqQfgr27On3xCHG5A0p3Z9RbtgusbwqEhLHgZrEQ6UYbyx74tVe9PJ7v1lxXME7akrmU7V9eyfXBlPSZIWyD7Qtjnm7Z9IeyxBWwp8PVjrkcGBrBfH/3x+O3l3foz6p5t5+oq2w8q70W+L5D7PZKenfus0fYrZO2XvmHry0Na6aUH0N8Tfntl7U1rrX/971VX2Wp7r3Ly0QE87cU7I+leXe5tj7PYvuE8y5M36TMewHdFxB8v79Z3x09tR+qeXXLn6t6ua2JVl9o/VSLMj1Hzvjw1V8iKZBu8AuZ6pPQ9uONvgPBdu1t/mbprBfOaupbtXF3L9lgeFZcDru72WsIeaxr+vmyQijr1SPzm5s+4En9947vuM9S17VxdZfuoTAv5eHhUcucMTrBSJmqPM2uSCRNeV8bmTRnb35tmt/6CgnnOZtSXl5fcy9RVtto+KIAP8pg1ziJinGATZ4J0DVXpDUYejq7m38ipvdvqyib4pQXzhO1E3VtZ76aqa9keywfsTNLoepwgKTe50opD0tl7w9dyQc9/SN3FltS1bK26yvZUxuKpFDm34DxicAaR4k2SurSXhr8Z4ATSPKtO+M2zS+5HqWtbVVfZzg/tfZqrszdTeizPkH1RN0Md0mNIc43tswvmxSV3W91bv7I9HY/FRwXwSeaiUZw3kn4J9XTg028974ALkOb2cvoMdTcK5glb8tOyXVyQle3J59NlyT/0JnXqF+WjZ5D6x6qbw+8+W92z7VxdZfvheK4ePVu+J75vXr8rnFd3DNfV3SiY52w/UV1lu2j1HBJOTepr6i6y3VZ3o2A+u+TO1f3Zz80wmRf+t/nE5E/93/oL1b1cQjrUsr3krGuQ/wI6/WYZ5hzgYQAAAABJRU5ErkJggg==","cubic":"data:image/png;base64,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"};
 const families=['hexagonal','cubic'];
 // Smooth outlines replace the small source raster's baked white/black edge.
 const outlines={hexagonal:{width:74,height:40,path:'M1.7 2.2 H71.8 A70.1 70.1 0 0 1 62.408 37.25 Z'},cubic:{width:43,height:50,path:'M2.2 3 L39.4 40.1 A100 100 0 0 1 2.2 47.3 Z'}};
 let serial=0;
 const tile=row=>row.tiles?.find(item=>item.channel==='IPF');
 function keys(row,options){
  const ipf=tile(row);if(!ipf?.image||ipf.error)return [];
  return families.filter(family=>options['ipf_legend_'+family]!==false).map(family=>({family,names:[...new Set((ipf.phases||[]).filter(phase=>phase.family===family).map(phase=>phase.name))]})).filter(key=>key.names.length);
 }
 function selected(result,options){
  if(!result.kam||options.ebsd_layout==='kam'||options.ipf_legend==='none')return [];
  const available=result.rows.filter(row=>keys(row,options).length);
  if(options.ipf_legend==='all')return available;
  return options.ipf_legend_target?available.filter(row=>row.acquisition===options.ipf_legend_target):available.slice(0,1);
 }
 function svg(row,options){
  const groups=keys(row,options);if(!groups.length)return null;
  const ns='http://www.w3.org/2000/svg',root=document.createElementNS(ns,'svg'),width=112,height=3+groups.reduce((sum,key)=>sum+(key.family==='hexagonal'?85:90),0);
  const add=(tag,attrs,text,parent=root)=>{const node=document.createElementNS(ns,tag);for(const [name,value]of Object.entries(attrs))node.setAttribute(name,value);if(text!==undefined)node.textContent=text;parent.append(node);return node};
  root.setAttribute('xmlns',ns);root.setAttribute('viewBox',`0 0 ${width} ${height}`);root.setAttribute('width',width);root.setAttribute('height',height);root.setAttribute('role','img');root.setAttribute('aria-label',`IPF ${tile(row).direction||'Z'} colour key: ${groups.map(key=>key.names.join(', ')).join('; ')}`);
  root.style.fontFamily='system-ui';add('rect',{width,height,rx:3,fill:'#080e14','fill-opacity':.75});
  const defs=add('defs',{});
  const field=(family,x,y,width,height)=>{const outline=outlines[family],id='ipf-key-'+(++serial),clip=add('clipPath',{id,clipPathUnits:'userSpaceOnUse'},undefined,defs);
   add('path',{d:outline.path,transform:`translate(${x} ${y}) scale(${width/outline.width} ${height/outline.height})`},undefined,clip);
   add('image',{href:artwork[family],x,y,width,height,'clip-path':`url(#${id})`,'image-rendering':'auto'});
  };
  const text=(x,y,value,size=10,anchor='middle',parent=root)=>add('text',{x,y,fill:'#fff','font-size':size,'text-anchor':anchor},value,parent);
  // Draw overbars explicitly: combining Unicode marks vary by font/platform.
  const indices=(x,y,values)=>{const group=add('g',{'role':'img','aria-label':'['+values.join(' ')+']'}),step=5.8;
   values.forEach((value,index)=>{const cx=x+(index-(values.length-1)/2)*step;text(cx,y,String(Math.abs(value)),9,'middle',group);if(value<0)add('line',{x1:cx-2.1,x2:cx+2.1,y1:y-8.5,y2:y-8.5,stroke:'#fff','stroke-width':.7},undefined,group)});
  };
  let y=0;
  for(const key of groups){
   const label=key.names.join(' / '),title=text(56,y+12,label.length>18?label.slice(0,17)+'…':label,11);add('title',{},label,title);
   if(key.family==='hexagonal'){
    field('hexagonal',15,y+28,78,42.16);
    text(16,y+25,'0001',9);indices(94,y+25,[-1,2,-1,0]);indices(81,y+84,[0,1,-1,0]);y+=85;
   }else{
    field('cubic',34,y+29,43,50);
    text(37,y+26,'001',9);text(37,y+87,'101',9);text(82,y+75,'111',9,'start');y+=90;
   }
  }
  return root;
 }
 function geometry(width,height,svg){
  const [, ,w,h]=svg.getAttribute('viewBox').split(' ').map(Number),scale=Math.min(width*.20/w,(height-10)/h);
  return {width:w*scale,height:h*scale};
 }
 return {keys,selected,svg,geometry};
})();

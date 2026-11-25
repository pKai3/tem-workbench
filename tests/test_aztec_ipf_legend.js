/* Phase-aware IPF key selection and the shared preview/export artwork. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class Element{
 constructor(tag){this.tag=tag;this.attributes={};this.children=[];this.style={}}
 setAttribute(k,v){this.attributes[k]=String(v)}
 getAttribute(k){return this.attributes[k]}
 append(...children){this.children.push(...children)}
}
const window={},document={createElementNS:(_,tag)=>new Element(tag)};
vm.runInNewContext(fs.readFileSync('web/aztec-ipf-legend.js','utf8'),{window,document});
const legend=window.aztecIpfLegend;
const phases=[{id:1,name:'Ti-Hex',family:'hexagonal'},{id:2,name:'Titanium cubic',family:'cubic'}];
const row=(id,ps=phases)=>({acquisition:id,tiles:[{channel:'IPF',direction:'Z',image:'stored-pixels',phases:ps}]});
const result={kam:{},rows:[row('AB'),row('ST'),row('STA',[phases[0]])]},before=JSON.stringify(result);
const ids=options=>Array.from(legend.selected(result,options),r=>r.acquisition);
assert.deepEqual(ids({}),['AB']);assert.deepEqual(ids({ipf_legend:'all'}),['AB','ST','STA']);
assert.deepEqual(ids({ipf_legend:'one',ipf_legend_target:'ST'}),['ST']);
assert.deepEqual(ids({ipf_legend:'one',ipf_legend_target:'missing'}),[],'Never silently move a chosen legend');
assert.deepEqual(ids({ipf_legend:'none'}),[]);assert.deepEqual(ids({ebsd_layout:'kam'}),[]);
assert.deepEqual(ids({ipf_legend:'all',ipf_legend_hexagonal:false}),['AB','ST'],'Only show phases actually present');
assert.deepEqual(ids({ipf_legend_hexagonal:false,ipf_legend_cubic:false}),[]);
assert.equal(legend.selected({...result,kam:undefined},{}).length,0);
assert.equal(legend.keys({tiles:[{channel:'IPF',image:'rgb',error:'Unavailable'}]},{}).length,0);
assert.equal(legend.keys(row('old',[]),{}).length,0);
const both=legend.svg(result.rows[0],{}),texts=both.children.filter(n=>n.tag==='text').map(n=>n.textContent);
for(const label of ['Ti-Hex','Titanium cubic','0001','001','101','111'])assert.ok(texts.includes(label),label);
assert.ok(!texts.some(label=>label.startsWith('IPF ')),'The panel already labels the IPF direction');
assert.equal(both.children.filter(n=>n.tag==='image').length,2);
const indices=both.children.filter(n=>n.tag==='g');assert.deepEqual(indices.map(n=>n.attributes['aria-label']),['[-1 2 -1 0]','[0 1 -1 0]']);
assert.equal(indices.flatMap(n=>n.children).filter(n=>n.tag==='line').length,3,'Overbars are drawn, independent of fonts');
const hex=both.children.find(n=>n.tag==='image'),bottomBar=indices[1].children.find(n=>n.tag==='line');
assert.ok(Number(bottomBar.attributes.y1)>Number(hex.attributes.y)+Number(hex.attributes.height)+4,'The lower barred index must clear the image');
const clips=both.children.find(n=>n.tag==='defs').children;
assert.equal(clips.length,2);assert.ok(clips.every(n=>n.tag==='clipPath'&&n.children[0].attributes.d.includes(' A')),'Curved boundaries are vector-clipped at the output resolution');
const next=legend.svg(result.rows[0],{}),nextIds=next.children.find(n=>n.tag==='defs').children.map(n=>n.attributes.id);
assert.ok(clips.every(n=>!nextIds.includes(n.attributes.id)),'Maps have independent clip identifiers');
assert.ok(both.children.filter(n=>n.tag==='text').every(n=>n.attributes.fill==='#fff'));
assert.ok(!JSON.stringify(both).includes('̅'),'No combining marks in rendered labels');
assert.ok(both.children.some(n=>n.tag==='rect'&&n.attributes.fill==='#080e14'&&n.attributes['fill-opacity']==='0.75'));
for(const family of ['hexagonal','cubic']){
 const one=legend.svg(result.rows[0],{['ipf_legend_'+(family==='cubic'?'hexagonal':'cubic')]:false});
 const images=one.children.filter(n=>n.tag==='image');assert.equal(images.length,1);
 assert.equal(images[0].attributes.href,'data:image/png;base64,'+fs.readFileSync('web/assets/ipf/'+family+'.png').toString('base64'),'Export embeds the same original colour artwork');
}
assert.equal(legend.svg(result.rows[0],{ipf_legend_hexagonal:false,ipf_legend_cubic:false}),null);
const dangerous='<script>phase</script>',safe=legend.svg(row('s',[{...phases[0],name:dangerous}]),{});
assert.ok(safe.children.flatMap(n=>[n,...n.children]).some(n=>n.textContent===dangerous));assert.ok(!safe.children.some(n=>n.tag==='script'),'Phase names are text, never markup');
for(const direction of ['X','Y','Z']){const r=row('d');r.tiles[0].direction=direction;assert.match(legend.svg(r,{}).getAttribute('aria-label'),new RegExp('IPF '+direction))}
const size=legend.geometry(320,240,both);assert.equal(size.width,64);assert.ok(size.height<230);
assert.ok(legend.geometry(320,50,both).height<=40,'Short panels keep the whole key inside the image');
assert.equal(JSON.stringify(result),before,'Legend choices never modify image data or phases');
console.log('IPF legends: one/all/off, explicit targets, independent phase switches and original artwork passed.');

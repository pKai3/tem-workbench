const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const window={};vm.runInNewContext(fs.readFileSync('web/aztec-distributions.js','utf8'),{window});
const plots=window.aztecDistributions,group={id:'ratio',label:'V / Ti',series:[{acquisition:'a',pixels:2,counts:[1,1]},{acquisition:'b',pixels:200,counts:[100,100]}]};
const rows=[{acquisition:'a',label:'First'},{acquisition:'b',label:'Second'}],names={a:'ST',b:'STA'};
const curves=plots.series(group,rows,names);
assert.equal(JSON.stringify(curves[0].percent),JSON.stringify(curves[1].percent),'Different map sizes have equal weight');
assert.equal(curves[0].name,'ST');assert.equal(curves[1].name,'STA');assert.notEqual(curves[0].colour,curves[1].colour);
assert.equal(plots.series({...group,series:[group.series[1]]},rows,names)[0].colour,curves[1].colour,'Acquisition colour survives missing channels');
const result={distributions:[{id:'signal',label:'Ti'},group]};
assert.equal(plots.selected(result,'missing').id,'ratio');assert.equal(plots.selected(result,'signal').id,'signal');
assert.equal(plots.selected({distributions:[]},'old'),undefined);
assert.equal(plots.number(NaN),'—');assert.equal(plots.number(1.23456),'1.235');
const measured={median:1,mean:1.15,percentile_low:.7,percentile_high:1.4};
const markers=plots.markers({percentiles:[20,80]},measured);
assert.equal(JSON.stringify(markers.map(m=>[m.label,m.value])),JSON.stringify([['Median',1],['Mean',1.15],['P20',.7],['P80',1.4]]));
assert.notEqual(markers[0].dash,markers[1].dash,'Mean and median must be distinguishable');
assert.equal(plots.markers({percentiles:[20,80]},measured,{median:false,percentiles:false})[0].key,'mean');
assert.equal(plots.markers({},{}).length,0,'Unavailable values must not create markers at zero');
console.log('Distribution curves compare pixel percentages, retain acquisition identity and reconcile quantity selections.');

const assigned=plots.series(group,rows,names,{a:'#e76f00'});
assert.equal(assigned[0].colour,'#e76f00');assert.equal(assigned[1].colour,curves[1].colour);
assert.equal(plots.series(group,rows,names,{a:'invalid'})[0].colour,curves[0].colour);
class Element{
 constructor(tag){this.tag=tag;this.attributes={};this.children=[];this.style={}}
 setAttribute(key,value){this.attributes[key]=value}
 append(node){this.children.push(node)}
}
const document={createElementNS:(_,tag)=>new Element(tag)},svgWindow={};
vm.runInNewContext(fs.readFileSync('web/aztec-distributions.js','utf8'),{window:svgWindow,document});
const kam={id:'kam',label:'KAM',unit:'degrees',pixel_scope:'valid_pixels',edges:[0,1,2],exceedance_thresholds:[0,1,2],series:[{acquisition:'a',pixels:4,excluded:1,counts:[1,3],exceedance_percent:[75,25,0]}]};
const svg=svgWindow.aztecDistributions.svg(kam,rows,names,{view:'exceedance',colours:{a:'#123456'},markers:{median:false,mean:false,percentiles:false}});
assert.match(svg.attributes['aria-label'],/exceedance curves/);
assert.ok(svg.children.some(node=>node.textContent==='Pixels above angle (%)'));
const path=svg.children.find(node=>node.tag==='path');
assert.equal(path.attributes.stroke,'#123456');
assert.equal(path.attributes.d,'M 47 86 L 195.5 170 L 344 212','Percentage axis must stay at 0–100, with no artificial rise from zero');
const before=JSON.stringify(kam),zoom=svgWindow.aztecDistributions.svg(kam,rows,names,{view:'exceedance',xMin:.25,xMax:1.25});
assert.equal(zoom.attributes['data-x-min'],.25);assert.equal(zoom.attributes['data-x-max'],1.25);
assert.match(zoom.children.find(node=>node.tag==='path').attributes['clip-path'],/^url\(#eds-distribution-clip-/);
assert.notEqual(zoom.children.find(node=>node.tag==='path').attributes['clip-path'],path.attributes['clip-path'],'Independent SVGs need unique clip IDs');
assert.equal(JSON.stringify(kam),before,'Axis changes must not alter pixels, statistics or percentages');
const histZoom=svgWindow.aztecDistributions.svg(kam,rows,names,{view:'histogram',xMin:.25,xMax:1.25});
assert.equal(histZoom.attributes['data-x-min'],.25);assert.equal(histZoom.attributes['data-x-max'],1.25);
assert.equal(JSON.stringify(plots.axisRange(kam,{xMin:null,xMax:null})),JSON.stringify([0,2]));
assert.equal(JSON.stringify(plots.axisRange(kam,{xMin:3})),JSON.stringify([3,4]));
assert.equal(JSON.stringify(plots.axisRange(kam,{xMin:1,xMax:.5})),JSON.stringify([1,2]));
const extended=svgWindow.aztecDistributions.svg(kam,rows,names,{view:'exceedance',xMax:4});
assert.match(extended.children.find(node=>node.tag==='path').attributes.d,/L 344 212$/,'Beyond the largest pixel, exceedance stays at zero');
const tails={...kam,series:[{...kam.series[0],p99:1.1},{...kam.series[0],acquisition:'b',p99:1.4}]};
assert.equal(JSON.stringify(plots.axisRange(tails,{view:'exceedance'})),JSON.stringify([0,1.4]),'Auto uses the largest P99, not the largest pixel');
assert.equal(JSON.stringify(plots.axisRange(tails,{view:'histogram'})),JSON.stringify([0,1.4]),'KAM histogram uses the same Auto range as exceedance');
assert.equal(JSON.stringify(plots.axisRange(tails,{view:'exceedance',xMax:1})),JSON.stringify([0,1]),'Explicit axis limits override Auto');
assert.equal(JSON.stringify(plots.axisRange({...kam,series:[{...kam.series[0],p99:0}]},{view:'exceedance'})),JSON.stringify([0,1]),'All-zero maps need a finite display span');
for(const view of ['histogram','exceedance']){
 const positive={...tails,edges:[.5,1,2]};
 const chart=svgWindow.aztecDistributions.svg(positive,rows,names,{view});
 assert.equal(chart.attributes['data-x-min'],0,'Both KAM chart styles start Auto at zero');
 assert.equal(chart.attributes['data-x-max'],1.4,'Screen and exported SVG use the largest selected P99');
 assert.equal(JSON.stringify(plots.axisRange(positive,{view,xMin:.2,xMax:1})),JSON.stringify([.2,1]),'Manual limits remain authoritative');
 assert.equal(JSON.stringify(plots.axisRange({...kam,edges:[-.01,0,.01],series:[{...kam.series[0],p99:0}]},{view})),JSON.stringify([0,1]));
}
assert.equal(JSON.stringify(plots.axisRange({...tails,exceedance_thresholds:undefined},{view:'histogram'})),JSON.stringify([0,2]),'EDS histograms retain the full range');

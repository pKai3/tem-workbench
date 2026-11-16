// Acquisition numbers can repeat after a restart; recorded time determines order.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('web/app.js','utf8');
const context=vm.createContext({fileSort:'acquisition'});
vm.runInContext(source.slice(source.indexOf('function acquisitionToken('),source.indexOf('function imageTypeLabel(')),context);
const rows=[
 {id:'old/9999',name:'1MX_OneView_ST_9999',acquisition_timestamp:100},
 {id:'later/0001',name:'1MX_OneView_ST_0001',acquisition_timestamp:200},
 {id:'latest/0001',name:'1MX_OneView_ST_0001',acquisition_timestamp:300},
];
assert.equal(context.sortedFiles([rows[2],rows[0],rows[1]]).map(row=>row.id).join(','),'old/9999,later/0001,latest/0001');
const untimed=[{id:'b',name:'ST_0042'},{id:'a',name:'ST_0042'},{id:'c',name:'ST_0043'}];
assert.equal(context.sortedFiles(untimed).map(row=>row.id).join(','),'a,b,c');
assert.equal(context.acquisitionNumber(rows[1]),1);
console.log('Acquisition sorting: rollover chronology, repeated numbers and untimed fallback passed.');

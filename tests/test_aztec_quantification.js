const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const window={};vm.runInNewContext(fs.readFileSync('web/aztec-quantification.js','utf8'),{window,atob,Uint8Array,DataView,Float32Array});
const {decodeValues,csv}=window.aztecQuantificationData;
const bytes=Buffer.alloc(24);[0,1.25,2.5,99.5,-3,NaN].forEach((v,i)=>bytes.writeFloatLE(v,i*4));
const values=decodeValues(bytes.toString('base64'),6);
assert.deepEqual(Array.from(values),[0,1.25,2.5,99.5,-3,NaN]);
assert.equal(csv(values,3),'0,1.25,2.5\r\n99.5,-3,\r\n');
assert.throws(()=>decodeValues(bytes.toString('base64'),7),/dimensions/);
console.log('Native composition values preserve little-endian float32, row order and missing pixels in CSV.');

const assert=require('node:assert/strict');
const {diagnosticControl}=require('../web/diagnostics.js');
assert.deepEqual(diagnosticControl({id:'map-show-rim',type:'checkbox',checked:false}),{control:'map-show-rim',value:false});
assert.deepEqual(diagnosticControl({id:'map-mode',value:'top'}),{control:'map-mode',value:'top'});
assert.equal(diagnosticControl({id:'secret',type:'password',value:'private'}),null);
assert.equal(diagnosticControl({id:'upload',type:'file',value:'private'}),null);
assert.equal(diagnosticControl({}),null);
assert.equal(diagnosticControl({id:'search',value:'x'.repeat(1000)}).value.length,160);
console.log('Diagnostic controls preserve useful settings and bound/exclude sensitive fields.');

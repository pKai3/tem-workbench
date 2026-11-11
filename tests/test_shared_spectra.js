const assert=require('node:assert/strict');
const pca=require('../web/shared-spectra.js');
const data={components:[{scores:[[-3,1],[0,2]]},{scores:[[4,-2],[1,0]]}],residual:[[.1,.2],[.3,.4]]};
assert.deepEqual(pca.values(data,'group',0,[0,1]),[[5,Math.sqrt(5)],[1,2]]);
assert.deepEqual(pca.values(data,'component',1,[]),data.components[1].scores);
assert.deepEqual(pca.values(data,'residual',0,[]),data.residual);
assert.deepEqual(pca.colour(1,1,true),[255,145,30]);
assert.deepEqual(pca.colour(-1,1,true),[30,145,255]);
assert.deepEqual(pca.colour(0,0,true),[30,30,30]);
const plan={window_pixels:[100,80],xs:[0,50,100],ys:[10,60]};
assert.equal(pca.nearest(plan,148,98),5);
assert.equal(pca.nearest(plan,50,50),0);
console.log('PCA view: signed maps, grouped activity, residuals and calibrated window selection passed.');

assert.deepEqual(pca.values({...data,decomposition:'nmf'},'group',0,[0,1]),[[1,-1],[1,2]]);

// A uniform field must remain uniform rather than inventing a contrast range.
assert.deepEqual(pca.mapRange([[5,5],[5,5]],true),{low:0,high:5,uniform:true});
const range=pca.mapRange([[5,5.1],[5.2,5.3]],true);
assert.ok(range.low>=5 && range.high<=5.3 && range.high>range.low);
assert.equal(pca.mapRange([[5,5.1],[5.2,5.3]],false).low,0);
assert.deepEqual(pca.mapColour(-1,0,1),pca.mapColour(0,0,1));
assert.deepEqual(pca.mapColour(2,0,1),pca.mapColour(1,0,1));

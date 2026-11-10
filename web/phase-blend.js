/* Display-only. Keep numerical colour rules in sync with phase_blend.py. */
function supportHsl(hex){
 const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255),hi=Math.max(r,g,b),lo=Math.min(r,g,b),d=hi-lo,l=(hi+lo)/2;
 if(!d)return [0,l,0];
 const s=d/(1-Math.abs(2*l-1));let h=hi===r?((g-b)/d+6)%6:hi===g?(b-r)/d+2:(r-g)/d+4;
 return [h/6,l,s];
}
function supportHex(h,l,s){
 const a=s*Math.min(l,1-l),f=n=>{const k=(n+h*12)%12;return l-a*Math.max(-1,Math.min(k-3,9-k,1))};
 return '#'+[f(0),f(8),f(4)].map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('');
}
function blendSupport(values){
 const entries=values.filter(e=>e[1]>0).map(([c,v])=>[c.toLowerCase(),v]).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
 if(!entries.length)return {colour:'#596778',value:0};
 if(entries.length===1)return {colour:entries[0][0],value:entries[0][1]};
 // Three or more selected phases use a continuous linear-light RGB mixture.
 // Keep zero-support phases in the input count so triangle edges use the same
 // rule as its interior, even when one phase disappears entirely.
 if(values.length>=3){
  const total=entries.reduce((sum,e)=>sum+e[1],0);
  const rgb=[1,3,5].map(offset=>{
   const light=entries.reduce((sum,[c,v])=>{const s=parseInt(c.slice(offset,offset+2),16)/255;return sum+v*(s<=.04045?s/12.92:((s+.055)/1.055)**2.4)},0)/total;
   return Math.round(255*(light<=.0031308?12.92*light:1.055*light**(1/2.4)-.055));
  });
  return {colour:'#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join(''),value:entries[0][1]};
 }
 const hls=entries.map(([c])=>supportHsl(c)),anchor=(hls.find(e=>e[2]>1e-9)||[0])[0],total=entries.reduce((s,e)=>s+e[1],0);
 let sumH=0,weightH=0,light=0,sat=0;
 entries.forEach(([,v],i)=>{const [h,l,s]=hls[i];weightH+=v*s;sumH+=v*s*(((h-anchor+.5)%1+1)%1-.5);light+=v*l;sat+=v*s});
 const hue=weightH?((anchor+sumH/weightH)%1+1)%1:0;
 return {colour:supportHex(hue,light/total,sat/total),value:entries[0][1]};
}
const supportTriangleCache=new Map();
function supportTriangleImage(colours){
 const key=colours.join('|');if(supportTriangleCache.has(key))return supportTriangleCache.get(key);
 const canvas=document.createElement('canvas');canvas.width=180;canvas.height=156;
 const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(canvas.width,canvas.height);
 for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
  const a=1-(y+.5)/canvas.height,c=(y+.5)/(2*canvas.height)+(x+.5)/canvas.width-.5,b=1-a-c;
  if(Math.min(a,b,c)<0)continue;
  const colour=blendSupport(colours.map((colour,i)=>[colour,[a,b,c][i]])).colour,offset=4*(y*canvas.width+x);
  for(let i=0;i<3;i++)pixels.data[offset+i]=parseInt(colour.slice(1+i*2,3+i*2),16);
  pixels.data[offset+3]=255;
 }
 ctx.putImageData(pixels,0,0);const url=canvas.toDataURL('image/png');
 if(supportTriangleCache.size>=12)supportTriangleCache.delete(supportTriangleCache.keys().next().value);
 supportTriangleCache.set(key,url);return url;
}
function supportBlendGradient(phases,palette){
 if(phases.length!==2)return '';
 const [a,b]=phases.map(p=>palette[p]);
 return 'linear-gradient(to right,'+Array.from({length:17},(_,i)=>blendSupport([[a,1-i/16],[b,i/16]]).colour+' '+(i/16*100)+'%').join(',')+')';
}

/* Saved native composition values; colour stretching is display-only. */
(() => {
'use strict';
function decodeValues(encoded, count){
 const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
 if(bytes.byteLength!==count*4)throw new Error('Composition map dimensions do not match its values.');
 const view=new DataView(bytes.buffer),values=new Float32Array(count);
 for(let i=0;i<count;i++)values[i]=view.getFloat32(i*4,true);
 return values;
}
function csv(values,width){
 const rows=[];
 for(let i=0;i<values.length;i+=width)rows.push(Array.from(values.subarray(i,i+width),v=>Number.isFinite(v)?String(v):'').join(','));
 return rows.join('\r\n')+'\r\n';
}
window.aztecQuantificationData={decodeValues,csv};
window.renderAztecQuantification=(root,result,{el,number})=>{
 const [height,width]=result.shape,grid=el('div',undefined,'eds-quant-grid');
 root.append(grid);
 const help=el('div',undefined,'eds-analysis-help eds-quant-help'),helpButton=el('button','ⓘ'),helpText=el('div',undefined,'eds-help-content');
 helpButton.type='button';helpButton.setAttribute('aria-label','About composition values');helpButton.setAttribute('aria-expanded','false');
 helpButton.onclick=()=>helpButton.setAttribute('aria-expanded',String(helpButton.getAttribute('aria-expanded')!=='true'));
 helpButton.onkeydown=e=>{if(e.key==='Escape')helpButton.setAttribute('aria-expanded','false')};helpText.setAttribute('role','tooltip');
 helpText.append(el('p','Each map shows the saved per-pixel composition. Colour ranges are stretched separately for each element. The mean is an average of pixels, not a new quantification of the summed spectrum. Hover, tap, or focus a map and use the arrow keys to inspect pixels. CSV downloads retain the original row and column order.','hint'));
 if(result.undecoded_fields?.length)helpText.append(el('p',`Additional stored fields ${result.undecoded_fields.join(', ')} have unverified units and are not displayed.`,'hint'));
 help.append(helpButton,helpText);
 for(const channel of result.channels){
  const tile=el('figure',undefined,'eds-quant-tile'),caption=el('figcaption',`${channel.element} · ${result.unit}`);
  tile.append(caption);grid.append(tile);
  if(channel.error){tile.append(el('p',channel.error,'eds-channel-error'));continue}
  const values=decodeValues(channel.values_base64,width*height),image=el('img'),scale=el('div',undefined,'eds-quant-scale'),readout=el('p','Hover or tap to inspect pixels.','hint eds-quant-readout');
  image.src=channel.image;image.alt=`${channel.element} ${result.label.toLowerCase()} map`;image.tabIndex=0;
  image.setAttribute('aria-label',`${image.alt}. Use arrow keys to inspect pixels.`);
  readout.id=`quant-pixel-${channel.atomic_number}`;image.setAttribute('aria-describedby',readout.id);
  scale.style.setProperty('--quant-colour',channel.colour);scale.append(el('span',number(channel.minimum)),el('span',number(channel.maximum)+' '+result.unit));
  let x=0,y=0;
  const show=()=>{readout.textContent=`Column ${x+1}, row ${y+1}: ${number(values[y*width+x])} ${result.unit}`};
  const point=e=>{const box=image.getBoundingClientRect();x=Math.max(0,Math.min(width-1,Math.floor((e.clientX-box.left)/box.width*width)));y=Math.max(0,Math.min(height-1,Math.floor((e.clientY-box.top)/box.height*height)));show()};
  image.onpointermove=point;image.onclick=point;image.onfocus=show;
  image.onkeydown=e=>{const step={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];if(!step)return;e.preventDefault();x=Math.max(0,Math.min(width-1,x+step[0]));y=Math.max(0,Math.min(height-1,y+step[1]));show()};
  const footer=el('div',undefined,'eds-quant-footer'),download=el('button','Download CSV');download.type='button';
  download.onclick=()=>{const url=URL.createObjectURL(new Blob([csv(values,width)],{type:'text/csv;charset=utf-8'})),link=el('a');link.href=url;link.download=`quant-${result.path.split('/').at(-1)}-${channel.atomic_number}-${result.measure}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
  footer.append(el('span',`Mean ${number(channel.mean)} ${result.unit}`,'hint'),download);
  tile.append(image,scale,readout,footer);
  if(channel.valid_pixels!==width*height)tile.append(el('p',`${(width*height-channel.valid_pixels).toLocaleString()} non-finite pixels are shown transparent and left empty in CSV.`,'eds-warning'));
 }
 root.append(help);
};
})();

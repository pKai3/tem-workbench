// Polygon vertices are relative to the ROI origin; translations preserve the mask.
let polygonDrawing=null,polygonVertexDrag=null;
function clipPolygonPreview(svg,image,r,id){
 let clip=svg.querySelector('#'+id);
 if(!r.polygon){image.removeAttribute('clip-path');clip?.remove();return}
 if(!clip){clip=el('clipPath',{id,clipPathUnits:'userSpaceOnUse'});svg.prepend(clip)}
 clip.replaceChildren(el('polygon',{points:r.polygon.map(([x,y])=>`${x+r.x},${y+r.y}`).join(' ')}));
 image.setAttribute('clip-path',`url(#${id})`);
}
function syncRegionSelection(){
 const polygon=Boolean(roi.polygon),mode=polygon?'polygon':Math.abs(roi.w-roi.h)>1?'rectangle':$('region-selection').value==='rectangle'?'rectangle':'square';
 if(!polygonDrawing)$('region-selection').value=mode;
 $('roi-box').style.display=polygon||polygonDrawing?'none':'';
 $('roi-handle').style.display=polygon||polygonDrawing?'none':'';
 $('roi-height-control').hidden=mode==='square';$('roi-height-nm').value=(roi.h*(meta.pixel_y_nm||meta.pixel_x_nm)).toFixed(2);
 $('draw-polygon').hidden=mode!=='polygon'||Boolean(polygonDrawing);
 $('polygon-fade-control').hidden=mode!=='polygon'&&!polygonDrawing;
 if(polygon&&!polygonDrawing)$('polygon-fade').value=roi.edge_fade_nm??1;
 $('finish-polygon').hidden=$('cancel-polygon').hidden=!polygonDrawing;
 $('finish-polygon').disabled=!polygonDrawing||polygonDrawing.points.length<3;
 $('polygon-help').hidden=mode!=='polygon'&&!polygonDrawing;
 if(polygon||mode==='rectangle')$('region-size').textContent=`${(roi.w*meta.pixel_x_nm).toFixed(2)} × ${(roi.h*(meta.pixel_y_nm||meta.pixel_x_nm)).toFixed(2)} nm`;
 $('fft-hann').title=polygon?'Polygon edge fading replaces the rectangular Hann window for this selection.':'';
 drawPolygonSelection();
}
// Display-only inset contour of distance to the polygon edge, in calibrated nm.
// Sampling permits concave outlines and disconnected full-weight interiors.
let polygonFadeContourCache=null;
function polygonFadeContour(r,sx,sy){
 const fade=r.edge_fade_nm??1;
 if(!r.polygon||fade<=0)return '';
 const key=JSON.stringify([r.w,r.h,r.polygon,fade,sx,sy]);
 if(polygonFadeContourCache?.key===key)return polygonFadeContourCache.path;
 const nx=Math.max(2,Math.ceil(256*r.w/Math.max(r.w,r.h))),ny=Math.max(2,Math.ceil(256*r.h/Math.max(r.w,r.h)));
 const vertices=r.polygon.map(([x,y])=>[x*sx,y*sy]);
 const samples=[];
 for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){
  const x=i*r.w/nx,y=j*r.h/ny,px=x*sx,py=y*sy;
  let inside=false,distance=Infinity;
  for(let a=0,b=vertices.length-1;a<vertices.length;b=a++){
   const [ax,ay]=vertices[a],[bx,by]=vertices[b],dx=bx-ax,dy=by-ay;
   if((ay>py)!==(by>py)&&px<(bx-ax)*(py-ay)/(by-ay)+ax)inside=!inside;
   const t=clamp(((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy||1),0,1);
   distance=Math.min(distance,Math.hypot(px-ax-t*dx,py-ay-t*dy));
  }
  samples.push([x,y,(inside?distance:-distance)-fade]);
 }
 const paths=[];
 function triangle(a,b,c){
  const hits=[];
  for(const [u,v] of [[a,b],[b,c],[c,a]])if((u[2]>0)!==(v[2]>0)){
   const t=u[2]/(u[2]-v[2]);hits.push([u[0]+t*(v[0]-u[0]),u[1]+t*(v[1]-u[1])]);
  }
  if(hits.length===2)paths.push(`M${hits[0][0].toFixed(3)},${hits[0][1].toFixed(3)}L${hits[1][0].toFixed(3)},${hits[1][1].toFixed(3)}`);
 }
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
  const k=j*(nx+1)+i,a=samples[k],b=samples[k+1],c=samples[k+nx+2],d=samples[k+nx+1];
  triangle(a,b,c);triangle(a,c,d);
 }
 const path=paths.join('');polygonFadeContourCache={key,path};return path;
}
function drawPolygonSelection(cursor){
 const layer=$('polygon-selection');layer.replaceChildren();if(!meta||isDiffraction())return;
 const points=polygonDrawing?.points||roi.polygon?.map(([x,y])=>[x+roi.x,y+roi.y]);if(!points?.length)return;
 const display=cursor&&polygonDrawing?[...points,[cursor.x,cursor.y]]:points;
 layer.append(el(polygonDrawing?'polyline':'polygon',{points:display.map(p=>p.join(',')).join(' '),class:'polygon-outline'}));
 if(!polygonDrawing&&roi.polygon){
  const path=polygonFadeContour(roi,meta.pixel_x_nm,meta.pixel_y_nm||meta.pixel_x_nm);
  if(path)layer.append(el('path',{d:path,transform:`translate(${roi.x} ${roi.y})`,class:'polygon-fade-outline'}));
  $('polygon-fade').title=(roi.edge_fade_nm??1)<=0?'No edge fade.':path?'Faint inset line: approximate start of full-weight interior. The outer band contributes with a cosine fade.':'Fade covers the entire selection; no full-weight interior remains.';
 }
 const radius=meta.width/Math.max($('overview').getBoundingClientRect().width,1)*5;
 points.forEach(([x,y],i)=>layer.append(el('circle',{cx:x,cy:y,r:radius,class:'polygon-vertex','data-vertex':i})));
}
function startPolygonDrawing(){
 if(!meta||isDiffraction())return;
 hideRegionPreview();polygonDrawing={points:[],previous:structuredClone(roi)};drag=null;
 $('region-selection').value='polygon';syncRegionSelection();$('overview').focus({preventScroll:true});
}
function cancelPolygonDrawing(restore=true){
 if(polygonDrawing&&restore)roi=polygonDrawing.previous;
 polygonDrawing=null;polygonVertexDrag=null;
 if(meta&&!isDiffraction())syncRegionSelection();
}
function finishPolygonDrawing(){
 const points=polygonDrawing?.points;if(!points||points.length<3)return;
 const x=Math.floor(Math.min(...points.map(p=>p[0]))),y=Math.floor(Math.min(...points.map(p=>p[1])));
 const w=Math.ceil(Math.max(...points.map(p=>p[0])))-x,h=Math.ceil(Math.max(...points.map(p=>p[1])))-y;
 if(Math.min(w,h)<32){message('Select at least 32 pixels in each direction.',true);return}
 roi={x,y,w,h,polygon:points.map(([px,py])=>[px-x,py-y]),edge_fade_nm:Number($('polygon-fade').value)};
 polygonDrawing=null;updateBox(true);schedule(0);
}
function resizeRegionSelection(start,p){
 const base=start.roi;
 if(base.polygon){
  const scale=clamp(Math.max((base.w+p.x-start.x)/base.w,(base.h+p.y-start.y)/base.h),Math.max(32/base.w,32/base.h),Math.min((meta.width-base.x)/base.w,(meta.height-base.y)/base.h));
  roi.w=Math.round(base.w*scale);roi.h=Math.round(base.h*scale);
  roi.polygon=base.polygon.map(([x,y])=>[x*roi.w/base.w,y*roi.h/base.h]);
 }else if($('region-selection').value==='rectangle'){
  roi.w=clamp(base.w+p.x-start.x,32,meta.width-base.x);roi.h=clamp(base.h+p.y-start.y,32,meta.height-base.y);
 }else roi.w=clamp(base.w+Math.max(p.x-start.x,p.y-start.y),32,Math.min(meta.width-base.x,meta.height-base.y));
}
$('region-selection').onchange=()=>{
 if(!meta||isDiffraction())return;
 const mode=$('region-selection').value;
 if(mode==='polygon'){startPolygonDrawing();return}
 cancelPolygonDrawing();$('region-selection').value=mode;delete roi.polygon;delete roi.edge_fade_nm;
 if(mode==='square')roi.h=roi.w;updateBox(mode==='rectangle');schedule(0);
};
$('draw-polygon').onclick=startPolygonDrawing;$('finish-polygon').onclick=finishPolygonDrawing;
$('cancel-polygon').onclick=()=>cancelPolygonDrawing();
let polygonFadeTimer=null;
function applyPolygonFade(reportInvalid=false){
 const value=$('polygon-fade').value,fade=Number(value);
 if(value===''||!Number.isFinite(fade)||fade<0||fade>1000){if(reportInvalid)message('Edge fading must be 0–1000 nm.',true);return}
 if(roi.polygon&&!polygonDrawing&&roi.edge_fade_nm!==fade){roi={...roi,edge_fade_nm:fade};drawPolygonSelection();schedule(0)}
}
$('polygon-fade').oninput=()=>{
 clearTimeout(polygonFadeTimer);polygonFadeTimer=setTimeout(()=>applyPolygonFade(),300);
};
$('polygon-fade').onchange=()=>{clearTimeout(polygonFadeTimer);applyPolygonFade(true)};
$('roi-height-nm').onchange=()=>{
 if(!meta)return;const h=clamp(Math.round(Number($('roi-height-nm').value)/(meta.pixel_y_nm||meta.pixel_x_nm)),32,meta.height-roi.y);
 if(!Number.isFinite(h))return;
 if(roi.polygon)roi.polygon=roi.polygon.map(([x,y])=>[x,y*h/roi.h]);
 roi.h=h;updateBox(true);schedule(0);
};
function polygonCursorPoint(e){
 const p=point(e);
 return {x:clamp(Math.round(p.x),0,meta.width-1),y:clamp(Math.round(p.y),0,meta.height-1)};
}
function polygonDrawingEvent(e){
 return polygonDrawing&&meta&&!isDiffraction()&&!overlapPlanning()&&!document.querySelector('dialog[open]')&&
  !e.target.closest?.('button,input,select,textarea,a,label,summary,[contenteditable="true"]');
}
// Allow vertices beyond the canvas: use the nearest source-image pixel.
document.addEventListener('pointerdown',e=>{
 if(!polygonDrawingEvent(e)||e.button!==0)return;
 e.preventDefault();e.stopImmediatePropagation();$('overview').focus({preventScroll:true});
 const p=polygonCursorPoint(e),points=polygonDrawing.points,first=points[0],tol=meta.width/$('overview').getBoundingClientRect().width*12;
 // SVG vertices are recreated during preview; native dblclick may never fire.
 const last=polygonDrawing.lastClick;
 if(last&&points.length>=3&&e.timeStamp-last.time<=500&&e.timeStamp>=last.time&&Math.hypot(e.clientX-last.x,e.clientY-last.y)<=6){finishPolygonDrawing();return}
 polygonDrawing.lastClick={time:e.timeStamp,x:e.clientX,y:e.clientY};
 if(first&&points.length>=3&&Math.hypot(p.x-first[0],p.y-first[1])<tol){finishPolygonDrawing();return}
 if(!points.length||points.at(-1)[0]!==p.x||points.at(-1)[1]!==p.y)points.push([p.x,p.y]);
 syncRegionSelection();
},true);
document.addEventListener('dblclick',e=>{
 if(!polygonDrawingEvent(e)||e.button!==0)return;
 e.preventDefault();e.stopImmediatePropagation();finishPolygonDrawing();
},true);
document.addEventListener('pointermove',e=>{
 if(!polygonDrawingEvent(e))return;
 e.stopImmediatePropagation();drawPolygonSelection(polygonCursorPoint(e));
},true);
$('overview').addEventListener('pointerdown',e=>{
 if(!meta||isDiffraction()||overlapPlanning()||e.button!==0)return;
 if(e.target.hasAttribute('data-vertex')&&roi.polygon){
  e.preventDefault();e.stopImmediatePropagation();polygonVertexDrag={index:Number(e.target.dataset.vertex),roi:structuredClone(roi)};
  $('overview').setPointerCapture(e.pointerId);hideRegionPreview();
 }
},true);
$('overview').addEventListener('pointermove',e=>{
 if(!polygonVertexDrag)return;e.stopImmediatePropagation();
 const p=point(e),base=polygonVertexDrag.roi,points=base.polygon.map(([x,y])=>[x+base.x,y+base.y]);
 points[polygonVertexDrag.index]=[clamp(p.x,0,meta.width),clamp(p.y,0,meta.height)];
 const x=Math.floor(Math.min(...points.map(p=>p[0]))),y=Math.floor(Math.min(...points.map(p=>p[1]))),w=Math.ceil(Math.max(...points.map(p=>p[0])))-x,h=Math.ceil(Math.max(...points.map(p=>p[1])))-y;
 if(Math.min(w,h)<32)return;
 roi={...base,x,y,w,h,polygon:points.map(([px,py])=>[px-x,py-y])};updateBox(true);schedule(90);
},true);
for(const event of ['pointerup','pointercancel'])$('overview').addEventListener(event,e=>{
 if(!polygonVertexDrag)return;e.stopImmediatePropagation();polygonVertexDrag=null;if(pending){clearTimeout(timer);timer=null;analyze()}
},true);
// Drawing shortcuts must survive focus moving to the selection toolbar.
document.addEventListener('keydown',e=>{
 if(!polygonDrawing||e.isComposing||e.altKey||e.ctrlKey||e.metaKey||document.querySelector('dialog[open]'))return;
 const editing=e.target.closest?.('input,textarea,select,[contenteditable="true"]');
 if(!['Escape','Enter','Backspace'].includes(e.key)||(e.key==='Backspace'&&editing))return;
 e.preventDefault();e.stopImmediatePropagation();
 if(e.key==='Escape'){cancelPolygonDrawing();updateBox(true)}
 if(e.key==='Enter')finishPolygonDrawing();
 if(e.key==='Backspace'){polygonDrawing.points.pop();syncRegionSelection()}
 $('overview').focus({preventScroll:true});
},true);

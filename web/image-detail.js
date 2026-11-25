/* Shared cursor-centred 5× detail for Figures and AZtec maps. */
window.WorkbenchImageDetail={
 crop({x=0,y=0,width,height,u,v}){
  const w=width/5,h=height/5;
  return {x:x+Math.max(0,Math.min(width-w,u*width-w/2)),y:y+Math.max(0,Math.min(height-h,v*height-h/2)),width:w,height:h};
 },
 draw(source,region,filter='none',smoothing=true){
  const crop=this.crop(region),canvas=document.createElement('canvas');canvas.width=560;canvas.height=Math.max(1,Math.round(560*crop.height/crop.width));
  const context=canvas.getContext('2d');context.filter=filter||'none';context.imageSmoothingEnabled=smoothing;
  context.drawImage(source,crop.x,crop.y,crop.width,crop.height,0,0,canvas.width,canvas.height);
  return canvas.toDataURL('image/png');
 },
 position(host,x,y){
  const box=host.getBoundingClientRect(),gap=14;
  let left=x+gap;if(left+box.width>innerWidth-8)left=x-box.width-gap;
  host.style.left=Math.max(8,Math.min(left,innerWidth-box.width-8))+'px';
  host.style.top=Math.max(8,Math.min(y+gap,innerHeight-box.height-8))+'px';
 }
};

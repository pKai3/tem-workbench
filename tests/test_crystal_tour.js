const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/crystal-viewer.js','utf8'),numerics={window:{}};vm.createContext(numerics);vm.runInContext(source,numerics);
const V=numerics.window.CrystalViewer,plain=value=>JSON.parse(JSON.stringify(value));
function tour({candidate=false,realign=false}={}){
 const timers=new Map(),moves=[],settled=[];let serial=0;
 const detail=V.describe('HCP',candidate?{phase:'HCP',zone_3index:[1,1,0]}:null);
 const state={detail,matrix:V.zoneRotation(detail,[1,1,0]),baseMatrix:null,activeZone:null,followCandidate:false,touring:true,tourIndex:0,tourTimer:0,closed:false,snapAnimation:null,view:{value:'tour'},customWrap:{hidden:true},snapStatus:{textContent:''},realign:{checked:realign},alignZone:V.alignZone,realignZone:V.realignZone,resetTilts(){},
  animateTo(target,complete,message,duration=600){state.snapAnimation={target,complete};moves.push({target,message,duration})},
  finishSnap(target,choice){state.matrix=state.baseMatrix=target.matrix;state.view.value=choice;settled.push(plain(target.zone))},
  setTimeout(callback,delay){const id=++serial;timers.set(id,{callback,delay});return id},clearTimeout(id){timers.delete(id)}};
 vm.createContext(state);
 vm.runInContext(source.slice(source.indexOf(' const STANDARD_ZONES='),source.indexOf(' let snapEnabled=')),state);
 vm.runInContext(source.slice(source.indexOf('  function tourNext(){'),source.indexOf('  function freeRotate(')),state);
 vm.runInContext(source.slice(source.indexOf('  function cancelSnap(){'),source.indexOf('  function finishSnap(')),state);
 return {state,timers,moves,settled,finish(){const animation=state.snapAnimation;assert.ok(animation);state.snapAnimation=null;state.matrix=animation.target.matrix;animation.complete()},advance(){assert.equal(timers.size,1);const [id,timer]=[...timers][0];assert.equal(timer.delay,1500);timers.delete(id);timer.callback()}};
}
const expected=[[0,0,1],[1,0,0],[1,1,0],[1,-1,0],[1,1,1],[1,1,2],[1,0,1],[0,0,1]],cycle=tour();cycle.state.tourNext();
for(let i=0;i<expected.length;i++){
 assert.deepEqual(plain(cycle.moves.at(-1).target.zone),expected[i]);assert.equal(cycle.moves.at(-1).duration,1800);assert.equal(cycle.timers.size,0,'Dwell starts only after rotation completes');
 cycle.finish();assert.deepEqual(cycle.settled.at(-1),expected[i]);assert.equal(cycle.state.view.value,'tour');assert.match(cycle.state.snapStatus.textContent,/^Tour · \[/);
 if(i<expected.length-1)cycle.advance();
}
// Cancelling during a dwell removes its timer; even an already-queued callback
// cannot move a manually selected or closed viewer later.
const queued=[...cycle.timers.values()][0].callback,moves=cycle.moves.length;cycle.state.cancelSnap();assert.equal(cycle.timers.size,0);assert.equal(cycle.state.view.value,'free');queued();assert.equal(cycle.moves.length,moves);
const moving=tour();moving.state.tourNext();moving.state.cancelSnap();assert.equal(moving.state.snapAnimation,null);assert.equal(moving.timers.size,0);assert.equal(moving.state.touring,false);
// Optional reference realignment finishes before the dwell. Candidates tour
// the chosen axes without applying that extra detector-roll adjustment.
const aligned=tour({realign:true});aligned.state.tourNext();aligned.finish();assert.equal(aligned.timers.size,0);assert.equal(aligned.moves.length,2);assert.match(aligned.moves[1].message,/Realigning/);assert.equal(aligned.moves[1].duration,1200);aligned.finish();assert.equal(aligned.timers.size,1);
const candidate=tour({candidate:true,realign:true});candidate.state.tourNext();candidate.finish();assert.equal(candidate.moves.length,1);assert.equal(candidate.timers.size,1);
const closed=tour();closed.state.closed=true;closed.state.tourNext();assert.equal(closed.moves.length,0);
console.log('Crystal zone tour: standard-axis order and looping, completed-rotation dwell, cancellation, reference realignment and candidate protection passed.');

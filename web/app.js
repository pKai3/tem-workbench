'use strict';
const MAGMA=[[0,0,3],[0,0,4],[0,0,6],[1,0,7],[1,1,9],[1,1,11],[2,2,13],[2,2,15],[3,3,17],[4,3,19],[4,4,21],[5,4,23],[6,5,25],[7,5,27],[8,6,29],[9,7,31],[10,7,34],[11,8,36],[12,9,38],[13,10,40],[14,10,42],[15,11,44],[16,12,47],[17,12,49],[18,13,51],[20,13,53],[21,14,56],[22,14,58],[23,15,60],[24,15,63],[26,16,65],[27,16,68],[28,16,70],[30,16,73],[31,17,75],[32,17,77],[34,17,80],[35,17,82],[37,17,85],[38,17,87],[40,17,89],[42,17,92],[43,17,94],[45,16,96],[47,16,98],[48,16,101],[50,16,103],[52,16,104],[53,15,106],[55,15,108],[57,15,110],[59,15,111],[60,15,113],[62,15,114],[64,15,115],[66,15,116],[67,15,117],[69,15,118],[71,15,119],[72,16,120],[74,16,121],[75,16,121],[77,17,122],[79,17,123],[80,18,123],[82,18,124],[83,19,124],[85,19,125],[87,20,125],[88,21,126],[90,21,126],[91,22,126],[93,23,126],[94,23,127],[96,24,127],[97,24,127],[99,25,127],[101,26,128],[102,26,128],[104,27,128],[105,28,128],[107,28,128],[108,29,128],[110,30,129],[111,30,129],[113,31,129],[115,31,129],[116,32,129],[118,33,129],[119,33,129],[121,34,129],[122,34,129],[124,35,129],[126,36,129],[127,36,129],[129,37,129],[130,37,129],[132,38,129],[133,38,129],[135,39,129],[137,40,129],[138,40,129],[140,41,128],[141,41,128],[143,42,128],[145,42,128],[146,43,128],[148,43,128],[149,44,128],[151,44,127],[153,45,127],[154,45,127],[156,46,127],[158,46,126],[159,47,126],[161,47,126],[163,48,126],[164,48,125],[166,49,125],[167,49,125],[169,50,124],[171,51,124],[172,51,123],[174,52,123],[176,52,123],[177,53,122],[179,53,122],[181,54,121],[182,54,121],[184,55,120],[185,55,120],[187,56,119],[189,57,119],[190,57,118],[192,58,117],[194,58,117],[195,59,116],[197,60,116],[198,60,115],[200,61,114],[202,62,114],[203,62,113],[205,63,112],[206,64,112],[208,65,111],[209,66,110],[211,66,109],[212,67,109],[214,68,108],[215,69,107],[217,70,106],[218,71,105],[220,72,105],[221,73,104],[222,74,103],[224,75,102],[225,76,102],[226,77,101],[228,78,100],[229,80,99],[230,81,98],[231,82,98],[232,84,97],[234,85,96],[235,86,96],[236,88,95],[237,89,95],[238,91,94],[238,93,93],[239,94,93],[240,96,93],[241,97,92],[242,99,92],[243,101,92],[243,103,91],[244,104,91],[245,106,91],[245,108,91],[246,110,91],[246,112,91],[247,113,91],[247,115,92],[248,117,92],[248,119,92],[249,121,92],[249,123,93],[249,125,93],[250,127,94],[250,128,94],[250,130,95],[251,132,96],[251,134,96],[251,136,97],[251,138,98],[252,140,99],[252,142,99],[252,144,100],[252,146,101],[252,147,102],[253,149,103],[253,151,104],[253,153,105],[253,155,106],[253,157,107],[253,159,108],[253,161,110],[253,162,111],[253,164,112],[254,166,113],[254,168,115],[254,170,116],[254,172,117],[254,174,118],[254,175,120],[254,177,121],[254,179,123],[254,181,124],[254,183,125],[254,185,127],[254,187,128],[254,188,130],[254,190,131],[254,192,133],[254,194,134],[254,196,136],[254,198,137],[254,199,139],[254,201,141],[254,203,142],[253,205,144],[253,207,146],[253,209,147],[253,210,149],[253,212,151],[253,214,152],[253,216,154],[253,218,156],[253,220,157],[253,221,159],[253,223,161],[253,225,163],[252,227,165],[252,229,166],[252,230,168],[252,232,170],[252,234,172],[252,236,174],[252,238,176],[252,240,177],[252,241,179],[252,243,181],[252,245,183],[251,247,185],[251,249,187],[251,250,189],[251,252,191]];
function paletteRamp(stops){
 const rgb=stops.map(hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)));
 return Array.from({length:256},(_,i)=>{
  const at=i/255*(rgb.length-1),lo=Math.floor(at),hi=Math.min(lo+1,rgb.length-1),t=at-lo;
  return rgb[lo].map((value,channel)=>Math.round(value+(rgb[hi][channel]-value)*t));
 });
}
// Matplotlib colour tables quantized to RGB8; see web/colormaps.LICENSE.
function paletteFromHex(hex){return hex.match(/.{6}/g).map(rgb=>[0,2,4].map(i=>parseInt(rgb.slice(i,i+2),16)))}
const SPECTRUM_PALETTES={
 magma:MAGMA,gray:paletteRamp(['#000000','#ffffff']),
 viridis:paletteFromHex('44015444025544035745055845065a45085b46095c460b5e460c5f460e61470f6247116347126547146647156747166947186a48196b481a6c481c6e481d6f481e70482071482172482273482374472575472676472777472878472a79472b7a472c7b462d7c462f7c46307d46317e45327f45347f453580453681443781443982433a83433b83433c84423d84423e854240854141864142864043874044873f45873f47883e48883e49893d4a893d4b893d4c893c4d8a3c4e8a3b508a3b518a3a528b3a538b39548b39558b38568b38578c37588c37598c365a8c365b8c355c8c355d8c345e8d345f8d33608d33618d32628d32638d31648d31658d31668d30678d30688d2f698d2f6a8d2e6b8e2e6c8e2e6d8e2d6e8e2d6f8e2c708e2c718e2c728e2b738e2b748e2a758e2a768e2a778e29788e29798e287a8e287a8e287b8e277c8e277d8e277e8e267f8e26808e26818e25828e25838d24848d24858d24868d23878d23888d23898d22898d228a8d228b8d218c8d218d8c218e8c208f8c20908c20918c1f928c1f938b1f948b1f958b1f968b1e978a1e988a1e998a1e998a1e9a891e9b891e9c891e9d881e9e881e9f881ea0871fa1871fa2861fa38620a48520a58521a68521a78422a78423a88323a98224aa8225ab8126ac8127ad8028ae7f29af7f2ab07e2bb17d2cb17d2eb27c2fb37b30b47a32b57a33b67935b77836b87738b97639b9763bba753dbb743ebc7340bd7242be7144be7045bf6f47c06e49c16d4bc26c4dc26b4fc36951c46853c56755c66657c66559c7645bc8625ec96160c96062ca5f64cb5d67cc5c69cc5b6bcd596dce5870ce5672cf5574d05477d05279d1517cd24f7ed24e81d34c83d34b86d44988d5478bd5468dd64490d64392d74195d73f97d83e9ad83c9dd93a9fd938a2da37a5da35a7db33aadb32addc30afdc2eb2dd2cb5dd2bb7dd29bade27bdde26bfdf24c2df22c5df21c7e01fcae01ecde01dcfe11cd2e11bd4e11ad7e219dae218dce218dfe318e1e318e4e318e7e419e9e419ece41aeee51bf1e51cf3e51ef6e61ff8e621fae622fde724'),
 plasma:paletteFromHex('0c078610078713068915068a18068b1b068c1d068d1f058e21058f2305902505912705922905932b05942d04942f04953104963304973404983604983804993a049a3b039a3d039b3f039c40039c42039d44039e45039e47029f49029f4a02a04c02a14e02a14f02a25101a25201a35401a35601a35701a45901a45a00a55c00a55e00a55f00a66100a66200a66400a76500a76700a76800a76a00a76c00a86d00a86f00a87000a87200a87300a87500a87601a87801a87901a87b02a87c02a77e03a77f03a78104a78204a78405a68506a68607a68807a58908a58b09a48c0aa48e0ca48f0da3900ea3920fa29310a19511a19612a09713a099149f9a159e9b179e9d189d9e199c9f1a9ba01b9ba21c9aa31d99a41e98a51f97a72197a82296a92395aa2494ac2593ad2692ae2791af2890b02a8fb12b8fb22c8eb42d8db52e8cb62f8bb7308ab83289b93388ba3487bb3586bc3685bd3784be3883bf3982c03b81c13c80c23d80c33e7fc43f7ec5407dc6417cc7427bc8447ac94579ca4678cb4777cc4876cd4975ce4a75cf4b74d04d73d14e72d14f71d25070d3516fd4526ed5536dd6556dd7566cd7576bd8586ad95969da5a68db5b67dc5d66dc5e66dd5f65de6064df6163df6262e06461e16560e26660e3675fe3685ee46a5de56b5ce56c5be66d5ae76e5ae87059e87158e97257ea7356ea7455eb7654ec7754ec7853ed7952ed7b51ee7c50ef7d4fef7e4ef0804df0814df1824cf2844bf2854af38649f38748f48947f48a47f58b46f58d45f68e44f68f43f69142f79241f79341f89540f8963ff8983ef9993df99a3cfa9c3bfa9d3afa9f3afaa039fba238fba337fba436fca635fca735fca934fcaa33fcac32fcad31fdaf31fdb030fdb22ffdb32efdb52dfdb62dfdb82cfdb92bfdbb2bfdbc2afdbe29fdc029fdc128fdc328fdc427fdc626fcc726fcc926fccb25fccc25fcce25fbd024fbd124fbd324fad524fad624fad824f9d924f9db24f8dd24f8df24f7e024f7e225f6e425f6e525f5e726f5e926f4ea26f3ec26f3ee26f2f026f2f126f1f326f0f525f0f623eff821'),
 cividis:paletteFromHex('00224d00234f00235000245200255400265500265700275900285b00285c00295e002a60002a62002b64002c66002c67002d69002e6b002f6d002f6f0030700030700031700031700432700833700b33700e347011356f14366f16366f18376f1a386f1c386e1d396e1f3a6e213b6e223b6e243c6e253d6d273d6d283e6d2a3f6d2b3f6d2c406d2e416c2f426c30426c31436c32446c34446c35456c36466c37466c38476c39486c3a486b3b496b3d4a6b3e4b6b3f4b6b404c6b414d6b424d6b434e6b444f6b454f6b46506b47516b48516b49526b4a536b4b546c4c546c4d556c4e566c4e566c4f576c50586c51586c52596c535a6c545a6c555b6d565c6d575d6d585d6d595e6d595f6d5a5f6d5b606e5c616e5d616e5e626e5f636e60646e61646f61656f62666f63666f64676f656870666970676970686a70686b71696b716a6c716b6d716c6d726d6e726e6f726e70736f70737071737172737273747373747474757475757575757676767777767878767978777979777a7a777b7b777c7b787d7c787e7d787f7d78807e78817f788280788380788481788582788583788683788784788885788986788a86788b87788c88788d89788e89788f8a77908b77918c77928c77938d77948e77958f77968f779790769891769992769a93769b93769c94769d95759e96759f9675a09775a19874a29974a39a74a49a74a59b73a69c73a79d73a89e73a99e72aa9f72aba072aca171ada271aea271afa370b0a470b1a570b2a66fb3a66fb4a76fb5a86eb6a96eb7aa6db8ab6db9ab6dbaac6cbbad6cbcae6bbdaf6bbeb06abfb06ac1b169c2b269c3b368c4b468c5b567c6b567c7b666c8b765c9b865cab964cbba64ccbb63cdbc62cebc62cfbd61d0be60d2bf60d3c05fd4c15ed5c25ed6c35dd7c35cd8c45bd9c55adac65adbc759dcc858dec957dfca56e0cb55e1cc54e2cc53e3cd52e4ce51e5cf50e6d04fe8d14ee9d24dead34cebd44becd54aedd648eed747efd846f1d944f2da43f3da42f4db40f5dc3ff6dd3df8de3bf9df3afae038fbe136fde234fde333fde534fde636fde737'),
 turbo:paletteFromHex('30123b31154232184a341b51351e5836215f37236538266c3929723a2c793b2f7f3c32853c358b3d37913e3a963f3d9c4040a14043a64145ab4148b0424bb5434eba4350be4353c24456c74458cb455bce455ed24560d64563d94666dd4668e0466be3466de64670e84673eb4675ed4678f0467af2467df4467ff64682f84584f94587fb4589fc448cfd438efd4291fe4193fe4096fe3f98fe3e9bfe3c9dfd3ba0fc39a2fc38a5fb36a8f934aaf833acf631aff52fb1f32db4f12bb6ef2ab9ed28bbeb26bde925c0e623c2e421c4e120c6df1ec9dc1dcbda1ccdd71bcfd41ad1d219d3cf18d5cc18d7ca17d9c717dac417dcc217debf18e0bd18e1ba19e3b81ae4b61be5b41de7b11ee8af20e9ac22eba924eca627eda329eea02cef9d2ff09a32f19735f39438f4913bf48d3ff58a42f68746f7834af8804df97c51f97955fa7659fb725dfb6f61fc6c65fc6869fd656dfd6271fd5f74fe5c78fe597cfe5680fe5384fe5087fe4d8bfe4b8efe4892fe4695fe4498fe429bfd409efd3ea1fc3da4fc3ba6fb3aa9fb39acfa37aef937b1f836b3f835b6f735b9f534bbf434bef334c0f233c3f133c5ef33c8ee33caed33cdeb34cfea34d1e834d4e735d6e535d8e335dae236dde036dfde36e1dc37e3da37e5d838e7d738e8d538ead339ecd139edcf39efcd39f0cb3af2c83af3c63af4c43af6c23af7c039f8be39f9bc39f9ba38fab737fbb537fbb336fcb035fcae34fdab33fda932fda631fda330fea12ffe9e2efe9b2dfe982cfd952bfd9229fd8f28fd8c27fc8926fc8624fb8323fb8022fa7d20fa7a1ff9771ef8741cf7711bf76e1af66b18f56817f46516f36315f26014f15d13ef5a11ee5810ed550fec520eea500de94d0de84b0ce6490be5460ae3440ae24209e04008de3e08dd3c07db3a07d93806d73606d63405d43205d23005d02f04ce2d04cb2b03c92903c72803c52602c32402c02302be2102bb1f01b91e01b61c01b41b01b11901ae1801ac1601a91501a61401a31201a011019d10019a0e01970d01940c01910b018e0a018b09018708018407018106027d05027a0402')
};
const PHASE_COLOR_OPTIONS={blue:['Blue','#79bafa'],gold:['Gold','#f4b75e'],mint:['Mint','#64e2b0'],green:['Vivid green','#39ff5a'],pink:['Pink','#ff8ac3'],white:['White','#f4f7fb']};
const $=id=>document.getElementById(id), NS='http://www.w3.org/2000/svg';
const PHASES=['HCP','BCC','FCC'];
const PHASE_DEFAULT_COLORS={HCP:'blue',BCC:'gold',FCC:'pink'};
const phaseColorChoices={...PHASE_DEFAULT_COLORS};
let enabledPhases=['HCP','BCC'];
function materialPhases(){return config?.material_presets?.[$('material').value]?.enabled_phases??({titanium:['HCP','BCC'],iron:['BCC','FCC'],custom:PHASES}[$('material').value]||PHASES)}
function analysisPhases(value){return Array.isArray(value?.enabled_phases)?PHASES.filter(phase=>value.enabled_phases.includes(phase)):PHASES}
function setPhaseSelection(phases){
 enabledPhases=PHASES.filter(phase=>phases.includes(phase));
 for(const phase of PHASES)$(phase.toLowerCase()+'-color').value=enabledPhases.includes(phase)?phaseColorChoices[phase]:'disabled';
 syncOverlayMenus();
 applyPhaseColors(false);
 $('phase-search-note').textContent=enabledPhases.length?'Searching '+enabledPhases.join(' + ')+'. Disabled skips matching.':'Phase search disabled. Peak and geometry checks remain available.';
}
function syncOverlayMenus(patternValue=$('overlay').value,vectorValue=$('reflection-vectors').value){
 const winners=[['winner','Winning Fit (Passing)'],['winner_any','Winning Fit (Any)']];
 const phaseChoices=enabledPhases.map(phase=>[phase,'Best '+phase]);
 if(enabledPhases.length>1)phaseChoices.push(['all','Best '+enabledPhases.join(' + ')]);
 if(enabledPhases.length===3)phaseChoices.push(['both','Best HCP + BCC']);
 const pattern=$('overlay'),vectors=$('reflection-vectors');
 const append=(parent,choices,prefix='',label='')=>{for(const [value,name] of choices)parent.append(new Option(label+name,prefix+value))};
 pattern.replaceChildren(new Option('None','none'));
 if(enabledPhases.length)append(pattern,[...winners,...phaseChoices]);
 append(pattern,[['geometry','Primary + Secondary Geometry'],['custom','Choose individual fits']]);
 vectors.replaceChildren(new Option('Off','off'));
 if(enabledPhases.length)for(const [label,prefix,caption] of [['Fitted A/B/C','fitted_','A/B/C · '],['Indexed reflections','','Indexed · ']]){
  const group=document.createElement('optgroup');group.label=label;
  append(group,[...winners,...phaseChoices],prefix,caption);vectors.append(group);
 }
 const restore=(select,value,fallback)=>{
  const values=[...select.options].map(option=>option.value);
  const prefix=value.startsWith('fitted_')?'fitted_':'',choice=prefix?value.slice(7):value;
  if(choice==='both'&&enabledPhases.join(',')==='HCP,BCC')value=prefix+'all';
  if(choice==='all'&&enabledPhases.length===1)value=prefix+enabledPhases[0];
  select.value=values.includes(value)?value:fallback;
 };
 restore(pattern,patternValue,enabledPhases.length?'winner':'none');
 restore(vectors,vectorValue,enabledPhases.length?(vectorValue.startsWith('fitted_')?'fitted_winner':'winner'):'off');
}
function finishPhaseChange(previous){
 writePreference('tem-phase-colors',phaseColorChoices);rememberBasicControls();
 applyPhaseColors();
 if(previous.join(',')!==enabledPhases.join(','))invalidateAnalysisSettings();
}
const phaseMaps=()=>Object.fromEntries(PHASES.map(phase=>[phase,new Map()]));
const labels={hcp_compatible:'HCP compatible',bcc_compatible:'BCC compatible',fcc_compatible:'FCC compatible',coexisting_candidates:'Two candidate structures',multiple_orientations:'Multiple orientations',ambiguous:'Phase ambiguous',unresolved:'Phase unresolved',insufficient:'Insufficient evidence'};
const colors={hcp_compatible:'#79bafa',bcc_compatible:'#f4b75e',fcc_compatible:'#ff8ac3',coexisting_candidates:'#d692fa',multiple_orientations:'#64d6bb',ambiguous:'#df9da6',unresolved:'#a4adba',insufficient:'#596778'};
let mapExportBusy=false;
let detectorRaw=null,showDetectorSignal=false;
let demoPromptShown=false;
let config, meta, roi={x:0,y:0,w:684,h:684}, fileId, result=null, fftRaw=null, grid=null, jobId=null;
let diffractionSettings=null, maskDrag=null;
function isDiffraction(){return meta?.image_kind==='diffraction'}
let chosenFits=new Set(), favorites=new Set();
let regionProject={revision:0,regions:[]},selectedRegionId=null,regionRequest=0;
let folderTarget=null,folderListing=null,folderBrowseVersion=0;
let rescoreTimer=null, rescoreBusy=false, rescorePending=false, rescoreRevision=0, scalePenalty=.10, peakEvidenceWeight=.10;
let zoneJob=null, zoneSymbols=phaseMaps();
const ZONE_SYMBOLS=['●','▲','◆','■','★','✚','✕','▼','⬟','⬢','◀','▶','✦','✳','◉','⊞','⊠','✧'];
const phaseColors=Object.fromEntries(PHASES.map(phase=>[phase,colors[phase.toLowerCase()+'_compatible']]));
let generation=0, busy=false, pending=false, timer=null, drag=null, sourceRequest=0, opened=false;
function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error)}
async function api(path,body,signal){const options=body?{method:'POST',headers:{'Content-Type':'application/json','X-TEM-Token':config.token},body:JSON.stringify(body)}:{};const r=await fetch('/api/'+path,{...options,signal});const data=await r.json();if(!r.ok)throw new Error(data.error||r.statusText);return data}
function readPreference(key,fallback){
 try{
  const text=localStorage.getItem(key);if(text===null)return fallback;
  try{return JSON.parse(text)??fallback}catch{return text} // Accept older plain-text display preferences.
 }catch{return fallback}
}
function writePreference(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch{message('Browser storage is unavailable; these preferences will last until this page closes.',true)}}
const FFT_DETECTOR_CONTROLS={'fft-smoothing':['fft_smoothing_sigma',.65,0,3],'fft-threshold-floor':['fft_threshold_floor',1.8,0,20],'fft-min-strength':['fft_minimum_enrichment',3,0,20],'fft-min-separation':['fft_minimum_separation',.12,0,3],'fft-max-peaks':['fft_max_peaks',70,4,200,true]};
const BASIC_NUMBERS={"g-max":[4,30],"fft-g-min":[0,29.9],"hcp-a":[0.15,0.65],"hcp-c":[0.20,1.20],"bcc-a":[0.20,0.65],"fcc-a":[0.20,0.65],"threshold":[0.15,0.7],"grid-count":[2,24,true],"grid-min":[0,null]};
Object.assign(BASIC_NUMBERS,Object.fromEntries(Object.entries(FFT_DETECTOR_CONTROLS).map(([id,[key,value,min,max,integer]])=>[id,[min,max,integer]])));
const BASIC_FLAGS=['adaptive','check-passing','show-grid','fft-hann','fft-mean'];
const OVERLAY_MODES=['none','winner','winner_any',...PHASES,'both','all','geometry','custom'];
let preferredRegionNm=readPreference('tem-region-width-nm',20);
if(typeof preferredRegionNm!=='number'||!Number.isFinite(preferredRegionNm)||preferredRegionNm<=0)preferredRegionNm=20;
function validControlNumber(id,value){
 const [min,max,integer]=BASIC_NUMBERS[id];
 return typeof value==='number'&&Number.isFinite(value)&&value>=min&&(max===null||value<=max)&&(!integer||Number.isInteger(value))&&(id!=='grid-min'||value>0);
}
function restoreBasicControls(){
 const saved=readPreference('tem-basic-settings',{});if(!saved||typeof saved!=='object')return;
 for(const id of Object.keys(BASIC_NUMBERS))if(validControlNumber(id,saved[id]))$(id).value=saved[id];
 for(const id of BASIC_FLAGS)if(typeof saved[id]==='boolean')$(id).checked=saved[id];
 if(['manual','auto'].includes(saved['fft-strength-mode']))$('fft-strength-mode').value=saved['fft-strength-mode'];
 if(['titanium','iron','custom'].includes(saved.material))$('material').value=saved.material;
 setPhaseSelection(Array.isArray(saved.enabled_phases)&&saved.enabled_phases.every(phase=>PHASES.includes(phase))?saved.enabled_phases:materialPhases());
 if(Number($('fft-g-min').value)>=Number($('g-max').value))$('fft-g-min').value=3;
 if(OVERLAY_MODES.includes(saved.overlay))syncOverlayMenus(saved.overlay);
 if($('overlay').value==='custom')$('fit-controls').open=true;
}
function rememberBasicControls(){
 const previous=readPreference('tem-basic-settings',{}),saved={};
 for(const id of Object.keys(BASIC_NUMBERS)){
  const value=$(id).value===''?NaN:Number($(id).value);
  if(validControlNumber(id,value))saved[id]=value;
  else if(previous&&validControlNumber(id,previous[id]))saved[id]=previous[id];
 }
 for(const id of BASIC_FLAGS)saved[id]=$(id).checked;
 saved['fft-strength-mode']=$('fft-strength-mode').value;
 if(OVERLAY_MODES.includes($('overlay').value))saved.overlay=$('overlay').value;
 saved.material=$('material').value;saved.enabled_phases=[...enabledPhases];
 if(Number(saved['fft-g-min'])>=Number(saved['g-max'])){saved['fft-g-min']=previous?.['fft-g-min']??3;saved['g-max']=previous?.['g-max']??10}
 writePreference('tem-basic-settings',saved);
}
function rememberRegionSize(){
 if(!meta||isDiffraction())return;
 const width=roi.w*meta.pixel_x_nm;
 if(width!==preferredRegionNm){preferredRegionNm=width;writePreference('tem-region-width-nm',width)}
}
function lastImageKey(){return 'tem-last-image:'+config.data_root}
function favoriteKey(){return 'tem-favorites:'+config.data_root}
let fileSort=readPreference('tem-file-sort','name');
if(!['name','acquisition'].includes(fileSort))fileSort='name';
function acquisitionNumber(file){
 const name=file.name.replace(/\.(?:dm[34]|tiff?|jpe?g|png)$/i,'');
 // Prefer the acquisition after ST/STA, ignoring magnification and suffix references.
 const tagged=name.match(/(?:^|[_\s-])(?:STA|ST)[_\s-]*(\d+)(?=$|[_\s·-])/i);
 const numbers=[...name.matchAll(/(?:^|[_\s-])(\d+)(?=$|[_\s-])/g)];
 const value=tagged?.[1]??numbers.at(-1)?.[1],number=value===undefined?null:Number(value);
 return Number.isSafeInteger(number)?number:null;
}
function sortedFiles(files){
 return [...files].sort((a,b)=>{
  if(fileSort==='acquisition'){
   const an=acquisitionNumber(a),bn=acquisitionNumber(b);
   if(an!==bn){if(an===null)return 1;if(bn===null)return -1;return an-bn}
  }
  return a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'})||a.id.localeCompare(b.id);
 });
}
function matchingFiles(){
 const terms=$('file-search').value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
 return config.files.filter(f=>terms.every(term=>`${f.name} ${f.sample} ${f.id}`.toLocaleLowerCase().includes(term)));
}
function renderFileList(){
 const select=$('file'),selected=select.value||fileId,files=matchingFiles(),searching=Boolean($('file-search').value.trim());
 select.replaceChildren();
 if(searching)select.append(new Option(files.length?'Choose a matching image…':'No matching images',''));
 for(const sample of new Set(files.map(f=>f.sample))){
  const group=document.createElement('optgroup');group.label=sample;
  for(const f of sortedFiles(files.filter(f=>f.sample===sample)))group.append(new Option((favorites.has(f.id)?'★ ':'')+f.name,f.id));
  select.append(group);
 }
 if(files.some(f=>f.id===selected))select.value=selected;
 $('file-search-count').textContent=searching?`${files.length} match${files.length===1?'':'es'}`:'';
 select.disabled=!files.length;
}
function clearFileSearch(){if($('file-search').value){$('file-search').value='';if(config)renderFileList()}}
$('file-search').oninput=()=>{if(config)renderFileList()};
$('file-search').onkeydown=event=>{
 if(event.key==='Escape'){clearFileSearch();return}
 if(event.key==='Enter'&&config){const files=matchingFiles();if(files.length===1){event.preventDefault();$('file').value=files[0].id;openFile()}else $('file').focus()}
};
$('file-sort').value=fileSort;
$('file-sort').onchange=()=>{
 fileSort=$('file-sort').value;writePreference('tem-file-sort',fileSort);
 if(config){renderFileList();renderFavorites()}
};
function renderFavorites(){
 const select=$('favorites'), rows=sortedFiles(config.files.filter(f=>favorites.has(f.id)));
 select.replaceChildren(new Option(rows.length?'Choose a favourite…':'No favourites yet',''));
 for(const f of rows)select.append(new Option(`★ ${f.sample} · ${f.name}`,f.id));
 select.disabled=!rows.length;select.value=opened&&favorites.has(fileId)?fileId:'';
 $('favorite-count').textContent=`(${rows.length})`;
 const active=opened&&favorites.has(fileId),button=$('favorite-toggle');
 button.disabled=!opened;button.textContent=active?'★ Favourited':'☆ Favourite open image';
 button.setAttribute('aria-pressed',String(active));
 button.title=opened?`${active?'Remove from':'Add to'} favourites: ${meta.name}`:'Open an image to favourite it';
}
$('favorite-toggle').onclick=()=>{
 if(!opened)return;
 favorites.has(fileId)?favorites.delete(fileId):favorites.add(fileId);
 writePreference(favoriteKey(),[...favorites]);renderFavorites();renderFileList();
 if($('image-browser').open)renderImageBrowser();
};
$('favorites').onchange=()=>{const id=$('favorites').value;if(id){clearFileSearch();$('file').value=id;openFile()}};
function settings(){const mode=$('scenario').value;return {material:$('material').value,enabled_phases:[...enabledPhases],hcp_a:Number($('hcp-a').value),hcp_c:Number($('hcp-c').value),g_min:isDiffraction()?diffractionSettings.exclude_radius_nm_inv:Number($('fft-g-min').value),scale:Number($('model-scale').value),bcc_a:Number($('bcc-a').value),fcc_a:Number($('fcc-a').value),g_max:Number($('g-max').value),threshold:Number($('threshold').value),fft_auto_strength:Boolean(config?.fft_auto_strength&&$('fft-strength-mode').value==='auto'),...Object.fromEntries(Object.entries(FFT_DETECTOR_CONTROLS).map(([id,[key,defaultValue]])=>[key,config?.fft_detection_controls?Number($(id).value):defaultValue])),scale_penalty_strength:config?.scale_penalty?scalePenalty:0,peak_evidence_weight:config?.peak_evidence?peakEvidenceWeight:0,scale_mode:mode.startsWith('auto_')?mode:'fixed',fft_window:config?.fft_processing&&!$('fft-hann').checked?'none':'hann',remove_mean:config?.fft_processing?$('fft-mean').checked:true,...(isDiffraction()?{diffraction:JSON.parse(JSON.stringify(diffractionSettings))}:{})}}
function calibrationView(){
 const v=$('scenario').value,field=$('model-scale'),automatic=v.startsWith('auto_');
 updatePenaltyControls();
 field.closest('.scale-input').style.display=automatic?'none':'';
 if(automatic){field.value='1.000';field.readOnly=true;
  $('calibration-note').textContent=(v==='auto_uniform'?'Each region fits one prediction scale separately for HCP, BCC and FCC; HCP c/a stays fixed.':'Each region fits one BCC/FCC prediction scale and independent HCP a/c scales where visible.')+' Range ×0.85–1.15 relative to nominal dimensions. Measured reciprocal axes stay unchanged. Candidate model dimensions are shown below.';return}

 if(v!=='custom')field.value='1.000';
 field.readOnly=v!=='custom';
 const scale=Number(field.value).toFixed(3);
 const explanation=v==='1'?'Nominal model sizes; stored DM4 calibration.':'Manual comparison; a better fit is not a measurement of calibration or strain.';
 $('calibration-note').textContent=`Model size ×${scale} for all structures, relative to the selected material references. ${explanation} Measured reciprocal axes stay unchanged.`;
}
function restoreCalibration(){
 const saved=readPreference('tem-scale-last',readPreference('tem-scale:'+meta.sha256_pixels,{}));
 const valid=saved&&['1','custom','auto_uniform','auto_hcp_ac'].includes(saved.mode)&&(!saved.mode.startsWith('auto_')||config.scale_modes?.includes(saved.mode))&&Number.isFinite(saved.scale)&&saved.scale>=.85&&saved.scale<=1.15;
 const defaultMode=config.scale_modes?.includes('auto_hcp_ac')?'auto_hcp_ac':'1';
 $('scenario').value=valid?saved.mode:defaultMode;$('model-scale').value=valid?saved.scale:1;
 calibrationView();rememberCalibration();
}
function rememberCalibration(){writePreference('tem-scale-last',{mode:$('scenario').value,scale:Number($('model-scale').value)})}
function requestBody(){return {file_id:fileId,roi:{...roi},settings:settings()}}
function el(tag,attrs,text){const e=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;return e}
// Convert labels only; numerical fits and saved three-index records stay unchanged.
function indexGcd(a,b){while(b){[a,b]=[b,a%b]}return Math.abs(a)}
function zoneIndices(model){
 const [u,v,w]=model.zone_3index;
 if(model.phase!=='HCP')return [u,v,w];
 const indices=[2*u-v,2*v-u,-u-v,3*w];
 const divisor=indices.reduce((g,n)=>indexGcd(g,Math.abs(n)),0)||1;
 return indices.map(n=>n/divisor);
}
function planeIndices(model,hkl,sign=1){
 const [h,k,l]=hkl.map(n=>n*sign);
 // Preserve reflection order: plane indices must not be reduced by their GCD.
 return model.phase==='HCP'?[h,k,-h-k,l]:[h,k,l];
}
function indexLabel(indices,brackets='[]'){
 // Combining overlines also work in plain-text SVG tooltips.
 return brackets[0]+indices.map(n=>n<0?Array.from(String(-n),digit=>digit+'\u0305').join(''):String(n)).join(' ')+brackets[1];
}
function zoneLabel(model){return indexLabel(zoneIndices(model))}
function planeLabel(model,hkl,sign=1){return indexLabel(planeIndices(model,hkl,sign),'()')}
function clamp(v,min,max){return Math.min(max,Math.max(min,v))}
function updateBox(preserveHeight=false){if(!meta)return;if(isDiffraction()){roi={x:0,y:0,w:meta.width,h:meta.height};$('region-size').textContent=`${meta.width} × ${meta.height} px · full detector`;drawDetector();return;}const min=32,max=Math.min(meta.width,meta.height);roi.w=clamp(Math.round(roi.w),min,max);roi.h=preserveHeight?roi.h:roi.w;roi.x=clamp(Math.round(roi.x),0,meta.width-roi.w);roi.y=clamp(Math.round(roi.y),0,meta.height-roi.h);for(const[k,v]of Object.entries({x:roi.x,y:roi.y,width:roi.w,height:roi.h}))$('roi-box').setAttribute(k,v);const handle=meta.width*.018;$('roi-handle').setAttribute('width',handle);$('roi-handle').setAttribute('height',handle);$('roi-handle').setAttribute('x',roi.x+roi.w-handle/2);$('roi-handle').setAttribute('y',roi.y+roi.h-handle/2);$('roi-x').value=roi.x;$('roi-y').value=roi.y;$('roi-nm').value=(roi.w*meta.pixel_x_nm).toFixed(2);$('region-size').textContent=`${(roi.w*meta.pixel_x_nm).toFixed(2)} nm · ${roi.w} px`;rememberRegionSize()}
// Invalidate the old result immediately; never attach it to a newly moved region.
function schedule(delay=120){generation++;pending=true;result=null;updateStrengthMode();hideRegionPreview();beginSpectrumLoading();syncSpectrumExportControls();if(isDiffraction()){drawDetector();renderTranslation()}$('save-region').disabled=true;$('phase-label').textContent='Updating…';document.querySelector('.previews').classList.add('stale');if(!timer)timer=setTimeout(()=>{timer=null;analyze()},delay)}
async function analyze(){if(busy||!meta||!pending)return;pending=false;busy=true;const version=generation,body=requestBody();try{const data=await api('analyze',body);if(version===generation||(drag&&body.file_id===fileId&&JSON.stringify(body.settings)===JSON.stringify(settings()))){result=data;await renderResult(data,version,body)}}catch(e){if(version===generation){result=null;message(e.message,true);$('phase-label').textContent='Analysis unavailable'}}finally{busy=false;if(version===generation&&!pending)finishSpectrumLoading();syncSpectrumExportControls();if(pending&&!timer)timer=setTimeout(()=>{timer=null;analyze()},20)}}
async function openFile(){
 const id=$('file').value;if(!id)return;
 rescoreRevision++;rescorePending=false;clearTimeout(rescoreTimer);
 const version=++sourceRequest;generation++;pending=false;meta=null;result=null;fftRaw=null;detectorRaw=null;opened=false;drag=null;maskDrag=null;
 finishSpectrumLoading();beginSpectrumLoading();hideRegionPreview();hoverCache.clear();syncSpectrumExportControls();resetRegionEditor();renderSavedRegions();renderFavorites();$('save-region').disabled=true;
 message('Opening source image…');
 try{
  if(isGridRunning())await api('cancel',{job_id:jobId});
  const info=await api('open',{file_id:id});if(version!==sourceRequest)return;
  meta=info;fileId=id;opened=true;writePreference(lastImageKey(),id);grid=null;jobId=null;
  setupImageKind();drawGrid();$('save-grid').disabled=true;$('cancel-grid').disabled=true;$('run-grid').disabled=isDiffraction();
  $('grid-status').textContent='Adaptive subdivides unresolved or ambiguous regions, two candidate structures, and substantial second patterns.';
  restoreCalibration();renderFavorites();updateGridSizeNote();
  $('overview').setAttribute('viewBox',`0 0 ${info.width} ${info.height}`);
  $('source-image').setAttribute('width',info.width);$('source-image').setAttribute('height',info.height);
  $('source-image').setAttribute('href','/api/preview?id='+encodeURIComponent(id));
  const calibration=isDiffraction()?`${info.pixel_x_nm_inv.toPrecision(6)} × ${info.pixel_y_nm_inv.toPrecision(6)} nm⁻¹/px`:`${info.pixel_x_nm.toFixed(5)} nm/px`;
  $('metadata').textContent=`${info.width} × ${info.height} · ${calibration} · ${info.device}${info.is_demo?' · bundled demo':''}`;
  if(isDiffraction())roi={x:0,y:0,w:info.width,h:info.height};
  else{const size=Math.min(info.width,info.height,Math.max(32,Math.round(preferredRegionNm/info.pixel_x_nm)));roi={x:Math.round((info.width-size)/2),y:Math.round((info.height-size)/2),w:size,h:size}}
  updateBox();renderSavedRegions();schedule(0);
  message(isDiffraction()?'Direct diffraction: check the beam centre, mask the beam stop if needed, and inspect the spot fits.':'Drag the box to inspect a region, or run an automatic grid.');
 }catch(e){if(version===sourceRequest){finishSpectrumLoading();syncSpectrumExportControls();message(e.message,true)}}
}

function point(event){const pt=new DOMPoint(event.clientX,event.clientY);return pt.matrixTransform($('overview').getScreenCTM().inverse())}
$('overview').addEventListener('pointerdown',e=>{if(!meta||e.button!==0)return;hideRegionPreview();const saved=e.target.closest('.saved-region-overlay');if(saved){e.preventDefault();openSavedRegion(saved.dataset.regionId);return}if(isDiffraction()){detectorPointerDown(e);return}$('overview').focus({preventScroll:true});e.preventDefault();const cell=e.target.closest('.grid-cell');if(cell){const r=grid.regions.find(r=>r.id===cell.dataset.id);roi={...r.roi};updateBox(true);schedule(0);return}const p=point(e);const inside=p.x>=roi.x&&p.x<=roi.x+roi.w&&p.y>=roi.y&&p.y<=roi.y+roi.h;const resizing=e.target.id==='roi-handle';if(!inside&&!resizing){roi.x=p.x-roi.w/2;roi.y=p.y-roi.h/2;updateBox();schedule()}drag={mode:resizing?'resize':'move',x:p.x,y:p.y,roi:{...roi}};$('overview').setPointerCapture(e.pointerId);e.preventDefault()});
$('overview').addEventListener('pointermove',e=>{if(isDiffraction()){detectorPointerMove(e);return}if(!drag){hoverComputedRegion(e);return}const p=point(e);if(drag.mode==='resize'){roi.w=clamp(drag.roi.w+Math.max(p.x-drag.x,p.y-drag.y),32,Math.min(meta.width-drag.roi.x,meta.height-drag.roi.y))}else{roi.x=drag.roi.x+p.x-drag.x;roi.y=drag.roi.y+p.y-drag.y}updateBox();schedule(90)});
for(const name of ['pointerup','pointercancel'])$('overview').addEventListener(name,e=>{if(isDiffraction()){detectorPointerEnd(e);return}if(drag){drag=null;schedule(0)}});
$('overview').addEventListener('keydown',e=>{const saved=e.target.closest('.saved-region-overlay');if(saved&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openSavedRegion(saved.dataset.regionId);return}if(!meta||isDiffraction()||e.altKey||e.ctrlKey||e.metaKey)return;const offsets={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};if(!offsets[e.key])return;const n=e.shiftKey?50:10;roi.x+=offsets[e.key][0]*n;roi.y+=offsets[e.key][1]*n;updateBox(true);schedule();e.preventDefault()});
for(const [id,key]of [['roi-x','x'],['roi-y','y'],['roi-nm','w']])$(id).addEventListener('change',()=>{if(!meta)return;const n=Number($(id).value);if(!Number.isFinite(n))return;roi[key]=key==='w'?n/meta.pixel_x_nm:n;updateBox();schedule(0)});
$('centre').onclick=()=>{if(!meta)return;roi.x=(meta.width-roi.w)/2;roi.y=(meta.height-roi.h)/2;updateBox();schedule(0)};
function patternExplanation(data){
 const label=data.classification.label;
 if(label==='coexisting_candidates')return 'Separate peak sets support passing fits of different structures. Both may contribute; their proportions are unknown.';
 if(label==='multiple_orientations')return 'Separate peak sets support multiple orientations of the same candidate structure.';
 if(data.classification.ambiguity_reason==='shared_peaks_model_tradeoff')return 'Both structures explain the same detected peaks. The leading fit also uses extra flexibility or more unsupported predictions; the phase remains ambiguous.';
 if(label==='ambiguous')return 'Different structures compete to explain the same or overlapping peaks; the phase assignment remains ambiguous.';
 if(data.periodicity.status==='multiple_periodic_patterns')return 'Additional periodicity is supported, but a second phase assignment remains unresolved.';
 if(data.periodicity.status==='predominantly_one_periodic_pattern')return ['hcp_compatible','bcc_compatible','fcc_compatible'].includes(label)?'One periodic pattern predominates in the geometry check.':'A periodic pattern is supported, but its phase remains unresolved.';
 return 'The geometry check could not resolve the number of periodic patterns.';
}
function scaleSummary(settings){
 const label=settings.scale_mode==='auto_uniform'?'automatic single scale per candidate and region':settings.scale_mode==='auto_hcp_ac'?'automatic BCC/FCC single / HCP a+c per region':`fixed prediction scale ×${settings.scale.toFixed(3)}`;
 return label+(settings.scale_mode?.startsWith('auto_')?` · scale penalty ${(settings.scale_penalty_strength??0).toFixed(3)} per 5%`:'')+` · peak evidence ${(settings.peak_evidence_weight??0).toFixed(2)} · ${config?.material_presets?.[settings.material]?.label??'Custom'} references · fitting band ${settings.g_min??settings.diffraction?.exclude_radius_nm_inv??3}–${settings.g_max??10} nm⁻¹`;
}
function fittedDimensions(model){
 const a=model.fitted_a_nm??model.nominal_a_nm/model.shared_scale;
 const c=model.fitted_c_nm??(model.scale_mode==='auto_hcp_ac'?null:model.nominal_c_nm/model.shared_scale);
 return a.toFixed(4)+(model.phase==='HCP'?' / '+(c===null?'unconstrained':c.toFixed(4)):'');
}
function scaleDetails(model){
 const a=model.scale_a??model.shared_scale,c=model.scale_c;
 if(model.scale_mode==='auto_hcp_ac'&&model.phase==='HCP')return `prediction scale a* ×${a.toFixed(4)}, c* ${c==null?'unconstrained':'×'+c.toFixed(4)}`;
 return `prediction scale ×${a.toFixed(4)}`;
}
function scalePercentages(model){
 const percent=value=>{if(value==null||!Number.isFinite(value))return 'unconstrained';const change=(value-1)*100;return (Math.abs(change)<.05?'0.0':(change>0?'+':'−')+Math.abs(change).toFixed(1))+'%'};
 const a=model.scale_a??model.shared_scale;
 if(model.phase!=='HCP')return percent(a);
 const c=model.scale_c??(model.scale_mode==='auto_hcp_ac'?null:a);
 return `a* ${percent(a)} / c* ${percent(c)}`;
}
function predictionCounts(model){
 const total=model.predicted_nodes?.length??model.predicted_visible_band_node_count;
 const strong=model.matched_prediction_count??model.matched_profile_count;
 return `${strong}${model.peak_evidence?'+'+model.peak_evidence.weak_count+'w':''} / ${total??'—'}`;
}
function evidenceDescription(model){
 const e=model.peak_evidence;if(!e)return 'Original detected profiles / prediction positions.';
 return `${e.detected_count} strong + ${e.weak_count} weak; ${e.unsupported_count} unsupported; ${e.unassessable_count} unchecked. Search radius ${e.search_radius_nm_inv.toFixed(3)} nm⁻¹. Weak maxima do not count toward the initial screen.`;
}
function rankDescription(m){return `Position ${(m.position_score??m.score).toFixed(3)} − scale ${(m.scale_penalty??0).toFixed(3)} + weak ${(m.weak_peak_bonus??0).toFixed(3)} − missing ${(m.missing_peak_penalty??0).toFixed(3)} = rank ${m.score.toFixed(3)}`}
function compareRank(a,b){
 if(!a)return b?1:0;
 if(!b)return -1;
 return b.score-a.score||b.coverage-a.coverage;
}
const COVERAGE_HELP='Weighted share of original detected peak profiles matched by this fit. FFT weights use radial-background enrichment; direct spots use log(1 + local contrast). Both are capped at 1–6. Extra weak maxima are excluded. Not an intensity fraction or phase probability.';
function renderEvidence(data){
 const container=$('evidence-table');container.replaceChildren();$('evidence-details').hidden=!data.models.some(m=>m.peak_evidence);
 const table=document.createElement('table'),header=document.createElement('tr'),head=document.createElement('thead'),body=document.createElement('tbody');
 for(const label of ['Candidate / zone','Strong','Weak','No peak','Unchecked','+ Bonus','− Missing']){const th=document.createElement('th');th.textContent=label;header.append(th)}
 head.append(header);table.append(head,body);container.append(table);
 for(const m of [...data.models].sort(compareRank)){
  const e=m.peak_evidence;if(!e)continue;const row=document.createElement('tr');row.title=rankDescription(m)+' · '+evidenceDescription(m);
  for(const value of [`${m.phase} ${zoneLabel(m)}`,e.detected_count,e.weak_count,e.unsupported_count,e.unassessable_count,m.weak_peak_bonus.toFixed(3),m.missing_peak_penalty.toFixed(3)]){const td=document.createElement('td');td.textContent=value;row.append(td)}
  body.append(row);
 }
}
function screenReasons(m){
 if(m.valid)return [];
 const reasons=[];
 if(m.matched_profile_count<4)reasons.push(`${m.matched_profile_count}/4 strong profiles`);
 if(m.nonparallel_spread_sine<=.5)reasons.push('limited directions');
 if(m.coverage<=.30)reasons.push('peak coverage ≤ 30%');
 if((m.position_score??m.score)<=.20)reasons.push('position ≤ 0.20');
 if(m.score<=.20)reasons.push('rank ≤ 0.20');
 return reasons;
}
function screenLabel(m){return m.valid?'Pass':'Below\n'+(screenReasons(m)[0]||'fit screen').replace(' strong profiles',' strong').replace('peak coverage','coverage')}
function bestModel(data,phase){return data.models.find(m=>m.phase===phase&&m.valid)??data.models.find(m=>m.phase===phase)}
function overlayModels(data,choice){
 if(choice==='winner'||choice==='winner_any'){
  return data.models.filter(model=>enabledPhases.includes(model.phase)&&(choice==='winner_any'||model.valid)).sort(compareRank).slice(0,1);
 }
 const phases=choice==='all'?PHASES:choice==='both'?['HCP','BCC']:PHASES.includes(choice)?[choice]:[];
 return phases.filter(phase=>enabledPhases.includes(phase)).map(phase=>bestModel(data,phase)).filter(Boolean);
}
function geometryFits(data){
 const p=data.periodicity||{};
 return [['primary_lattice','#df92ef','Primary geometry'],['secondary_lattice','#64d6bb','Secondary geometry']].flatMap(([key,color,name])=>{
  const model=p[key];
  // Older engines and saved results may retain a rejected copy of the primary.
  if(!model||(key==='secondary_lattice'&&(!p.primary_lattice?.valid||!model.valid)))return [];
  return [{key,model,color,name,geometry:true}];
 });
}
function geometryDescription(data){
 const p=data.periodicity||{};
 if(p.status==='multiple_periodic_patterns')return 'Geometry check: a substantial second periodic pattern is supported.';
 if(p.status==='predominantly_one_periodic_pattern')return 'Geometry check: one periodic pattern predominates.'+
  (geometryFits(data).some(f=>f.key==='secondary_lattice')?'':' No distinct secondary geometry detected.');
 return 'Geometry check: pattern count remains unresolved.';
}
// Shared column definitions keep both candidate tables aligned.
const FIT_COLUMNS=[["candidate","Candidate\nZone axis","Zone axis: HCP [u v t w], BCC/FCC [u v w]. A bar means a negative index; individual overlays also show rotation."],["rank","Rank ↓","Position − scale cost + weak-peak bonus − missing-prediction cost; heuristic rank, not probability; highest first"],["screen","Screen","Candidate acceptance screen; hover for all rejection reasons"],["peaks","Peaks\nS+W / all","Original strong profiles + separately checked weak maxima / prediction positions. Weak maxima do not count toward the four-profile screen."],["coverage","Peak\ncoverage",COVERAGE_HELP],["rms","RMS\nnm⁻¹","Root-mean-square positional residual"],["position","Position","Position-weighted agreement minus chance-match allowance; before scale and peak-evidence adjustments"],["cost","Scale\ncost","Cost of automatic scale changes, subtracted from the position score"],["dimensions","a / c\nnm","Candidate model lattice dimensions, assuming the image calibration used"],["scale","Scale Δ\n%","100 × (reciprocal prediction multiplier − 1); HCP shows a* and c* separately. Model lattice dimensions change inversely."]];
function renderFitHeader(head, showToggle=false){
 const row=document.createElement('tr');
 const columns=showToggle?[['show','Show','Toggle this overlay'],...FIT_COLUMNS]:FIT_COLUMNS;
 for(const [key,label,help]of columns){
  const cell=document.createElement('th');cell.scope='col';cell.className='col-'+key;cell.dataset.column=key;
  cell.textContent=label;cell.title=help;
  if(key==='rank')cell.setAttribute('aria-sort','descending');
  row.append(cell);
 }
 head.replaceChildren(row);
}
function appendFitCells(row,m,{name,geometry=false,rotation=false}){
 const values={
  candidate:name+(m&&rotation?`\n${m.rotation_deg.toFixed(1)}°`:''),
  rank:m?m.score.toFixed(3):'—',
  screen:m?(geometry?(m.valid?'Pass':'Below'):screenLabel(m)):'No fit',
  peaks:m?(geometry?m.matched_profile_count+' peaks':predictionCounts(m)):'—',
  coverage:m?`${(100*m.coverage).toFixed(0)}%`:'—',
  rms:m?m.rms_nm_inv.toFixed(3):'—',
  position:m&&!geometry?(m.position_score??m.score).toFixed(3):'—',
  cost:m&&!geometry?(m.scale_penalty??0).toFixed(3):'—',
  dimensions:m&&!geometry?fittedDimensions(m).replace(' / ','\n'):'—',
  scale:m&&!geometry?scalePercentages(m).replace(' / ','\n'):'—'
 };
 for(const [key,,help]of FIT_COLUMNS){
  const cell=document.createElement('td');cell.className='col-'+key;cell.dataset.column=key;
  cell.textContent=values[key];cell.title=help;
  if(m){
   if(key==='candidate')cell.className+=' '+(geometry?'geometry-fit':m.phase.toLowerCase());
   if(key==='rank')cell.title=geometry?'Geometry-only score':rankDescription(m);
   if(key==='peaks')cell.title=geometry?'Profiles matched by a freely fitted reciprocal grid':evidenceDescription(m);
   if(key==='screen')cell.title=m.valid?'Passes the screen':geometry?'Below threshold':screenReasons(m).join('; ');
   if(!geometry&&(key==='dimensions'||key==='scale'))cell.title=scaleDetails(m)+(key==='scale'?' · '+help:'');
  }
  row.append(cell);
 }
}
renderFitHeader($('model-head'));
function renderModels(data){
 $('models').replaceChildren();
 const ranked=analysisPhases(data.settings).map(phase=>({phase,m:bestModel(data,phase)})).sort((a,b)=>compareRank(a.m,b.m));
 for(const {phase,m}of ranked){
  const row=document.createElement('tr');
  appendFitCells(row,m,{name:m?`${phase} ${zoneLabel(m)}`:phase});
  $('models').append(row);
 }
 $('fit-summary').textContent=scaleSummary(data.settings)+'. Rank = position − scale cost + weak-peak bonus − missing-prediction cost. S+W separates strong profiles from weak maxima; peak coverage is the weighted share of original detected profiles matched by the candidate. Prediction-site evidence below shows the separate adjustments. Model dimensions assume the image calibration used; these scores are not phase probabilities.';
}
async function renderResult(data,version,body){renderAutoStrength(data);if(data.images.crop)$('crop').src=data.images.crop;$('phase-label').textContent=labels[data.classification.label]||data.classification.label;$('phase-label').style.color=colors[data.classification.label]||'#ddd';$('timing').textContent=`${data.elapsed_ms.toFixed(0)} ms · `+(data.image_kind==='diffraction'?'direct detector spots':`ROI ${data.roi.x}, ${data.roi.y}`);$('pattern-label').textContent=patternExplanation(data);$('geometry-check').textContent=geometryDescription(data);renderModels(data);renderEvidence(data);$('result-detail').textContent=data.image_kind==='diffraction'?`${data.spectrum.observed_spot_count} observed spots · ${data.spectrum.peaks.length} independent profiles · detector sampling ${data.spectrum.df.toFixed(4)} nm⁻¹/px. Only observed spots are marked; opposite spots count once.`:`${data.spectrum.peaks.length} independent peak profiles · FFT bins ${data.spectrum.df.toFixed(3)} nm⁻¹. Opposite spots represent the same profile.`;$('flags').replaceChildren();for(const f of data.classification.flags){const li=document.createElement('li');li.textContent=f;$('flags').append(li)}$('peaks').replaceChildren();for(const p of data.spectrum.peaks){const tr=document.createElement('tr');for(const v of [p.profile_id,p.g_nm_inv.toFixed(3),(1/p.g_nm_inv).toFixed(4),p.qx.toFixed(3),p.qy.toFixed(3)]){const td=document.createElement('td');td.textContent=v;tr.append(td)}$('peaks').append(tr)}$('peak-count').textContent=`(${data.spectrum.peaks.length})`;renderFitChoices(data);const [raw,detector]=await Promise.all([decodeSpectrumImage(data.images),data.images.detector_signal16?decodeSpectrumImage({fft_log16:data.images.detector_signal16,fft_log_limits:data.images.detector_signal_limits}).then(raw=>({...raw,detector:true})):null]);if(version!==generation&&(!drag||body.file_id!==fileId||JSON.stringify(body.settings)!==JSON.stringify(settings())))return;result=data;fftRaw=raw;detectorRaw=detector;syncSignalToggle();if(!isDiffraction())cacheRegionPreview(previewKey(data.roi,data.settings),analysisPreview(data));drawFFT();if(isDiffraction()){drawDetector();renderTranslation()}document.querySelector('.previews').classList.remove('stale');$('save-region').disabled=version!==generation}
const MARKER_SHAPES=['circle','diamond','square','triangle','crosshair','open-crosshair','off'];
// Fraction of one animation cycle; the same value drives live CSS and GIF frames.
function markerMotionOffset(kind,phase){
 return kind==='prediction'?(phase==='HCP'?.25:phase==='BCC'?.75:.5):0;
}
function markerShape(x,y,mode,attrs={},r=7){
 const offset=markerMotionOffset(attrs['data-marker-kind'],attrs['data-marker-phase']);
 const style={class:'spectrum-marker',stroke:'#ffffff','stroke-width':1,fill:'none',
  'data-motion-offset':offset,...attrs};
 if(mode==='off')return null;
 if(mode==='diamond')return el('path',{...style,d:`M${x} ${y-r}L${x+r} ${y}L${x} ${y+r}L${x-r} ${y}Z`});
 if(mode==='square')return el('rect',{...style,x:x-r,y:y-r,width:2*r,height:2*r});
 if(mode==='triangle'){const dx=r*Math.sqrt(3)/2;return el('path',{...style,d:`M${x} ${y-r}L${x+dx} ${y+r/2}L${x-dx} ${y+r/2}Z`})}
 if(mode==='open-crosshair')return el('path',{...style,'stroke-linecap':'butt',d:`M${x-r},${y}h${r/2}M${x+r/2},${y}h${r/2}M${x},${y-r}v${r/2}M${x},${y+r/2}v${r/2}`});
 if(mode==='crosshair')return el('path',{...style,d:`M${x-r},${y}h${2*r}M${x},${y-r}v${2*r}`});
 return el('circle',{...style,cx:x,cy:y,r});
}
function peakMarker(x,y,mode,attrs={}){
 return markerShape(x,y,mode,{'data-marker-kind':'measured',...attrs},mode==='open-crosshair'?8:mode==='circle'?3:4);
}
function weakMarker(x,y,id){
 const choice=$('weak-marker').value,mode=choice==='follow'?$('peak-marker').value:choice;
 const attrs={stroke:'#ffffff','stroke-width':1,opacity:.9,'data-marker-kind':'weak','data-weak-profile':id};
 if(choice==='follow')attrs['stroke-dasharray']='2 2';
 if(choice==='dot')return markerShape(x,y,'circle',{...attrs,fill:'#fff',stroke:'none'},1.5);
 return peakMarker(x,y,mode,attrs);
}
function rememberMarkerStyles(){
 const value={motion:$('marker-motion').value};
 for(const id of ['hcp-marker','bcc-marker','fcc-marker','primary-geometry-marker','secondary-geometry-marker','weak-marker'])value[id]=$(id).value;
 writePreference('tem-marker-styles',value);
}
function applyMarkerAnimation(){const mode=$('marker-motion').value;document.body.classList.toggle('marker-pulse',mode==='pulse');document.body.classList.toggle('marker-bounce',mode==='bounce');document.body.classList.toggle('marker-wobble',mode==='wobble')}
function applyPhaseColors(redraw=true){
 for(const [phase,id,key,fallback]of [['HCP','hcp-color','hcp_compatible','blue'],['BCC','bcc-color','bcc_compatible','gold'],['FCC','fcc-color','fcc_compatible','pink']]){
  const choice=phaseColorChoices[phase]||fallback;
  const color=PHASE_COLOR_OPTIONS[choice][1];$(id).style.color=$(id).value==='disabled'?'var(--muted)':color;
  phaseColors[phase]=color;colors[key]=color;document.documentElement.style.setProperty('--'+id,color);
 }
 if(redraw){
  if(result)$('phase-label').style.color=colors[result.classification.label]||'#ddd';
  drawGrid();drawFFT();
 }
}
function syncIntensityKey(){
 const palette=SPECTRUM_PALETTES[$('palette').value]||MAGMA;
 const stops=Array.from({length:17},(_,i)=>`rgb(${palette[Math.round(i*255/16)].join(',')})`);
 document.documentElement.style.setProperty('--intensity-gradient',`linear-gradient(90deg,${stops.join(',')})`);
}
async function decodeSpectrumImage(images){
 const img=new Image(),precise=Boolean(images.fft_log16);
 img.src=images.fft_log16||images.fft;await img.decode();
 const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
 const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
 const pixels=ctx.getImageData(0,0,img.width,img.height),maximum=precise?65535:255,histogram=new Uint32Array(maximum+1);
 for(let i=0;i<pixels.data.length;i+=4)histogram[precise?(pixels.data[i]<<8)|pixels.data[i+1]:pixels.data[i]]++;
 return {canvas,pixels,precise,histogram,maximum,limits:images.fft_log_limits||[0,1]};
}
function colourSpectrum(raw,imageKind){
 const {canvas,pixels,precise,histogram,maximum,limits}=raw,ctx=canvas.getContext('2d');
 const percentile=f=>{let sum=0;for(let i=0;i<=maximum;i++){sum+=histogram[i];if(sum>=canvas.width*canvas.height*f)return i}return maximum};
 const lo=percentile(Number($('contrast').value)/100),high=clamp(Number($('fft-white').value)||99.8,91,100),hi=percentile(high/100);
 const linear=$('fft-curve').value==='linear'&&precise&&!raw.detector;
 const transform=code=>{if(!linear)return code;const intensity=Math.expm1(limits[0]+code/maximum*(limits[1]-limits[0]));return imageKind==='diffraction'?intensity:Math.sqrt(intensity)};
 const lowValue=transform(lo),span=Math.max(transform(hi)-lowValue,1e-12),lookup=new Uint8ClampedArray((maximum+1)*3),palette=SPECTRUM_PALETTES[$('palette').value]||MAGMA;
 for(let code=0;code<=maximum;code++){
  const v=Math.round(clamp((transform(code)-lowValue)/span,0,1)*255),rgb=palette[v];
  lookup.set(rgb,code*3);
 }
 const out=ctx.createImageData(canvas.width,canvas.height);
 for(let i=0;i<out.data.length;i+=4){const code=precise?(pixels.data[i]<<8)|pixels.data[i+1]:pixels.data[i];out.data[i]=lookup[code*3];out.data[i+1]=lookup[code*3+1];out.data[i+2]=lookup[code*3+2];out.data[i+3]=255}
 ctx.putImageData(out,0,0);return canvas.toDataURL();
}
function spectrumTicks(extent){
 const limit=Math.min(Math.abs(extent[0]),Math.abs(extent[1]));
 const step=limit<=5.5?2:limit<=12?5:10;
 const count=Math.floor(limit/step);
 return Array.from({length:count*2+1},(_,i)=>(i-count)*step);
}
function drawFittingBand(qp){
 const outer=result.spectrum.g_max??result.settings.g_max??10;
 const inner=result.spectrum.g_min??result.settings.g_min??result.settings.diffraction?.exclude_radius_nm_inv??3;
 const [cx,cy]=qp(0,0),rx=Math.abs(qp(outer,0)[0]-cx),ry=Math.abs(qp(0,outer)[1]-cy);
 const ix=Math.abs(qp(inner,0)[0]-cx),iy=Math.abs(qp(0,inner)[1]-cy);
 const group=el('svg',{x:0,y:0,width:420,height:420,viewBox:'0 0 420 420',overflow:'hidden','pointer-events':'none','data-fitting-band':`${inner}-${outer}`});
 const ellipse=`M${cx-rx} ${cy}a${rx} ${ry} 0 1 0 ${2*rx} 0a${rx} ${ry} 0 1 0 ${-2*rx} 0Z`;
 group.append(el('path',{d:'M0 0H420V420H0Z'+ellipse,fill:'#000','fill-opacity':.25,'fill-rule':'evenodd'}));
 group.append(el('ellipse',{cx,cy,rx:ix,ry:iy,fill:'#000','fill-opacity':.16}));
 for(const [r,xr,yr,description]of [[outer,rx,ry,'Outer fitting limit'],[inner,ix,iy,'Central exclusion']]){
  if(r===0)continue;
  const boundary=el('ellipse',{cx,cy,rx:xr,ry:yr,fill:'none',stroke:'#b3c2d0','stroke-width':.7,'stroke-dasharray':'3 3',opacity:.8});
  boundary.append(el('title',{},`${description}: ${r} nm⁻¹. Shaded areas are excluded from fitting.`));group.append(boundary);
  const x=r===outer?cx+xr*.70:cx,y=r===outer?cy-yr*.70-4:cy-yr-4;
  group.append(el('text',{x:clamp(x,38,382),y:clamp(y,10,410),fill:'#c2cfda','font-size':8,'text-anchor':'middle',stroke:'#05090e','stroke-width':2.5,'paint-order':'stroke'},`${r} nm⁻¹`));
 }
 $('fft-overlay').append(group);
}
function drawFFT(){
 hideSpectrumHover();
 if(!result||!fftRaw)return;
 $('fft-image').setAttribute('href',colourSpectrum(showDetectorSignal&&detectorRaw?detectorRaw:fftRaw,result.image_kind));$('contrast-value').textContent=$('contrast').value+'%';
 const ex=result.spectrum.extent;const qp=(x,y)=>[(x-ex[0])/(ex[1]-ex[0])*420,(ex[3]-y)/(ex[3]-ex[2])*420];$('fft-overlay').replaceChildren();$('fft-axes').replaceChildren();drawFittingBand(qp);if(showDetectorSignal&&detectorRaw)$('fft-axes').append(el('text',{x:0,y:-3,fill:'#aab9c8','font-size':7.5},`Processed detector signal · cutoff ${result.spectrum.profile_threshold.toFixed(3)} · minimum strength ${result.spectrum.minimum_peak_enrichment.toFixed(3)}`));for(const q of spectrumTicks(ex)){if(q<ex[0]||q>ex[1])continue;const [px]=qp(q,0);$('fft-axes').append(el('text',{x:px,y:437,fill:'#8c9eaf','font-size':10,'text-anchor':'middle'},q));const[,py]=qp(0,q);$('fft-axes').append(el('text',{x:-7,y:py+3,fill:'#8c9eaf','font-size':10,'text-anchor':'end'},q))}const overlay=$('overlay').value;const marker=$('peak-marker').value;if(marker!=='off')for(const p of result.spectrum.peaks){for(const q of (p.observed_spots||[[p.qx,p.qy],[-p.qx,-p.qy]])){const[x,y]=qp(q[0],q[1]);const attrs={stroke:'#ffffff','stroke-width':1,fill:'none','data-measured-profile':p.profile_id};const shape=peakMarker(x,y,marker,attrs);shape.append(el('title',{},`Measured profile ${p.profile_id} · g ${p.g_nm_inv.toFixed(3)} nm⁻¹`));$('fft-overlay').append(shape)}}const fits=[];
for(const model of overlayModels(result,overlay))fits.push({model,color:phaseColors[model.phase],geometry:false});
if(overlay==='geometry')fits.push(...geometryFits(result));
if(overlay==='custom'){
 for(const key of chosenFits){if(key.startsWith('phase-')){const m=result.models[Number(key.slice(6))];if(m)fits.push({model:m,color:phaseColors[m.phase],geometry:false})}else{const fit=geometryFits(result).find(f=>f.key===key);if(fit)fits.push(fit)}}
}
const shownWeak=new Set();
for(const f of fits){
 const matched=new Set(f.model.matches.map(m=>m.node_index));
 for(const [nodeIndex,node] of f.model.predicted_nodes.entries()){
  const evidence=f.model.peak_evidence?.nodes.find(n=>n.node_index===nodeIndex);
  const supported=f.geometry||matched.has(nodeIndex),weak=evidence?.status==='weak';
  for(const sign of [1,-1]){
   const[x,y]=qp(sign*node.q[0],sign*node.q[1]);if(x<0||x>420||y<0||y>420)continue;
   const attrs={stroke:f.color,'stroke-width':1.2,fill:'none'};
   if(weak)attrs['stroke-dasharray']='5 3';else if(!f.model.valid)attrs['stroke-dasharray']='2 2';else if(!supported)attrs['stroke-dasharray']='1 3';
   if(evidence?.status==='unassessable')attrs.opacity=.35;
   const styleId=f.geometry?(f.model===result.periodicity.primary_lattice?'primary-geometry-marker':'secondary-geometry-marker'):(f.model.phase.toLowerCase()+'-marker');
   const shape=markerShape(x,y,$(styleId).value,{...attrs,'data-marker-kind':'prediction','data-marker-phase':f.geometry?'geometry':f.model.phase},7);
   const evidenceText=supported?'matched original detected profile':weak?`weak local maximum ${evidence.weak_id}, local contrast ${evidence.local_contrast.toFixed(1)}, offset ${evidence.offset_nm_inv.toFixed(3)} nm⁻¹`:evidence?.status==='unassessable'?'not reliably assessable':'no strong or qualifying weak maximum assigned';
   if(shape){shape.append(el('title',{},f.geometry?`${f.name||'Geometry'} ${indexLabel(node.coefficients_mn.map(n=>sign*n),'()')}`:`${f.model.phase} ${planeLabel(f.model,node.hkl,sign)} · ${f.model.valid?'passes screen':'below threshold'} · ${evidenceText}`));$('fft-overlay').append(shape)}
   if(weak){
    const observations=evidence.observed_spots?(sign===1?evidence.observed_spots:[]):[[sign*evidence.observed_q[0],sign*evidence.observed_q[1]]];
    for(const q of observations){
     const key=JSON.stringify([evidence.weak_id,...q]);if(shownWeak.has(key))continue;shownWeak.add(key);
     const [wx,wy]=qp(q[0],q[1]),mark=weakMarker(wx,wy,evidence.weak_id);
     if(mark){mark.append(el('title',{},'Weak detection · '+evidenceText));$('fft-overlay').append(mark)}
    }
   }
  }
 }
}
 drawReflectionVectors(qp);
 if(result.image_kind==='diffraction')drawDetectorExclusions(qp);
 syncFFTZoom();
}
function renderFitChoices(data){
 chosenFits=new Set();$('fit-list').replaceChildren();
 const table=document.createElement('table');table.className='model-table fit-table';
 const head=document.createElement('thead'),body=document.createElement('tbody');
 renderFitHeader(head,true);table.append(head,body);$('fit-list').append(table);
 const add=(key,m,name,geometry=false,target=body)=>{
  const row=document.createElement('tr'),toggle=document.createElement('td'),box=document.createElement('input');
  toggle.className='col-show';toggle.dataset.column='show';
  box.type='checkbox';box.dataset.fit=key;box.setAttribute('aria-label','Overlay '+name);
  box.addEventListener('change',()=>{box.checked?chosenFits.add(key):chosenFits.delete(key);$('overlay').value='custom';drawFFT()});
  toggle.append(box);row.append(toggle);
  appendFitCells(row,m,{name,geometry,rotation:!geometry});target.append(row);
 };
 data.models.map((m,i)=>({m,i})).sort((a,b)=>compareRank(a.m,b.m)).forEach(({m,i})=>add('phase-'+i,m,`${m.phase} ${zoneLabel(m)}`));
 const geometryEntries=geometryFits(data);
 if(geometryEntries.length){
  const geometryBody=document.createElement('tbody'),heading=document.createElement('tr'),cell=document.createElement('td');
  heading.className='fit-section';cell.colSpan=FIT_COLUMNS.length+1;cell.textContent='Geometry-only checks · separate score';heading.append(cell);geometryBody.append(heading);table.append(geometryBody);
  geometryEntries.sort((a,b)=>compareRank(a.model,b.model)).forEach(({key,name,model})=>add(key,model,name,true,geometryBody));
 }
 if(!body.children.length&&!geometryEntries.length)$('fit-list').textContent='No retained candidate fits in this region.';
}

function syncSignalToggle(){
 const direct=isDiffraction(),active=showDetectorSignal&&!direct&&Boolean(detectorRaw);
 $('fft-signal-toggle').hidden=direct;
 $('show-original-fft').setAttribute('aria-pressed',String(!active));
 $('show-detector-signal').setAttribute('aria-pressed',String(active));
 $('show-detector-signal').disabled=!detectorRaw;
 $('spectrum-title').textContent=direct?'Diffraction space':active?'Processed':'FFT space';
 $('fft-zoom-title').textContent=(direct?'Diffraction space':active?'Processed FFT detector signal':'FFT space')+' · nm⁻¹';
 $('fft-curve').disabled=active||!config?.fft_log16;
 $('fft-curve').querySelector('option[value="log"]').textContent=active?'Detector response':direct?'Log intensity':'Log power';
 $('fft-curve').querySelector('option[value="linear"]').textContent=active?'Detector response':direct?'Linear intensity':'Linear amplitude';
}
for(const [id,active]of [['show-original-fft',false],['show-detector-signal',true]])$(id).onclick=()=>{
 showDetectorSignal=active;syncSignalToggle();drawFFT();
};
function rememberFFTDisplay(){writePreference('tem-fft-display',{curve:$('fft-curve').value,background:Number($('contrast').value),white:Number($('fft-white').value)})}
function autoFFTContrast(){const linear=$('fft-curve').value==='linear'&&!(showDetectorSignal&&detectorRaw);$('contrast').value=linear?30:60;$('fft-white').value=linear?99.9:99.8;rememberFFTDisplay();drawFFT()}
$('fft-curve').onchange=autoFFTContrast;$('fft-auto').onclick=autoFFTContrast;
$('fft-white').onchange=()=>{$('fft-white').value=clamp(Number($('fft-white').value)||99.8,91,100);rememberFFTDisplay();drawFFT()};
const displayPreference=readPreference('tem-fft-display',{});
if(['log','linear'].includes(displayPreference.curve))$('fft-curve').value=displayPreference.curve;
if(Number.isFinite(displayPreference.background))$('contrast').value=clamp(displayPreference.background,0,90);
if(Number.isFinite(displayPreference.white))$('fft-white').value=clamp(displayPreference.white,91,100);
const savedPhaseColors=readPreference('tem-phase-colors',{});
for(const phase of PHASES){
 const field=$(phase.toLowerCase()+'-color');field.append(new Option('Disabled','disabled'));
 for(const [value,[name]]of Object.entries(PHASE_COLOR_OPTIONS))field.append(new Option(name,value));
 phaseColorChoices[phase]=Object.hasOwn(PHASE_COLOR_OPTIONS,savedPhaseColors?.[phase])?savedPhaseColors[phase]:PHASE_DEFAULT_COLORS[phase];
 field.value=phaseColorChoices[phase];
 field.onchange=()=>{
  const previous=[...enabledPhases];
  const next=PHASES.filter(phase=>$(phase.toLowerCase()+'-color').value!=='disabled');
  if(!config?.phase_selection&&previous.join(',')!==next.join(',')){setPhaseSelection(previous);message('Restart TEM Workbench and reload to change which phases are searched.',true);return}
  if(field.value!=='disabled')phaseColorChoices[phase]=field.value;
  setPhaseSelection(next);finishPhaseChange(previous);
 };
}
setPhaseSelection(enabledPhases);
$('reset-phase-colors').onclick=()=>{
 const previous=[...enabledPhases];Object.assign(phaseColorChoices,PHASE_DEFAULT_COLORS);
 setPhaseSelection(config?.phase_selection?materialPhases():PHASES);finishPhaseChange(previous);
};
const savedMarkerStyles=readPreference('tem-marker-styles',{});
for(const [id,fallback]of Object.entries({'hcp-marker':'circle','bcc-marker':'circle','fcc-marker':'circle','primary-geometry-marker':'diamond','secondary-geometry-marker':'diamond','weak-marker':'diamond'})){
 const choices=id==='weak-marker'?[...MARKER_SHAPES,'follow','dot']:MARKER_SHAPES;
 $(id).value=choices.includes(savedMarkerStyles?.[id])?savedMarkerStyles[id]:fallback;
 $(id).onchange=()=>{rememberMarkerStyles();drawFFT()};
}
$('marker-motion').value=['off','pulse','bounce','wobble'].includes(savedMarkerStyles?.motion)?savedMarkerStyles.motion:savedMarkerStyles?.pulse===true?'bounce':'off';applyMarkerAnimation();
$('marker-motion').onchange=()=>{rememberMarkerStyles();applyMarkerAnimation()};
$('contrast').oninput=()=>{rememberFFTDisplay();drawFFT()};$('peak-marker').onchange=()=>{writePreference('tem-peak-marker',$('peak-marker').value);drawFFT()};const savedMarker=readPreference('tem-peak-marker',null);if(MARKER_SHAPES.includes(savedMarker))$('peak-marker').value=savedMarker;$('overlay').onchange=()=>{if($('overlay').value==='custom')$('fit-controls').open=true;drawFFT()};$('palette').onchange=()=>{writePreference('tem-palette',$('palette').value);syncIntensityKey();drawFFT()};
const oldPalette=readPreference('tem-palette',null),savedPalette=({ice:'viridis',violet:'plasma',green:'viridis'})[oldPalette]||oldPalette;if(Object.hasOwn(SPECTRUM_PALETTES,savedPalette))$('palette').value=savedPalette;syncIntensityKey();
function updateGridSizeNote(){
 $('check-passing').disabled=!config?.check_passing||!$('adaptive').checked;
 const note=$('grid-size-note');if(!meta||isDiffraction()){note.textContent='';return}
 const count=Number($('grid-count').value),minimum=Number($('grid-min').value);
 if(!Number.isInteger(count)||count<2||count>24||!Number.isFinite(minimum)||minimum<=0){note.textContent='Choose 2–24 regions per side and a positive stopping limit in nm.';return}
 const extent=Math.min(meta.width,meta.height),pixel=Math.min(meta.pixel_x_nm,meta.pixel_y_nm);
 const start=extent*pixel/count,half=Math.floor(Math.ceil(extent/count)/2);
 note.textContent=`Starting regions: about ${start.toFixed(2)} nm wide. `;
 if(!$('adaptive').checked){note.textContent+='Uniform grid; no subdivision.';return}
 if(half<32||half*pixel<minimum){
  note.textContent+=`The next split would be about ${(start/2).toFixed(2)} nm, below ${half<32?'32 pixels':minimum+' nm'}. Use fewer regions per side to allow subdivision.`;
 }else{
  note.textContent+=`Unresolved, insufficient or ambiguous regions, two candidate structures, and substantial second patterns split into four; each child must remain at least ${minimum} nm and 32 pixels wide.`;
  if($('check-passing').checked)note.textContent+=' Passing regions also trial four children; keep the children when they reveal different phases/zones, a separate pattern, or a mix of passing and unresolved assignments.';
 }
}
for(const id of ['grid-count','grid-min','adaptive','check-passing'])$(id).addEventListener('input',updateGridSizeNote);
function renderZoneBreakdown(phase,totalArea,open){
 const found=new Map();
 for(const region of grid.regions){
  const model=region.leaf&&region.best_zones?.[phase];if(!model?.valid)continue;
  const key=zoneKey(model);
  if(!found.has(key))found.set(key,{key,model,count:0,passing:0,area:0});
  const entry=found.get(key);entry.count++;if(model.valid)entry.passing++;entry.area+=region.roi.w*region.roi.h;
 }
 const entries=[...found.values()].sort((a,b)=>b.area-a.area||a.key.localeCompare(b.key));
 const details=document.createElement('details'),summary=document.createElement('summary');
 details.className='zone-breakdown';details.dataset.phase=phase;details.open=open;
 const passing=entries.reduce((sum,e)=>sum+e.passing,0);
 summary.textContent=`${phase} zone axes · ${passing} passing fits`;summary.style.color=phaseColors[phase];details.append(summary);
 const note=document.createElement('p');note.className='hint';
 note.textContent='Passing best fits for this structure in current map regions only. Regions may appear in more than one structure list; image area here is not a phase fraction.';
 details.append(note);
 const table=document.createElement('table'),head=document.createElement('thead'),header=document.createElement('tr'),body=document.createElement('tbody');
 for(const label of ['Zone axis','Passing regions','Image area']){
  const cell=document.createElement('th');cell.scope='col';cell.textContent=label;header.append(cell);
 }
 head.append(header);table.append(head,body);details.append(table);
 for(const entry of entries){
  const row=document.createElement('tr'),symbol=zoneSymbols[phase].get(entry.key);
  row.dataset.zone=entry.key;
  const values=[(symbol?symbol+' ':'')+zoneLabel(entry.model),entry.passing,`${(100*entry.area/totalArea).toFixed(1)}%`];
  for(const [index,value]of values.entries()){
   const cell=document.createElement('td');cell.textContent=value;if(index===0)cell.style.color=phaseColors[phase];row.append(cell);
  }
  body.append(row);
 }
 if(!entries.length)note.textContent='No passing fits for this structure in the current map.';
 return details;
}
function renderGridSummary(){
 const container=$('grid-summary');
 const expanded=new Set([...container.querySelectorAll('.zone-breakdown')].filter(e=>e.open).map(e=>e.dataset.phase));
 container.replaceChildren();container.hidden=!grid;
 if(!grid)return;
 const totalArea=grid.source.width*grid.source.height,counts={};
 for(const key of Object.keys(labels))counts[key]={count:0,area:0};
 let regionCount=0,covered=0;
 for(const region of grid.regions){
  if(!region.leaf)continue;
  const key=Object.hasOwn(counts,region.label)?region.label:'unresolved';
  const area=region.roi.w*region.roi.h;counts[key].count++;counts[key].area+=area;
  regionCount++;covered+=area;
 }
 const heading=document.createElement('h3');heading.textContent='Grid results';
 const summary=document.createElement('p');summary.className='hint';
 summary.textContent=`${regionCount} current map regions · ${(100*covered/totalArea).toFixed(1)}% image coverage · ${grid.state} · started ${grid.grid.count}×${grid.grid.count}, ${grid.grid.adaptive?'adaptive'+(grid.grid.check_passing?' + passing-region checks':''):'uniform'} · ${scaleSummary(grid.settings)}`;
 const table=document.createElement('table'),head=document.createElement('thead'),header=document.createElement('tr');
 for(const title of ['Result','Regions','Image area']){const cell=document.createElement('th');cell.scope='col';cell.textContent=title;header.append(cell)}
 head.append(header);table.append(head);const body=document.createElement('tbody');
 const add=(label,count,area,color)=>{const row=document.createElement('tr');for(const [index,value] of [label,count,`${(100*area/totalArea).toFixed(1)}%`].entries()){const cell=document.createElement('td');cell.textContent=value;if(index===0&&color)cell.style.color=color;row.append(cell)}body.append(row)};
 for(const [key,value]of Object.entries(counts))add(labels[key],value.count,value.area,colors[key]);
 if(covered<totalArea)add('Not yet covered','—',totalArea-covered);
 table.append(body);const note=document.createElement('p');note.className='hint';
 note.textContent='Area is weighted by region size. Counts include current map regions only, excluding subdivided parents. Candidate-labelled image area is not a confirmed phase fraction.';
 if(grid.rescore&&grid.grid.adaptive)note.textContent+=` Labels have been reweighted within the existing cells. Subdivision decisions and stopping reasons remain from the original run. Run a new grid to change its boundaries.`;
 if(grid.lookahead?.checked)note.textContent+=` Child checks: ${grid.lookahead.refined} parents subdivided, ${grid.lookahead.retained} retained. Trial-only children are excluded from map totals.`;
 container.append(heading,summary,table,note);
 for(const phase of analysisPhases(grid.settings))container.append(renderZoneBreakdown(phase,totalArea,expanded.has(phase)));
}
function zoneKey(model){return zoneIndices(model).join(',')}
function zoneSymbol(phase,key){
 if(!zoneSymbols[phase].has(key)){
  const index=zoneSymbols[phase].size;
  zoneSymbols[phase].set(key,ZONE_SYMBOLS[index]??`◌${index+1}`);
 }
 return zoneSymbols[phase].get(key);
}
function renderClassLegend(){
 const legend=$('class-legend'),shown=new Set(grid?.regions.filter(r=>r.leaf).map(r=>r.label)??[]);
 legend.hidden=!$('show-grid').checked||!shown.size;
 for(const item of legend.children)item.hidden=!shown.has(item.dataset.label);
}
function renderZoneLegend(found){
 const legend=$('zone-legend');legend.replaceChildren();legend.hidden=PHASES.every(phase=>!found[phase].size);
 if(legend.hidden)return;
 const hint=document.createElement('p');hint.className='hint';
 hint.textContent='Best candidate for each searched structure, left to right: '+analysisPhases(grid?.settings).join(', ')+'. Faded symbols are below the screen threshold. These are alternative fits, not proof that multiple phases are present. Legend counts and areas include passing fits only, largest area first.';
 legend.append(hint);
 for(const phase of PHASES){
  if(!found[phase].size)continue;
  const group=document.createElement('div');group.className='zone-legend-group';group.style.color=phaseColors[phase];
  const title=document.createElement('strong');title.textContent=phase;group.append(title);
  for(const [key,entry] of [...found[phase]].sort((a,b)=>b[1].area-a[1].area||b[1].count-a[1].count||a[0].localeCompare(b[0]))){
   const item=document.createElement('span');item.className='zone-key';
   const symbol=document.createElement('b');symbol.textContent=zoneSymbols[phase].get(key);
   const count=document.createElement('small');count.textContent='×'+entry.count;
   item.dataset.phase=phase;item.dataset.zone=key;
   item.append(symbol,document.createTextNode(zoneLabel(entry.model)),count);
   item.title=`${entry.count} passing cells · ${(100*entry.area/(grid.source.width*grid.source.height)).toFixed(1)}% image area`;group.append(item);
  }
  legend.append(group);
 }
}
function drawGrid(){
 hideRegionPreview();renderClassLegend();
 if(zoneJob!==grid?.id){zoneJob=grid?.id;zoneSymbols=phaseMaps()}
 const shown=phaseMaps();
 const group=$('grid-map');group.replaceChildren();
 const showGrid=$('show-grid').checked,showZones=$('show-zones').checked&&!$('show-zones').disabled;
 if(!grid||(!showGrid&&!showZones)){renderZoneLegend(shown);renderGridSummary();updatePenaltyControls();return}
 for(const r of grid.regions){
  if(!r.leaf)continue;
  const e=el('rect',{x:r.roi.x,y:r.roi.y,width:r.roi.w,height:r.roi.h,fill:colors[r.label]||'#aaa',stroke:showGrid?(colors[r.label]||'#aaa'):'none',class:'grid-cell','data-id':r.id,'fill-opacity':showGrid?Number($('grid-opacity').value)/100:0});
  const descriptions=[labels[r.label]];
  for(const phase of PHASES){const m=r.best_zones?.[phase];if(m)descriptions.push(`${phase} ${zoneLabel(m)} · ${m.valid?'passes screen':'below threshold'}`)}
  e.setAttribute('role','img');e.setAttribute('aria-label',descriptions.join(' · '));group.append(e);
  if(showZones)for(const [i,phase]of analysisPhases(grid.settings).entries()){
   const model=r.best_zones?.[phase];if(!model)continue;
   const key=zoneKey(model),symbol=zoneSymbol(phase,key);
   const size=Math.min(r.roi.w,r.roi.h)*.25;
   const marker=el('text',{x:r.roi.x+r.roi.w*((i+1)/(analysisPhases(grid.settings).length+1)),y:r.roi.y+r.roi.h*.5,
    fill:phaseColors[phase],'font-size':size,'stroke-width':size*.12,
    class:'zone-marker','data-phase':phase,'data-zone-key':key,'fill-opacity':model.valid?1:.38,'stroke-opacity':model.valid ? .85 : .38,
    'aria-hidden':'true'},symbol);
   group.append(marker);
   // Count only emitted passing markers; rejected alternatives remain faded on the map.
   if(!model.valid)continue;
   if(!shown[phase].has(key))shown[phase].set(key,{model,count:0,passing:0,area:0});
   const entry=shown[phase].get(key);entry.count++;entry.area+=r.roi.w*r.roi.h;if(model.valid)entry.passing++;
  }
 }
 renderZoneLegend(shown);renderGridSummary();updatePenaltyControls();
}
$('show-zones').checked=readPreference('tem-grid-zones',true)!==false;
$('show-zones').onchange=()=>{writePreference('tem-grid-zones',$('show-zones').checked);drawGrid()};
$('show-grid').onchange=drawGrid;
function updateGridOpacity(){
 const amount=Number($('grid-opacity').value);$('grid-opacity-value').textContent=amount+'%';
 for(const cell of $('grid-map').querySelectorAll('.grid-cell'))cell.setAttribute('fill-opacity',$('show-grid').checked?amount/100:0);
}
$('grid-opacity').oninput=()=>{updateGridOpacity();writePreference('tem-grid-opacity',Number($('grid-opacity').value))};
const savedOpacity=readPreference('tem-grid-opacity',12);
if(Number.isFinite(savedOpacity))$('grid-opacity').value=clamp(savedOpacity,0,100);
updateGridOpacity();
function isGridRunning(){return Boolean(jobId&&(!grid||grid.state==='running'))}
function gridStatus(){
 if(!grid)return;
 $('grid-status').textContent=`${grid.processed} regions analysed · ${grid.pending} pending · ${grid.state}${grid.error?' — '+grid.error:''}`+(grid.rescore?` · reweighted in ${(grid.rescore.elapsed_ms/1000).toFixed(2)} s using cached fits`:'');
}
async function poll(id){
 try{
  const status=await api('job?id='+encodeURIComponent(id));if(id!==jobId)return;
  grid=status;drawGrid();gridStatus();
  if(status.state==='running')setTimeout(()=>poll(id),600);
  else{$('run-grid').disabled=isDiffraction();$('cancel-grid').disabled=true;updatePenaltyControls()}
 }catch(e){if(id===jobId){message(e.message,true);$('run-grid').disabled=isDiffraction();$('cancel-grid').disabled=true}}
}
$('run-grid').onclick=async()=>{
 if(!meta||isDiffraction())return;
 try{
  rescoreRevision++;rescorePending=false;clearTimeout(rescoreTimer);
  hideRegionPreview();$('run-grid').disabled=true;$('clear-grid').disabled=true;$('cancel-grid').disabled=true;
  const version=sourceRequest,expectedSettings=JSON.stringify(settings()),d=await api('grid',{...requestBody(),count:Number($('grid-count').value),adaptive:$('adaptive').checked,minimum_nm:Number($('grid-min').value),check_passing:$('adaptive').checked&&$('check-passing').checked});
  if(version!==sourceRequest||JSON.stringify(settings())!==expectedSettings){await api('cancel',{job_id:d.id});$('run-grid').disabled=isDiffraction();updatePenaltyControls();return}
  jobId=d.id;grid=null;drawGrid();$('cancel-grid').disabled=false;$('save-grid').disabled=true;
  $('scale-penalty').disabled=true;$('scale-penalty-slider').disabled=true;$('peak-evidence-weight').disabled=true;$('peak-evidence-slider').disabled=true;poll(jobId);
 }catch(e){$('run-grid').disabled=isDiffraction();message(e.message,true);updatePenaltyControls()}
};
$('cancel-grid').onclick=async()=>{try{await api('cancel',{job_id:jobId})}catch(e){message(e.message,true)}};
$('clear-grid').onclick=()=>{
 const id=jobId,running=isGridRunning();
 rescoreRevision++;rescorePending=false;clearTimeout(rescoreTimer);
 jobId=null;grid=null;drawGrid();
 $('run-grid').disabled=isDiffraction();$('cancel-grid').disabled=true;
 $('grid-status').textContent='Grid cleared. Run grid to create a new map.';
 if(id&&running)api('cancel',{job_id:id}).catch(e=>message(e.message,true));
};
const exportButtonTimers=new Map();
function exportNotice(title,detail='',state='busy'){
 const notice=$('export-notice');notice.dataset.state=state;
 $('export-notice-title').textContent=title;$('export-notice-detail').textContent=detail;notice.hidden=false;
}
$('export-notice-close').onclick=()=>{$('export-notice').hidden=true};
function beginExport(id,title){
 const button=$(id);clearTimeout(exportButtonTimers.get(id));
 button.dataset.exportLabel??=button.textContent;button.dataset.exportState='busy';button.setAttribute('aria-busy','true');button.disabled=true;button.textContent='Exporting…';
 exportNotice(title,'Preparing the file…');
}
function finishExport(id,path,error=null){
 const button=$(id);button.removeAttribute('aria-busy');button.dataset.exportState=error?'error':'saved';button.textContent=error?'Export failed':'✓ Saved';
 if(error){exportNotice('Export failed',error,'error');message(error,true)}
 else{const name=path.split(/[\\/]/).pop();exportNotice('✓ Export saved · '+name,path,'saved');message('Saved: '+path)}
 exportButtonTimers.set(id,setTimeout(()=>{button.textContent=button.dataset.exportLabel;delete button.dataset.exportState},5000));
}
async function save(body,id){
 if($(id).dataset.exportState==='busy')return;
 beginExport(id,'Exporting results…');
 try{const data=await api('save',body);finishExport(id,data.path)}catch(e){finishExport(id,null,e.message)}
 finally{if(id==='save-grid')updatePenaltyControls();else $(id).disabled=!result||busy||pending}
}
$('save-region').onclick=()=>{if(result)save({file_id:fileId,roi:result.roi,settings:result.settings},'save-region')};$('save-grid').onclick=()=>{if(jobId)save({job_id:jobId},'save-grid')};
function updatePenaltyControls(){
 const automatic=$('scenario').value.startsWith('auto_'),running=isGridRunning();
 const disabled=!config?.grid_rescore||!automatic||running;
 $('scale-penalty').disabled=disabled;$('scale-penalty-slider').disabled=disabled;
 $('peak-evidence-weight').disabled=!config?.peak_evidence||!config?.grid_rescore||running;$('peak-evidence-slider').disabled=$('peak-evidence-weight').disabled;
 const mismatch=Boolean(grid&&((grid.settings.scale_mode!=='fixed'&&scalePenalty!==grid.settings.scale_penalty_strength)||(config?.peak_evidence&&peakEvidenceWeight!==grid.settings.peak_evidence_weight)));
 const updating=rescorePending||rescoreBusy;
 $('grid-map').classList.toggle('stale',updating||mismatch);
 $('save-grid').disabled=!grid||running||updating||mismatch||$('save-grid').dataset.exportState==='busy';syncMapExportControls();
 $('clear-grid').disabled=!grid&&!jobId;
 const note=$('penalty-note');
 note.textContent=!config?.peak_evidence?'Restart TEM Workbench and reload to enable prediction-site evidence.':running?'Finish or cancel this grid to adjust ranking weights.':updating?'Updating the map from cached fits…':mismatch?'This map still shows its previous weights; adjust a control again to retry.':grid?'Updates labels, symbols and totals from cached fits. Existing cell boundaries stay fixed.':automatic?'Zero disables a weight. Scale cost favours smaller adjustments; peak evidence checks weak and missing spots.':'Fixed scale has no scale penalty. Peak-evidence weight adjusts weak and missing spot contributions; zero disables it.';
}
function penaltyChanged(input){
 if(!input.value)return;
 const value=Number(input.value);
 if(!Number.isFinite(value)||value<0||value>.5){message('Use a ranking weight from 0 to 0.5.',true);return}
 if(['peak-evidence-weight','peak-evidence-slider'].includes(input.id)){peakEvidenceWeight=value;$('peak-evidence-weight').value=value;$('peak-evidence-slider').value=value;writePreference('tem-peak-evidence-weight',value)}
 else{scalePenalty=value;if(input.id==='scale-penalty-slider')$('scale-penalty').value=value;else $('scale-penalty-slider').value=value;writePreference('tem-scale-penalty',value)}
 rescoreRevision++;clearTimeout(rescoreTimer);
 rescorePending=Boolean(jobId&&grid?.can_rescore);
 updatePenaltyControls();if(meta)schedule(150);
 if(rescorePending)rescoreTimer=setTimeout(rescoreGrid,140);
}
async function rescoreGrid(){
 if(rescoreBusy||!rescorePending)return;
 const id=jobId,version=rescoreRevision,strength=scalePenalty,evidenceWeight=peakEvidenceWeight;
 rescoreBusy=true;rescorePending=false;updatePenaltyControls();
 try{
  const status=await api('rescore-grid',{job_id:id,scale_penalty_strength:strength,peak_evidence_weight:evidenceWeight});
  if(id===jobId&&version===rescoreRevision){grid=status;drawGrid();gridStatus()}
 }catch(e){if(id===jobId&&version===rescoreRevision)message(e.message,true)}
 finally{
  rescoreBusy=false;updatePenaltyControls();
  if(rescorePending){clearTimeout(rescoreTimer);rescoreTimer=setTimeout(rescoreGrid,0)}
 }
}
const savedPenalty=readPreference('tem-scale-penalty',.10);
if(Number.isFinite(savedPenalty)&&savedPenalty>=0&&savedPenalty<=.5)scalePenalty=savedPenalty;
$('scale-penalty').value=scalePenalty;
$('scale-penalty-slider').value=$('scale-penalty').value;
const savedEvidenceWeight=readPreference('tem-peak-evidence-weight',.10);
if(Number.isFinite(savedEvidenceWeight)&&savedEvidenceWeight>=0&&savedEvidenceWeight<=.5)peakEvidenceWeight=savedEvidenceWeight;
$('peak-evidence-weight').value=peakEvidenceWeight;$('peak-evidence-slider').value=peakEvidenceWeight;
$('peak-evidence-weight').onblur=()=>{$('peak-evidence-weight').value=peakEvidenceWeight};
for(const id of ['scale-penalty','scale-penalty-slider','peak-evidence-weight','peak-evidence-slider'])$(id).oninput=()=>penaltyChanged($(id));
$('scale-penalty').onblur=()=>{$('scale-penalty').value=scalePenalty};
const REFERENCE_CONTROLS={'hcp-a':'hcp_a','hcp-c':'hcp_c','bcc-a':'bcc_a','fcc-a':'fcc_a'};
function materialView(){
 const selected=$('material').value,preset=config?.material_presets?.[selected];
 if(preset&&Object.entries(REFERENCE_CONTROLS).some(([id,key])=>Math.abs(Number($(id).value)-preset.references[key])>1e-9))$('material').value='custom';
 const note=config?.material_presets?.[$('material').value]?.note??'Custom reference cells. Changing the material or a reference recalculates this region; rerun any grid.';
 $('material-note').textContent=note+'\nCubic: a = b = c; HCP: a = b, γ = 120°. Dimensions in nm.';
}
function invalidateAnalysisSettings(){
 if(!meta)return;
 if(isGridRunning())api('cancel',{job_id:jobId}).catch(e=>message(e.message,true));
 rescoreRevision++;rescorePending=false;clearTimeout(rescoreTimer);jobId=null;grid=null;drawGrid();$('save-grid').disabled=true;$('run-grid').disabled=isDiffraction();$('cancel-grid').disabled=true;
 $('grid-status').textContent='Settings changed. Run a new grid to use these settings.';schedule(0);
}
function updateStrengthMode(){
 const automatic=$('fft-strength-mode').value==='auto';
 $('fft-strength-mode').disabled=!config?.fft_auto_strength;
 $('fft-min-strength').disabled=!config?.fft_detection_controls||automatic;
 $('fft-min-strength').hidden=automatic;
 $('fft-auto-strength-value').hidden=!automatic;
 $('fft-auto-strength-value').textContent=config?.fft_auto_strength?'Choosing…':'Restart required';
 $('fft-auto-strength-status').hidden=!automatic||isDiffraction();
 $('fft-auto-strength-status').textContent=automatic?'Auto chooses the strength for each region; the manual value is ignored.':'';
}
function renderAutoStrength(data){
 const info=data.spectrum.auto_peak_strength,output=$('fft-auto-strength-status');
 output.hidden=!info||data.image_kind==='diffraction';
 if(!info)return;
 $('fft-auto-strength-value').textContent=info.status==='optimized'?`Selected ${info.selected_strength.toFixed(3)}`:'Unavailable';
 output.textContent=info.status==='optimized'?`Auto strength: ${info.selected_strength.toFixed(3)} · ${info.tested_sets} peak sets compared${info.selection==='passing'?'':' · no passing fit'}`:'Auto strength unavailable: check enabled phases and image sampling.';
}
function resetFFTControls(){
 let changed=false;
 for(const [id,value]of [['threshold',.35],...Object.entries(FFT_DETECTOR_CONTROLS).map(([id,[key,value]])=>[id,value])]){
  changed||=$(id).value===''||Number($(id).value)!==value;$(id).value=value;
 }
 for(const id of ['fft-hann','fft-mean']){changed||=!$(id).checked;$(id).checked=true}
 changed||=$('fft-strength-mode').value!=='manual';$('fft-strength-mode').value='manual';updateStrengthMode();
 rememberBasicControls();if(changed)invalidateAnalysisSettings();message('FFT defaults restored.');
}
$('reset-fft').onclick=resetFFTControls;
$('material').onchange=()=>{
 const preset=config?.material_presets?.[$('material').value];
 if(preset)for(const [id,key]of Object.entries(REFERENCE_CONTROLS))$(id).value=preset.references[key];
 setPhaseSelection(config?.phase_selection?materialPhases():PHASES);materialView();rememberBasicControls();calibrationView();invalidateAnalysisSettings();
};
for(const id of ['scenario','model-scale',...Object.keys(REFERENCE_CONTROLS),'fft-g-min','g-max','threshold',...Object.keys(FFT_DETECTOR_CONTROLS),'fft-hann','fft-mean','fft-strength-mode'])$(id).onchange=()=>{
 if(id==='fft-strength-mode')updateStrengthMode();
 if(id==='model-scale'&&(!$('model-scale').value||!Number.isFinite(Number($('model-scale').value))||Number($('model-scale').value)<.85||Number($('model-scale').value)>1.15)){
  if(meta)restoreCalibration();message('Use a model size between 0.850 and 1.150.',true);return;
 }
 for(const key of [...Object.keys(REFERENCE_CONTROLS),'fft-g-min','g-max','threshold',...Object.keys(FFT_DETECTOR_CONTROLS)]){
  if($(key).value===''||!validControlNumber(key,Number($(key).value))){const [low,high]=BASIC_NUMBERS[key];message(`Enter a value between ${low} and ${high} for ${$(key).closest('label').firstChild.textContent.trim()}.`,true);return}
 }
 const inner=isDiffraction()?diffractionSettings.exclude_radius_nm_inv:Number($('fft-g-min').value);
 if(inner>=Number($('g-max').value)){message('Central exclusion must be smaller than the outer fitting limit.',true);return}
 if(id in REFERENCE_CONTROLS){$('material').value='custom';materialView()}
 if(id==='scenario'||id==='model-scale'){calibrationView();rememberCalibration()}
 if(id==='g-max'&&isDiffraction())syncDetectorControls();
 rememberBasicControls();invalidateAnalysisSettings();
};
$('model-scale').oninput=()=>{
 const field=$('model-scale'),value=Number(field.value);
 if(!field.readOnly&&field.value&&Number.isFinite(value)&&value>=.85&&value<=1.15)field.onchange();
};
$('file').onchange=openFile;
async function start(){try{config=await api('config');$('file-search').value='';$('engine-note').hidden=Boolean(config.grid_rescore&&config.grid_zones&&config.peak_evidence&&config.check_passing&&config.fft_processing&&config.refinement_policy==='passing-children-v2'&&config.folder_picker&&config.saved_regions&&config.direct_diffraction==='direct-spots-v2'&&config.diffraction_translation==='shared-center-v1'&&config.region_previews&&config.spectrum_exports&&config.map_exports&&config.phases?.includes('FCC')&&config.adjustable_fitting_band&&config.adjustable_inner_limit&&config.material_presets&&config.phase_selection&&config.fft_detection_controls&&config.fft_auto_strength&&config.fft_detector_view&&config.sidecar_previews&&config.delete_regions);$('reset-fft').disabled=!(config.fft_detection_controls&&config.fft_processing);for(const id of Object.keys(FFT_DETECTOR_CONTROLS))$(id).disabled=!config.fft_detection_controls;updateStrengthMode();if(!config.phase_selection)setPhaseSelection(PHASES);for(const phase of PHASES)$(phase.toLowerCase()+'-color').querySelector('option[value=disabled]').disabled=!config.phase_selection;for(const id of ['fft-hann','fft-mean']){$(id).disabled=!config.fft_processing;if(!config.fft_processing)$(id).checked=true}$('fft-processing-note').textContent=config.fft_detection_controls?'Changes recalculate the region; run a new grid afterwards. Separation also respects the crop-window peak width.':'Restart TEM Workbench to enable all FFT detection controls.';$('g-max').disabled=!config.adjustable_fitting_band;for(const id of ['material',...Object.keys(REFERENCE_CONTROLS)])$(id).disabled=!config.material_presets;$('fft-g-min').disabled=!config.adjustable_inner_limit;materialView();$('library-note').textContent=`Exploratory ${(config.phases||['HCP','BCC']).join('/')} comparison using ${config.template_count||46} templates from a limited set of zone axes. Untested orientations and other structures can affect the result; candidate labels are not confirmed phase identities.`;$('show-zones').disabled=!config.grid_zones;updatePenaltyControls();updateGridSizeNote();for(const mode of ['auto_uniform','auto_hcp_ac'])$('scenario').querySelector('option[value="'+mode+'"]').disabled=!config.scale_modes?.includes(mode);if(!config.fft_log16){$('fft-curve').value='log';$('fft-curve').disabled=true}const savedFavorites=readPreference(favoriteKey(),[]);favorites=new Set(Array.isArray(savedFavorites)?savedFavorites.filter(id=>typeof id==='string'):[]);renderFavorites();$('connection').textContent='Local Python · connected';$('data-path').textContent='Data: '+config.data_root;$('output-path').textContent='Results: '+config.output_root;setupFolderControls();await loadSavedRegions();renderFileList();const lastImage=readPreference(lastImageKey(),null),initial=config.files.find(f=>f.id===lastImage)||config.files.find(f=>f.id===config.default_file)||config.files[0];if(initial)$('file').value=initial.id;if(config.files.length)await openFile();else message('Choose a data folder or download the optional demo images above.',true)}catch(e){$('connection').textContent='Disconnected';message(e.message,true)}}


// Reuse the displayed spectrum and overlays; hovering never requests analysis.
let spectrumHoverTimer=null,spectrumHoverFrame=null,spectrumHoverPointer=null;
function hideSpectrumHover(){
 clearTimeout(spectrumHoverTimer);spectrumHoverTimer=null;
 cancelAnimationFrame(spectrumHoverFrame);spectrumHoverFrame=null;spectrumHoverPointer=null;
 $('spectrum-hover').hidden=true;$('spectrum-hover-content').replaceChildren();
}
function spectrumHoverPoint(){
 const pointer=spectrumHoverPointer;
 if(!pointer?.source?.isConnected||!result||!fftRaw||busy||pending||spectrumLoading)return null;
 const matrix=pointer.source.getScreenCTM();if(!matrix)return null;
 const point=new DOMPoint(pointer.x,pointer.y).matrixTransform(matrix.inverse());
 if(point.x<0||point.x>420||point.y<0||point.y>420)return null;
 return {x:point.x,y:point.y,scale:Math.hypot(matrix.a,matrix.b)};
}
function positionSpectrumHover(){
 spectrumHoverFrame=null;
 const point=spectrumHoverPoint();if(!point){hideSpectrumHover();return}
 const card=$('spectrum-hover'),view=$('spectrum-hover-view'),{x,y}=spectrumHoverPointer;
 const size=view.getBoundingClientRect().width,span=size/(point.scale*3);
 view.setAttribute('viewBox',`${point.x-span/2} ${point.y-span/2} ${span} ${span}`);
 // A small open crosshair identifies the cursor without hiding its centre pixel.
 const arm=10*span/size,gap=3*span/size;
 $('spectrum-hover-cross').setAttribute('d',`M${point.x-arm} ${point.y}h${arm-gap}M${point.x+gap} ${point.y}h${arm-gap}M${point.x} ${point.y-arm}v${arm-gap}M${point.x} ${point.y+gap}v${arm-gap}`);
 const ex=result.spectrum.extent,gx=ex[0]+point.x/420*(ex[1]-ex[0]),gy=ex[3]-point.y/420*(ex[3]-ex[2]);
 $('spectrum-hover-coords').textContent=`gₓ ${gx.toFixed(2)} · gᵧ ${gy.toFixed(2)} nm⁻¹`;
 const box=card.getBoundingClientRect(),margin=8,offset=18;
 card.style.left=clamp(x+offset+box.width>innerWidth-margin?x-offset-box.width:x+offset,margin,Math.max(margin,innerWidth-box.width-margin))+'px';
 card.style.top=clamp(y+offset+box.height>innerHeight-margin?y-offset-box.height:y+offset,margin,Math.max(margin,innerHeight-box.height-margin))+'px';
}
function showSpectrumHover(){
 spectrumHoverTimer=null;
 if(!spectrumHoverPoint()){hideSpectrumHover();return}
 const card=$('spectrum-hover'),content=$('spectrum-hover-content');
 // A modal is in the browser's top layer; its loupe must be there too.
 ($('fft-zoom').open?$('fft-zoom'):document.body).append(card);
 content.replaceChildren($('fft-image').cloneNode(true),$('fft-overlay').cloneNode(true));
 for(const node of content.querySelectorAll('[id]'))node.removeAttribute('id');
 for(const node of content.querySelectorAll('title'))node.remove();
 $('spectrum-hover-title').textContent=isDiffraction()?'Diffraction':'FFT';
 card.hidden=false;positionSpectrumHover();
 // Keep enlarged markers in the same animation phase as the source view.
 const originals=$('fft-overlay').querySelectorAll('.spectrum-marker');
 content.querySelectorAll('.spectrum-marker').forEach((marker,index)=>{
  const original=originals[index]?.getAnimations()[0],copy=marker.getAnimations()[0];
  if(original&&copy&&original.currentTime!==null)copy.currentTime=original.currentTime;
 });
}
function hoverSpectrum(event){
 if(event.pointerType==='touch'||event.buttons){hideSpectrumHover();return}
 const source=event.currentTarget===$('fft')?$('fft'):$('fft-zoom-view').querySelector('svg');
 if(spectrumHoverPointer?.source!==source)hideSpectrumHover();
 spectrumHoverPointer={source,x:event.clientX,y:event.clientY};
 if(!spectrumHoverPoint()){hideSpectrumHover();return}
 if($('spectrum-hover').hidden){if(spectrumHoverTimer===null)spectrumHoverTimer=setTimeout(showSpectrumHover,180)}
 else if(spectrumHoverFrame===null)spectrumHoverFrame=requestAnimationFrame(positionSpectrumHover);
}
for(const id of ['fft','fft-zoom-view']){
 $(id).addEventListener('pointermove',hoverSpectrum);
 for(const event of ['pointerleave','pointerdown','pointercancel'])$(id).addEventListener(event,hideSpectrumHover);
}
document.addEventListener('scroll',hideSpectrumHover,true);
window.addEventListener('resize',hideSpectrumHover);
window.addEventListener('blur',hideSpectrumHover);
document.addEventListener('keydown',event=>{if(event.key==='Escape')hideSpectrumHover()});

function syncFFTZoom(){
 if(!$('fft-zoom').open)return;
 hideSpectrumHover();
 const copy=$('fft').cloneNode(true);
 for(const attribute of ['id','tabindex','aria-haspopup','aria-controls'])copy.removeAttribute(attribute);
 copy.setAttribute('role','img');copy.setAttribute('aria-label',isDiffraction()?'Enlarged diffraction pattern with current spots and crystal overlays':'Enlarged FFT with current peaks and crystal overlays');
 for(const child of copy.querySelectorAll('[id]'))child.removeAttribute('id');
 copy.classList.add('fft-enlarged');$('fft-zoom-view').replaceChildren(copy);
}
function openFFTZoom(){
 if(!result||!fftRaw||!$('fft-image').getAttribute('href'))return;
 hideSpectrumHover();
 if(!$('fft-zoom').open)$('fft-zoom').showModal();
 syncFFTZoom();$('fft-zoom-close').focus();
}
$('fft').addEventListener('click',openFFTZoom);
$('fft').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openFFTZoom()}});
$('fft-zoom-close').onclick=()=>{hideSpectrumHover();$('fft-zoom').close()};
$('fft-zoom').addEventListener('click',e=>{
 if(e.target!==$('fft-zoom'))return;
 const bounds=$('fft-zoom').getBoundingClientRect();
 if(e.clientX<bounds.left||e.clientX>bounds.right||e.clientY<bounds.top||e.clientY>bounds.bottom)$('fft-zoom').close();
});
$('fft-zoom').addEventListener('close',()=>{if($('fft-zoom').open)return;hideSpectrumHover();$('fft-zoom-view').replaceChildren();$('fft').focus({preventScroll:true})});

function setupFolderControls(){
 $('download-demo-pack').disabled=!config.demo_download;
 const savedDemoLink=readPreference('tem-demo-pack-url','');
 $('demo-pack-url').value=typeof savedDemoLink==='string'&&savedDemoLink.trim()?savedDemoLink:$('demo-pack-url').defaultValue;
 if(config.demo_download){renderDemoDownload(config.demo_job);if(config.demo_job?.state==='running')pollDemoDownload()}
 if(!config.files.length){$('folders-panel').open=true;offerDemoDownload()}
 for(const id of ['browse-data','browse-output','apply-folders','refresh-files'])$(id).disabled=!config.folder_picker;
 $('folder-data').value=config.data_root;$('folder-output').value=config.output_root;
 if(!config.folder_picker)$('folders-note').textContent='Restart TEM Workbench to enable folder selection.';
 $('browse-images').disabled=false;
 renderPreviewProgress(config.preview_job);
 if(config.preview_job?.state==='running')pollPreviewGeneration();
}
let previewPollTimer=null,previewStarting=false;
function renderPreviewProgress(status){
 const running=status?.state==='running';
 for(const id of ['generate-previews','browser-previews']){
  $(id).disabled=!config?.sidecar_previews||running||previewStarting;
  $(id).title=config?.sidecar_previews?'Save missing PNG previews beside the linked DM4 files; existing PNGs are kept.':'Restart TEM Workbench to enable preview generation';
 }
 $('cancel-previews').hidden=!running;
 $('apply-folders').disabled=!config?.folder_picker||running;
 const text=status?`${running?'Generating previews':status.state==='cancelled'?'Preview generation cancelled':'Previews complete'} · ${status.processed}/${status.total} files · ${status.created} saved · ${status.skipped} existing · ${status.failed} failed${status.current?' · '+status.current:''}`:
  'Save 1400 px previews beside each DM4 with the same name. Existing PNGs are kept.';
 for(const id of ['preview-progress','browser-preview-progress'])$(id).textContent=text;
 $('preview-errors').hidden=!status?.errors?.length;$('preview-error-list').replaceChildren();
 for(const error of status?.errors||[]){const li=document.createElement('li');li.textContent=error;$('preview-error-list').append(li)}
}
async function pollPreviewGeneration(){
 clearTimeout(previewPollTimer);
 try{
  const status=await api('previews');renderPreviewProgress(status);
  if(status?.state==='running'){previewPollTimer=setTimeout(pollPreviewGeneration,800);return}
  const latest=await api('config');config.files=latest.files;config.preview_job=status;renderFileList();
  if($('image-browser').open)renderImageBrowser();
  if(status)exportNotice(status.state==='cancelled'?'Preview generation cancelled':'PNG previews complete',`${status.created} saved · ${status.skipped} existing · ${status.failed} failed. Saved beside the source DM4 files.`,'saved');
 }catch(error){for(const id of ['preview-progress','browser-preview-progress'])$(id).textContent=error.message;previewPollTimer=setTimeout(pollPreviewGeneration,3000)}
}
async function generatePreviews(){
 if(!config?.sidecar_previews||previewStarting)return;
 previewStarting=true;renderPreviewProgress(null);
 try{const status=await api('previews',{});renderPreviewProgress(status);pollPreviewGeneration()}
 catch(error){previewStarting=false;renderPreviewProgress(null);message(error.message,true)}
 finally{previewStarting=false}
}
$('generate-previews').onclick=generatePreviews;$('browser-previews').onclick=generatePreviews;
$('cancel-previews').onclick=async()=>{try{await api('previews/cancel',{});pollPreviewGeneration()}catch(error){message(error.message,true)}};
function renderImageBrowser(){
 const terms=$('image-browser-search').value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
 const files=config.files.filter(f=>terms.every(term=>`${f.name} ${f.sample} ${f.id}`.toLocaleLowerCase().includes(term)));
 const list=$('image-browser-list');list.replaceChildren();
 $('image-browser-count').textContent=`${files.length} image${files.length===1?'':'s'}`;
 for(const sample of new Set(files.map(f=>f.sample)))for(const file of sortedFiles(files.filter(f=>f.sample===sample))){
  const tile=document.createElement('button');tile.type='button';tile.className='image-browser-tile';tile.title=file.id;
  tile.setAttribute('aria-label','Open '+file.name+(favorites.has(file.id)?' · Favourite':''));if(file.id===fileId)tile.setAttribute('aria-current','true');
  const preview=document.createElement('span');preview.className='image-browser-preview';
  const placeholder=document.createElement('span');placeholder.className='muted';placeholder.textContent=file.id.startsWith('demo/')?'Bundled demo':'No PNG preview';preview.append(placeholder);
  if(file.has_preview){
   const img=document.createElement('img');img.alt='';img.loading='lazy';img.decoding='async';
   img.src='/api/file-preview?id='+encodeURIComponent(file.id);img.onload=()=>placeholder.hidden=true;img.onerror=()=>img.remove();preview.append(img);
  }
  const name=document.createElement('strong');name.textContent=file.name;
  if(favorites.has(file.id)){const star=document.createElement('span');star.className='favorite-star';star.textContent='★ ';star.title='Favourite';star.setAttribute('aria-hidden','true');name.prepend(star)}
  const group=document.createElement('small');group.textContent=file.sample;
  tile.append(preview,name,group);tile.onclick=()=>{
   $('image-browser').close();clearFileSearch();$('file').value=file.id;openFile();
  };list.append(tile);
 }
 if(!files.length){const empty=document.createElement('p');empty.className='hint';empty.textContent='No matching images.';list.append(empty)}
}
$('browse-images').onclick=()=>{
 $('image-browser-search').value=$('file-search').value;$('image-browser-sort').value=fileSort;
 renderImageBrowser();$('image-browser').showModal();$('image-browser-search').focus();
};
$('image-browser-close').onclick=()=>$('image-browser').close();
$('image-browser-search').oninput=renderImageBrowser;
$('image-browser-sort').onchange=()=>{$('file-sort').value=$('image-browser-sort').value;$('file-sort').onchange();renderImageBrowser()};
async function browseFolder(path){
 const version=++folderBrowseVersion;$('folder-use').disabled=true;$('folder-status').textContent='Loading folders…';
 try{
  const listing=await api('browse-folders',{path});
  if(version!==folderBrowseVersion)return;
  folderListing=listing;$('folder-path').value=listing.path;$('folder-list').replaceChildren();
  for(const folder of listing.directories){
   const button=document.createElement('button');button.type='button';button.textContent='▸ '+folder.name;button.title=folder.path;
   button.onclick=()=>browseFolder(folder.path);$('folder-list').append(button);
  }
  $('folder-up').disabled=listing.path===listing.parent;$('folder-use').disabled=false;
  $('folder-status').textContent=listing.directories.length?listing.directories.length+' subfolders':'No subfolders. You can select this folder.';
 }catch(e){if(version===folderBrowseVersion)$('folder-status').textContent=e.message}
}
function chooseFolder(target){
 if(!config?.folder_picker)return;
 folderTarget=target;$('folder-picker-title').textContent=target==='folder-data'?'Choose data folder':'Choose output folder';
 $('folder-picker').showModal();browseFolder($(target).value);
}
$('browse-data').onclick=()=>chooseFolder('folder-data');$('browse-output').onclick=()=>chooseFolder('folder-output');
for(const id of ['folder-close','folder-cancel'])$(id).onclick=()=>{$('folder-picker').close();folderBrowseVersion++};
$('folder-up').onclick=()=>browseFolder(folderListing?.parent);
$('folder-home').onclick=()=>browseFolder(folderListing?.home);
$('folder-go').onclick=()=>browseFolder($('folder-path').value);
$('folder-path').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();browseFolder($('folder-path').value)}};
$('folder-use').onclick=()=>{if(folderListing&&folderTarget){$(folderTarget).value=folderListing.path;$('folder-picker').close();folderBrowseVersion++}};
$('apply-folders').onclick=async()=>{
 $('apply-folders').disabled=true;
 try{
  await api('folders',{data_root:$('folder-data').value,output_root:$('folder-output').value});
  await start();message('Folders linked and image collection refreshed.');
 }catch(e){message(e.message,true)}
 finally{$('apply-folders').disabled=!config?.folder_picker}
};
$('refresh-files').onclick=async()=>{if(isGridRunning()){message('Finish or cancel the grid before refreshing images.',true);return}await start()};

function resetRegionEditor(){
 selectedRegionId=null;$('region-name').value='';$('region-tags').value='';$('region-notes').value='';
 $('store-region').textContent='Save region';
}
function renderSavedRegionOverlays(){
 const layer=$('saved-regions-map');layer.replaceChildren();
 if(!meta?.sha256_pixels)return;
 for(const region of regionProject.regions){
  if(region.source.sha256_pixels!==meta.sha256_pixels)continue;
  const r=region.roi;
  if(!r||!['x','y','w','h'].every(k=>Number.isFinite(r[k]))||r.w<=0||r.h<=0)continue;
  const group=el('g',{'class':'saved-region-overlay','data-region-id':region.id,role:'button',tabindex:0,'aria-label':'Open saved region: '+region.name});
  const bounds={x:r.x,y:r.y,width:r.w,height:r.h};
  group.append(el('rect',{...bounds,class:'saved-region-hit'}),el('rect',{...bounds,class:'saved-region-outline'}));
  layer.append(group);
 }
}
function renderSavedRegions(){
 renderSavedRegionOverlays();
 const select=$('saved-region-select'),all=$('saved-region-all').checked;
 const entries=regionProject.regions.filter(r=>all||r.source.sha256_pixels===meta?.sha256_pixels);
 select.replaceChildren(new Option('New region…',''));
 for(const region of [...entries].sort((a,b)=>a.source.name.localeCompare(b.source.name)||a.name.localeCompare(b.name))){
  const label=(all?region.source.name+' · ':'')+region.name+(region.tags.length?' ['+region.tags.join(', ')+']':'');
  select.append(new Option(label,region.id));
 }
 select.value=selectedRegionId||'';
 $('saved-region-count').textContent='('+entries.length+')';
 $('store-region').disabled=!meta||!config?.saved_regions;$('copy-region').disabled=!meta||!selectedRegionId||!config?.saved_regions;
 $('reload-regions').disabled=!config?.saved_regions;
 $('delete-region').disabled=!selectedRegionId||!config?.delete_regions;
 $('delete-region').title=config?.delete_regions?'Delete this saved entry; source images and exported files are kept.':'Restart TEM Workbench to enable deleting saved regions.';
}
async function loadSavedRegions(){
 if(!config.saved_regions){$('saved-region-note').textContent='Restart TEM Workbench to enable saved regions.';renderSavedRegions();return}
 try{regionProject=await api('regions');renderSavedRegions()}
 catch(e){$('saved-region-note').textContent=e.message;$('store-region').disabled=true;$('copy-region').disabled=true}
}
function applyRegionSettings(saved){
 const defaults={hcp_a:.295,hcp_c:.468,bcc_a:.330,fcc_a:.417};
 for(const [id,key]of Object.entries(REFERENCE_CONTROLS))$(id).value=saved[key]??defaults[key];
 $('material').value=saved.material??'titanium';setPhaseSelection(analysisPhases(saved));materialView();
 if(!isDiffraction())$('fft-g-min').value=saved.g_min??3;
 $('g-max').value=saved.g_max??10;
 if(isDiffraction()&&saved.diffraction){diffractionSettings=withTranslationDefaults(JSON.parse(JSON.stringify(saved.diffraction)));syncDetectorControls();rememberDiffraction();}
 $('scenario').value=saved.scale_mode==='fixed'?(saved.scale===1?'1':'custom'):saved.scale_mode;
 $('model-scale').value=saved.scale??1;$('threshold').value=saved.threshold??.35;
 for(const [id,[key,defaultValue]]of Object.entries(FFT_DETECTOR_CONTROLS))$(id).value=saved[key]??defaultValue;
 $('fft-strength-mode').value=saved.fft_auto_strength?'auto':'manual';updateStrengthMode();
 $('fft-hann').checked=(saved.fft_window??'hann')==='hann';$('fft-mean').checked=saved.remove_mean!==false;
 scalePenalty=saved.scale_penalty_strength??.1;peakEvidenceWeight=saved.peak_evidence_weight??.1;
 $('scale-penalty').value=scalePenalty;$('scale-penalty-slider').value=scalePenalty;$('peak-evidence-weight').value=peakEvidenceWeight;$('peak-evidence-slider').value=peakEvidenceWeight;
 calibrationView();rememberCalibration();rememberBasicControls();
 writePreference('tem-scale-penalty',scalePenalty);writePreference('tem-peak-evidence-weight',peakEvidenceWeight);
}
$('saved-region-all').onchange=renderSavedRegions;
$('reload-regions').onclick=loadSavedRegions;
$('new-region').onclick=()=>{resetRegionEditor();renderSavedRegions()};
async function openSavedRegion(id){
 const request=++regionRequest,imageRequest=sourceRequest;
 if(!id){resetRegionEditor();renderSavedRegions();return}
 hideRegionPreview();
 try{
  const saved=await api('regions/open',{id});if(request!==regionRequest||imageRequest!==sourceRequest)return;clearFileSearch();
  const sameImage=meta?.sha256_pixels===saved.source.sha256_pixels&&fileId===saved.source.id;
  const previousSettings=sameImage?JSON.stringify(settings()):null;
  if(!sameImage){
   $('file').value=saved.source.id;await openFile();
   if(request!==regionRequest||sourceRequest!==imageRequest+1||!meta||fileId!==saved.source.id)return;
  }
  // The server checks the pixel hash, dimensions and calibration before applying.
  selectedRegionId=id;$('region-name').value=saved.name;$('region-tags').value=saved.tags.join(', ');$('region-notes').value=saved.notes;
  $('store-region').textContent='Update region';applyRegionSettings(saved.settings);
  // Reopening a box on this image need not discard a grid with the same settings.
  if(sameImage&&previousSettings!==JSON.stringify(settings())&&(jobId||grid)){
   $('clear-grid').onclick();$('grid-status').textContent='Saved region settings restored. Run grid to create a matching map.';
  }
  roi={...saved.roi};updateBox(true);renderSavedRegions();schedule(0);
  message('Restored region and analysis settings: '+saved.name);
 }catch(e){message(e.message,true);renderSavedRegions()}
}
$('saved-region-select').onchange=() => openSavedRegion($('saved-region-select').value);
$('delete-region').onclick=async()=>{
 const id=selectedRegionId,entry=regionProject.regions.find(region=>region.id===id);
 if(!entry||!config?.delete_regions)return;
 if(!confirm(`Delete saved region “${entry.name}”? Source images and exported files will be kept.`))return;
 $('delete-region').disabled=true;
 try{
  const deleted=await api('regions/delete',{id,revision:regionProject.revision});regionProject=deleted.project;
  ++regionRequest;hideRegionPreview();hoverCache.clear();
  if(selectedRegionId===id)resetRegionEditor();
  renderSavedRegions();message('Deleted saved region: '+entry.name);
 }catch(e){message(e.message,true);renderSavedRegions()}
};
async function storeRegion(asNew=false){
 if(!meta)return;
 try{
  const request={...requestBody(),source_hash:meta.sha256_pixels,id:asNew?null:selectedRegionId,revision:regionProject.revision,
   name:$('region-name').value,tags:$('region-tags').value.split(',').map(s=>s.trim()).filter(Boolean),notes:$('region-notes').value};
  const current=sourceRequest,saved=await api('regions/save',request);regionProject=saved.project;
  if(current===sourceRequest){selectedRegionId=saved.region.id;$('store-region').textContent='Update region'}
  renderSavedRegions();message('Region saved: '+saved.region.name);
 }catch(e){message(e.message,true)}
}
$('store-region').onclick=()=>storeRegion();$('copy-region').onclick=()=>storeRegion(true);

function diffractionKey(){return 'tem-diffraction:'+meta.sha256_pixels}
const DETECTOR_FIELDS={'diff-cx':'center_x','diff-cy':'center_y','diff-sx':'pixel_x_nm_inv','diff-sy':'pixel_y_nm_inv','diff-radius':'exclude_radius_nm_inv','diff-sigma':'spot_sigma_px','diff-snr':'spot_snr','diff-shift-limit':'max_center_shift_px'};
function withTranslationDefaults(d){return {refine_center:true,max_center_shift_px:50,...d}}
function validDiffraction(d){
 if(!d||typeof d!=='object'||typeof d.refine_center!=='boolean')return false;
 if(!Object.values(DETECTOR_FIELDS).every(key=>typeof d[key]==='number'&&Number.isFinite(d[key])))return false;
 if(!(d.center_x>=0&&d.center_x<meta.width&&d.center_y>=0&&d.center_y<meta.height&&d.pixel_x_nm_inv>=1e-6&&d.pixel_x_nm_inv<=10&&d.pixel_y_nm_inv>=1e-6&&d.pixel_y_nm_inv<=10&&d.exclude_radius_nm_inv>=0&&d.exclude_radius_nm_inv<Number($('g-max').value)&&d.spot_sigma_px>=.5&&d.spot_sigma_px<=10&&d.spot_snr>=2&&d.spot_snr<=30&&d.max_center_shift_px>=1&&d.max_center_shift_px<=200))return false;
 return Array.isArray(d.masks)&&d.masks.length<=20&&d.masks.every(r=>['x','y','w','h'].every(k=>Number.isFinite(r[k]))&&r.x>=0&&r.y>=0&&r.w>0&&r.h>0&&r.x+r.w<=meta.width&&r.y+r.h<=meta.height);
}
function setupImageKind(){
 const direct=isDiffraction();syncSignalToggle();applyInspectorLayout();hideRegionPreview();document.body.classList.toggle('diffraction',direct);$('diffraction-controls').hidden=!direct;
 $('source-title').textContent=direct?'Diffraction detector':'Real space';$('inspector-title').textContent=direct?'Pattern analysis':'Selected region';
 $('source-caption').textContent=direct?'Diffraction space':'Real space';$('spectrum-title').textContent=direct?'Diffraction space':'FFT space';$('brightness-title').textContent=direct?'Brightness':'FFT brightness';
 $('fft-zoom-title').textContent=(direct?'Diffraction space':'FFT space')+' · nm⁻¹';
 $('fft').setAttribute('aria-label',direct?'Enlarge diffraction pattern with detected spots and crystal predictions':'Enlarge region FFT with measured peaks and candidate crystal predictions');
 $('overview').setAttribute('aria-label',direct?'Diffraction detector. Choose Set beam centre to click its position or draw exclusion rectangles for the beam stop.':'Image with movable region. Drag to move; drag the lower right handle to resize. Arrow keys move by 10 pixels; Shift moves by 50 pixels.');
 $('fft-curve').querySelector('option[value="log"]').textContent=direct?'Log intensity':'Log power';
 $('fft-curve').querySelector('option[value="linear"]').textContent=direct?'Linear intensity':'Linear amplitude';
 document.querySelector('.compact-display-note').textContent=direct?'Recorded detector intensity; no FFT. Display controls change brightness only. Centre, calibration and spot settings affect the analysis.':'Brightness controls affect the display only. FFT processing is set above; scaling moves prediction points.';
 $('detector-overlay').replaceChildren();diffractionSettings=null;$('diff-tool').value='view';hideCentreLoupe();$('centre-loupe-image').removeAttribute('href');
 if(direct){
  const c=meta.beam_center;
  diffractionSettings={center_x:c.x,center_y:c.y,pixel_x_nm_inv:meta.pixel_x_nm_inv,pixel_y_nm_inv:meta.pixel_y_nm_inv,exclude_radius_nm_inv:2.5,spot_sigma_px:2,spot_snr:9,refine_center:true,max_center_shift_px:50,masks:[]};
  const saved=withTranslationDefaults(readPreference(diffractionKey(),{}));if(validDiffraction(saved))diffractionSettings=saved;
  syncDetectorControls();
 }
}
function rememberDiffraction(){if(isDiffraction()&&validDiffraction(diffractionSettings))writePreference(diffractionKey(),diffractionSettings)}
function syncDetectorControls(){
 if(!isDiffraction()||!diffractionSettings)return;
 for(const [id,key]of Object.entries(DETECTOR_FIELDS))$(id).value=Number(diffractionSettings[key].toPrecision(9));
 $('diff-snr-slider').value=diffractionSettings.spot_snr;
 $('diff-radius').max=Number($('g-max').value)-.1;
 $('diff-refine-center').checked=diffractionSettings.refine_center;
 $('diff-refine-center').disabled=!config.diffraction_translation;
 $('diff-shift-limit').disabled=!config.diffraction_translation||!diffractionSettings.refine_center;
 $('diff-cx').max=meta.width-1;$('diff-cy').max=meta.height-1;
 const c=meta.beam_center;
 $('diffraction-note').textContent=(c.pairs?`Initial centre estimate: ${c.pairs} opposite-spot pairs; pair residual ${c.residual_px.toFixed(1)} px${c.beamstop_prior?'; beam-stop shadow used to choose the centre':''}. Verify visually. `:'No reliable opposite-spot centre found: set the beam centre manually. ')+`${diffractionSettings.masks.length} exclusion rectangle(s). Calibration and centre are remembered for this image. Save a named entry to keep a reusable analysis. Fitting band: ${diffractionSettings.exclude_radius_nm_inv}–${Number($('g-max').value)} nm⁻¹.`;
 $('diff-undo-mask').disabled=$('diff-clear-masks').disabled=!diffractionSettings.masks.length;drawDetector();renderTranslation();
}
function currentTranslation(){
 if(!isDiffraction()||!diffractionSettings||result?.image_kind!=='diffraction')return null;
 const d=result.settings.diffraction;
 if(!d||!Object.values(DETECTOR_FIELDS).every(k=>d[k]===diffractionSettings[k])||d.refine_center!==diffractionSettings.refine_center||JSON.stringify(d.masks)!==JSON.stringify(diffractionSettings.masks))return null;
 return result.spectrum.center_refinement;
}
function renderTranslation(){
 if(!isDiffraction()){$('diff-translation-note').textContent='';return}
 const note=$('diff-translation-note');
 if(!config.diffraction_translation){note.textContent='Restart TEM Workbench to enable translation refinement.';return}
 if(!diffractionSettings.refine_center){note.textContent='Fixed at the starting centre.';return}
 const r=currentTranslation();
 if(!r){note.textContent='Fitting a shared centre within '+diffractionSettings.max_center_shift_px+' px of the starting position…';return}
 if(!r.applied){note.textContent=r.reason;return}
 const sign=n=>(n>=0?'+':'')+n.toFixed(2),[x,y]=r.fitted_center_px,[dx,dy]=r.shift_px;
 note.textContent=`Fitted centre ${x.toFixed(2)}, ${y.toFixed(2)} px · shift X ${sign(dx)}, Y ${sign(dy)} px (Y down) · ${r.pair_count} opposite pairs · pair RMS ${r.rms_before_px.toFixed(2)} → ${r.rms_after_px.toFixed(2)} px.`+(r.near_limit?' Near the shift limit.':'')+' Shared by all structures; diffraction coordinates use this centre.';
}
function drawDetector(){
 const group=$('detector-overlay');group.replaceChildren();if(!isDiffraction()||!diffractionSettings)return;
 const translation=currentTranslation(),[cx,cy]=translation?.applied?translation.fitted_center_px:[diffractionSettings.center_x,diffractionSettings.center_y];
 const d={...diffractionSettings,center_x:cx,center_y:cy},cross=Math.max(meta.width,meta.height)*.014;
 if(translation?.applied&&Math.hypot(...translation.shift_px)>.25){
  const [x,y]=translation.starting_center_px,half=cross/2;
  const mark=el('path',{d:`M${x-half},${y}h${2*half}M${x},${y-half}v${2*half}M${x},${y}L${cx},${cy}`,fill:'none',stroke:'#94a5b8','stroke-width':1,'vector-effect':'non-scaling-stroke'});
  mark.append(el('title',{},'Starting centre → fitted centre'));group.append(mark);
 }
 group.append(el('ellipse',{cx:d.center_x,cy:d.center_y,rx:d.exclude_radius_nm_inv/d.pixel_x_nm_inv,ry:d.exclude_radius_nm_inv/d.pixel_y_nm_inv,class:'detector-centre','stroke-dasharray':'5 4'}));
 group.append(el('path',{d:`M${d.center_x-cross},${d.center_y}h${2*cross}M${d.center_x},${d.center_y-cross}v${2*cross}`,class:'detector-centre'}));
 for(const rect of [...d.masks,...(maskDrag?.rect?[maskDrag.rect]:[])])group.append(el('rect',{x:rect.x,y:rect.y,width:rect.w,height:rect.h,class:'detector-mask'}));
}
function drawDetectorExclusions(qp){
 const starting=result.settings.diffraction;if(!starting)return;
 const [cxPx,cyPx]=result.spectrum.beam_center_px||[starting.center_x,starting.center_y];
 const d={...starting,center_x:cxPx,center_y:cyPx};
 const overlay=$('fft-overlay'),extent=result.spectrum.extent,pixels=420/(extent[1]-extent[0]);
 for(const r of d.masks){
  const [left,top]=qp((r.x-d.center_x)*d.pixel_x_nm_inv,(d.center_y-r.y)*d.pixel_y_nm_inv);
  const [right,bottom]=qp((r.x+r.w-d.center_x)*d.pixel_x_nm_inv,(d.center_y-r.y-r.h)*d.pixel_y_nm_inv);
  const x=clamp(left,0,420),y=clamp(top,0,420),width=clamp(right,0,420)-x,height=clamp(bottom,0,420)-y;
  if(width>0&&height>0)overlay.append(el('rect',{x,y,width,height,fill:'#f4b75e','fill-opacity':.12,stroke:'#f4b75e','stroke-width':.6}));
 }
}
function commitDetector(delay=0){syncDetectorControls();rememberDiffraction();schedule(delay)}
$('diff-refine-center').onchange=()=>{if(!isDiffraction()||!config.diffraction_translation)return;diffractionSettings.refine_center=$('diff-refine-center').checked;commitDetector()};
for(const [id,key]of Object.entries(DETECTOR_FIELDS))$(id).onchange=()=>{
 if(!isDiffraction())return;
 const updated={...diffractionSettings,[key]:$(id).value===''?NaN:Number($(id).value)};
 if(!validDiffraction(updated)){message('Enter a valid detector centre, positive calibration, exclusion radius from 0 up to the outer fitting limit, smoothing 0.5–10 px, contrast 2–30 and shift limit 1–200 px.',true);syncDetectorControls();return}
 diffractionSettings=updated;commitDetector();
};
$('diff-snr-slider').oninput=()=>{
 if(!isDiffraction())return;
 const updated={...diffractionSettings,spot_snr:Number($('diff-snr-slider').value)};
 if(!validDiffraction(updated))return;
 diffractionSettings=updated;commitDetector(120);
};
$('diff-estimate').onclick=()=>{if(!isDiffraction())return;diffractionSettings.center_x=meta.beam_center.x;diffractionSettings.center_y=meta.beam_center.y;commitDetector()};
$('diff-calibration-reset').onclick=()=>{if(!isDiffraction())return;diffractionSettings.pixel_x_nm_inv=meta.pixel_x_nm_inv;diffractionSettings.pixel_y_nm_inv=meta.pixel_y_nm_inv;commitDetector()};
$('diff-undo-mask').onclick=()=>{if(isDiffraction()){diffractionSettings.masks.pop();commitDetector()}};
$('diff-clear-masks').onclick=()=>{if(isDiffraction()){diffractionSettings.masks=[];commitDetector()}};
function hideCentreLoupe(){$('centre-loupe').hidden=true}
function prepareCentreLoupe(){
 if(!isDiffraction())return;
 const img=$('centre-loupe-image');img.setAttribute('width',meta.width);img.setAttribute('height',meta.height);
 img.setAttribute('href','/api/preview?id='+encodeURIComponent(fileId)+'&native=1');
}
function moveCentreLoupe(p){
 if(!isDiffraction()||$('diff-tool').value!=='center'){hideCentreLoupe();return}
 if(p.x<0||p.y<0||p.x>=meta.width||p.y>=meta.height){hideCentreLoupe();return}
 const x=p.x,y=p.y,loupe=$('centre-loupe');
 if(!$('centre-loupe-image').getAttribute('href'))prepareCentreLoupe();
 loupe.hidden=false;loupe.classList.toggle('to-left',x>meta.width/2);loupe.classList.toggle('to-top',y>meta.height/2);
 $('centre-loupe-view').setAttribute('viewBox',`${x-64} ${y-64} 128 128`);
 $('centre-loupe-cross').setAttribute('d',`M${x-56},${y}h53M${x+3},${y}h53M${x},${y-56}v53M${x},${y+3}v53`);
 $('centre-loupe-coords').textContent=`${x.toFixed(1)}, ${y.toFixed(1)} px`;
}
$('diff-tool').onchange=()=>{maskDrag=null;hideCentreLoupe();drawDetector();if($('diff-tool').value==='center')prepareCentreLoupe()};
$('overview').addEventListener('pointerleave',hideCentreLoupe);
$('overview').addEventListener('keydown',e=>{if(e.key==='Escape'&&isDiffraction()){$('diff-tool').value='view';maskDrag=null;hideCentreLoupe();drawDetector()}});
function detectorPointerDown(e){
 const tool=$('diff-tool').value;if(tool==='view')return;e.preventDefault();
 const p=point(e),x=clamp(p.x,0,meta.width-1),y=clamp(p.y,0,meta.height-1);
 if(tool==='center'){diffractionSettings.center_x=x;diffractionSettings.center_y=y;commitDetector();return}
 if(diffractionSettings.masks.length>=20){message('Use up to 20 exclusions. Undo or clear an existing one first.',true);return}
 maskDrag={x,y,rect:null};$('overview').setPointerCapture(e.pointerId);
}
function detectorPointerMove(e){
 const p=point(e);moveCentreLoupe(p);if(!maskDrag)return;const x=clamp(p.x,0,meta.width),y=clamp(p.y,0,meta.height);
 maskDrag.rect={x:Math.min(maskDrag.x,x),y:Math.min(maskDrag.y,y),w:Math.abs(x-maskDrag.x),h:Math.abs(y-maskDrag.y)};drawDetector();
}
function detectorPointerEnd(e){
 if(!maskDrag)return;
 const rect=maskDrag.rect;maskDrag=null;
 if(e.type!=='pointercancel'&&rect&&rect.w>=2&&rect.h>=2){diffractionSettings.masks.push(rect);commitDetector()}else drawDetector();
}

restoreBasicControls();
for(const id of [...Object.keys(BASIC_NUMBERS),...BASIC_FLAGS,'overlay']){
 $(id).addEventListener('input',rememberBasicControls);
 $(id).addEventListener('change',rememberBasicControls);
}
// Display-only layout, cursor previews and delayed analysis feedback.
let spectrumLoadingTimer=null, spectrumLoading=false, spectrumExportBusy=false;
let hoverTimer=null, hoverKey=null, hoverVersion=0, hoverController=null, hoverPointer={x:0,y:0};
const hoverCache=new Map();
function syncSpectrumExportControls(){
 syncMapExportControls();
 for(const id of ['export-png','export-gif']){$(id).disabled=spectrumExportBusy||mapExportBusy||busy||pending||!result||!fftRaw||!config?.spectrum_exports;$(id).title=config?.spectrum_exports?'Save the current view to the output folder':'Restart TEM Workbench to enable image exports'}
}
function setSpectrumSpinner(show){for(const id of ['fft-loading','fft-zoom-loading'])$(id).hidden=!show}
function beginSpectrumLoading(){
 hideSpectrumHover();
 if(spectrumLoading)return;spectrumLoading=true;$('fft-stage').setAttribute('aria-busy','true');
 spectrumLoadingTimer=setTimeout(()=>{spectrumLoadingTimer=null;if(spectrumLoading)setSpectrumSpinner(true)},1000);
}
function finishSpectrumLoading(){spectrumLoading=false;clearTimeout(spectrumLoadingTimer);spectrumLoadingTimer=null;setSpectrumSpinner(false);$('fft-stage').setAttribute('aria-busy','false')}
function syncLargeSpectrumSize(){
 const {width,height}=$('overview').getBoundingClientRect();
 const size=Math.min(width,height);
 if(size>0)document.querySelector('.previews').style.setProperty('--reference-preview-size',`${size}px`);
}
function applyInspectorLayout(){
 document.body.classList.toggle('fft-only',!isDiffraction()&&inspectorLayout==='fft');
 $('inspector-layout-control').hidden=isDiffraction();
 $('view-real-fft').setAttribute('aria-pressed',String(inspectorLayout==='paired'));
 $('view-fft-only').setAttribute('aria-pressed',String(inspectorLayout==='fft'));
 syncLargeSpectrumSize();
}
if(typeof ResizeObserver!=='undefined')new ResizeObserver(syncLargeSpectrumSize).observe($('overview'));
else window.addEventListener('resize',syncLargeSpectrumSize);
let inspectorLayout=readPreference('tem-inspector-layout','paired')==='fft'?'fft':'paired';
for(const [id,layout]of [['view-real-fft','paired'],['view-fft-only','fft']])$(id).onclick=()=>{
 inspectorLayout=layout;writePreference('tem-inspector-layout',layout);applyInspectorLayout();
};
function hideRegionPreview(){clearTimeout(hoverTimer);hoverTimer=null;hoverKey=null;hoverVersion++;hoverController?.abort();hoverController=null;$('region-hover').hidden=true}
function regionContains(r,p){return p.x>=r.x&&p.x<r.x+r.w&&p.y>=r.y&&p.y<r.y+r.h}
function previewKey(r,values){
 const ordered=Object.keys(values).sort().map(k=>[k,values[k]]);
 return JSON.stringify([fileId,meta.sha256_pixels,meta.pixel_x_nm,meta.pixel_y_nm,config.engine,...['x','y','w','h'].map(k=>r[k]),ordered]);
}
function analysisPreview(data){
 return {roi:data.roi,settings:data.settings,label:data.classification.label,
  models:Object.fromEntries(PHASES.map(phase=>[phase,bestModel(data,phase)])),
  crop:data.images.crop,images:data.images,extent:data.spectrum.extent};
}
function cacheRegionPreview(key,preview){
 hoverCache.delete(key);hoverCache.set(key,preview);
 // Only the recent encoded previews are retained; no project/backup files.
 while(hoverCache.size>24)hoverCache.delete(hoverCache.keys().next().value);
}
function computedRegionAt(p,savedId){
 if(!meta||isDiffraction()||drag||busy||pending||isGridRunning()||$('run-grid').disabled||rescoreBusy||rescorePending)return null;
 if(savedId){
  const saved=regionProject.regions.find(r=>r.id===savedId);
  const identity=['sha256_pixels','width','height','pixel_x_nm','pixel_y_nm'];
  if(!saved||identity.some(k=>saved.source[k]!==meta[k]))return null;
  return {roi:{...saved.roi},settings:{...saved.settings},name:saved.name,saved:true,models:{}};
 }
 if(result&&result.image_kind!=='diffraction'&&['x','y','w','h'].every(k=>result.roi[k]===roi[k])&&regionContains(roi,p))return analysisPreview(result);
 if(grid&&($('show-grid').checked||$('show-zones').checked&&!$('show-zones').disabled)){
  const cell=grid.regions.find(r=>r.leaf&&regionContains(r.roi,p));
  if(cell)return {roi:cell.roi,settings:{...grid.settings},label:cell.label,models:cell.best_zones||{}};
 }
 return null;
}
function renderRegionPreviewDetails(region){
 const heading=$('region-hover-title');heading.textContent=labels[region.label]||(region.saved?'Saved region':'Computed region');heading.style.color=colors[region.label]||'#dce6ef';
 const name=$('region-hover-name');name.textContent=region.name||'';name.hidden=!region.name;
 const rows=$('region-hover-models');rows.replaceChildren();
 if(!region.label){rows.textContent='Loading saved analysis…';return}
 const candidates=analysisPhases(region.settings).map(phase=>({phase,model:region.models[phase]}));
 candidates.sort((a,b)=>Number(Boolean(b.model?.valid))-Number(Boolean(a.model?.valid))||compareRank(a.model,b.model));
 for(const {phase,model}of candidates){
  const row=document.createElement('div'),name=document.createElement('span'),rank=document.createElement('span'),status=document.createElement('span');
  name.textContent=phase+(model?' '+zoneLabel(model):'');name.style.color=phaseColors[phase];
  rank.textContent=Number.isFinite(model?.score)?'Rank '+model.score.toFixed(3):'—';rank.className='preview-rank';
  status.textContent=model?(model.valid?'Pass':'Below threshold'):'No fit';status.className='muted';
  row.append(name,rank,status);rows.append(row);
 }
}
function positionRegionPreview(x,y){
 const box=$('region-hover'),bounds=box.getBoundingClientRect(),gap=18;
 let left=x+gap,top=y+gap;if(left+bounds.width>window.innerWidth-8)left=x-bounds.width-gap;if(top+bounds.height>window.innerHeight-8)top=y-bounds.height-gap;
 box.style.left=Math.max(8,left)+'px';box.style.top=Math.max(8,top)+'px';
}
function setRegionPreviewImage(region,src,cropped){
 const r=region.roi,img=$('region-hover-image');
 $('region-hover-view').setAttribute('viewBox',cropped?`0 0 ${r.w} ${r.h}`:`${r.x} ${r.y} ${r.w} ${r.h}`);
 img.setAttribute('width',cropped?r.w:meta.width);img.setAttribute('height',cropped?r.h:meta.height);img.setAttribute('href',src);
}
async function setRegionPreviewFFT(region,version){
 const raw=await decodeSpectrumImage(region.images);if(version!==hoverVersion)return;
 $('region-hover-fft-image').setAttribute('href',colourSpectrum(raw,'real_space'));
 const axes=$('region-hover-fft-axes'),ex=region.extent;axes.replaceChildren();
 for(const q of spectrumTicks(ex)){
  if(q>=ex[0]&&q<=ex[1])axes.append(el('text',{x:(q-ex[0])/(ex[1]-ex[0])*420,y:437,'text-anchor':'middle'},q));
  if(q>=ex[2]&&q<=ex[3])axes.append(el('text',{x:-7,y:(ex[3]-q)/(ex[3]-ex[2])*420+4,'text-anchor':'end'},q));
 }
 $('region-hover-fft-status').hidden=true;
}
function hoverComputedRegion(event){
 if(event.pointerType==='touch'||event.buttons){hideRegionPreview();return}
 hoverPointer={x:event.clientX,y:event.clientY};
 const savedId=event.target?.closest('.saved-region-overlay')?.dataset.regionId;
 const region=computedRegionAt(point(event),savedId);if(!region){hideRegionPreview();return}
 const key=previewKey(region.roi,region.settings),cardKey=key+':'+(savedId||'');
 if(cardKey===hoverKey){positionRegionPreview(event.clientX,event.clientY);return}
 hideRegionPreview();hoverKey=cardKey;const version=hoverVersion,source=fileId;
 hoverTimer=setTimeout(async()=>{
  hoverTimer=null;if(version!==hoverVersion)return;
  const cached=region.images?region:hoverCache.get(key),preview={...region,...cached};
  const r=region.roi;renderRegionPreviewDetails(preview);
  $('region-hover-size').textContent=`${(r.w*meta.pixel_x_nm).toFixed(2)} × ${(r.h*meta.pixel_y_nm).toFixed(2)} nm · ${r.w} × ${r.h} px`+(region.saved?' · Saved settings':'');
  setRegionPreviewImage(preview,preview.crop||$('source-image').getAttribute('href'),Boolean(preview.crop));
  $('region-hover-fft-image').removeAttribute('href');$('region-hover-fft-axes').replaceChildren();
  const status=$('region-hover-fft-status');status.textContent='Loading FFT…';status.hidden=false;
  $('region-hover').hidden=false;positionRegionPreview(hoverPointer.x,hoverPointer.y);
  try{
   if(cached){await setRegionPreviewFFT(preview,version);return}
   hoverController=new AbortController();
   const data=await api('analyze',{file_id:source,roi:r,settings:region.settings},hoverController.signal);
   if(version!==hoverVersion)return;
   const detail=analysisPreview(data);cacheRegionPreview(key,detail);
   const completed={...region,...detail};renderRegionPreviewDetails(completed);setRegionPreviewImage(completed,detail.crop,true);
   await setRegionPreviewFFT(completed,version);
   if(version===hoverVersion)positionRegionPreview(hoverPointer.x,hoverPointer.y);
  }catch(error){
   if(version!==hoverVersion)return;
   status.textContent='FFT preview unavailable';status.hidden=false;
   if(region.saved&&!cached)$('region-hover-models').textContent='Analysis unavailable; click the outline to reopen.';
  }
 },180);
}
$('overview').addEventListener('pointerleave',hideRegionPreview);
document.addEventListener('scroll',hideRegionPreview,true);
window.addEventListener('resize',hideRegionPreview);
document.addEventListener('keydown',event=>{if(event.key==='Escape')hideRegionPreview()});

// PNG freezes exact marker positions; GIF renders one cycle of the chosen motion.
function markerMotionAt(mode,phase){
 phase=((phase%1)+1)%1;
 if(mode==='pulse')return {scale:1,x:0,y:0,opacity:.675+.325*Math.cos(phase*Math.PI*2)};
 if(!['bounce','wobble'].includes(mode))return {scale:1,x:0,y:0,opacity:1};
 const stops=[[1.35,0,0],[1.1,1,-1],[.85,0,1],[1.1,-1,-.5],[1.35,0,0]],i=Math.floor(phase*4),f=phase*4-i,t=f*f*(3-2*f),a=stops[i],b=stops[i+1];
 return {scale:a[0]+(b[0]-a[0])*t,x:mode==='wobble'?a[1]+(b[1]-a[1])*t:0,y:mode==='wobble'?a[2]+(b[2]-a[2])*t:0,opacity:1};
}
function spectrumSnapshot(){
 const svg=$('fft').cloneNode(true),markers=[...$('fft').querySelectorAll('.spectrum-marker')].map(m=>{const b=m.getBBox();return {x:b.x+b.width/2,y:b.y+b.height/2,offset:Number(m.getAttribute('data-motion-offset'))||0}});
 svg.setAttribute('font-family','Arial, sans-serif');
 for(const node of [svg,...svg.querySelectorAll('[id]')])node.removeAttribute('id');
 for(const attribute of ['tabindex','role','aria-controls','aria-haspopup','aria-label'])svg.removeAttribute(attribute);
 svg.insertBefore(el('rect',{x:-28,y:-12,width:464,height:452,fill:'#05090e'}),svg.firstChild);
 for(const img of svg.querySelectorAll('image'))img.setAttribute('style','image-rendering:pixelated');
 return {svg,markers};
}
function spectrumFrameSVG(snapshot,width,mode,phase){
 const svg=snapshot.svg.cloneNode(true);svg.setAttribute('width',width);svg.setAttribute('height',Math.round(width*452/464));
 [...svg.querySelectorAll('.spectrum-marker')].forEach((marker,i)=>{
  const centre=snapshot.markers[i],motion=markerMotionAt(mode,phase+centre.offset);
  marker.removeAttribute('class');marker.setAttribute('transform',`translate(${motion.x} ${motion.y}) translate(${centre.x} ${centre.y}) scale(${motion.scale}) translate(${-centre.x} ${-centre.y})`);
  marker.setAttribute('stroke-opacity',motion.opacity);marker.setAttribute('fill-opacity',motion.opacity);
 });
 return new XMLSerializer().serializeToString(svg);
}
async function renderSpectrumFrame(snapshot,width,mode,phase){
 const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(spectrumFrameSVG(snapshot,width,mode,phase));await image.decode();
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=Math.round(width*452/464);canvas.getContext('2d').drawImage(image,0,0);return canvas.toDataURL('image/png');
}
async function exportSpectrum(format){
 if(!result||!fftRaw||spectrumExportBusy||mapExportBusy||pending||busy)return;
 if(!config?.spectrum_exports){message('Restart TEM Workbench to enable PNG and GIF exports.',true);return}
 const mode=format==='gif'?$('marker-motion').value:'off',cycleMs=mode==='pulse'?1800:1200,count=mode==='off'?1:Math.round(cycleMs*30/1000);
 if(count>1&&config.spectrum_export_fps!==30){message('Restart TEM Workbench, then reload the page to enable 30 fps GIF exports.',true);return}
 // GIF delays have 10 ms precision. Rounded frame boundaries alternate
 // 30/40 ms delays for 30 fps on average without changing the cycle length.
 const durations=Array.from({length:count},(_,i)=>10*(Math.round((i+1)*cycleMs/count/10)-Math.round(i*cycleMs/count/10)));
 spectrumExportBusy=true;syncSpectrumExportControls();const buttonId='export-'+format;beginExport(buttonId,'Exporting '+format.toUpperCase()+'…');
 const body={file_id:fileId,image_kind:result.image_kind,format,frames:[],duration_ms:count>1?durations:60};
 try{
  const snapshot=spectrumSnapshot();
  for(let i=0;i<count;i++){$(buttonId).textContent=`Exporting ${i+1}/${count}`;exportNotice('Exporting '+format.toUpperCase()+'…',`Preparing frame ${i+1} of ${count}`);body.frames.push(await renderSpectrumFrame(snapshot,2800,mode,i/count));await new Promise(resolve=>setTimeout(resolve,0))}
  exportNotice('Saving '+format.toUpperCase()+'…','Writing to the output folder');const saved=await api('export-spectrum',body);finishExport(buttonId,saved.path);
 }catch(error){finishExport(buttonId,null,'Image export failed: '+error.message)}finally{spectrumExportBusy=false;syncSpectrumExportControls()}
}
$('export-png').onclick=()=>exportSpectrum('png');$('export-gif').onclick=()=>exportSpectrum('gif');

function syncMapExportControls(){
 const button=$('export-map'),mismatch=grid&&((grid.settings.scale_mode!=='fixed'&&scalePenalty!==grid.settings.scale_penalty_strength)||peakEvidenceWeight!==grid.settings.peak_evidence_weight);
 button.disabled=!config?.map_exports||!meta||isDiffraction()||grid?.state!=='complete'||Boolean(grid?.error)||grid?.source?.sha256_pixels!==meta?.sha256_pixels||rescoreBusy||rescorePending||mismatch||mapExportBusy||spectrumExportBusy;
 button.title=!config?.map_exports?'Restart TEM Workbench, then reload to enable map exports':button.disabled?'Complete a grid and finish reweighting before exporting':'Save the visible map, colours and zone legend as PNG';
}
function blobDataURL(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read the image.'));reader.readAsDataURL(blob)})}
function mapSnapshot(){
 const original=$('overview'),copy=original.cloneNode(true),nodes=[original,...original.querySelectorAll('*')],copies=[copy,...copy.querySelectorAll('*')];
 const properties=['fill','fill-opacity','stroke','stroke-width','stroke-opacity','stroke-dasharray','stroke-linejoin','opacity','vector-effect','paint-order','font-family','font-size','font-weight','text-anchor','dominant-baseline'];
 nodes.forEach((node,i)=>{const style=getComputedStyle(node);for(const property of properties)copies[i].setAttribute(property,style.getPropertyValue(property))});
 for(const node of copy.querySelectorAll('#roi-box,#roi-handle,#detector-overlay,title'))node.remove();
 const source=copy.querySelector('#source-image');
 for(const node of [copy,...copy.querySelectorAll('*')])for(const attribute of ['id','class','style','role','tabindex'])node.removeAttribute(attribute);
 copy.setAttribute('x',20);copy.setAttribute('y',78);copy.setAttribute('width',1160);copy.setAttribute('height',1160);
 const svg=el('svg',{xmlns:NS,width:1200,'font-family':'Arial, sans-serif'});
 svg.append(el('rect',{x:0,y:0,width:1200,height:'100%',fill:'#0c121a'}));
 svg.append(el('text',{x:20,y:28,fill:'#dce6ef','font-size':20,'font-weight':600},meta.name));
 svg.append(el('text',{x:20,y:52,fill:'#94a5b8','font-size':13},`${(meta.width*meta.pixel_x_nm).toFixed(2)} × ${(meta.height*meta.pixel_y_nm).toFixed(2)} nm · ${grid.regions.filter(r=>r.leaf).length} regions · overlay ${$('grid-opacity').value}%`),copy);
 const measure=document.createElement('canvas').getContext('2d');measure.font='14px Arial';let y=1267,x=20;
 const legendItem=(text,color)=>{const width=measure.measureText(text).width+27;if(x+width>1180){x=20;y+=25}svg.append(el('text',{x,y,fill:color,'font-size':14},text));x+=width};
 if(!$('class-legend').hidden)for(const node of $('class-legend').children)if(!node.hidden)legendItem('● '+node.textContent,colors[node.dataset.label]);
 if(x!==20){x=20;y+=28}
 if(!$('zone-legend').hidden)for(const group of $('zone-legend').querySelectorAll('.zone-legend-group')){
  const phase=group.querySelector('strong').textContent;legendItem(phase,phaseColors[phase]);
  for(const node of group.querySelectorAll('.zone-key'))legendItem([...node.childNodes].map(n=>n.textContent).join(' '),phaseColors[phase]);
  x=20;y+=28;
 }
 svg.append(el('text',{x:20,y:y+4,fill:'#94a5b8','font-size':12},'Candidate map, not confirmed phase fractions. Faded zone symbols are below threshold.'));
 const height=y+28;svg.setAttribute('viewBox',`0 0 1200 ${height}`);svg.setAttribute('height',height);
 return {svg,source,height,file_id:fileId};
}
async function exportMap(){
 if($('export-map').disabled)return;
 mapExportBusy=true;syncSpectrumExportControls();beginExport('export-map','Exporting map PNG…');
 try{
  const snapshot=mapSnapshot();
  const response=await fetch(snapshot.source.getAttribute('href'));if(!response.ok)throw new Error('Source preview unavailable.');
  snapshot.source.setAttribute('href',await blobDataURL(await response.blob()));
  const width=Math.min(2800,Math.floor(3200*1200/snapshot.height)),height=Math.round(width*snapshot.height/1200);
  snapshot.svg.setAttribute('width',width);snapshot.svg.setAttribute('height',height);
  const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(snapshot.svg));await image.decode();
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').drawImage(image,0,0);
  exportNotice('Saving map PNG…','Writing to the output folder');
  const data=await api('export-spectrum',{file_id:snapshot.file_id,image_kind:'real_space_map',format:'png',frames:[canvas.toDataURL('image/png')]});finishExport('export-map',data.path);
 }catch(error){finishExport('export-map',null,'Map export failed: '+error.message)}
 finally{mapExportBusy=false;syncSpectrumExportControls()}
}
$('export-map').onclick=exportMap;

function matchedReflectionVectors(model){
 const selected=[];
 for(const match of (model.matches||[]).filter(m=>m.observed_q&&m.hkl).sort((a,b)=>Math.hypot(...a.observed_q)-Math.hypot(...b.observed_q))){
  const sign=match.observed_q[1]<0||(match.observed_q[1]===0&&match.observed_q[0]<0)?-1:1,q=match.observed_q.map(v=>sign*v),g=Math.hypot(...q);
  if(!g||selected.some(s=>Math.abs(s.q[0]*q[1]-s.q[1]*q[0])/(s.g*g)<.15))continue;
  const indexSign=match.predicted_q&&match.observed_q[0]*match.predicted_q[0]+match.observed_q[1]*match.predicted_q[1]<0?-sign:sign;
  selected.push({q,g,hkl:match.hkl,sign:indexSign});if(selected.length===2)break;
 }
 return selected;
}
function fittedReferenceVectors(model){
 const strong=new Set((model.matches||[]).map(m=>m.node_index)),weak=new Set((model.peak_evidence?.nodes||[]).filter(n=>n.status==='weak').map(n=>n.node_index));
 const nodes=(model.predicted_nodes||[]).map((node,i)=>({...node,i,g:Math.hypot(...node.q)})).filter(n=>n.g>0).sort((a,b)=>a.g-b.g);
 const vector=(node,sign=1)=>({q:node.q.map(v=>v*sign),g:node.g,hkl:node.hkl,sign});
 let best=null,bestScore=-Infinity;
 // Select a short, well-supported closed trio from the already fitted lattice.
 // These illustrate the fit; they do not replace its all-peak comparison.
 for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
  const a=nodes[i],b=nodes[j];if(Math.abs(a.q[0]*b.q[1]-a.q[1]*b.q[0])/(a.g*b.g)<.25)continue;
  for(const sign of [1,-1]){
   const sum=a.q.map((v,k)=>v+sign*b.q[k]);
   for(const c of nodes){if(c.i===a.i||c.i===b.i)continue;
    const cSign=sum[0]*c.q[0]+sum[1]*c.q[1]<0?-1:1;
    if(Math.hypot(sum[0]-cSign*c.q[0],sum[1]-cSign*c.q[1])>1e-4)continue;
    const score=[a,b,c].reduce((s,n)=>s+(strong.has(n.i)?100:weak.has(n.i)?10:0),0)-a.g-b.g-c.g;
    if(score>bestScore){bestScore=score;best=[{...vector(a),coefficient:1},{...vector(b,sign),coefficient:1},{...vector(c,cSign),coefficient:-1}]}
   }
  }
 }
 if(!best){
  best=[];
  for(const node of [...nodes].sort((a,b)=>Number(strong.has(b.i))-Number(strong.has(a.i))||a.g-b.g)){
   if(best.some(v=>Math.abs(v.q[0]*node.q[1]-v.q[1]*node.q[0])/(v.g*node.g)<.25))continue;
   best.push(vector(node));if(best.length===2)break;
  }
 }
 best.sort((a,b)=>b.g-a.g);
 let letter=0,length=best[0]?.g;
 return best.map(v=>{
  // Share letters only for equal fitted lengths, allowing numerical roundoff.
  if(Math.abs(v.g-length)>1e-6*Math.max(1,length)){letter++;length=v.g}
  return {...v,name:'ABC'[letter]};
 });
}
function fittedVectorSummary(vectors){
 const [a,b]=vectors;
 const angle=b?Math.acos(clamp((a.q[0]*b.q[0]+a.q[1]*b.q[1])/(a.g*b.g),-1,1))*180/Math.PI:null;
 const angleLabel=angle===null?'One direction':`∠${a.name}${b.name} ${angle.toFixed(1)}°`;
 if(vectors.length!==3)return angleLabel+' · no closed trio';
 // Repeated letters describe equal lengths, so avoid an ambiguous A = A + B equation.
 if(new Set(vectors.map(v=>v.name)).size<3)return angleLabel+' · '+vectors.map(v=>v.name).join('/');
 // Reordering lengths must also reorder the signed vector equation.
 const terms=vectors.slice(1).map(v=>({name:v.name,sign:-v.coefficient/a.coefficient})).sort((x,y)=>y.sign-x.sign);
 return `${angleLabel} · ${a.name} = ${terms[0].sign<0?'− ':''}${terms[0].name} ${terms[1].sign<0?'−':'+'} ${terms[1].name}`;
}
function vectorLabelText(value,attrs){
 const text=el('text',attrs);
 // SVG combining marks can drift onto adjacent indices with font fallback.
 // Decorate each negative index itself, keeping brackets and spaces unbarred.
 for(const part of value.split(/((?:\d\u0305)+)/)){
  if(!part)continue;
  text.append(part.includes('\u0305')
   ?el('tspan',{'text-decoration':'overline'},part.replaceAll('\u0305',''))
   :document.createTextNode(part));
 }
 if(value.includes('\u0305'))text.setAttribute('aria-label',value);
 return text;
}
function addVectorLabel(parent,attrs,lines,height,opacity){
 const group=el('g',{'font-family':'Arial, sans-serif',...attrs});
 const background=el('rect',{width:1,height,rx:2,fill:'#05090e',opacity});
 const text=lines.map(([value,size,y,fill])=>vectorLabelText(value,{x:5,y,fill,'font-size':size}));
 group.append(background,...text);parent.append(group);
 // Measure attached SVG text so boxes and collision checks use the drawn width.
 const width=Math.ceil(Math.max(...text.map(node=>node.getComputedTextLength())))+10;
 background.setAttribute('width',width);
 return {group,w:width,h:height};
}
function vectorLabelPosition(x,y,w,h,occupied,anchors){
 const candidates=[[x+10,y-h-8],[x+10,y+8],[x-w-10,y-h-8],[x-w-10,y+8],
  [x-w/2,y-h-12],[x-w/2,y+12],[x-w-12,y-h/2],[x+12,y-h/2]];
 for(let ly=5;ly<=415-h;ly+=12)for(let lx=5;lx<=415-w;lx+=12)candidates.push([lx,ly]);
 const overlap=(a,b,pad)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w+pad)-Math.max(a.x,b.x-pad))*Math.max(0,Math.min(a.y+a.h,b.y+b.h+pad)-Math.max(a.y,b.y-pad));
 let chosen=null,best=Infinity;
 for(const [lx,ly]of candidates){
  const p={x:clamp(lx,5,415-w),y:clamp(ly,5,415-h),w,h};
  const dx=x-clamp(x,p.x,p.x+w),dy=y-clamp(y,p.y,p.y+h);
  const score=occupied.reduce((sum,box)=>sum+overlap(p,box,4),0)*10000+
   anchors.reduce((sum,box)=>sum+overlap(p,box,2),0)*20+dx*dx+dy*dy+
   .03*((x-p.x-w/2)**2+(y-p.y-h/2)**2);
  if(score<best){best=score;chosen=p}
 }
 occupied.push(chosen);return chosen;
}
function drawReflectionVectors(qp){
 const mode=$('reflection-vectors').value,fitted=mode.startsWith('fitted_'),choice=fitted?mode.slice(7):mode;
 const models=overlayModels(result,choice),occupied=[],groups=[];
 for(const [phaseNumber,model]of models.entries()){
  const phase=model.phase;
  const vectors=fitted?fittedReferenceVectors(model):matchedReflectionVectors(model);if(!vectors.length)continue;
  if(fitted){
   const label=addVectorLabel($('fft-overlay'),{'data-vector-key':phase},[
    [phase+' '+zoneLabel(model),10,12,phaseColors[phase]],
    [fittedVectorSummary(vectors),9,26,'#dce6ef']
   ],33,.92);
   const lx=models.length===2&&phaseNumber===1?415-label.w:5,ly=models.length>2?382-37*phaseNumber:382;
   label.group.setAttribute('transform',`translate(${lx} ${ly})`);
   occupied.push({x:lx,y:ly,w:label.w,h:label.h});
  }
  groups.push({phase,model,vectors});
 }
 const points=[[0,0],...groups.flatMap(entry=>entry.vectors.map(v=>v.q)),
  ...(result.spectrum?.peaks||[]).flatMap(p=>p.observed_spots||[[p.qx,p.qy],[-p.qx,-p.qy]])];
 const anchors=points.map(q=>{const [x,y]=qp(...q);return {x:x-8,y:y-8,w:16,h:16}});
 for(const {phase,model,vectors}of groups){
  for(const {q,g,sign,hkl,name}of vectors){
   const [ox,oy]=qp(0,0),[x,y]=qp(...q),dx=x-ox,dy=y-oy,length=Math.hypot(dx,dy),ux=dx/length,uy=dy/length,color=phaseColors[phase];
   const group=el('g',{'data-reflection-vector':phase});
   const line=el('path',{d:`M${ox} ${oy}L${x} ${y}M${x-7*ux+3*uy} ${y-7*uy-3*ux}L${x} ${y}L${x-7*ux-3*uy} ${y-7*uy+3*ux}`,stroke:color,'stroke-width':1.2,fill:'none'});
   if(!model.valid)line.setAttribute('stroke-dasharray','4 3');group.append(line);$('fft-overlay').append(group);
   const label=addVectorLabel(group,{'data-vector-label':phase},[
    [fitted?`${name} · ${phase}`:phase+' '+planeLabel(model,hkl,sign),9.5,11,color],
    [`g ${g.toFixed(3)} nm⁻¹ · d ${(1/g).toFixed(4)} nm`,9,23,'#edf5fc']
   ],29,.88);
   const {x:lx,y:ly}=vectorLabelPosition(x,y,label.w,label.h,occupied,anchors);
   label.group.setAttribute('transform',`translate(${lx} ${ly})`);
   const edgeX=clamp(x,lx,lx+label.w),edgeY=clamp(y,ly,ly+label.h),distance=Math.hypot(edgeX-x,edgeY-y);
   if(distance>12){
    const lead=el('path',{d:`M${x+8*(edgeX-x)/distance} ${y+8*(edgeY-y)/distance}L${edgeX} ${edgeY}`,stroke:color,'stroke-width':.7,'stroke-dasharray':'2 2',opacity:.7,fill:'none','data-vector-leader':phase});
    group.insertBefore(lead,label.group);
   }
   group.append(el('title',{},fitted?`${name}: ${planeLabel(model,hkl,sign)} from the fitted prediction lattice. Letters run from longest to shortest reciprocal length; equal lengths share a letter. These are not unit-cell edges or a separate phase test.`:'Measured reciprocal distance and plane spacing, indexed by this candidate fit. Opposite observations count as one profile.'));
  }
 }
}
const VECTOR_MODES=['off','fitted_winner','fitted_winner_any','fitted_HCP','fitted_BCC','fitted_FCC','fitted_both','fitted_all','winner','winner_any',...PHASES,'both','all'];
const savedVectors=readPreference('tem-reflection-vectors','off');
syncOverlayMenus($('overlay').value,VECTOR_MODES.includes(savedVectors)?savedVectors:'off');
$('reflection-vectors').onchange=()=>{writePreference('tem-reflection-vectors',$('reflection-vectors').value);drawFFT()};

start();

let demoDownloadTimer=null;
function renderDemoDownload(job){
 const running=job?.state==='running';
 $('download-demo-pack').disabled=!config?.demo_download||running;
 $('cancel-demo-pack').hidden=!running;
 if(job&&job.state!=='idle')$('demo-pack-status').textContent=(job.message||'Downloading…')+(running?` · ${(job.bytes/1048576).toFixed(1)}${job.total?' / '+(job.total/1048576).toFixed(1):''} MB`:'');
}
async function pollDemoDownload(){
 clearTimeout(demoDownloadTimer);
 try{
  const job=await api('demo-pack');renderDemoDownload(job);
  if(job.state==='running')demoDownloadTimer=setTimeout(pollDemoDownload,750);
  else if(job.state==='complete'){
   const updated=await api('config');config.files=updated.files;renderFileList();renderFavorites();
   if(!meta&&config.files.length){$('file').value=config.files[0].id;await openFile()}
  }
 }catch(e){$('demo-pack-status').textContent=e.message;$('download-demo-pack').disabled=false}
}
$('download-demo-pack').onclick=async()=>{
 $('download-demo-pack').disabled=true;
 try{renderDemoDownload(await api('demo-pack',{url:$('demo-pack-url').value}));writePreference('tem-demo-pack-url',$('demo-pack-url').value);pollDemoDownload()}
 catch(e){$('demo-pack-status').textContent=e.message;$('download-demo-pack').disabled=false}
};
$('cancel-demo-pack').onclick=async()=>{try{await api('demo-pack/cancel',{})}catch(e){$('demo-pack-status').textContent=e.message}};

function offerDemoDownload(){
 if(demoPromptShown||!config?.demo_download||config.files.length||config.demo_job?.state==='running')return;
 demoPromptShown=true;
 $('demo-download-prompt').showModal();
}
$('demo-prompt-later').onclick=()=>$('demo-download-prompt').close();
$('demo-prompt-folder').onclick=()=>{
 $('demo-download-prompt').close();$('folders-panel').open=true;chooseFolder('folder-data');
};
$('demo-prompt-download').onclick=()=>{
 $('demo-download-prompt').close();$('folders-panel').open=true;$('download-demo-pack').click();
};

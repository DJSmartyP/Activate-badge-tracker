'use strict';

const VERSION='13.83.0';
const STORAGE_KEY='activateBadgeTracker_v8';
const MAX_PINS=5;
let BADGES=[], ROOMS=[], GAMES=[], GAME_CATALOG={}, COMPETITIVE_INFO={}, BASE_BADGE_COUNT=0;
let TROPHIES=[];
let BASE_BADGES=[], BASE_ROOMS=[], BASE_GAMES=[], BASE_GAME_CATALOG={}, BASE_COMPETITIVE_INFO={}, BASE_GAME_ENTITIES=[], BADGE_ENTITIES=[];
let state=null;
let modalBadgeIndex=null;
let focusIndex=0;
let focusBadgeIndex=null;
let focusContext={source:'single',indices:[]};

let levelsDisplayMode='levels';
let contentManagerTab='rooms';
let contentEditing=null;
const defaultState=()=>({
  schemaVersion:3,
  playerName:"Smarty",
  playerBrandColor:"#FF4FB3",
  content:{rooms:{},games:{},badges:{}},
  badgeAwards:{},
  trophies:{
    bronze:{earned:false,earnedAt:null},
    silver:{earned:false,earnedAt:null},
    gold:{earned:false,earnedAt:null},
    platinum:{earned:false,earnedAt:null}
  },
  earned:{},
  pins:[],
  notes:{},
  history:[],
  levelProgress:{games:{},competitive:{},importedAt:null,player:null},
  levelProgressByLocation:{},
  locations:[{id:'home',name:'My Activate',rooms:[],games:[],roomCopies:{},roomInstances:[],venueMap:{Entrance:{front:null,left:null,right:null,back:null},Exit:{front:null,left:null,right:null,back:null}}}],
  activeLocation:'home'
});

const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const save=()=>localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
const toast=msg=>{const t=$('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1600)};
function normalisePlayerName(value){
  let name=String(value??'').trim().replace(/\s+/g,' ').slice(0,32);
  // v13.58 stored/displayed the old possessive directly. Keep the Settings
  // field as the raw player name so we never produce "Smarty's's".
  name=name.replace(/(?:['’]s)$/i,'').trim();
  return name.slice(0,32);
}

function validPlayerBrandColor(value){
  const v=String(value||'').trim();
  return /^#[0-9a-f]{6}$/i.test(v)?v.toUpperCase():'#FF4FB3';
}

function hexToRgbTriplet(hex){
  const value=validPlayerBrandColor(hex).slice(1);
  return [
    parseInt(value.slice(0,2),16),
    parseInt(value.slice(2,4),16),
    parseInt(value.slice(4,6),16)
  ].join(',');
}

function hexToRgbArray(hex){
  const value=validPlayerBrandColor(hex).slice(1);
  return [
    parseInt(value.slice(0,2),16),
    parseInt(value.slice(2,4),16),
    parseInt(value.slice(4,6),16)
  ];
}

function srgbChannelToLinear(v){
  const c=v/255;
  return c<=0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4);
}

function relativeLuminance(hex){
  const [r,g,b]=hexToRgbArray(hex).map(srgbChannelToLinear);
  return 0.2126*r + 0.7152*g + 0.0722*b;
}

function rgbToHex(r,g,b){
  return '#'+[r,g,b].map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('').toUpperCase();
}

function mixHex(a,b,amount){
  const ar=hexToRgbArray(a), br=hexToRgbArray(b);
  const t=Math.max(0,Math.min(1,Number(amount)||0));
  return rgbToHex(
    ar[0]+(br[0]-ar[0])*t,
    ar[1]+(br[1]-ar[1])*t,
    ar[2]+(br[2]-ar[2])*t
  );
}

function contrastSafePlayerColor(hex){
  const raw=validPlayerBrandColor(hex);
  // Target enough luminance to remain legible/glowy on the dark UI.
  // Preserve bright colours exactly; progressively lift darker picks
  // toward white so black/navy/deep purple remain recognisably related
  // to the chosen colour instead of disappearing.
  const target=0.34;
  let safe=raw;
  if(relativeLuminance(safe)>=target)return safe;

  for(let i=1;i<=20;i++){
    const candidate=mixHex(raw,'#FFFFFF',i/20);
    if(relativeLuminance(candidate)>=target){
      safe=candidate;
      break;
    }
  }
  return safe;
}

function playerDisplayName(){
  return normalisePlayerName(state?.playerName)||'Smarty';
}

function playerPossessiveName(){
  return `${playerDisplayName()}’s`;
}

function renderPlayerBrand(){
  const rawName=playerDisplayName();
  const possessive=playerPossessiveName();
  const color=validPlayerBrandColor(state?.playerBrandColor);
  const safeColor=contrastSafePlayerColor(color);

  const nameEl=$('playerBrandName');
  const banner=$('brandBanner');
  const input=$('playerDisplayName');
  const colorInput=$('playerBrandColor');

  document.documentElement.style.setProperty('--player-brand-color',color);
  document.documentElement.style.setProperty('--player-brand-rgb',hexToRgbTriplet(color));
  document.documentElement.style.setProperty('--player-brand-safe',safeColor);
  document.documentElement.style.setProperty('--player-brand-safe-rgb',hexToRgbTriplet(safeColor));

  if(nameEl)nameEl.textContent=possessive;
  if(banner)banner.setAttribute('aria-label',`${possessive} Activate Tracker`);
  if(input && document.activeElement!==input)input.value=rawName;
  if(colorInput && document.activeElement!==colorInput)colorInput.value=color;
}


const activeLocation=()=>state.locations.find(l=>l.id===state.activeLocation)||state.locations[0];
const earnedCount=()=>activeTrackedBadgeIndices().filter(i=>state.earned[i]).length;
const roomTypeFromInstance=n=>n==='Entrance'||n==='Exit'?n:n.replace(/\s+\d+$/,'');
const roomParts=b=>(b.room||'').split(/\s*\/\s*/).map(x=>x.trim()).filter(Boolean);
const gameParts=b=>(b.game||'').split(/\s*\/\s*/).map(x=>x.trim()).filter(Boolean);


/* =========================================================
   v13.51 — CONTENT CATALOGUE / STABLE ENTITY LAYER
   Bundled JSON remains the default catalogue. User edits live in
   state.content and are merged over the defaults at runtime.
   ========================================================= */

const contentSlug=s=>String(s??'').trim().toLowerCase()
  .replace(/&/g,' and ')
  .replace(/[^a-z0-9]+/g,'-')
  .replace(/^-+|-+$/g,'')||'item';

const newContentId=prefix=>`${prefix}:custom:${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
const baseRoomId=name=>`room:base:${contentSlug(name)}`;
const baseGameId=(room,name)=>`game:base:${contentSlug(room)}:${contentSlug(name)}`;
const baseBadgeId=index=>`badge:base:${index}`;

function ensureContentState(){
  if(!state.content || typeof state.content!=='object')state.content={};
  if(!state.content.rooms || typeof state.content.rooms!=='object')state.content.rooms={};
  if(!state.content.games || typeof state.content.games!=='object')state.content.games={};
  if(!state.content.badges || typeof state.content.badges!=='object')state.content.badges={};
  state.schemaVersion=Math.max(Number(state.schemaVersion)||1,3);
}

function buildBaseGameEntities(){
  const map=new Map();
  Object.entries(BASE_GAME_CATALOG||{}).forEach(([room,catalog])=>{
    const add=(game,mode)=>{
      const key=`${room}||${game}`;
      const id=baseGameId(room,game);
      const existing=map.get(key)||{
        id,
        custom:false,
        baseRoomName:room,
        baseRoomId:baseRoomId(room),
        baseName:game,
        cooperative:false,
        competitive:false,
        levels:10,
        baseCompetitiveKey:`${room}||${game}`
      };
      existing[mode]=true;
      map.set(key,existing);
    };
    (catalog?.cooperative||[]).forEach(g=>add(g,'cooperative'));
    (catalog?.competitive||[]).forEach(g=>add(g,'competitive'));
  });
  BASE_GAME_ENTITIES=[...map.values()];
}

function allRoomEntities({includeArchived=true}={}){
  ensureContentState();
  const base=BASE_ROOMS.map(name=>{
    const id=baseRoomId(name),o=state.content.rooms[id]||{};
    return {
      id,custom:false,baseName:name,
      name:String(o.name||name).trim()||name,
      archived:!!o.archived
    };
  });
  const custom=Object.values(state.content.rooms)
    .filter(x=>x?.custom)
    .map(x=>({
      id:x.id,custom:true,baseName:null,
      name:String(x.name||'New room').trim()||'New room',
      archived:!!x.archived,
      createdAt:x.createdAt||''
    }));
  const rows=[...base,...custom];
  return includeArchived?rows:rows.filter(x=>!x.archived);
}

function roomEntityById(id){return allRoomEntities({includeArchived:true}).find(x=>x.id===id)||null}
function roomNameById(id){return roomEntityById(id)?.name||''}

function allGameEntities({includeArchived=true}={}){
  ensureContentState();
  const base=BASE_GAME_ENTITIES.map(base=>{
    const o=state.content.games[base.id]||{};
    return {
      ...base,
      name:String(o.name||base.baseName).trim()||base.baseName,
      roomId:o.roomId||base.baseRoomId,
      cooperative:o.cooperative===undefined?!!base.cooperative:!!o.cooperative,
      competitive:o.competitive===undefined?!!base.competitive:!!o.competitive,
      levels:Math.max(1,Math.min(99,Number(o.levels)||Number(base.levels)||10)),
      description:o.description===undefined?'':String(o.description||''),
      archived:!!o.archived
    };
  });
  const custom=Object.values(state.content.games)
    .filter(x=>x?.custom)
    .map(x=>({
      id:x.id,custom:true,baseName:null,baseRoomName:null,baseCompetitiveKey:null,
      name:String(x.name||'New game').trim()||'New game',
      roomId:x.roomId||'',
      cooperative:!!x.cooperative,
      competitive:!!x.competitive,
      levels:Math.max(1,Math.min(99,Number(x.levels)||10)),
      description:String(x.description||''),
      archived:!!x.archived,
      createdAt:x.createdAt||''
    }));
  const rows=[...base,...custom];
  return includeArchived?rows:rows.filter(x=>!x.archived);
}

function gameEntityById(id){return allGameEntities({includeArchived:true}).find(x=>x.id===id)||null}

function gameEntityByDisplay(room,game){
  return allGameEntities({includeArchived:true}).find(x=>
    x.name===game && roomNameById(x.roomId)===room
  )||null;
}

function levelCountForGame(room,game){
  const entity=gameEntityByDisplay(room,game);
  return Math.max(1,Math.min(99,Number(entity?.levels)||10));
}


const TROPHY_DEFS=[
  {id:'bronze',name:'Bronze',need:25,description:'25 badges'},
  {id:'silver',name:'Silver',need:50,description:'50 badges'},
  {id:'gold',name:'Gold',need:75,description:'75 badges'},
  {id:'platinum',name:'Platinum',need:'all',description:'100% of current active badges'}
];

const BASE_MULTIPART_RULES={
  'Activated':'every-game-level',
  'Completionist':'every-game',
  'Keener':'every-game',
  'The Grand Tour':'every-room'
};

function ensureTrophyState(){
  state.trophies=state.trophies&&typeof state.trophies==='object'?state.trophies:{};
  TROPHY_DEFS.forEach(t=>{
    const old=state.trophies[t.id];
    state.trophies[t.id]=old&&typeof old==='object'
      ? {earned:!!old.earned,earnedAt:old.earnedAt||null}
      : {earned:false,earnedAt:null};
  });
}

function migrateLegacyTrophyState(){
  ensureTrophyState();

  const old=Array.isArray(state._trophyIndices)?state._trophyIndices:[];
  if(old.length){
    const [bronzeIndex,silverIndex,goldIndex,platinumIndex]=old;
    if(state.earned?.[bronzeIndex])state.trophies.bronze.earned=true;
    if(state.earned?.[silverIndex])state.trophies.silver.earned=true;
    if(state.earned?.[goldIndex])state.trophies.gold.earned=true;
    // Platinum is deliberately not grandfathered. It represents
    // 100% of the CURRENT active badge catalogue.
    [bronzeIndex,silverIndex,goldIndex,platinumIndex].forEach(i=>{
      if(i===undefined)return;
      delete state.earned?.[i];
    });
    if(Array.isArray(state.pins))state.pins=state.pins.filter(i=>!old.includes(Number(i)));
    if(Array.isArray(state.history))state.history=state.history.filter(h=>!old.includes(Number(h.badge)));
  }else{
    // v13.52 without _trophyIndices could have helper trophies directly
    // after the base/custom badge array. Remove only obvious legacy helpers.
    Object.keys(state.earned||{}).map(Number).filter(Number.isInteger).forEach(i=>{
      if(i>=BASE_BADGES.length+Object.values(state.content?.badges||{}).filter(x=>x?.custom).length){
        delete state.earned[i];
      }
    });
  }
  state._trophyIndices=[];
}

function splitRequirementNames(value){
  return String(value||'').split(/\s*\/\s*/).map(x=>x.trim()).filter(Boolean);
}

function defaultBadgeAvailabilityType(base,room,game){
  if(BASE_MULTIPART_RULES[base?.name])return 'multipart';
  // Riddle 7.0 is venue-dependent: all cooperative S-games present
  // at that facility. It intentionally has no fixed room/game list.
  if(/^Riddle 7\.0$/i.test(String(base?.name||'').trim()))return 'any';
  return (String(room||'').trim()||String(game||'').trim())?'specific':'any';
}

function defaultBadgeRequirements(base,room,game,level){
  const rooms=splitRequirementNames(room);
  const games=splitRequirementNames(game);
  const numericLevel=level?Number(level)||null:null;

  // The Marathon has three fixed paired requirements. This is not
  // "multipart" because the list is fixed rather than expanding with a venue.
  if(/^The Marathon$/i.test(String(base?.name||'').trim()) && rooms.length===3 && games.length===3){
    return rooms.map((r,i)=>({rooms:[r],games:[games[i]],level:numericLevel}));
  }

  if(!rooms.length&&!games.length)return [];
  return [{rooms,games,level:numericLevel}];
}

function normaliseRequirementParts(parts){
  return (Array.isArray(parts)?parts:[]).map(p=>({
    rooms:[...new Set((Array.isArray(p?.rooms)?p.rooms:splitRequirementNames(p?.room)).map(normaliseContentName).filter(Boolean))],
    games:[...new Set((Array.isArray(p?.games)?p.games:splitRequirementNames(p?.game)).map(normaliseContentName).filter(Boolean))],
    level:p?.level?Math.max(1,Math.min(99,Number(p.level)||1)):null
  })).filter(p=>p.rooms.length||p.games.length);
}

function applyBadgeCatalog(){
  ensureContentState();
  migrateLegacyTrophyState();

  const records=[];
  BASE_BADGES.forEach((base,index)=>{
    const id=baseBadgeId(index),o=state.content.badges[id]||{};
    const room=o.room===undefined?(base.room||''):o.room;
    const game=o.game===undefined?(base.game||''):o.game;
    const level=o.level===undefined?(base.level||''):o.level;
    const availabilityType=o.availabilityType||defaultBadgeAvailabilityType(base,room,game);
    const multipartRule=o.multipartRule||BASE_MULTIPART_RULES[base.name]||'every-game';
    const requirements=normaliseRequirementParts(
      o.requirements===undefined?defaultBadgeRequirements(base,room,game,level):o.requirements
    );

    const badge={
      ...base,
      name:o.name===undefined?base.name:o.name,
      how:o.how===undefined?base.how:o.how,
      room,game,level,
      availabilityType,
      multipartRule,
      requirements,
      tip:o.tip===undefined?(base.tip||''):o.tip,
      hint:o.hint===undefined?(base.hint||''):o.hint,
      solution:o.solution===undefined?(base.solution||''):o.solution,
      category:o.category===undefined?(base.category||'standard'):o.category,
      type:'badge',
      _id:id,_custom:false,_archived:!!o.archived
    };
    records.push({id,index,custom:false,baseIndex:index,badge,archived:badge._archived});
  });

  const customs=Object.values(state.content.badges)
    .filter(x=>x?.custom)
    .sort((a,b)=>String(a.createdAt||a.id).localeCompare(String(b.createdAt||b.id)));

  customs.forEach(x=>{
    const requirements=normaliseRequirementParts(x.requirements);
    const badge={
      name:String(x.name||'New badge'),
      how:String(x.how||''),
      room:String(x.room||''),
      game:String(x.game||''),
      level:x.level||'',
      availabilityType:x.availabilityType||((x.room||x.game)?'specific':'any'),
      multipartRule:x.multipartRule||'every-game',
      requirements,
      tip:String(x.tip||''),
      hint:String(x.hint||''),
      solution:String(x.solution||''),
      category:x.category||'standard',
      type:'badge',
      _id:x.id,_custom:true,_archived:!!x.archived
    };
    records.push({id:x.id,index:records.length,custom:true,baseIndex:null,badge,archived:badge._archived});
  });

  BADGE_ENTITIES=records;
  BADGES=records.map(x=>x.badge);
  BASE_BADGE_COUNT=BADGES.filter(b=>!b?._archived).length;
  ensureBadgeAwardState();
}

function badgeIdAt(index){return BADGE_ENTITIES[index]?.id||BADGES[index]?._id||`badge:legacy:${index}`}

function badgeRequirementSnapshot(b){
  return {
    name:String(b?.name||''),
    how:String(b?.how||''),
    availabilityType:b?.availabilityType||'any',
    multipartRule:b?.multipartRule||'',
    requirements:normaliseRequirementParts(b?.requirements),
    room:String(b?.room||''),
    game:String(b?.game||''),
    level:String(b?.level||'')
  };
}

function badgeRequirementSignature(b){
  return JSON.stringify(badgeRequirementSnapshot(b));
}

function ensureBadgeAwardState(){
  state.badgeAwards=state.badgeAwards&&typeof state.badgeAwards==='object'?state.badgeAwards:{};

  BADGES.forEach((b,i)=>{
    if(!state.earned?.[i])return;
    const id=badgeIdAt(i);
    if(!state.badgeAwards[id]){
      const history=(state.history||[]).find(h=>Number(h.badge)===i);
      state.badgeAwards[id]={
        earnedAt:history?.date||new Date().toISOString().slice(0,10),
        name:b.name,
        requirement:badgeRequirementSnapshot(b),
        requirementSignature:badgeRequirementSignature(b)
      };
    }
  });
}

function awardTermsChanged(index){
  if(!state.earned?.[index])return false;
  const award=state.badgeAwards?.[badgeIdAt(index)];
  if(!award?.requirementSignature)return false;
  return award.requirementSignature!==badgeRequirementSignature(BADGES[index]);
}

function recordBadgeAward(index){
  const b=BADGES[index];
  const id=badgeIdAt(index);
  const date=new Date().toISOString().slice(0,10);
  state.badgeAwards??={};
  state.badgeAwards[id]={
    earnedAt:date,
    name:b?.name||'Badge',
    requirement:badgeRequirementSnapshot(b),
    requirementSignature:badgeRequirementSignature(b)
  };
  return date;
}

function clearBadgeAward(index){
  if(state.badgeAwards)delete state.badgeAwards[badgeIdAt(index)];
}

function badgeRequirements(b){
  return normaliseRequirementParts(b?.requirements?.length?b.requirements:defaultBadgeRequirements(b,b?.room,b?.game,b?.level));
}

function badgeSpecificRooms(b){
  return [...new Set(badgeRequirements(b).flatMap(p=>p.rooms||[]))];
}

function badgeSpecificGames(b){
  return [...new Set(badgeRequirements(b).flatMap(p=>p.games||[]))];
}

function multipartRuleLabel(rule){
  if(rule==='every-room')return 'Every room';
  if(rule==='every-game-level')return 'Every game level';
  if(rule==='every-room-game')return 'Every room & game';
  return 'Every game';
}

function badgeScopeLabel(b){
  if(b?.availabilityType==='multipart')return `Multipart • ${multipartRuleLabel(b.multipartRule)}`;
  if(b?.availabilityType==='specific'){
    const parts=badgeRequirements(b);
    if(parts.length>1)return `Specific • ${parts.length} required parts`;
    const p=parts[0]||{rooms:[],games:[]};
    const bits=[];
    if(p.rooms?.length)bits.push(p.rooms.join(' / '));
    if(p.games?.length)bits.push(p.games.join(' / ')+(p.level?` • L${p.level}`:''));
    return `Specific${bits.length?' • '+bits.join(' • '):''}`;
  }
  return 'Any Room';
}

function requirementPartLabel(part){
  const bits=[];
  if(part.rooms?.length)bits.push(`Room: ${part.rooms.join(' / ')}`);
  if(part.games?.length)bits.push(`Game: ${part.games.join(' / ')}`);
  if(part.level)bits.push(`Level ${part.level}`);
  return bits.join(' • ');
}

function badgeRequirementMarkup(b){
  if(b?.availabilityType==='multipart'){
    return `<div class="detail"><strong>Availability</strong>${esc(multipartRuleLabel(b.multipartRule))} at the active Location</div>`;
  }
  if(b?.availabilityType==='specific'){
    const parts=badgeRequirements(b);
    return parts.map((p,i)=>`<div class="detail"><strong>${parts.length>1?`Required part ${i+1}`:'Room / game'}</strong>${esc(requirementPartLabel(p))}</div>`).join('');
  }
  return `<div class="detail"><strong>Availability</strong>Any Room</div>`;
}

function partAvailableHere(part,l=activeLocation()){
  const rooms=part.rooms||[],games=part.games||[];
  const excluded=new Set(l.excludedGames||[]);
  const entries=inferredGamesForLocation(l).filter(x=>!excluded.has(x.game));

  if(rooms.length&&games.length){
    return entries.some(x=>rooms.includes(x.room)&&games.includes(x.game));
  }
  if(rooms.length)return rooms.some(r=>l.rooms.includes(r));
  if(games.length)return entries.some(x=>games.includes(x.game));
  return true;
}

function syncTrophies(){
  ensureTrophyState();
  const n=earnedCount();
  const total=BASE_BADGE_COUNT;
  const today=new Date().toISOString().slice(0,10);

  [['bronze',25],['silver',50],['gold',75]].forEach(([id,need])=>{
    if(n>=need&&!state.trophies[id].earned){
      state.trophies[id].earned=true;
      state.trophies[id].earnedAt=today;
    }
    // Bronze / Silver / Gold are permanent once achieved.
  });

  const platinumNow=total>0&&n>=total;
  if(platinumNow&&!state.trophies.platinum.earned){
    state.trophies.platinum.earnedAt=today;
  }
  state.trophies.platinum.earned=platinumNow;
  if(!platinumNow)state.trophies.platinum.earnedAt=null;

  TROPHIES=TROPHY_DEFS.map(t=>({
    ...t,
    earned:!!state.trophies[t.id]?.earned,
    earnedAt:state.trophies[t.id]?.earnedAt||null
  }));
}

function applyContentCatalog(){
  ensureContentState();

  const activeRooms=allRoomEntities({includeArchived:false});
  ROOMS=activeRooms.map(x=>x.name);

  GAME_CATALOG={};
  COMPETITIVE_INFO={};

  allGameEntities({includeArchived:false}).forEach(game=>{
    const room=roomEntityById(game.roomId);
    if(!room || room.archived)return;
    const roomName=room.name;
    GAME_CATALOG[roomName]??={cooperative:[],competitive:[]};

    if(game.cooperative && !GAME_CATALOG[roomName].cooperative.includes(game.name)){
      GAME_CATALOG[roomName].cooperative.push(game.name);
    }
    if(game.competitive && !GAME_CATALOG[roomName].competitive.includes(game.name)){
      GAME_CATALOG[roomName].competitive.push(game.name);
    }

    if(game.competitive){
      const raw=game.baseCompetitiveKey?BASE_COMPETITIVE_INFO[game.baseCompetitiveKey]:null;
      const source=typeof raw==='string'?{description:raw}:{...(raw||{})};
      if(game.description)source.description=game.description;
      COMPETITIVE_INFO[`${roomName}||${game.name}`]=source;
    }
  });

  Object.values(GAME_CATALOG).forEach(c=>{
    c.cooperative.sort((a,b)=>a.localeCompare(b));
    c.competitive.sort((a,b)=>a.localeCompare(b));
  });
  GAMES=[...new Set(Object.values(GAME_CATALOG).flatMap(c=>[...(c.cooperative||[]),...(c.competitive||[])]))].sort((a,b)=>a.localeCompare(b));

  applyBadgeCatalog();
  syncTrophies();
}

function activeTrackedBadgeIndices(){
  return BADGES.map((b,i)=>[b,i]).filter(([b])=>!b?._archived).map(([,i])=>i);
}

function replaceDelimitedName(value,oldName,newName){
  const parts=String(value||'').split(/\s*\/\s*/).map(x=>x.trim()).filter(Boolean);
  if(!parts.length)return value||'';
  return parts.map(x=>x===oldName?newName:x).join(' / ');
}

function addCatalogReview(location,message){
  ensureLocationShape(location);
  location.catalogReview=Array.isArray(location.catalogReview)?location.catalogReview:[];
  if(!location.catalogReview.includes(message))location.catalogReview.push(message);
  location.catalogReview=location.catalogReview.slice(-8);
}

function forEachProgressStore(fn){
  if(state.levelProgress)fn(state.levelProgress);
  Object.values(state.levelProgressByLocation||{}).forEach(fn);
}

function mergeGameProgress(a={},b={}){
  const levels={...(a.levels||{})};
  Object.entries(b.levels||{}).forEach(([n,v])=>{
    const old=levels[n]||{};
    levels[n]={
      ...old,...v,
      score:Math.max(Number(old.score)||0,Number(v?.score)||0),
      topScore:Math.max(Number(old.topScore)||0,Number(v?.topScore)||0),
      complete:!!old.complete||!!v?.complete
    };
  });
  return {...a,...b,levels};
}

function renameProgressRoom(store,oldName,newName){
  if(!store)return;
  const games=store.games||{};
  Object.keys(games).forEach(key=>{
    const cut=key.indexOf('||');if(cut<0)return;
    const room=key.slice(0,cut),game=key.slice(cut+2);
    if(room!==oldName)return;
    const next=`${newName}||${game}`;
    games[next]=mergeGameProgress(games[next],games[key]);
    games[next].room=newName;
    delete games[key];
  });
  const comp=store.competitive||{};
  Object.keys(comp).forEach(key=>{
    const cut=key.indexOf('||');if(cut<0)return;
    const room=key.slice(0,cut),game=key.slice(cut+2);
    if(room!==oldName)return;
    comp[`${newName}||${game}`]=!!comp[`${newName}||${game}`]||!!comp[key];
    delete comp[key];
  });
}

function renameProgressGame(store,oldName,newName){
  if(!store)return;
  const games=store.games||{};
  Object.keys(games).forEach(key=>{
    const cut=key.indexOf('||');if(cut<0)return;
    const room=key.slice(0,cut),game=key.slice(cut+2);
    if(game!==oldName)return;
    const next=`${room}||${newName}`;
    games[next]=mergeGameProgress(games[next],games[key]);
    games[next].game=newName;
    delete games[key];
  });
  const comp=store.competitive||{};
  Object.keys(comp).forEach(key=>{
    const cut=key.indexOf('||');if(cut<0)return;
    const room=key.slice(0,cut),game=key.slice(cut+2);
    if(game!==oldName)return;
    comp[`${room}||${newName}`]=!!comp[`${room}||${newName}`]||!!comp[key];
    delete comp[key];
  });
}

function moveProgressGame(store,gameName,oldRoom,newRoom){
  if(!store || oldRoom===newRoom)return;
  const oldKey=`${oldRoom}||${gameName}`,newKey=`${newRoom}||${gameName}`;
  if(store.games?.[oldKey]){
    store.games[newKey]=mergeGameProgress(store.games[newKey],store.games[oldKey]);
    store.games[newKey].room=newRoom;
    delete store.games[oldKey];
  }
  if(store.competitive?.[oldKey]){
    store.competitive[newKey]=!!store.competitive[newKey]||!!store.competitive[oldKey];
    delete store.competitive[oldKey];
  }
}

function migrateBadgeReference(kind,oldName,newName){
  const field=kind==='room'?'room':'game';
  const partField=kind==='room'?'rooms':'games';

  const updateParts=parts=>normaliseRequirementParts(parts).map(p=>({
    ...p,
    [partField]:(p[partField]||[]).map(x=>x===oldName?newName:x)
  }));

  BASE_BADGES.forEach((base,index)=>{
    const id=baseBadgeId(index),o=state.content.badges[id]||{};
    const current=o[field]===undefined?(base[field]||''):o[field];
    const changed=replaceDelimitedName(current,oldName,newName);
    const next={...o};
    if(changed!==current)next[field]=changed;
    if(Array.isArray(o.requirements))next.requirements=updateParts(o.requirements);
    if(JSON.stringify(next)!==JSON.stringify(o))state.content.badges[id]=next;
  });

  Object.values(state.content.badges).filter(x=>x?.custom).forEach(x=>{
    x[field]=replaceDelimitedName(x[field]||'',oldName,newName);
    if(Array.isArray(x.requirements))x.requirements=updateParts(x.requirements);
  });
}

function migrateRoomName(oldName,newName){
  if(!oldName || !newName || oldName===newName)return;
  state.locations.forEach(l=>{
    ensureLocationShape(l);
    l.rooms=l.rooms.map(x=>x===oldName?newName:x);
    if(l.roomCopies?.[oldName]!==undefined){
      l.roomCopies[newName]=l.roomCopies[oldName];
      delete l.roomCopies[oldName];
    }

    const renameInstance=x=>typeof x==='string'&&x.startsWith(oldName+' ')?newName+x.slice(oldName.length):x;
    l.roomInstances=(l.roomInstances||[]).map(x=>{
      if(typeof x==='string')return renameInstance(x);
      if(x&&typeof x==='object'){
        const copy={...x};
        if(copy.name)copy.name=renameInstance(copy.name);
        if(copy.type===oldName)copy.type=newName;
        return copy;
      }
      return x;
    });

    const oldMap=l.venueMap||{};
    const nextMap={};
    Object.entries(oldMap).forEach(([key,val])=>{
      const nextKey=renameInstance(key);
      const obj={...(val||{})};
      ['front','left','right','back'].forEach(dir=>{if(obj[dir])obj[dir]=renameInstance(obj[dir])});
      nextMap[nextKey]=obj;
    });
    l.venueMap=nextMap;
  });
  forEachProgressStore(store=>renameProgressRoom(store,oldName,newName));
  migrateBadgeReference('room',oldName,newName);
}

function migrateGameName(oldName,newName){
  if(!oldName || !newName || oldName===newName)return;
  state.locations.forEach(l=>{
    ensureLocationShape(l);
    l.games=l.games.map(x=>x===oldName?newName:x);
    l.excludedGames=l.excludedGames.map(x=>x===oldName?newName:x);
  });
  forEachProgressStore(store=>renameProgressGame(store,oldName,newName));
  migrateBadgeReference('game',oldName,newName);
}

function migrateBadgeRoomForMovedGame(gameName,oldRoom,newRoom){
  BASE_BADGES.forEach((base,index)=>{
    const id=baseBadgeId(index),o=state.content.badges[id]||{};
    const game=o.game===undefined?(base.game||''):o.game;
    const room=o.room===undefined?(base.room||''):o.room;
    if(gameParts({game}).includes(gameName) && roomParts({room}).includes(oldRoom)){
      state.content.badges[id]={...o,room:replaceDelimitedName(room,oldRoom,newRoom)};
    }
  });
  Object.values(state.content.badges).filter(x=>x?.custom).forEach(x=>{
    if(gameParts({game:x.game}).includes(gameName) && roomParts({room:x.room}).includes(oldRoom)){
      x.room=replaceDelimitedName(x.room,oldRoom,newRoom);
    }
  });
}

function migrateGameRoom(gameName,oldRoom,newRoom){
  if(!oldRoom || !newRoom || oldRoom===newRoom)return;
  forEachProgressStore(store=>moveProgressGame(store,gameName,oldRoom,newRoom));
  migrateBadgeRoomForMovedGame(gameName,oldRoom,newRoom);

  state.locations.forEach(l=>{
    ensureLocationShape(l);
    const wasAvailable=l.rooms.includes(oldRoom)&&!l.excludedGames.includes(gameName);
    const newRoomPresent=l.rooms.includes(newRoom);

    // Moving a game must never silently change venue availability.
    // If the destination room exists at this Location, keep the game
    // excluded until the Location is reviewed.
    if(newRoomPresent && !l.excludedGames.includes(gameName)){
      l.excludedGames.push(gameName);
    }

    if(wasAvailable || newRoomPresent){
      addCatalogReview(
        l,
        `${gameName} moved from ${oldRoom} to ${newRoom}. It is unavailable here until this venue is reviewed.`
      );
    }
  });
}

function excludeNewGameFromExistingLocations(gameName,roomName){
  state.locations.forEach(l=>{
    ensureLocationShape(l);
    if(!l.rooms.includes(roomName))return;
    if(!l.excludedGames.includes(gameName))l.excludedGames.push(gameName);
    addCatalogReview(l,`New game ${gameName} was added to ${roomName}. It is unavailable here until you restore it.`);
  });
}

function normaliseContentName(value){return String(value||'').trim().replace(/\s+/g,' ')}

function roomNameExists(name,exceptId=null){
  return allRoomEntities({includeArchived:true}).some(x=>x.id!==exceptId&&x.name.toLowerCase()===name.toLowerCase());
}
function gameNameExists(name,exceptId=null){
  return allGameEntities({includeArchived:true}).some(x=>x.id!==exceptId&&x.name.toLowerCase()===name.toLowerCase());
}

function badgeNameExists(name,exceptId=null){
  return BADGE_ENTITIES.some(x=>x.id!==exceptId&&String(x.badge.name||'').toLowerCase()===name.toLowerCase());
}

function contentRequirementType(b){
  const room=!!String(b?.room||'').trim(),game=!!String(b?.game||'').trim();
  if(room&&game)return 'roomgame';
  if(room)return 'room';
  if(game)return 'game';
  return 'global';
}

function validateDelimitedReferences(value,type){
  const parts=String(value||'').split(/\s*\/\s*/).map(x=>x.trim()).filter(Boolean);
  if(!parts.length)return true;
  const names=type==='room'
    ? allRoomEntities({includeArchived:true}).map(x=>x.name)
    : allGameEntities({includeArchived:true}).map(x=>x.name);
  return parts.every(x=>names.includes(x));
}

function roomGameEntries(room){
  const c=GAME_CATALOG[room]||{competitive:[],cooperative:[]};
  const out=[];
  (c.competitive||[]).forEach(g=>out.push({game:g,mode:'Competitive'}));
  (c.cooperative||[]).forEach(g=>{
    if(!out.some(x=>x.game===g)) out.push({game:g,mode:'Cooperative'});
    else out.find(x=>x.game===g).mode='Competitive + Cooperative';
  });
  return out;
}
function inferredGamesForLocation(l=activeLocation()){
  const entries=[];
  (l.rooms||[]).forEach(r=>roomGameEntries(r).forEach(x=>{
    if(!entries.some(e=>e.game===x.game&&e.room===r))entries.push({...x,room:r});
  }));
  return entries;
}
function enabledGameNames(l=activeLocation()){
  const excluded=new Set(l.excludedGames||[]);
  return [...new Set(inferredGamesForLocation(l).filter(x=>!excluded.has(x.game)).map(x=>x.game))];
}

function competitivePlayedKey(room,game){return room+'||'+game}
function isCompetitivePlayed(room,game){
  ensureLevelProgress();
  return !!activeLevelProgress().competitive[competitivePlayedKey(room,game)];
}
function setCompetitivePlayed(room,game,played){
  const progress=activeLevelProgress();
  progress.competitive[competitivePlayedKey(room,game)]=!!played;
  save();
  renderLevels?.();
  renderCompetitive?.();
}

function competitiveEntries(l=activeLocation()){
  const excluded=new Set(l.excludedGames||[]);
  const rows=[];
  (l.rooms||[]).forEach(r=>{
    const c=GAME_CATALOG[r]||{};
    (c.competitive||[]).forEach(g=>{
      if(!excluded.has(g))rows.push({room:r,game:g});
    });
  });
  return rows;
}


const isTrophy=b=>b && b.type==='trophy';
const isEasterEggBadge=b=>!isTrophy(b) && (b?.category==='easter-egg'||/^Easter Egg\b/i.test(b?.name||''));
const isRiddleBadge=b=>!isTrophy(b) && (b?.category==='riddle'||/^Riddle\b/i.test(b?.name||''));


function gamesForSelectedRooms(){
  return enabledGameNames();
}


function loadState(){
  try{
    const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
    state=saved||defaultState();
  }catch{state=defaultState()}
  if(!Array.isArray(state.locations)||!state.locations.length)state=defaultState();
  state.pins=Array.isArray(state.pins)?[...new Set(state.pins.map(Number).filter(Number.isInteger))].slice(0,MAX_PINS):[];
  state.history=Array.isArray(state.history)?state.history:[];
  state.earned=state.earned||{};
  state.notes=state.notes||{};
  if(state.playerName===undefined || state.playerName===null)state.playerName='Smarty';
  state.playerName=normalisePlayerName(state.playerName)||'Smarty';
  state.playerBrandColor=validPlayerBrandColor(state.playerBrandColor);
  state.locations.forEach(ensureLocationShape);ensureContentState();ensureTrophyState();state.badgeAwards=state.badgeAwards||{};ensureLevelProgressStore();activeLevelProgress();
}

function ensureLocationShape(l){
  l.rooms=Array.isArray(l.rooms)?l.rooms:[];
  l.games=Array.isArray(l.games)?l.games:[];
  l.excludedGames=Array.isArray(l.excludedGames)?l.excludedGames:[];
  l.catalogReview=Array.isArray(l.catalogReview)?l.catalogReview:[];
  l.roomCopies=l.roomCopies||{};
  l.roomInstances=Array.isArray(l.roomInstances)?l.roomInstances:[];
  l.venueMap=l.venueMap||{};
  l.venueMap.Entrance=l.venueMap.Entrance||{front:null,left:null,right:null,back:null};
  l.venueMap.Exit=l.venueMap.Exit||{front:null,left:null,right:null,back:null};
}

function availableHere(b){
  if(b?._archived)return false;
  const type=b?.availabilityType||defaultBadgeAvailabilityType(b,b?.room,b?.game);

  // Any Room includes venue-relative rules such as Riddle 7.0.
  if(type==='any')return true;

  // Multipart badges are defined relative to the active venue's current
  // catalogue, so they are valid at any configured Location.
  if(type==='multipart')return true;

  const parts=badgeRequirements(b);
  return parts.length?parts.every(p=>partAvailableHere(p,activeLocation())):true;
}

function currentTrophy(){
  ensureTrophyState();
  if(state.trophies.platinum.earned)return 'Platinum';
  if(state.trophies.gold.earned)return 'Gold';
  if(state.trophies.silver.earned)return 'Silver';
  if(state.trophies.bronze.earned)return 'Bronze';
  return 'No trophy yet';
}

function nextTrophyText(){
  ensureTrophyState();
  const n=earnedCount();
  if(!state.trophies.bronze.earned)return `${Math.max(0,25-n)} to Bronze`;
  if(!state.trophies.silver.earned)return `${Math.max(0,50-n)} to Silver`;
  if(!state.trophies.gold.earned)return `${Math.max(0,75-n)} to Gold`;
  if(!state.trophies.platinum.earned)return `${Math.max(0,BASE_BADGE_COUNT-n)} to Platinum`;
  return '100% complete';
}

function trophyProgress(){
  ensureTrophyState();
  const n=earnedCount();
  if(!state.trophies.bronze.earned)return {name:'Bronze',current:n,target:25,remaining:Math.max(0,25-n)};
  if(!state.trophies.silver.earned)return {name:'Silver',current:n,target:50,remaining:Math.max(0,50-n)};
  if(!state.trophies.gold.earned)return {name:'Gold',current:n,target:75,remaining:Math.max(0,75-n)};
  return {name:'Platinum',current:n,target:BASE_BADGE_COUNT,remaining:Math.max(0,BASE_BADGE_COUNT-n)};
}

function renderHome(){
  const n=earnedCount(), total=BASE_BADGE_COUNT, pct=total?Math.round(n/total*100):0, l=activeLocation();
  const tp=trophyProgress();
  const tpClass=`trophy-${String(tp.name).toLowerCase()}`;
  const milestonePct=tp.target?Math.max(0,Math.min(100,Math.round(tp.current/tp.target*100))):100;
  const recentThree=(state.history||[]).slice(0,3).map(h=>({
    badge:Number(h.badge),
    date:h.date||'',
    name:BADGES[Number(h.badge)]?.name||'Badge'
  }));
  const recentMarkup=recentThree.length
    ? recentThree.map((h,idx)=>`<button class="home-achievement-row" data-open-focus-badge="${h.badge}" data-focus-source="recent">
        <span class="home-achievement-rank">${String(idx+1).padStart(2,'0')}</span>
        <span class="home-achievement-copy">
          <b>${esc(h.name)}</b>
          <small>${esc(h.date)}</small>
        </span>
        <span class="home-achievement-open">›</span>
      </button>`).join('')
    : '<div class="home-achievement-empty">No achievements logged yet</div>';

  $('homeSummary').innerHTML=`
    <div class="home-trophy-dashboard">
      <div class="home-trophy-main">
        <div class="label">Trophy progress</div>

        <div class="home-trophy-title-row">
          <div class="home-trophy-title-copy">
            <div class="big trophy-current-name ${tpClass}" data-text="${esc(tp.name)}">${esc(tp.name)}</div>
            <div class="sub">${tp.remaining?`${tp.current} / ${tp.target} badges • ${tp.remaining} to unlock`:'Unlocked • 100% complete'}</div>
          </div>

          <div class="home-trophy-live ${tpClass}" aria-label="${milestonePct}% progress toward ${esc(tp.name)} trophy">
            <div class="trophy-counter-display" style="--trophy-pct:${milestonePct};--milestone-fill:${milestonePct}%">
              <div class="trophy-counter-inner">
                <span class="trophy-counter-icon-stack" aria-hidden="true">
                  <span class="trophy-counter-icon trophy-counter-icon-mono">🏆</span>
                  <span class="trophy-counter-icon trophy-counter-icon-colour">🏆</span>
                </span>
                <strong>${milestonePct}%</strong>
                <small>To ${esc(tp.name)}</small>
              </div>
            </div>
          </div>
        </div>

        <div class="progress top-gap"><span style="width:${tp.target?Math.min(100,tp.current/tp.target*100):100}%"></span></div>

        <div class="metrics">
          <div class="metric"><span class="label">Earned</span><b>${n}</b></div>
          <div class="metric"><span class="label">Overall</span><b>${pct}%</b></div>
          <div class="metric"><span class="label">Location</span><b style="font-size:15px">${esc(l.name)}</b></div>
        </div>
      </div>

      <aside class="home-trophy-side">
        <div class="home-recent-three">
          <div class="home-recent-head">
            <span class="label">Last 3 achievements</span>
            <span class="home-recent-pulse" aria-hidden="true"></span>
          </div>
          <div class="home-achievement-list">${recentMarkup}</div>
        </div>
      </aside>
    </div>`;
  $('trophies').innerHTML=TROPHIES.map(t=>{
    const need=t.need==='all'?total:t.need;
    const metal=`trophy-${t.id}`;
    const unlocked=!!t.earned;
    const progress=t.id==='platinum'
      ? (need?Math.min(100,n/need*100):0)
      : (unlocked?100:(need?Math.min(100,n/need*100):0));
    return `<div class="card trophy ${metal} ${unlocked?'unlocked':'locked'}">
      <div class="trophy-shimmer" aria-hidden="true"></div>
      <div class="row between">
        <span class="cup" aria-hidden="true">🏆</span>
        <span class="pill">${unlocked?'Unlocked':`${Math.max(0,need-n)} left`}</span>
      </div>
      <h3>${esc(t.name)}</h3>
      <div class="sub">${t.id==='platinum'?'100% of current active badges':`${need} badges • permanent once earned`}</div>
      <div class="progress top-gap"><span style="width:${progress}%"></span></div>
    </div>`;
  }).join('');
  $('homePins').innerHTML=state.pins.length?state.pins.map((i,idx)=>`<div class="item row between"><div><b>${esc(BADGES[i].name)}</b><div class="sub">${esc(BADGES[i].room||'Any room')}</div></div><button class="mini" data-open-focus="${idx}">Open</button></div>`).join(''):'<div class="item sub">No pinned badges.</div>';
  $('recent').innerHTML=state.history.length?state.history.slice(0,8).map(h=>`<button class="item recent-achievement clickable-badge" data-open-focus-badge="${h.badge}" data-focus-source="recent"><div><b>${esc(BADGES[h.badge]?.name||'Badge')}</b><div class="sub">${esc(h.date||'')}</div></div><span class="recent-open">›</span></button>`).join(''):'<div class="item sub">No achievements recorded yet.</div>';
}


function setBadgePinned(index,pinned){
  const i=Number(index);
  if(!Number.isInteger(i) || i<0 || i>=BADGES.length)return false;
  state.pins=Array.isArray(state.pins)?state.pins.map(Number).filter(Number.isInteger):[];
  const has=state.pins.includes(i);

  if(pinned && !has){
    if(state.pins.length>=MAX_PINS){
      toast('Focus list is full — maximum 5 badges');
      return false;
    }
    state.pins.push(i);
  }else if(!pinned && has){
    state.pins=state.pins.filter(x=>x!==i);
  }else{
    return true;
  }

  save();
  renderAll();
  toast(pinned?'Pinned to Focus':'Removed from Focus');
  return true;
}
function toggleBadgePin(index){
  const i=Number(index);
  return setBadgePinned(i,!(Array.isArray(state.pins)&&state.pins.includes(i)));
}


function filteredBadgeIndices(){
  const room=$('targetRoom')?.value||'';
  const q=($('badgeSearch')?.value||'').trim().toLowerCase();
  const status=$('badgeStatus')?.value||'all';
  const avail=$('badgeAvailability')?.value||'all';

  return BADGES.map((b,i)=>[b,i]).filter(([b,i])=>{
    if(b?._archived)return false;
    const text=JSON.stringify(b).toLowerCase();
    const qok=!q||text.includes(q);
    const roomOk=!room || badgeSpecificRooms(b).includes(room);
    const sok=status==='all'
      ||(status==='todo'&&!state.earned[i])
      ||(status==='done'&&state.earned[i])
      ||(status==='pinned'&&state.pins.includes(i));
    const aok=avail==='all'
      ||(avail==='here'&&availableHere(b))
      ||(avail==='away'&&!availableHere(b));
    return qok&&roomOk&&sok&&aok;
  }).map(([,i])=>i);
}

function recentBadgeIndices(){
  const seen=new Set();
  return (state.history||[]).map(h=>Number(h.badge)).filter(i=>{
    if(!Number.isInteger(i) || i<0 || i>=BADGES.length || seen.has(i))return false;
    seen.add(i);
    return true;
  }).slice(0,8);
}

function renderBadges(){
  syncTrophies();
  const rooms=availableFocusRooms();
  const roomSel=$('targetRoom');
  const chosen=roomSel.value||'';
  roomSel.innerHTML='<option value="">All badges</option>'+rooms.map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join('');
  roomSel.value=rooms.includes(chosen)?chosen:'';

  const rows=filteredBadgeIndices().map(i=>[BADGES[i],i]);

  $('pinCount').textContent=`${state.pins.length} / ${MAX_PINS}`;
  $('pinList').innerHTML=state.pins.length?state.pins.map((i,idx)=>`<div class="item row between">
    <div><b>${esc(BADGES[i].name)}</b><div class="sub">${esc(badgeScopeLabel(BADGES[i]))} • ${esc(BADGES[i].how)}</div></div>
    <div class="row"><button class="mini" data-open-focus="${idx}">Open</button><button type="button" class="mini" data-unpin-badge="${i}" aria-label="Unpin ${esc(BADGES[i].name)}">✕</button></div>
  </div>`).join(''):'<div class="item sub">No pinned badges.</div>';

  $('badgeCount').textContent=`${rows.length} shown`;
  $('badgeList').innerHTML=rows.length?rows.map(([b,i])=>`<article class="badge target-card clickable-badge ${availableHere(b)?'available-here':'other-location'} ${state.earned[i]?'done completed-target':''} ${state.pins.includes(i)?'pinned-target':''}" data-open-focus-badge="${i}" data-focus-source="badges">
    <button class="checkbtn" data-toggle-earned="${i}">${state.earned[i]?'✓':''}</button>
    <div><h3>${esc(b.name)}</h3><p>${esc(b.how)}</p><div class="tags">
      <span class="tag">${isEasterEggBadge(b)?'Badge • Easter Egg':isRiddleBadge(b)?'Badge • Riddle':'Badge'}</span>
      <span class="tag">${esc(badgeScopeLabel(b))}</span>
      ${awardTermsChanged(i)?'<span class="tag award-legacy-tag">Earned under earlier terms</span>':''}
      <span class="tag availability-tag ${availableHere(b)?'ok':'away'}">${availableHere(b)?'Available here':'Other location'}</span>
    </div></div>
    <div class="row"><button type="button" class="mini pin-button ${state.pins.includes(i)?'active':''}" data-pin-badge="${i}" aria-pressed="${state.pins.includes(i)?'true':'false'}" aria-label="${state.pins.includes(i)?'Unpin':'Pin'} ${esc(b.name)}" title="${state.pins.includes(i)?'Unpin badge':'Pin badge'}">${state.pins.includes(i)?'📌':'📍'}</button><button class="mini" data-open-focus-badge="${i}" title="Open badge">›</button></div>
  </article>`).join(''):'<div class="item sub">No badges match those filters.</div>';
}

function renderLocations(){
  const l=activeLocation();

  $('selectedVenueBanner').innerHTML=`<span class="label">Current venue</span><strong>${esc(l.name)}</strong>`;
  if($('locationCatalogReview')){
    const notices=Array.isArray(l.catalogReview)?l.catalogReview:[];
    $('locationCatalogReview').innerHTML=notices.length?`
      <div class="catalog-review-card">
        <div><strong>Catalogue review</strong><div class="sub">${notices.map(esc).join('<br>')}</div></div>
        <button class="mini" data-clear-catalog-review>Clear</button>
      </div>`:'';
  }

  $('locationList').innerHTML=state.locations.map(x=>`<button class="item location-choice ${x.id===l.id?'active selected-location':''}" data-location="${x.id}">
    <div class="row between">
      <div>
        <b>${esc(x.name)}</b>
        <div class="sub">${x.rooms.length} rooms • ${enabledGameNames(x).length} games available</div>
      </div>
      ${x.id===l.id?'<span class="selected-pill">SELECTED</span>':''}
    </div>
  </button>`).join('');

  $('locationName').value=l.name;
  $('locationRooms').innerHTML=ROOMS.map(r=>`<button class="toggle ${l.rooms.includes(r)?'on':''}" data-room-toggle="${esc(r)}">${esc(r)}</button>`).join('');

  const entries=inferredGamesForLocation(l);
  const excluded=new Set(l.excludedGames||[]);
  $('locationGamesAuto').innerHTML=entries.length?entries.map(x=>`<div class="item game-auto ${excluded.has(x.game)?'off':''}">
    <div><b>${esc(x.game)}</b><div class="sub">${esc(x.room)} • ${esc(x.mode)}</div></div>
    <button class="mini" data-exclude-game="${esc(x.game)}">${excluded.has(x.game)?'Restore':'Mark unavailable'}</button>
  </div>`).join(''):'<div class="item sub">Select the rooms at this venue and the game list will appear automatically.</div>';
}







function availableFocusRooms(){
  const l=activeLocation();
  if(l.rooms.length)return [...l.rooms];
  return [...ROOMS];
}



function renderCompetitive(){
  const all=competitiveEntries();
  const roomSel=$('competitiveRoom');
  const currentRoom=roomSel.value||'';
  const rooms=[...new Set(all.map(x=>x.room))].sort((a,b)=>a.localeCompare(b));
  roomSel.innerHTML='<option value="">All rooms</option>'+rooms.map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join('');
  roomSel.value=rooms.includes(currentRoom)?currentRoom:'';

  const q=($('competitiveSearch').value||'').trim().toLowerCase();
  const room=roomSel.value;
  const playedFilter=$('competitivePlayed')?.value||'all';

  const rows=all.filter(x=>{
    const played=isCompetitivePlayed(x.room,x.game);
    return (!q||x.game.toLowerCase().includes(q))
      && (!room||x.room===room)
      && (playedFilter==='all'
        || (playedFilter==='played'&&played)
        || (playedFilter==='notplayed'&&!played));
  });

  $('competitiveCount').textContent=`${rows.length} game${rows.length===1?'':'s'}`;

  $('competitiveList').innerHTML=rows.length?rows.map(x=>{
    const played=isCompetitivePlayed(x.room,x.game);
    const key=`${x.room}||${x.game}`;
    return `<article class="badge comp-game competitive-mode ${played?'competitive-played':''}" data-comp-room="${esc(x.room)}" data-comp-game="${esc(x.game)}">
      <label class="competitive-check" title="${played?'Played':'Not played'}">
        <input type="checkbox" data-competitive-played="${esc(key)}" ${played?'checked':''}>
        <span class="competitive-check-box">${played?'✓':''}</span>
      </label>
      <div>
        <h3>${esc(x.game)}</h3>
        <p>Tap to see how the game is played.</p>
        <div class="tags">
          <span class="tag">${esc(x.room)}</span>
          <span class="tag competitive-pill">Competitive</span>
          <span class="tag ${played?'comp-played-tag':'comp-notplayed-tag'}">${played?'Played':'Not played'}</span>
        </div>
      </div>
      <button class="mini" data-comp-room="${esc(x.room)}" data-comp-game="${esc(x.game)}">›</button>
    </article>`;
  }).join(''):'<div class="item sub">No competitive games match those filters.</div>';
}

function openCompetitiveGame(room,game){
  const info=COMPETITIVE_INFO[`${room}||${game}`];
  $('competitiveModalTitle').textContent=game;
  $('competitiveModalBody').innerHTML=`<div class="game-card-room">${esc(room)} • Competitive</div>
    <div class="game-how"><strong>How to play</strong>${esc(info?.description||'A description for this competitive game is not currently available in the Master Document data used by this build.')}</div>`;
  $('competitiveModal').classList.add('open');
}

function renderStats(){
  const tracked=activeTrackedBadgeIndices();
  const n=earnedCount(), here=tracked.filter(i=>availableHere(BADGES[i])&&!state.earned[i]).length, away=tracked.filter(i=>!availableHere(BADGES[i])&&!state.earned[i]).length;
  $('statsCards').innerHTML=`<div class="stat"><span class="label">Earned</span><b>${n}</b></div><div class="stat"><span class="label">Available here</span><b>${here}</b></div><div class="stat"><span class="label">Other location</span><b>${away}</b></div><div class="stat"><span class="label">Pinned</span><b>${state.pins.length}</b></div>`;
  const byRoom={};BADGES.forEach((b,i)=>{if(state.earned[i])badgeSpecificRooms(b).forEach(r=>byRoom[r]=(byRoom[r]||0)+1)});
  $('roomStats').innerHTML=Object.entries(byRoom).sort((a,b)=>b[1]-a[1]).map(([r,c])=>`<div class="item row between"><span>${esc(r)}</span><b>${c}</b></div>`).join('')||'<div class="item sub">No room-specific badges earned yet.</div>';
  $('historyList').innerHTML=state.history.map(h=>`<div class="item"><b>${esc(BADGES[h.badge]?.name||'Badge')}</b><div class="sub">${esc(h.date||'')}</div></div>`).join('')||'<div class="item sub">No history yet.</div>';
}


/* =========================================================
   v13.51 — SETTINGS CONTENT MANAGER
   ========================================================= */

function contentModeLabel(game){
  if(game.cooperative&&game.competitive)return 'Co-op + Competitive';
  if(game.competitive)return 'Competitive';
  return 'Co-op';
}

function badgeDependencyLabel(b){
  return badgeScopeLabel(b);
}

function renderContentManager(){
  const list=$('contentManagerList');
  if(!list)return;

  document.querySelectorAll('[data-content-tab]').forEach(b=>b.classList.toggle('active',b.dataset.contentTab===contentManagerTab));

  const q=($('contentSearch')?.value||'').trim().toLowerCase();
  const showArchived=!!$('contentShowArchived')?.checked;
  const add=$('contentAddBtn');
  if(add)add.textContent=`+ Add ${contentManagerTab==='rooms'?'room':contentManagerTab==='games'?'game':'badge'}`;

  let rows=[];
  if(contentManagerTab==='rooms'){
    rows=allRoomEntities({includeArchived:true})
      .filter(x=>showArchived||!x.archived)
      .filter(x=>!q||x.name.toLowerCase().includes(q))
      .sort((a,b)=>Number(a.archived)-Number(b.archived)||a.name.localeCompare(b.name))
      .map(x=>({
        id:x.id,name:x.name,archived:x.archived,
        sub:`${x.custom?'Custom':'Built-in'} room`,
        type:'rooms'
      }));
  }else if(contentManagerTab==='games'){
    rows=allGameEntities({includeArchived:true})
      .filter(x=>showArchived||!x.archived)
      .filter(x=>{
        const text=`${x.name} ${roomNameById(x.roomId)} ${contentModeLabel(x)}`.toLowerCase();
        return !q||text.includes(q);
      })
      .sort((a,b)=>Number(a.archived)-Number(b.archived)||roomNameById(a.roomId).localeCompare(roomNameById(b.roomId))||a.name.localeCompare(b.name))
      .map(x=>({
        id:x.id,name:x.name,archived:x.archived,
        sub:`${roomNameById(x.roomId)||'No room'} • ${contentModeLabel(x)}${x.cooperative?` • ${x.levels} levels`:''}`,
        type:'games'
      }));
  }else{
    rows=BADGE_ENTITIES
      .filter(x=>showArchived||!x.archived)
      .filter(x=>{
        const text=`${x.badge.name} ${x.badge.how} ${x.badge.room} ${x.badge.game}`.toLowerCase();
        return !q||text.includes(q);
      })
      .sort((a,b)=>Number(a.archived)-Number(b.archived)||String(a.badge.name).localeCompare(String(b.badge.name)))
      .map(x=>({
        id:x.id,name:x.badge.name,archived:x.archived,
        sub:`${x.custom?'Custom':'Built-in'} badge • ${badgeDependencyLabel(x.badge)}`,
        type:'badges'
      }));
  }

  if($('contentManagerCount'))$('contentManagerCount').textContent=`${rows.length} shown`;

  list.innerHTML=rows.length?rows.map(x=>`
    <div class="content-manager-row ${x.archived?'content-archived':''}">
      <button class="content-main-button" data-edit-content-type="${x.type}" data-edit-content-id="${esc(x.id)}">
        <strong>${esc(x.name)}</strong>
        <span>${esc(x.sub)}</span>
      </button>
      <div class="content-row-actions">
        ${x.archived?'<span class="content-archived-pill">Archived</span>':''}
        <button class="mini" data-edit-content-type="${x.type}" data-edit-content-id="${esc(x.id)}">Edit</button>
        <button class="mini ${x.archived?'':'danger-outline'}" data-toggle-content-archive="${x.type}" data-content-id="${esc(x.id)}">${x.archived?'Restore':'Archive'}</button>
      </div>
    </div>`).join(''):'<div class="item sub">Nothing matches this search.</div>';
}

function contentEditorHeader(title,sub=''){
  $('contentEditorTitle').textContent=title;
  $('contentEditorSubtitle').textContent=sub;
}

function setContentModalOpen(open){
  $('contentEditorModal')?.classList.toggle('open',!!open);
}


function editorRequirementParts(parts){
  // Editor rows must preserve blank parts while the user is filling them in.
  // The persisted catalogue still strips blank requirements on Save.
  return (Array.isArray(parts)?parts:[]).map(p=>({
    rooms:[...new Set((Array.isArray(p?.rooms)?p.rooms:splitRequirementNames(p?.room)).map(normaliseContentName).filter(Boolean))],
    games:[...new Set((Array.isArray(p?.games)?p.games:splitRequirementNames(p?.game)).map(normaliseContentName).filter(Boolean))],
    level:p?.level?Math.max(1,Math.min(99,Number(p.level)||1)):null
  }));
}

function renderBadgePartRows(parts){
  const rows=editorRequirementParts(parts);
  return rows.map((p,i)=>`
    <div class="content-badge-part" data-badge-part>
      <div class="content-badge-part-head">
        <strong>Part ${i+1}</strong>
        <button class="mini danger-outline" type="button" data-remove-badge-part aria-label="Remove requirement part">Remove</button>
      </div>
      <div class="content-form-grid">
        <div>
          <label class="label">Room(s)</label>
          <input class="field" data-badge-part-rooms list="contentRoomNames" value="${esc((p.rooms||[]).join(' / '))}" placeholder="e.g. Mega Laser / Trench">
        </div>
        <div>
          <label class="label">Game(s)</label>
          <input class="field" data-badge-part-games list="contentGameNames" value="${esc((p.games||[]).join(' / '))}" placeholder="e.g. Defuse">
        </div>
      </div>
      <div class="top-gap">
        <label class="label">Level (optional)</label>
        <input class="field content-number" data-badge-part-level type="number" min="1" max="99" value="${p.level||''}">
      </div>
    </div>`).join('');
}

function collectBadgeRequirementParts(keepBlank=false){
  const parts=[...document.querySelectorAll('#contentBadgeParts [data-badge-part]')].map(row=>({
    rooms:splitRequirementNames(row.querySelector('[data-badge-part-rooms]')?.value||''),
    games:splitRequirementNames(row.querySelector('[data-badge-part-games]')?.value||''),
    level:row.querySelector('[data-badge-part-level]')?.value||null
  }));
  return keepBlank?parts:parts.filter(p=>p.rooms.length||p.games.length);
}

function openContentEditor(type,id=null){
  ensureContentState();
  contentEditing={type,id,isNew:!id};
  const body=$('contentEditorBody');
  const archiveBtn=$('contentArchiveBtn');

  if(type==='rooms'){
    const room=id?roomEntityById(id):null;
    contentEditorHeader(id?'Edit room':'Add room',id?(room?.custom?'Custom room':'Built-in room'):'New rooms are not automatically added to existing Locations.');
    body.innerHTML=`
      <label class="label" for="contentRoomName">Room name</label>
      <input id="contentRoomName" class="field" value="${esc(room?.name||'')}" maxlength="80" autocomplete="off">
      <p class="sub top-gap">Renaming a room migrates saved Location selections and level-progress keys so existing progress is retained.</p>`;
    if(archiveBtn){
      archiveBtn.hidden=!id;
      archiveBtn.textContent=room?.archived?'Restore room':'Archive room';
    }
  }else if(type==='games'){
    const game=id?gameEntityById(id):null;
    const rooms=allRoomEntities({includeArchived:true}).filter(r=>!r.archived || r.id===game?.roomId);
    contentEditorHeader(id?'Edit game':'Add game',id?(game?.custom?'Custom game':'Built-in game'):'New games default to unavailable at existing Locations that already use the selected room.');
    body.innerHTML=`
      <div class="content-form-grid">
        <div>
          <label class="label" for="contentGameName">Game name</label>
          <input id="contentGameName" class="field" value="${esc(game?.name||'')}" maxlength="80" autocomplete="off">
        </div>
        <div>
          <label class="label" for="contentGameRoom">Room</label>
          <select id="contentGameRoom" class="field">
            ${rooms.map(r=>`<option value="${esc(r.id)}" ${r.id===game?.roomId?'selected':''}>${esc(r.name)}${r.archived?' • archived':''}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="content-check-row top-gap">
        <label class="content-check"><input id="contentGameCoop" type="checkbox" ${game?.cooperative!==false?'checked':''}><span>Co-op</span></label>
        <label class="content-check"><input id="contentGameCompetitive" type="checkbox" ${game?.competitive?'checked':''}><span>Competitive</span></label>
      </div>
      <div id="contentGameLevelWrap" class="top-gap">
        <label class="label" for="contentGameLevels">Co-op levels</label>
        <input id="contentGameLevels" class="field content-number" type="number" min="1" max="99" value="${game?.levels||10}">
      </div>
      <div id="contentGameDescriptionWrap" class="top-gap">
        <label class="label" for="contentGameDescription">Competitive description</label>
        <textarea id="contentGameDescription" class="field content-textarea" placeholder="Optional how-to-play description">${esc(game?.description||'')}</textarea>
      </div>
      <p class="sub top-gap">Moving or renaming a game migrates saved progress. Affected Locations are flagged for review rather than silently changing venue availability.</p>`;
    if(archiveBtn){
      archiveBtn.hidden=!id;
      archiveBtn.textContent=game?.archived?'Restore game':'Archive game';
    }
    const refresh=()=>{
      const coop=!!$('contentGameCoop')?.checked;
      const comp=!!$('contentGameCompetitive')?.checked;
      $('contentGameLevelWrap')?.classList.toggle('content-field-disabled',!coop);
      if($('contentGameLevels'))$('contentGameLevels').disabled=!coop;
      $('contentGameDescriptionWrap')?.classList.toggle('content-field-disabled',!comp);
      if($('contentGameDescription'))$('contentGameDescription').disabled=!comp;
    };
    $('contentGameCoop')?.addEventListener('change',refresh);
    $('contentGameCompetitive')?.addEventListener('change',refresh);
    refresh();
  }else{
    const rec=id?BADGE_ENTITIES.find(x=>x.id===id):null;
    const b=rec?.badge||{};
    const availabilityType=b.availabilityType||defaultBadgeAvailabilityType(b,b.room,b.game);
    const roomNames=allRoomEntities({includeArchived:true}).map(x=>x.name);
    const gameNames=allGameEntities({includeArchived:true}).map(x=>x.name);
    const parts=badgeRequirements(b);
    contentEditorHeader(
      id?'Edit badge':'Add badge',
      id
        ? (rec?.custom?'Custom badge':'Built-in badge')
        : 'Use Any Room unless the badge names fixed rooms/games. Multipart is reserved for EVERY room/game rules.'
    );
    body.innerHTML=`
      <label class="label" for="contentBadgeName">Badge name</label>
      <input id="contentBadgeName" class="field" value="${esc(b.name||'')}" maxlength="120" autocomplete="off">

      <label class="label top-gap" for="contentBadgeHow">Requirement / how to earn</label>
      <textarea id="contentBadgeHow" class="field content-textarea" placeholder="What must be done to earn this badge?">${esc(b.how||'')}</textarea>

      <div class="content-form-grid top-gap">
        <div>
          <label class="label" for="contentBadgeRequirement">Availability type</label>
          <select id="contentBadgeRequirement" class="field">
            <option value="any" ${availabilityType==='any'?'selected':''}>Any Room</option>
            <option value="specific" ${availabilityType==='specific'?'selected':''}>Specific rooms / games</option>
            <option value="multipart" ${availabilityType==='multipart'?'selected':''}>Multipart — EVERY room / game</option>
          </select>
        </div>
        <div>
          <label class="label" for="contentBadgeCategory">Badge type</label>
          <select id="contentBadgeCategory" class="field">
            <option value="standard" ${(b.category||'standard')==='standard'?'selected':''}>Standard</option>
            <option value="easter-egg" ${b.category==='easter-egg'?'selected':''}>Easter Egg</option>
            <option value="riddle" ${b.category==='riddle'?'selected':''}>Riddle</option>
          </select>
        </div>
      </div>

      <div id="contentBadgeSpecificWrap" class="top-gap">
        <div class="row between wrap">
          <div>
            <div class="label">Specific requirement parts</div>
            <div class="sub">Every part below is required. Within one part, “ / ” means alternative rooms or games.</div>
          </div>
          <button class="mini" type="button" data-add-badge-part>+ Add part</button>
        </div>
        <div id="contentBadgeParts" class="content-badge-parts top-gap">
          ${renderBadgePartRows(parts.length?parts:[{rooms:[],games:[],level:null}])}
        </div>
        <datalist id="contentRoomNames">${roomNames.map(n=>`<option value="${esc(n)}">`).join('')}</datalist>
        <datalist id="contentGameNames">${gameNames.map(n=>`<option value="${esc(n)}">`).join('')}</datalist>
      </div>

      <div id="contentBadgeMultipartWrap" class="top-gap">
        <label class="label" for="contentBadgeMultipartRule">Multipart rule</label>
        <select id="contentBadgeMultipartRule" class="field">
          <option value="every-room" ${b.multipartRule==='every-room'?'selected':''}>Every room at the active Location</option>
          <option value="every-game" ${(b.multipartRule||'every-game')==='every-game'?'selected':''}>Every game at the active Location</option>
          <option value="every-game-level" ${b.multipartRule==='every-game-level'?'selected':''}>Every game level at the active Location</option>
          <option value="every-room-game" ${b.multipartRule==='every-room-game'?'selected':''}>Every room and every game</option>
        </select>
      </div>

      <label class="label top-gap" for="contentBadgeTip">Tip / watch out</label>
      <textarea id="contentBadgeTip" class="field content-textarea">${esc(b.tip||'')}</textarea>

      <label class="label top-gap" for="contentBadgeHint">Hint</label>
      <textarea id="contentBadgeHint" class="field content-textarea">${esc(b.hint||'')}</textarea>

      <label class="label top-gap" for="contentBadgeSolution">Solution / spoiler</label>
      <textarea id="contentBadgeSolution" class="field content-textarea">${esc(b.solution||'')}</textarea>

      <p class="sub top-gap"><strong>Any Room</strong> also covers venue-relative rules such as Riddle 7. <strong>Multipart</strong> is only for rules that explicitly mean EVERY room/game at that Location.</p>`;
    if(archiveBtn){
      archiveBtn.hidden=!id;
      archiveBtn.textContent=b?._archived?'Restore badge':'Archive badge';
    }
    $('contentBadgeRequirement')?.addEventListener('change',refreshBadgeRequirementFields);
    refreshBadgeRequirementFields();
  }

  setContentModalOpen(true);
  requestAnimationFrame(()=>body.querySelector('input,select,textarea')?.focus());
}

function refreshBadgeRequirementFields(){
  const type=$('contentBadgeRequirement')?.value||'any';
  $('contentBadgeSpecificWrap')?.classList.toggle('hidden',type!=='specific');
  $('contentBadgeMultipartWrap')?.classList.toggle('hidden',type!=='multipart');
}

function saveContentEditor(){
  if(!contentEditing)return;
  const {type,id,isNew}=contentEditing;
  ensureContentState();

  if(type==='rooms'){
    const name=normaliseContentName($('contentRoomName')?.value);
    if(!name)return toast('Enter a room name');
    if(roomNameExists(name,id))return toast('A room with that name already exists');

    if(isNew){
      const newId=newContentId('room');
      state.content.rooms[newId]={id:newId,custom:true,name,archived:false,createdAt:new Date().toISOString()};
    }else{
      const current=roomEntityById(id);if(!current)return;
      const oldName=current.name;
      const prior=state.content.rooms[id]||{};
      state.content.rooms[id]={...prior,id,custom:!!current.custom,name,archived:!!current.archived};
      if(oldName!==name)migrateRoomName(oldName,name);
    }
  }

  if(type==='games'){
    const name=normaliseContentName($('contentGameName')?.value);
    const roomId=$('contentGameRoom')?.value||'';
    const cooperative=!!$('contentGameCoop')?.checked;
    const competitive=!!$('contentGameCompetitive')?.checked;
    const levels=Math.max(1,Math.min(99,Number($('contentGameLevels')?.value)||10));
    const description=String($('contentGameDescription')?.value||'').trim();

    if(!name)return toast('Enter a game name');
    if(!roomId||!roomEntityById(roomId))return toast('Choose a room');
    if(!cooperative&&!competitive)return toast('Choose Co-op, Competitive, or both');
    if(gameNameExists(name,id))return toast('A game with that name already exists');

    const roomName=roomNameById(roomId);
    if(isNew){
      const newId=newContentId('game');
      state.content.games[newId]={id:newId,custom:true,name,roomId,cooperative,competitive,levels,description,archived:false,createdAt:new Date().toISOString()};
      excludeNewGameFromExistingLocations(name,roomName);
    }else{
      const current=gameEntityById(id);if(!current)return;
      const oldName=current.name,oldRoom=roomNameById(current.roomId);
      const prior=state.content.games[id]||{};
      state.content.games[id]={
        ...prior,id,custom:!!current.custom,name,roomId,cooperative,competitive,levels,description,archived:!!current.archived
      };
      if(oldName!==name)migrateGameName(oldName,name);
      if(oldRoom!==roomName)migrateGameRoom(name,oldRoom,roomName);
    }
  }

  if(type==='badges'){
    const name=normaliseContentName($('contentBadgeName')?.value);
    const how=String($('contentBadgeHow')?.value||'').trim();
    const availabilityType=$('contentBadgeRequirement')?.value||'any';
    const category=$('contentBadgeCategory')?.value||'standard';
    const multipartRule=$('contentBadgeMultipartRule')?.value||'every-game';
    let requirements=availabilityType==='specific'?collectBadgeRequirementParts():[];

    if(!name)return toast('Enter a badge name');
    if(!how)return toast('Enter the badge requirement');
    if(badgeNameExists(name,id))return toast('A badge with that name already exists');

    if(availabilityType==='specific'&&!requirements.length){
      return toast('Add at least one specific room or game requirement');
    }

    for(const part of requirements){
      if(part.rooms.length&&!part.rooms.every(r=>allRoomEntities({includeArchived:true}).some(x=>x.name===r))){
        return toast('One of those room names is not in the catalogue');
      }
      if(part.games.length&&!part.games.every(g=>allGameEntities({includeArchived:true}).some(x=>x.name===g))){
        return toast('One of those game names is not in the catalogue');
      }
      if(part.level){
        const n=Number(part.level);
        if(!Number.isInteger(n)||n<1||n>99)return toast('Level must be between 1 and 99');
        part.level=n;
      }else part.level=null;
    }

    requirements=normaliseRequirementParts(requirements);
    const flatRooms=[...new Set(requirements.flatMap(p=>p.rooms||[]))];
    const flatGames=[...new Set(requirements.flatMap(p=>p.games||[]))];
    const levels=[...new Set(requirements.map(p=>p.level).filter(Boolean))];

    const data={
      name,how,availabilityType,multipartRule,requirements,category,
      room:availabilityType==='specific'?flatRooms.join(' / '):'',
      game:availabilityType==='specific'?flatGames.join(' / '):'',
      level:availabilityType==='specific'&&levels.length===1?String(levels[0]):'',
      tip:String($('contentBadgeTip')?.value||'').trim(),
      hint:String($('contentBadgeHint')?.value||'').trim(),
      solution:String($('contentBadgeSolution')?.value||'').trim()
    };

    if(isNew){
      const newId=newContentId('badge');
      state.content.badges[newId]={id:newId,custom:true,...data,archived:false,createdAt:new Date().toISOString()};
    }else{
      const rec=BADGE_ENTITIES.find(x=>x.id===id);if(!rec)return;
      const prior=state.content.badges[id]||{};
      state.content.badges[id]={...prior,id,custom:!!rec.custom,...data,archived:!!rec.archived};
      // Earned status and award snapshot intentionally remain untouched.
    }

  }

  applyContentCatalog();
  syncTrophies();
  save();
  setContentModalOpen(false);
  renderAll();
  renderContentManager();
  toast(isNew?'Added':'Saved');
}

function setContentArchived(type,id,archived){
  ensureContentState();
  if(type==='rooms'){
    const room=roomEntityById(id);if(!room)return;
    const prior=state.content.rooms[id]||{};
    state.content.rooms[id]={...prior,id,custom:!!room.custom,name:room.name,archived};
    if(archived){
      state.locations.filter(l=>l.rooms.includes(room.name)).forEach(l=>addCatalogReview(l,`${room.name} was archived from the master catalogue. Historical progress is retained.`));
    }
  }else if(type==='games'){
    const game=gameEntityById(id);if(!game)return;
    const prior=state.content.games[id]||{};
    state.content.games[id]={
      ...prior,id,custom:!!game.custom,name:game.name,roomId:game.roomId,
      cooperative:game.cooperative,competitive:game.competitive,levels:game.levels,
      description:game.description||'',archived
    };
    if(archived){
      const room=roomNameById(game.roomId);
      state.locations.filter(l=>l.rooms.includes(room)&&!l.excludedGames.includes(game.name))
        .forEach(l=>addCatalogReview(l,`${game.name} was archived from ${room}. Historical progress is retained.`));
    }
  }else{
    const rec=BADGE_ENTITIES.find(x=>x.id===id);if(!rec)return;
    const prior=state.content.badges[id]||{};
    state.content.badges[id]={...prior,id,custom:!!rec.custom,archived};
    if(archived){
      state.pins=state.pins.filter(i=>i!==rec.index);
      if(Number(focusBadgeIndex)===rec.index)$('focusOverlay')?.classList.remove('open');
    }
  }

  applyContentCatalog();
  syncTrophies();
  save();
  renderAll();
  renderContentManager();
  toast(archived?'Archived':'Restored');
}

function toggleContentArchived(type,id){
  if(type==='rooms'){
    const x=roomEntityById(id);if(x)setContentArchived(type,id,!x.archived);
  }else if(type==='games'){
    const x=gameEntityById(id);if(x)setContentArchived(type,id,!x.archived);
  }else{
    const x=BADGE_ENTITIES.find(y=>y.id===id);if(x)setContentArchived(type,id,!x.archived);
  }
}

function renderAll(){ensureLevelProgress();renderPlayerBrand();renderHome();renderBadges();renderLocations();renderCompetitive();renderLevels();renderStats();renderContentManager();save()}

function toggleEarn(i){
  if(state.earned[i]){
    delete state.earned[i];
    state.history=state.history.filter(h=>Number(h.badge)!==Number(i));
    clearBadgeAward(i);
  }else{
    state.earned[i]=true;
    const date=recordBadgeAward(i);
    state.history.unshift({badge:i,date});
  }
  syncTrophies();
  renderAll();updatePageHeader('home');
}

function togglePin(i){return toggleBadgePin(i)}

function openBadge(i){
  modalBadgeIndex=i;const b=BADGES[i];
  $('modalTitle').textContent=b.name;
  const award=state.badgeAwards?.[badgeIdAt(i)];
  $('modalBody').innerHTML=`
    <div class="detail"><strong>How to earn</strong>${esc(b.how)}</div>
    ${badgeRequirementMarkup(b)}
    ${state.earned[i]&&awardTermsChanged(i)?`<div class="detail award-legacy-detail"><strong>Earned under earlier terms</strong>This badge remains earned. Award recorded ${esc(award?.earnedAt||'previously')}.</div>`:''}
    ${b.tip?`<div class="detail"><strong>Tip / watch out</strong>${esc(b.tip)}</div>`:''}
    ${b.hint?`<div class="detail"><strong>Hint</strong>${esc(b.hint)}</div>`:''}
    ${b.solution?`<div class="detail"><strong>Spoiler solution</strong><button id="revealSolution" class="btn ghost">Reveal</button><div id="solutionText" style="display:none;margin-top:8px">${esc(b.solution)}</div></div>`:''}`;
  $('modalEarn').textContent=state.earned[i]?'Mark not earned':'Mark earned';
  $('modalEarn').disabled=false;
  $('modalPin').textContent=state.pins.includes(i)?'Unpin':'Pin';
  $('badgeModal').classList.add('open');
  if($('revealSolution'))$('revealSolution').onclick=()=>{$('solutionText').style.display='block';$('revealSolution').style.display='none'};
}



let focusFitFrame=0;

function fitFocusText(){
  const overlay=$('focusOverlay');
  const body=$('focusOverlayBody');
  if(!overlay?.classList.contains('open') || !body)return;

  const landscape=window.matchMedia('(orientation:landscape) and (min-width:700px)').matches;

  // Titles intentionally do NOT scale from badge to badge.
  // Only the instruction/detail copy is fitted to the available Focus body.
  const limits=landscape
    ? {reqMin:18,reqMax:30,detailMin:12.5,detailMax:16,metaMin:11,metaMax:13}
    : {reqMin:18,reqMax:34,detailMin:13,detailMax:17,metaMin:11,metaMax:13};

  const apply=t=>{
    const lerp=(a,b)=>a+(b-a)*t;
    body.style.setProperty('--focus-requirement-size',`${lerp(limits.reqMin,limits.reqMax).toFixed(2)}px`);
    body.style.setProperty('--focus-detail-size',`${lerp(limits.detailMin,limits.detailMax).toFixed(2)}px`);
    body.style.setProperty('--focus-meta-size',`${lerp(limits.metaMin,limits.metaMax).toFixed(2)}px`);
  };

  // Measure with internal scrolling disabled so scrollHeight tells us the true fit.
  body.classList.add('focus-fitting');
  body.style.overflowY='hidden';

  apply(1);
  const fits=()=>body.scrollHeight<=body.clientHeight+1 && body.scrollWidth<=body.clientWidth+1;

  if(!fits()){
    let lo=0,hi=1,best=0;
    apply(0);
    if(fits()){
      for(let n=0;n<12;n++){
        const mid=(lo+hi)/2;
        apply(mid);
        if(fits()){best=mid;lo=mid}else{hi=mid}
      }
      apply(best);
    }else{
      // Extremely long cards still remain usable rather than clipping.
      apply(0);
      body.style.overflowY='auto';
    }
  }

  body.classList.remove('focus-fitting');
}

function scheduleFocusTextFit(){
  cancelAnimationFrame(focusFitFrame);
  focusFitFrame=requestAnimationFrame(()=>{
    focusFitFrame=requestAnimationFrame(fitFocusText);
  });
}

function focusSequenceFor(source,badgeIndex){
  if(source==='pins')return [...(state.pins||[])];
  if(source==='badges')return filteredBadgeIndices();
  if(source==='recent')return recentBadgeIndices();
  return [Number(badgeIndex)];
}

function focusContextName(source){
  if(source==='pins')return 'Pinned badges';
  if(source==='badges')return 'Badges';
  if(source==='recent')return 'Recent achievements';
  return 'Badge';
}

function setFocusContext(source,badgeIndex,explicitIndices=null){
  const indices=Array.isArray(explicitIndices)
    ? explicitIndices.map(Number).filter(Number.isInteger)
    : focusSequenceFor(source,badgeIndex);

  focusContext={
    source:source||'single',
    indices:indices.length?indices:[Number(badgeIndex)]
  };

  const pos=focusContext.indices.indexOf(Number(badgeIndex));
  focusIndex=pos>=0?pos:0;
  focusBadgeIndex=Number(badgeIndex);
}

function refreshFocusContextForCurrentBadge(){
  if(focusContext.source==='pins'){
    focusContext.indices=[...(state.pins||[])];
  }else if(focusContext.source==='badges'){
    focusContext.indices=filteredBadgeIndices();
  }else if(focusContext.source==='recent'){
    focusContext.indices=recentBadgeIndices();
  }

  if(!focusContext.indices.length)return false;

  const pos=focusContext.indices.indexOf(Number(focusBadgeIndex));
  if(pos>=0)focusIndex=pos;
  else focusIndex=Math.min(focusIndex,focusContext.indices.length-1);
  return true;
}

function updateFocusNavUi(){
  const count=focusContext.indices.length;
  const contextLabel=$('focusContextLabel');
  if(contextLabel)contextLabel.textContent=focusContextName(focusContext.source);

  const pos=$('focusPosition');
  if(pos)pos.textContent=count?`${focusIndex+1} / ${count}`:'';

  const prev=$('focusPrev'),next=$('focusNext');
  const hasMultiple=count>1;
  if(prev){
    prev.disabled=!hasMultiple;
    prev.setAttribute('aria-label',hasMultiple?'Previous badge in this list':'No previous badge');
  }
  if(next){
    next.disabled=!hasMultiple;
    next.setAttribute('aria-label',hasMultiple?'Next badge in this list':'No next badge');
  }
}

function openBadgeFocus(i,opts={}){
  const badgeIndex=Number(i);
  const b=BADGES[badgeIndex];
  if(!b)return;

  if(opts.newContext!==false){
    const source=opts.source||'single';
    setFocusContext(source,badgeIndex,opts.indices||null);
  }else{
    focusBadgeIndex=badgeIndex;
    const pos=focusContext.indices.indexOf(badgeIndex);
    if(pos>=0)focusIndex=pos;
  }

  const achieved=!!state.earned[badgeIndex];

  updateFocusNavUi();

  $('focusOverlayBody').innerHTML=`<section>
    <div class="focus-meta">${esc(b.room||'Any room')}${b.game?' • '+esc(b.game):''}${b.level?' • Level '+esc(b.level):''}</div>
    <h2 class="focus-title">${esc(b.name)}</h2>
    ${achieved?'<div class="focus-achieved-banner"><span class="focus-achieved-symbol">★</span><span>ACHIEVED</span></div>':''}
    <p class="focus-requirement">${esc(b.how)}</p>
  </section>
  <section>
    ${b.tip?`<div class="detail"><strong>Tip / watch out</strong>${esc(b.tip)}</div>`:''}
    ${b.hint?`<div class="detail"><strong>Hint</strong>${esc(b.hint)}</div>`:''}
    ${b.solution?`<div class="detail"><strong>Spoiler</strong><button id="focusReveal" class="btn ghost">Reveal</button><div id="focusSolution" style="display:none;margin-top:8px">${esc(b.solution)}</div></div>`:''}
  </section>`;

  const inner=$('focusOverlay')?.querySelector('.focus-inner');
  inner?.classList.toggle('focus-achieved',achieved);

  const completeBtn=$('focusComplete');
  if(completeBtn){
    completeBtn.disabled=achieved || isTrophy(b);
    completeBtn.classList.toggle('achieved-locked',achieved);
    completeBtn.classList.toggle('trophy-locked',isTrophy(b)&&!achieved);

    if(achieved){
      completeBtn.textContent='ACHIEVED';
      completeBtn.setAttribute('aria-label','Badge already achieved');
    }else if(isTrophy(b)){
      completeBtn.textContent='Unlocks automatically';
      completeBtn.setAttribute('aria-label','Trophy unlocks automatically');
    }else{
      completeBtn.textContent='MARK BADGE EARNED';
      completeBtn.setAttribute('aria-label','Mark this badge as earned');
    }
  }

  $('focusOverlay').classList.add('open');
  scheduleFocusTextFit();

  if($('focusReveal'))$('focusReveal').onclick=()=>{
    $('focusSolution').style.display='block';
    $('focusReveal').style.display='none';
    scheduleFocusTextFit();
  };
}

function openFocusFromPins(index){
  if(!state.pins.length)return;
  const pos=(Number(index)+state.pins.length)%state.pins.length;
  openBadgeFocus(state.pins[pos],{source:'pins'});
}

function moveFocus(step){
  if(!refreshFocusContextForCurrentBadge())return;

  const count=focusContext.indices.length;
  if(!count)return;

  const currentPos=focusContext.indices.indexOf(Number(focusBadgeIndex));
  const base=currentPos>=0?currentPos:Math.min(focusIndex,count-1);
  focusIndex=(base+step+count)%count;
  focusBadgeIndex=focusContext.indices[focusIndex];
  openBadgeFocus(focusBadgeIndex,{newContext:false});
}

// Backwards-compatible wrapper used by existing pinned Open buttons.
function openFocusOverlay(index){
  openFocusFromPins(index);
}

function exportBackup(){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='activate-badge-backup-v8.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}



function emptyLevelProgress(){
  return {games:{},competitive:{},importedAt:null,player:null,source:null,lastImportReport:null};
}
function ensureLevelProgressStore(){
  if(!state.levelProgressByLocation || typeof state.levelProgressByLocation!=='object'){
    state.levelProgressByLocation={};
  }

  if(!state._levelProgressMigrated){
    const legacy=state.levelProgress;
    const activeId=state.activeLocation || state.locations?.[0]?.id || 'home';
    const hasLegacy=!!legacy && (
      Object.keys(legacy.games||{}).length>0 ||
      Object.keys(legacy.competitive||{}).length>0 ||
      !!legacy.importedAt ||
      !!legacy.player
    );

    if(hasLegacy && !state.levelProgressByLocation[activeId]){
      state.levelProgressByLocation[activeId]={
        games:{...(legacy.games||{})},
        competitive:{...(legacy.competitive||{})},
        importedAt:legacy.importedAt||null,
        player:legacy.player||null,
        source:legacy.source||null
      };
    }
    state._levelProgressMigrated=true;
  }
}
function activeLevelProgress(){
  ensureLevelProgressStore();
  const id=state.activeLocation || state.locations?.[0]?.id || 'home';
  if(!state.levelProgressByLocation[id]){
    state.levelProgressByLocation[id]=emptyLevelProgress();
  }
  const p=state.levelProgressByLocation[id];
  if(!p.games)p.games={};
  if(!p.competitive)p.competitive={};
  if(p.lastImportReport===undefined)p.lastImportReport=null;
  return p;
}
function ensureLevelProgress(){
  return activeLevelProgress();
}
function csvRows(t){let a=[],r=[],f='',q=false;for(let i=0;i<t.length;i++){let c=t[i];if(q){if(c==='"'&&t[i+1]==='"'){f+='"';i++}else if(c==='"')q=false;else f+=c}else if(c==='"')q=true;else if(c===','){r.push(f);f=''}else if(c==='\n'){r.push(f);a.push(r);r=[];f=''}else if(c!=='\r')f+=c}if(f||r.length){r.push(f);a.push(r)}return a}
function csvChangeLabel(room,game,level=null){
  return `${room} • ${game}${level?` • Level ${level}`:''}`;
}

function csvImportReportCount(report){
  if(!report)return 0;
  return [
    report.newLevels,
    report.newGames,
    report.newCompetitiveGames,
    report.highScoresGained,
    report.highScoresLost,
    report.scoreImprovements,
    report.venueHighChanges
  ].reduce((n,list)=>n+(Array.isArray(list)?list.length:0),0);
}

function renderCsvImportReport(report=activeLevelProgress()?.lastImportReport){
  const el=$('csvImportReport');
  if(!el)return;

  if(!report){
    el.innerHTML='';
    el.classList.add('hidden');
    return;
  }

  const newGames=[...(report.newGames||[]),...(report.newCompetitiveGames||[])];
  const chips=[
    ['New levels',(report.newLevels||[]).length],
    ['New games',newGames.length],
    ['Highs gained',(report.highScoresGained||[]).length],
    ['Highs lost',(report.highScoresLost||[]).length],
    ['Scores improved',(report.scoreImprovements||[]).length]
  ];

  const group=(title,items,kind='')=>{
    if(!items?.length)return '';
    return `<details class="csv-report-group ${kind}" open>
      <summary>${esc(title)} <span>${items.length}</span></summary>
      <div class="csv-report-list">${items.map(x=>`<div class="csv-report-item">${esc(x)}</div>`).join('')}</div>
    </details>`;
  };

  const changeCount=csvImportReportCount(report);
  const when=report.importedAt?new Date(report.importedAt).toLocaleString():'';

  el.classList.remove('hidden');
  el.innerHTML=`
    <div class="csv-report-head row between wrap">
      <div>
        <div class="label">CSV change report</div>
        <h4>${changeCount?`${changeCount} recorded change${changeCount===1?'':'s'}`:'No progress changes detected'}</h4>
      </div>
      <div class="sub">${esc(report.location||activeLocation().name)}${when?' • '+esc(when):''}</div>
    </div>

    <div class="csv-report-summary">
      ${chips.map(([label,count])=>`<span class="csv-report-chip ${count?'has-change':''}"><strong>${count}</strong> ${esc(label)}</span>`).join('')}
    </div>

    ${group('New levels completed',report.newLevels,'new')}
    ${group('New games played',newGames,'new')}
    ${group('Venue high scores gained',report.highScoresGained,'gain')}
    ${group('Venue high scores lost',report.highScoresLost,'loss')}
    ${group('Personal scores improved',report.scoreImprovements,'improve')}
    ${group('Other venue high-score changes',report.venueHighChanges,'venue')}
    ${!changeCount?'<div class="csv-report-empty sub">This upload matches the progress already stored for this Location.</div>':''}
  `;
}

function importScores(t){
  const rows=csvRows(t).filter(r=>r.some(c=>String(c||'').trim()!==''));
  if(!rows.length)throw Error('The selected CSV is empty.');

  const headerIndex=rows.findIndex(r=>
    String(r[0]||'').trim().toLowerCase()==='room' &&
    String(r[1]||'').trim().toLowerCase()==='game'
  );
  if(headerIndex<0)throw Error('Could not find the Room / Game header row. Please use an export from Activate-scores.ca.');

  const progress=activeLevelProgress();
  const playerRow=rows.slice(0,headerIndex).find(r=>String(r[0]||'').toLowerCase().startsWith('activate:'));
  const player=playerRow?String(playerRow[0]).replace(/^Activate:\s*/i,'').trim():null;
  const importedAt=new Date().toISOString();

  const report={
    importedAt,
    location:activeLocation().name,
    player,
    newLevels:[],
    newGames:[],
    newCompetitiveGames:[],
    highScoresGained:[],
    highScoresLost:[],
    scoreImprovements:[],
    venueHighChanges:[]
  };

  let games=0,totalCompleted=0,competitivePlayed=0;

  for(const r of rows.slice(headerIndex+1)){
    const room=String(r[0]||'').trim();
    const game=String(r[1]||'').trim();
    if(!room||!game||game.toLowerCase()==='total')continue;

    const cat=GAME_CATALOG[room]||{};
    const isCoop=(cat.cooperative||[]).includes(game);
    const isComp=(cat.competitive||[]).includes(game);

    // Competitive-only games do not have level progression.
    if(isComp&&!isCoop){
      const key=room+'||'+game;
      const wasPlayed=!!progress.competitive[key];
      const played=r.slice(2).some(v=>{
        const n=Number(String(v||'').replace(/,/g,'').trim());
        return Number.isFinite(n)&&n>0;
      });

      if(played){
        progress.competitive[key]=true;
        competitivePlayed++;
        if(!wasPlayed)report.newCompetitiveGames.push(`${csvChangeLabel(room,game)} • Competitive`);
      }
      games++;
      continue;
    }

    // Cooperative (including games that also have a competitive mode): parse configured level count.
    const key=room+'||'+game;
    const prior=progress.games[key]||{room,game,levels:{}};
    const priorLevels={...(prior.levels||{})};
    (prior.complete||[]).forEach(level=>{
      priorLevels[level]=priorLevels[level]||{score:0,topScore:0,complete:true};
      priorLevels[level].complete=true;
    });

    const wasGamePlayed=Object.values(priorLevels).some(x=>!!x?.complete);
    const levels={...priorLevels};
    let foundLevel=false;

    for(let i=2;i+2<r.length;i+=3){
      const level=parseInt(String(r[i]||'').trim(),10);
      if(!(level>=1&&level<=levelCountForGame(room,game)))continue;
      foundLevel=true;

      const csvScore=Number(String(r[i+1]||'0').replace(/,/g,'').trim())||0;
      const csvTopScore=Number(String(r[i+2]||'0').replace(/,/g,'').trim())||0;

      const old=levels[level]||{score:0,topScore:0,complete:false};
      const oldScore=Number(old.score)||0;
      const oldTopScore=Number(old.topScore)||0;
      const wasComplete=!!old.complete;
      const oldHigh=oldScore>0&&oldTopScore>0&&oldScore===oldTopScore;

      const score=Math.max(oldScore,csvScore);
      const topScore=csvTopScore||oldTopScore;
      const complete=csvScore>0||wasComplete;
      const newHigh=score>0&&topScore>0&&score===topScore;
      const label=csvChangeLabel(room,game,level);

      levels[level]={score,topScore,complete};

      if(complete){
        totalCompleted++;
        if(!wasComplete)report.newLevels.push(label);
      }

      if(csvScore>oldScore){
        report.scoreImprovements.push(`${label} • ${oldScore||0} → ${csvScore}`);
      }

      if(!oldHigh&&newHigh){
        report.highScoresGained.push(`${label} • ${score}`);
      }else if(oldHigh&&!newHigh){
        report.highScoresLost.push(`${label} • Your ${score} • Venue high ${topScore}`);
      }else if(oldTopScore>0&&topScore>0&&oldTopScore!==topScore){
        report.venueHighChanges.push(`${label} • ${oldTopScore} → ${topScore}`);
      }
    }

    if(foundLevel){
      progress.games[key]={room,game,levels};
      const isGamePlayed=Object.values(levels).some(x=>!!x?.complete);
      if(!wasGamePlayed&&isGamePlayed){
        report.newGames.push(`${csvChangeLabel(room,game)} • Co-op`);
      }
      games++;
    }
  }

  if(!games)throw Error('No game rows were found in this Activate-scores.ca export.');

  progress.importedAt=importedAt;
  progress.player=player;
  progress.source='Activate-scores.ca';

  if(player){
    // The player identity embedded in the imported Activate-scores CSV
    // is authoritative for the personalised header name.
    state.playerName=normalisePlayerName(player);
    renderPlayerBrand();
  }
  progress.lastImportReport=report;

  save();
  renderLevels();
  renderCsvImportReport(report);

  return {
    games,
    newLevels:report.newLevels.length,
    totalCompleted,
    competitivePlayed,
    player,
    report,
    changeCount:csvImportReportCount(report)
  };
}
function gameModesForRoom(room){
  const c=GAME_CATALOG[room]||{};
  return {
    cooperative:[...(c.cooperative||[])],
    competitive:[...(c.competitive||[])]
  };
}
function progressEntries(){
  const progress=activeLevelProgress();
  const entries=[];
  const l=activeLocation();

  const rooms=[...new Set(Array.isArray(l.rooms)?l.rooms:[])];

  rooms.forEach(room=>{
    const modes=gameModesForRoom(room);

    modes.cooperative.forEach(game=>{
      const x=progress.games[room+'||'+game]||{};
      const levels={...(x.levels||{})};
      (Array.isArray(x.complete)?x.complete:[]).forEach(n=>{
        levels[n]=levels[n]||{score:0,topScore:0,complete:true};
        levels[n].complete=true;
      });
      entries.push({room,game,mode:'cooperative',levels});
    });

    modes.competitive.forEach(game=>{
      entries.push({
        room,game,mode:'competitive',
        played:!!progress.competitive[room+'||'+game]
      });
    });
  });

  return entries.sort((a,b)=>a.room.localeCompare(b.room)||a.game.localeCompare(b.game)||a.mode.localeCompare(b.mode));
}

function gamePlayEntries(){
  const entries=progressEntries();
  return entries.map(x=>{
    if(x.mode==='competitive'){
      return {room:x.room,game:x.game,mode:'competitive',played:!!x.played};
    }
    const played=Array.from({length:levelCountForGame(x.room,x.game)},(_,i)=>i+1).some(n=>!!x.levels?.[n]?.complete);
    return {room:x.room,game:x.game,mode:'cooperative',played};
  }).sort((a,b)=>a.room.localeCompare(b.room)||a.game.localeCompare(b.game)||a.mode.localeCompare(b.mode));
}

function renderLevels(){
  if(!$('levelsList'))return;

  const progress=activeLevelProgress();
  if($('levelsImportLocation'))$('levelsImportLocation').textContent=`Progress dataset: ${activeLocation().name}`;

  const roomSel=$('levelsRoom');
  const gameSel=$('levelsGame');
  const currentRoom=roomSel?.value||'';
  const currentGame=gameSel?.value||'';
  const entries=progressEntries();
  const rooms=[...new Set(entries.map(x=>x.room))].sort();

  if(roomSel){
    roomSel.innerHTML='<option value="">All rooms</option>'+rooms.map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join('');
    if(rooms.includes(currentRoom))roomSel.value=currentRoom;
  }

  const selectedRoom=roomSel?.value||'';

  if(gameSel){
    const games=selectedRoom
      ? [...new Set(entries.filter(x=>x.room===selectedRoom).map(x=>x.game))].sort((a,b)=>a.localeCompare(b))
      : [];

    gameSel.disabled=!selectedRoom;
    gameSel.classList.toggle('disabled-filter',!selectedRoom);
    gameSel.innerHTML=selectedRoom
      ? '<option value="">All games</option>'+games.map(g=>`<option value="${esc(g)}">${esc(g)}</option>`).join('')
      : '<option value="">Select a room first</option>';

    if(selectedRoom && games.includes(currentGame))gameSel.value=currentGame;
    else gameSel.value='';
  }

  const selectedGame=gameSel?.value||'';
  const levelMode=$('levelsView')?.value||'all';
  const gameMode=$('gamesView')?.value||'all';

  const levelFilter=$('levelsView');
  const gameFilter=$('gamesView');
  if(levelFilter)levelFilter.classList.toggle('hidden',levelsDisplayMode!=='levels');
  if(gameFilter)gameFilter.classList.toggle('hidden',levelsDisplayMode!=='games');
  document.querySelectorAll('[data-levels-mode]').forEach(b=>b.classList.toggle('active',b.dataset.levelsMode===levelsDisplayMode));

  const visibleRooms=rooms.filter(r=>!selectedRoom||r===selectedRoom);
  let totalGames=0,playedGames=0,totalLevels=0,completeLevels=0,venueHighScores=0;

  const roomHtml=visibleRooms.map(room=>{
    const roomEntries=entries.filter(x=>x.room===room && (!selectedGame||x.game===selectedGame));
    const coop=roomEntries.filter(x=>x.mode==='cooperative').sort((a,b)=>a.game.localeCompare(b.game));
    const comp=roomEntries.filter(x=>x.mode==='competitive').sort((a,b)=>a.game.localeCompare(b.game));

    const gameBlocks=[];

    coop.forEach(g=>{
      const played=Array.from({length:levelCountForGame(g.room,g.game)},(_,i)=>i+1).some(n=>!!g.levels?.[n]?.complete);
      totalGames++; if(played)playedGames++;

      if(levelsDisplayMode==='games'){
        if(gameMode==='played'&&!played)return;
        if(gameMode==='unplayed'&&played)return;
        gameBlocks.push(`
          <article class="room-game-card coop-game ${played?'played-card':'unplayed-card'}">
            <div class="room-game-head">
              <div>
                <span class="mode-tag coop-tag">CO-OP</span>
                <strong>${esc(g.game)}</strong>
              </div>
              <span class="status-tag ${played?'status-played':'status-unplayed'}">${played?'✓ Played':'✕ Not played'}</span>
            </div>
          </article>`);
        return;
      }

      const levelItems=[];
      for(let level=1;level<=levelCountForGame(g.room,g.game);level++){
        const info=g.levels?.[level]||g.levels?.[String(level)]||{};
        const done=!!info.complete;
        const score=Number(info.score)||0;
        const topScore=Number(info.topScore)||0;
        const isHighScore=score>0 && topScore>0 && score===topScore;

        totalLevels++;
        if(done)completeLevels++;
        if(isHighScore)venueHighScores++;

        if(levelMode==='complete'&&!done)continue;
        if(levelMode==='incomplete'&&done)continue;
        if(levelMode==='highscore'&&!isHighScore)continue;

        const scoreBits=[];
        if(score>0)scoreBits.push(`Score ${score}`);
        if(topScore>0)scoreBits.push(`Venue high ${topScore}`);

        levelItems.push(`
          <div class="level-chip ${done?'level-chip-done':'level-chip-open'} ${isHighScore?'high-score-level':''}">
            <div class="level-chip-main">
              <div class="level-chip-title-row">
                <strong>Level ${level}</strong>
                ${isHighScore?'<span class="high-score-tag">★ HIGH SCORE</span>':''}
              </div>
              ${scoreBits.length?`<span>${scoreBits.join(' • ')}</span>`:''}
            </div>
            <span class="status-icon ${done?'status-icon-done':'status-icon-open'}">${done?'✓':'✕'}</span>
          </div>`);
      }

      if(levelItems.length){
        gameBlocks.push(`
          <article class="room-game-card coop-game ${played?'played-card':'unplayed-card'}">
            <div class="room-game-head">
              <div>
                <span class="mode-tag coop-tag">CO-OP</span>
                <strong>${esc(g.game)}</strong>
              </div>
              <span class="status-tag ${played?'status-played':'status-unplayed'}">${played?'✓ Played':'✕ Not played'}</span>
            </div>
            <div class="level-grid">${levelItems.join('')}</div>
          </article>`);
      }
    });

    // Competitive games always render after all co-op games in the room.
    comp.forEach(g=>{
      const played=!!g.played;
      totalGames++; if(played)playedGames++;

      if(levelsDisplayMode==='games'){
        if(gameMode==='played'&&!played)return;
        if(gameMode==='unplayed'&&played)return;
      }else{
        if(levelMode==='highscore')return;
        if(levelMode==='complete'&&!played)return;
        if(levelMode==='incomplete'&&played)return;
        totalLevels++; if(played)completeLevels++;
      }

      gameBlocks.push(`
        <article class="room-game-card competitive-game ${played?'played-card':'unplayed-card'}">
          <div class="room-game-head">
            <div>
              <span class="mode-tag competitive-tag">COMPETITIVE</span>
              <strong>${esc(g.game)}</strong>
            </div>
            <button class="status-tag status-button ${played?'status-played':'status-unplayed'}"
              data-toggle-comp-played="${esc(g.room)}||${esc(g.game)}"
              aria-pressed="${played?'true':'false'}">${played?'✓ Played':'✕ Not played'}</button>
          </div>
        </article>`);
    });

    if(!gameBlocks.length)return '';

    return `
      <section class="room-section">
        <div class="room-title-row">
          <span class="room-label">ROOM</span>
          <h3>${esc(room)}</h3>
        </div>
        <div class="room-games">${gameBlocks.join('')}</div>
      </section>`;
  }).join('');

  if(levelsDisplayMode==='games'){
    $('levelsSummary').textContent=`${playedGames}/${totalGames} games played • ${esc(activeLocation().name)}`;
  }else if(levelMode==='highscore'){
    $('levelsSummary').textContent=`${venueHighScores} venue high score${venueHighScores===1?'':'s'} • ${esc(activeLocation().name)}`;
  }else{
    $('levelsSummary').textContent=`${completeLevels}/${totalLevels} complete • ${venueHighScores} venue high score${venueHighScores===1?'':'s'} • ${esc(activeLocation().name)}`;
  }

  $('levelsImportInfo').textContent=progress.importedAt
    ? `Last import for ${activeLocation().name}: ${new Date(progress.importedAt).toLocaleString()}${progress.player?' • '+progress.player:''}`
    : `No Activate-scores.ca export imported for ${activeLocation().name} yet.`;

  renderCsvImportReport(progress.lastImportReport);
  $('levelsList').innerHTML=roomHtml||'<div class="item sub">Nothing matches this filter.</div>';
}

async function init(){
  try{
    const [badgeRes,roomRes]=await Promise.all([fetch('badges.json',{cache:'no-store'}),fetch('rooms.json',{cache:'no-store'})]);
    if(!badgeRes.ok||!roomRes.ok)throw new Error('Data files failed to load');
    BASE_BADGES=await badgeRes.json();
    const roomData=await roomRes.json();
    BASE_ROOMS=[...(roomData.rooms||[])];
    BASE_GAMES=[...(roomData.games||[])];
    BASE_GAME_CATALOG=structuredClone(roomData.catalog||{});
    BASE_COMPETITIVE_INFO=structuredClone(roomData.competitiveInfo||{});
    buildBaseGameEntities();
    loadState();
    applyContentCatalog();
    bindEvents();
    renderAll();
}catch(err){
    console.error(err);
    
    document.body.insertAdjacentHTML('afterbegin',`<div style="padding:16px;background:#5b1125;color:white">App failed to load: ${esc(err.message)}. Refresh the page after GitHub Pages finishes deploying.</div>`);
  }
}


function openDrawer(){
  const drawer=$('sideDrawer'),backdrop=$('drawerBackdrop'),btn=$('drawerMenuBtn');
  if(!drawer||!backdrop)return;
  backdrop.hidden=false;
  requestAnimationFrame(()=>{
    drawer.classList.add('open');
    backdrop.classList.add('open');
  });
  drawer.setAttribute('aria-hidden','false');
  btn?.setAttribute('aria-expanded','true');
}
function closeDrawer(){
  const drawer=$('sideDrawer'),backdrop=$('drawerBackdrop'),btn=$('drawerMenuBtn');
  if(!drawer||!backdrop)return;
  drawer.classList.remove('open');
  backdrop.classList.remove('open');
  drawer.setAttribute('aria-hidden','true');
  btn?.setAttribute('aria-expanded','false');
  setTimeout(()=>{if(!drawer.classList.contains('open'))backdrop.hidden=true},220);
}
function showView(view,opts={}){
  if(!view)return;
  if(!opts.fromBack && currentView!==view){
    appViewStack.push(view);
  }
  currentView=view;
  updatePageHeader?.(view);
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  $(view)?.classList.add('active');
  document.querySelectorAll('.drawer-nav [data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  closeDrawer?.();
}


const PAGE_META={
  home:{title:'Home',subtitle:'Dashboard overview',icon:'home'},
  badges:{title:'Badges',subtitle:'View and manage your badges',icon:'badges'},
  levels:{title:'Levels',subtitle:'Track your level progress',icon:'levels'},
  competitive:{title:'Competitive',subtitle:'Manage your competitive play',icon:'competitive'},
  locations:{title:'Locations',subtitle:'Explore and track locations',icon:'locations'},
  stats:{title:'Stats',subtitle:'View your statistics and insights',icon:'stats'},
  settings:{title:'Settings',subtitle:'Configure your preferences',icon:'settings'}
};
function updatePageHeader(view){
  const meta=PAGE_META[view]||PAGE_META.home;
  const title=$('pageHeaderTitle'),subtitle=$('pageHeaderSubtitle'),icon=$('pageHeaderIcon');
  if(title)title.textContent=meta.title;
  if(subtitle)subtitle.textContent=meta.subtitle;
  if(icon)icon.src=`icons/header/${meta.icon}.svg`;

  const pageBar=document.querySelector('.page-bar');
  const shell=document.querySelector('.app-header-shell');

  if(pageBar){
    pageBar.dataset.page=view;

    // Promote the active page accent to the complete header shell.
    // This lets the page colour blend upward behind the player's
    // personalised tag without hard-coding a second palette.
    const pageStyle=getComputedStyle(pageBar);
    const accent=pageStyle.getPropertyValue('--page-accent').trim()||'#43E7FF';
    const accentRgb=pageStyle.getPropertyValue('--page-accent-rgb').trim()||'67,231,255';

    shell?.style.setProperty('--active-page-accent',accent);
    shell?.style.setProperty('--active-page-accent-rgb',accentRgb);
  }
}


let currentView='home';
let appViewStack=['home'];
let focusReturnView='home';

function closeFocusWithoutCompleting(){
  const overlay=$('focusOverlay');
  if(overlay)overlay.classList.remove('open');
}

function appBack(){
  if($('focusOverlay')?.classList.contains('open')){
    closeFocusWithoutCompleting();
    return true;
  }
  if($('competitiveModal')?.classList.contains('open')){
    $('competitiveModal').classList.remove('open');
    return true;
  }
  if($('badgeModal')?.classList.contains('open')){
    $('badgeModal').classList.remove('open');
    return true;
  }
  if($('contentEditorModal')?.classList.contains('open')){
    setContentModalOpen(false);
    return true;
  }
  if($('sideDrawer')?.classList.contains('open') || $('drawerBackdrop')?.classList.contains('open')){
    closeDrawer?.();
    return true;
  }
  if(appViewStack.length>1){
    appViewStack.pop();
    const previous=appViewStack[appViewStack.length-1]||'home';
    showView(previous,{fromBack:true});
    return true;
  }
  return false;
}

function installBackGuard(){
  try{
    history.replaceState({activateTracker:true,guard:true},'');
    history.pushState({activateTracker:true,guard:true},'');
    window.addEventListener('popstate',()=>{
      const handled=appBack();
      // Keep one browser-history entry ahead so Android edge-back is routed
      // through the app rather than immediately leaving the PWA.
      try{history.pushState({activateTracker:true,guard:true},'')}catch{}
      return handled;
    });
  }catch{}
}

function bindEvents(){
  // Pin controls get first refusal in CAPTURE phase.
  // This makes them independent of the clickable badge-card event path.
  document.addEventListener('click',e=>{
    const pin=e.target.closest('[data-pin-badge],[data-pin],[data-focus-pin]');
    const unpin=e.target.closest('[data-unpin-badge],[data-unpin]');
    if(!pin && !unpin)return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if(unpin){
      const i=Number(unpin.dataset.unpinBadge??unpin.dataset.unpin);
      setBadgePinned(i,false);
      return;
    }

    if(pin){
      const raw=pin.dataset.pinBadge??pin.dataset.pin??pin.dataset.focusPin;
      toggleBadgePin(Number(raw));
    }
  },true);


  window.addEventListener('resize',scheduleFocusTextFit,{passive:true});
  window.addEventListener('orientationchange',scheduleFocusTextFit,{passive:true});
  if(document.fonts?.ready)document.fonts.ready.then(scheduleFocusTextFit).catch(()=>{});


  document.querySelectorAll('[data-levels-mode]').forEach(btn=>btn.addEventListener('click',()=>{
    levelsDisplayMode=btn.dataset.levelsMode||'levels';
    renderLevels();
  }));

  let touchStartX=0,touchStartY=0,touchStartTime=0;
  document.addEventListener('touchstart',e=>{
    if(e.touches.length!==1)return;
    const t=e.touches[0];
    touchStartX=t.clientX;touchStartY=t.clientY;touchStartTime=Date.now();
  },{passive:true});
  document.addEventListener('touchend',e=>{
    if(!touchStartTime || !e.changedTouches.length)return;
    const t=e.changedTouches[0];
    const dx=t.clientX-touchStartX,dy=Math.abs(t.clientY-touchStartY);
    const elapsed=Date.now()-touchStartTime;
    const startedAtEdge=touchStartX<=42;
    touchStartTime=0;
    if(startedAtEdge && dx>=72 && dy<=80 && elapsed<=700){
      appBack();
    }
  },{passive:true});

  const onClick=(id,fn)=>{const el=$(id);if(el)el.onclick=fn};
  const onChange=(id,fn)=>{const el=$(id);if(el)el.onchange=fn};
  const listen=(id,event,fn)=>{const el=$(id);if(el)el.addEventListener(event,fn)};

  document.addEventListener('change',e=>{
    const cp=e.target.closest('[data-competitive-played]');
    if(!cp)return;
    const key=cp.dataset.competitivePlayed;
    const cut=key.indexOf('||');
    const room=key.slice(0,cut),game=key.slice(cut+2);
    setCompetitivePlayed(room,game,cp.checked);
    renderLevels();
    renderCompetitive();
    toast(cp.checked?'Marked as played':'Marked as not played');
  });

  listen('drawerMenuBtn','click',openDrawer);
  listen('closeDrawer','click',closeDrawer);
  listen('drawerBackdrop','click',closeDrawer);

  document.addEventListener('click',e=>{
    if(e.target.closest('[data-add-badge-part]')){
      const wrap=$('contentBadgeParts');
      if(wrap){
        const parts=collectBadgeRequirementParts(true);
        parts.push({rooms:[],games:[],level:null});
        wrap.innerHTML=renderBadgePartRows(parts);
      }
      return;
    }
    const removePart=e.target.closest('[data-remove-badge-part]');
    if(removePart){
      const row=removePart.closest('[data-badge-part]');
      const wrap=$('contentBadgeParts');
      row?.remove();
      if(wrap&&!wrap.querySelector('[data-badge-part]')){
        wrap.innerHTML=renderBadgePartRows([{rooms:[],games:[],level:null}]);
      }else if(wrap){
        const parts=collectBadgeRequirementParts(true);
        wrap.innerHTML=renderBadgePartRows(parts);
      }
      return;
    }

    const contentTab=e.target.closest('[data-content-tab]');
    if(contentTab){
      contentManagerTab=contentTab.dataset.contentTab;
      renderContentManager();
      return;
    }
    const editContent=e.target.closest('[data-edit-content-type]');
    if(editContent){
      openContentEditor(editContent.dataset.editContentType,editContent.dataset.editContentId);
      return;
    }
    const archiveContent=e.target.closest('[data-toggle-content-archive]');
    if(archiveContent){
      toggleContentArchived(archiveContent.dataset.toggleContentArchive,archiveContent.dataset.contentId);
      return;
    }
    if(e.target.closest('[data-clear-catalog-review]')){
      activeLocation().catalogReview=[];
      save();renderLocations();toast('Catalogue review cleared');
      return;
    }

    const nav=e.target.closest('[data-view]');if(nav){showView(nav.dataset.view);return}

    // Nested badge controls MUST be handled before the clickable badge card.
    // The card itself carries data-open-focus-badge, so checking the card first
    // causes pin/unpin taps to be swallowed and opens Focus instead.
    const t=e.target.closest('[data-toggle-earned]');
    if(t){e.preventDefault();e.stopPropagation();return toggleEarn(Number(t.dataset.toggleEarned))}


    const of=e.target.closest('[data-open-focus]');
    if(of){e.preventDefault();e.stopPropagation();return openFocusOverlay(Number(of.dataset.openFocus))}

    const o=e.target.closest('[data-open-badge]');
    if(o){e.preventDefault();e.stopPropagation();return openBadge(Number(o.dataset.openBadge))}

    const fb=e.target.closest('[data-open-focus-badge]');
    if(fb){
      const source=fb.dataset.focusSource||fb.closest('[data-focus-source]')?.dataset.focusSource||'badges';
      return openBadgeFocus(Number(fb.dataset.openFocusBadge),{source});
    }
    if(e.target.closest('.competitive-check'))return;
    const cg=e.target.closest('[data-comp-game]');
    if(cg){openCompetitiveGame(cg.dataset.compRoom,cg.dataset.compGame);return}
    const exg=e.target.closest('[data-exclude-game]');if(exg){
      const l=activeLocation(),g=exg.dataset.excludeGame;
      l.excludedGames=l.excludedGames||[];
      l.excludedGames=l.excludedGames.includes(g)?l.excludedGames.filter(x=>x!==g):[...l.excludedGames,g];
      renderAll();return
    }
    const loc=e.target.closest('[data-location]');if(loc){state.activeLocation=loc.dataset.location;renderAll();return}
    const rt=e.target.closest('[data-room-toggle]');if(rt){
      const l=activeLocation(),r=rt.dataset.roomToggle;
      if(l.rooms.includes(r)){
        l.rooms=l.rooms.filter(x=>x!==r);
        l.excludedGames=(l.excludedGames||[]).filter(g=>inferredGamesForLocation(l).some(e=>e.game===g));
      }else l.rooms=[...l.rooms,r];
      renderAll();return
    }
    const gt=e.target.closest('[data-game-toggle]');if(gt){
      const l=activeLocation(),g=gt.dataset.gameToggle;
      l.games=l.games.includes(g)?l.games.filter(x=>x!==g):[...l.games,g];
      renderAll();return
    }
  });

  onChange('importScoresCsv',async e=>{
    const f=e.target.files?.[0];
    if(!f)return;

    const fileName=String(f.name||'').trim();
    const mime=String(f.type||'').toLowerCase();
    const looksCsv=/\.csv$/i.test(fileName) || /csv|comma-separated|plain|excel|octet-stream/.test(mime);
    if(!looksCsv){
      toast('Please choose a CSV file');
      e.target.value='';
      return;
    }

    const info=$('levelsImportInfo');
    if(info)info.textContent=`Reading ${f.name}…`;
    try{
      const text=await f.text();
      const result=importScores(text);
      if(info)info.textContent=`Imported ${result.games} games • ${result.totalCompleted} co-op levels${result.competitivePlayed?` • ${result.competitivePlayed} competitive played`:''}${result.player?' • '+result.player:''}`;
      toast(result.changeCount
        ? `Import complete • ${result.changeCount} change${result.changeCount===1?'':'s'}`
        : 'Import complete • no progress changes');
    }catch(err){
      console.error('Activate-scores.ca import failed',err);
      if(info)info.textContent=`Import failed: ${err?.message||'Unknown error'}`;
      toast(err?.message||'Could not import Activate-scores.ca CSV');
    }finally{e.target.value=''}
  });

  onChange('levelsRoom',renderLevels);
  onChange('levelsGame',renderLevels);
  onChange('levelsView',renderLevels);
  onChange('levelsSort',renderLevels);
  onChange('gamesView',renderLevels);
  onClick('clearLevelProgress',()=>{if(confirm(`Clear imported level progress for ${activeLocation().name}?`)){state.levelProgressByLocation[state.activeLocation]=emptyLevelProgress();save();renderLevels();renderCsvImportReport(null)}});

  listen('badgeSearch','input',renderBadges);
  listen('competitiveSearch','input',renderCompetitive);
  listen('competitiveRoom','change',renderCompetitive);
  listen('competitivePlayed','change',renderCompetitive);
  listen('targetRoom','change',renderBadges);
  listen('badgeStatus','change',renderBadges);
  listen('badgeAvailability','change',renderBadges);
  listen('locationName','input',e=>{activeLocation().name=e.target.value;save();renderHome()});
  listen('playerDisplayName','input',e=>{
    state.playerName=normalisePlayerName(e.target.value);
    renderPlayerBrand();
    save();
  });
  listen('playerDisplayName','change',e=>{
    state.playerName=normalisePlayerName(e.target.value)||'Smarty';
    renderPlayerBrand();
    save();
  });
  listen('playerBrandColor','input',e=>{
    state.playerBrandColor=validPlayerBrandColor(e.target.value);
    renderPlayerBrand();
    save();
  });
  listen('playerBrandColor','change',e=>{
    state.playerBrandColor=validPlayerBrandColor(e.target.value);
    renderPlayerBrand();
    save();
  });

  onClick('addLocation',()=>{const id='loc_'+Date.now();state.locations.push({id,name:'New location',rooms:[],games:[],roomCopies:{},roomInstances:[],venueMap:{Entrance:{front:null,left:null,right:null,back:null},Exit:{front:null,left:null,right:null,back:null}}});state.activeLocation=id;renderAll()});
  onClick('deleteLocation',()=>{if(state.locations.length===1)return toast('Keep at least one location');state.locations=state.locations.filter(l=>l.id!==state.activeLocation);state.activeLocation=state.locations[0].id;renderAll()});
  onClick('allRooms',()=>{activeLocation().rooms=[...ROOMS];renderAll()});
  onClick('clearRooms',()=>{const l=activeLocation();l.rooms=[];l.excludedGames=[];renderAll()});

  onClick('closeModal',()=>$('badgeModal')?.classList.remove('open'));
  onClick('closeCompetitiveModal',()=>$('competitiveModal')?.classList.remove('open'));
  onClick('competitiveModal',e=>{if(e.target.id==='competitiveModal')$('competitiveModal')?.classList.remove('open')});
  onClick('badgeModal',e=>{if(e.target.id==='badgeModal')$('badgeModal')?.classList.remove('open')});
  onClick('modalEarn',()=>{toggleEarn(modalBadgeIndex);openBadge(modalBadgeIndex)});
  onClick('modalPin',()=>{togglePin(modalBadgeIndex);openBadge(modalBadgeIndex)});
  onClick('closeFocusOverlay',closeFocusWithoutCompleting);
  onClick('focusDismiss',closeFocusWithoutCompleting);
  onClick('focusNext',()=>moveFocus(1));
  onClick('focusPrev',()=>moveFocus(-1));
  onClick('focusComplete',()=>{
    const i=Number(focusBadgeIndex);
    const target=BADGES[i];
    if(!target)return;

    if(isTrophy(target)){
      syncTrophies();
      toast(state.earned[i]?'Trophy already achieved':'Trophies unlock automatically');
      openBadgeFocus(i,{newContext:false});
      return;
    }

    if(state.earned[i]){
      toast('Badge already achieved');
      return;
    }

    state.earned[i]=true;
    state.history.unshift({badge:i,date:new Date().toISOString().slice(0,10)});
    syncTrophies();

    // An earned badge leaves Focus/pins, but earning from the Badges list does
    // not otherwise alter the user's active list except where the current
    // filter itself excludes achieved badges.
    if(state.pins.includes(i)){
      state.pins=state.pins.filter(x=>x!==i);
    }

    save();
    renderAll();
    toast('Badge marked as earned');

    if(focusContext.source==='pins'){
      focusContext.indices=[...(state.pins||[])];
      if(!focusContext.indices.length){
        $('focusOverlay')?.classList.remove('open');
        return;
      }
      focusIndex=Math.min(focusIndex,focusContext.indices.length-1);
      focusBadgeIndex=focusContext.indices[focusIndex];
      openBadgeFocus(focusBadgeIndex,{newContext:false});
      return;
    }

    if(focusContext.source==='badges'){
      const updated=filteredBadgeIndices();
      // If the active filter removes this newly achieved badge (for example
      // "Not earned"), continue at the nearest remaining result.
      if(!updated.includes(i)){
        focusContext.indices=updated;
        if(!updated.length){
          $('focusOverlay')?.classList.remove('open');
          return;
        }
        focusIndex=Math.min(focusIndex,updated.length-1);
        focusBadgeIndex=updated[focusIndex];
        openBadgeFocus(focusBadgeIndex,{newContext:false});
        return;
      }
      focusContext.indices=updated;
    }

    openBadgeFocus(i,{newContext:false});
  });

  listen('contentSearch','input',renderContentManager);
  listen('contentShowArchived','change',renderContentManager);
  onClick('contentAddBtn',()=>openContentEditor(contentManagerTab));
  onClick('closeContentEditor',()=>setContentModalOpen(false));
  onClick('contentCancelBtn',()=>setContentModalOpen(false));
  onClick('contentSaveBtn',saveContentEditor);
  onClick('contentArchiveBtn',()=>{
    if(!contentEditing?.id)return;
    toggleContentArchived(contentEditing.type,contentEditing.id);
    setContentModalOpen(false);
  });
  onClick('contentEditorModal',e=>{if(e.target.id==='contentEditorModal')setContentModalOpen(false)});

  onClick('exportBackup',exportBackup);
  onChange('importBackup',e=>{
    const f=e.target.files?.[0];if(!f)return;
    const r=new FileReader();
    r.onload=()=>{try{state=JSON.parse(r.result);
      if(!Array.isArray(state.locations)||!state.locations.length)state.locations=defaultState().locations;
      state.locations.forEach(ensureLocationShape);
      state.activeLocation=state.activeLocation||state.locations[0].id;
      state.pins=Array.isArray(state.pins)?state.pins:[];
      state.history=Array.isArray(state.history)?state.history:[];
      state.earned=state.earned||{};
      state.notes=state.notes||{};
      if(state.playerName===undefined || state.playerName===null)state.playerName='Smarty';
      state.playerName=normalisePlayerName(state.playerName)||'Smarty';
      state.playerBrandColor=validPlayerBrandColor(state.playerBrandColor);
      ensureContentState();
      ensureTrophyState();
      state.badgeAwards=state.badgeAwards||{};
      ensureLevelProgressStore();
      activeLevelProgress();
      applyContentCatalog();
      syncTrophies();
      save();
      renderAll();
      toast('Backup restored')}catch{toast('Could not read backup')}};
    r.readAsText(f)
  });
  onClick('resetApp',()=>{if(confirm('Reset all app data?')){state=defaultState();ensureContentState();applyContentCatalog();renderAll()}});
}

if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js?v=1383',{updateViaCache:'none'}).catch(console.error));
init();
installBackGuard();

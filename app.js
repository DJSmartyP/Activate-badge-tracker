'use strict';

const VERSION='13.4.0';
const STORAGE_KEY='activateBadgeTracker_v8';
const MAX_PINS=5;
let BADGES=[], ROOMS=[], GAMES=[], GAME_CATALOG={}, COMPETITIVE_INFO={}, BASE_BADGE_COUNT=0;
let state=null;
let modalBadgeIndex=null;
let focusIndex=0;

let levelsDisplayMode='levels';
const defaultState=()=>({
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
const activeLocation=()=>state.locations.find(l=>l.id===state.activeLocation)||state.locations[0];
const earnedCount=()=>BADGES.slice(0,BASE_BADGE_COUNT||BADGES.length).filter((_,i)=>state.earned[i]).length;
const roomTypeFromInstance=n=>n==='Entrance'||n==='Exit'?n:n.replace(/\s+\d+$/,'');
const roomParts=b=>(b.room||'').split(/\s*\/\s*/).map(x=>x.trim()).filter(Boolean);
const gameParts=b=>(b.game||'').split(/\s*\/\s*/).map(x=>x.trim()).filter(Boolean);

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
  ensureLevelProgress();
  activeLevelProgress().competitive[competitivePlayedKey(room,game)]=!!played;
  save();
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
const isEasterEggBadge=b=>!isTrophy(b) && /^Easter Egg\b/i.test(b?.name||'');
function addTrophyTargets(){
  BASE_BADGE_COUNT=BADGES.length;
  BADGES=[
    ...BADGES.map(b=>({...b,type:b.type||'badge'})),
    {name:'Bronze Trophy',type:'trophy',how:'Achieve 25 badges.',room:'',game:'',level:'',trophyNeed:25},
    {name:'Silver Trophy',type:'trophy',how:'Achieve 50 badges.',room:'',game:'',level:'',trophyNeed:50},
    {name:'Gold Trophy',type:'trophy',how:'Achieve 75 badges.',room:'',game:'',level:'',trophyNeed:75},
    {name:'Platinum Trophy',type:'trophy',how:'Achieve 100% of tracked badges.',room:'',game:'',level:'',trophyNeed:'all'}
  ];
}
function syncTrophyEarned(){
  const badgeCount=Object.keys(state.earned||{}).map(Number).filter(i=>i<BASE_BADGE_COUNT && state.earned[i]).length;
  BADGES.forEach((b,i)=>{
    if(!isTrophy(b))return;
    const earned=b.trophyNeed==='all'?badgeCount>=BASE_BADGE_COUNT:badgeCount>=b.trophyNeed;
    if(earned)state.earned[i]=true; else delete state.earned[i];
  });
}


function gamesForSelectedRooms(){
  return enabledGameNames();
}


function loadState(){
  try{
    const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
    state=saved||defaultState();
  }catch{state=defaultState()}
  if(!Array.isArray(state.locations)||!state.locations.length)state=defaultState();
  state.pins=Array.isArray(state.pins)?state.pins:[];
  state.history=Array.isArray(state.history)?state.history:[];
  state.earned=state.earned||{};
  state.notes=state.notes||{};
  state.locations.forEach(ensureLocationShape);ensureLevelProgressStore();activeLevelProgress();
}

function ensureLocationShape(l){
  l.rooms=Array.isArray(l.rooms)?l.rooms:[];
  l.games=Array.isArray(l.games)?l.games:[];
  l.excludedGames=Array.isArray(l.excludedGames)?l.excludedGames:[];
  l.roomCopies=l.roomCopies||{};
  l.roomInstances=Array.isArray(l.roomInstances)?l.roomInstances:[];
  l.venueMap=l.venueMap||{};
  l.venueMap.Entrance=l.venueMap.Entrance||{front:null,left:null,right:null,back:null};
  l.venueMap.Exit=l.venueMap.Exit||{front:null,left:null,right:null,back:null};
}

function availableHere(b){
  if(isTrophy(b)) return true;
  const l=activeLocation();
  const rp=roomParts(b), gp=gameParts(b);
  const roomOk=!rp.length ? true : (l.rooms.length>0 && rp.some(r=>l.rooms.includes(r)));
  const enabled=enabledGameNames(l);
  const gameOk=!gp.length ? true : gp.some(g=>enabled.includes(g));
  return roomOk && gameOk;
}

function currentTrophy(){
  const n=earnedCount();
  if(n>=BASE_BADGE_COUNT)return 'Platinum';
  if(n>=75)return 'Gold';
  if(n>=50)return 'Silver';
  if(n>=25)return 'Bronze';
  return 'No trophy yet';
}

function nextTrophyText(){
  const n=earnedCount();
  if(n<25)return `${25-n} to Bronze`;
  if(n<50)return `${50-n} to Silver`;
  if(n<75)return `${75-n} to Gold`;
  if(n<BASE_BADGE_COUNT)return `${BASE_BADGE_COUNT-n} to Platinum`;
  return '100% complete';
}

function trophyProgress(){
  const n=earnedCount();
  if(n<25) return {name:'Bronze', current:n, target:25, remaining:25-n};
  if(n<50) return {name:'Silver', current:n, target:50, remaining:50-n};
  if(n<75) return {name:'Gold', current:n, target:75, remaining:75-n};
  if(n<BASE_BADGE_COUNT) return {name:'Platinum', current:n, target:BASE_BADGE_COUNT, remaining:BASE_BADGE_COUNT-n};
  return {name:'Platinum', current:BASE_BADGE_COUNT, target:BASE_BADGE_COUNT, remaining:0};
}

function renderHome(){
  const n=earnedCount(), total=BASE_BADGE_COUNT, pct=total?Math.round(n/total*100):0, l=activeLocation();
  const tp=trophyProgress();
  $('homeSummary').innerHTML=`<div class="label">Trophy progress</div>
    <div class="big">${esc(tp.name)}</div>
    <div class="sub">${tp.remaining?`${tp.current} / ${tp.target} badges • ${tp.remaining} to unlock`:'Unlocked • 100% complete'}</div>
    <div class="progress top-gap"><span style="width:${tp.target?Math.min(100,tp.current/tp.target*100):100}%"></span></div>
    <div class="metrics">
      <div class="metric"><span class="label">Earned</span><b>${n}</b></div>
      <div class="metric"><span class="label">Overall</span><b>${pct}%</b></div>
      <div class="metric"><span class="label">Location</span><b style="font-size:15px">${esc(l.name)}</b></div>
    </div>`;
  $('trophies').innerHTML=[['Bronze',25],['Silver',50],['Gold',75],['Platinum',total]].map(([name,need])=>`<div class="card trophy ${n>=need?'':'locked'}"><div class="row between"><span class="cup">🏆</span><span class="pill">${n>=need?'Unlocked':`${Math.max(0,need-n)} left`}</span></div><h3>${name}</h3><div class="sub">${name==='Platinum'?'100% of tracked badges':`${need} badges`}</div><div class="progress top-gap"><span style="width:${need?Math.min(100,n/need*100):0}%"></span></div></div>`).join('');
  $('homePins').innerHTML=state.pins.length?state.pins.map((i,idx)=>`<div class="item row between"><div><b>${esc(BADGES[i].name)}</b><div class="sub">${esc(BADGES[i].room||'Any room')}</div></div><button class="mini" data-open-focus="${idx}">Open</button></div>`).join(''):'<div class="item sub">No pinned badges.</div>';
  $('recent').innerHTML=state.history.length?state.history.slice(0,8).map(h=>`<button class="item recent-achievement clickable-badge" data-open-focus-badge="${h.badge}"><div><b>${esc(BADGES[h.badge]?.name||'Badge')}</b><div class="sub">${esc(h.date||'')}</div></div><span class="recent-open">›</span></button>`).join(''):'<div class="item sub">No achievements recorded yet.</div>';
}

function renderBadges(){
  syncTrophyEarned();
  const rooms=availableFocusRooms();
  const roomSel=$('targetRoom');
  const chosen=roomSel.value||'';
  roomSel.innerHTML='<option value="">All targets</option>'+rooms.map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join('');
  roomSel.value=rooms.includes(chosen)?chosen:'';

  const room=roomSel.value;
  const q=$('badgeSearch').value.trim().toLowerCase();
  const status=$('badgeStatus').value;
  const avail=$('badgeAvailability').value;

  const rows=BADGES.map((b,i)=>[b,i]).filter(([b,i])=>{
    const text=JSON.stringify(b).toLowerCase();
    const qok=!q||text.includes(q);
    const roomOk=!room || (!isTrophy(b) && roomParts(b).includes(room));
    const sok=status==='all'||(status==='todo'&&!state.earned[i])||(status==='done'&&state.earned[i])||(status==='pinned'&&state.pins.includes(i));
    const aok=avail==='all'||(avail==='here'&&availableHere(b))||(avail==='away'&&!availableHere(b));
    return qok&&roomOk&&sok&&aok;
  });

  $('pinCount').textContent=`${state.pins.length} / ${MAX_PINS}`;
  $('pinList').innerHTML=state.pins.length?state.pins.map((i,idx)=>`<div class="item row between">
    <div><b>${esc(BADGES[i].name)}</b><div class="sub">${isTrophy(BADGES[i])?'Trophy':esc(BADGES[i].room||'Global')} • ${esc(BADGES[i].how)}</div></div>
    <div class="row"><button class="mini" data-open-focus="${idx}">Open</button><button class="mini" data-unpin="${i}">✕</button></div>
  </div>`).join(''):'<div class="item sub">No pinned targets.</div>';

  $('badgeCount').textContent=`${rows.length} shown`;
  $('badgeList').innerHTML=rows.length?rows.map(([b,i])=>`<article class="badge target-card clickable-badge ${availableHere(b)?'available-here':'other-location'} ${state.earned[i]?'done completed-target':''} ${state.pins.includes(i)?'pinned-target':''}" data-open-focus-badge="${i}">
    <button class="checkbtn" data-toggle-earned="${i}" ${isTrophy(b)?'disabled':''}>${state.earned[i]?'✓':''}</button>
    <div><h3>${esc(b.name)}</h3><p>${esc(b.how)}</p><div class="tags">
      <span class="tag">${isTrophy(b)?'Trophy':isEasterEggBadge(b)?'Badge • Easter Egg':'Badge'}</span>
      ${b.room?`<span class="tag">${esc(b.room)}</span>`:''}
      ${b.game?`<span class="tag">${esc(b.game)}${b.level?' • L'+esc(b.level):''}</span>`:''}
      ${!isTrophy(b)?`<span class="tag availability-tag ${availableHere(b)?'ok':'away'}">${availableHere(b)?'Available here':'Other location'}</span>`:''}
    </div></div>
    <div class="row"><button class="mini pin-button ${state.pins.includes(i)?'active':''}" data-pin="${i}" title="${state.pins.includes(i)?'Pinned':'Pin target'}">${state.pins.includes(i)?'📌':'📍'}</button><button class="mini" data-open-focus-badge="${i}" title="Open badge">›</button></div>
  </article>`).join(''):'<div class="item sub">No targets match those filters.</div>';
}

function renderLocations(){
  const l=activeLocation();

  $('selectedVenueBanner').innerHTML=`<span class="label">Current venue</span><strong>${esc(l.name)}</strong>`;

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
  const n=earnedCount(), here=BADGES.filter((b,i)=>availableHere(b)&&!state.earned[i]).length, away=BADGES.filter((b,i)=>!availableHere(b)&&!state.earned[i]).length;
  $('statsCards').innerHTML=`<div class="stat"><span class="label">Earned</span><b>${n}</b></div><div class="stat"><span class="label">Available here</span><b>${here}</b></div><div class="stat"><span class="label">Other location</span><b>${away}</b></div><div class="stat"><span class="label">Pinned</span><b>${state.pins.length}</b></div>`;
  const byRoom={};BADGES.forEach((b,i)=>{if(state.earned[i])roomParts(b).forEach(r=>byRoom[r]=(byRoom[r]||0)+1)});
  $('roomStats').innerHTML=Object.entries(byRoom).sort((a,b)=>b[1]-a[1]).map(([r,c])=>`<div class="item row between"><span>${esc(r)}</span><b>${c}</b></div>`).join('')||'<div class="item sub">No room-specific badges earned yet.</div>';
  $('historyList').innerHTML=state.history.map(h=>`<div class="item"><b>${esc(BADGES[h.badge]?.name||'Badge')}</b><div class="sub">${esc(h.date||'')}</div></div>`).join('')||'<div class="item sub">No history yet.</div>';
}

function renderAll(){ensureLevelProgress();renderHome();renderBadges();renderLocations();renderCompetitive();renderLevels();renderStats();save()}

function toggleEarn(i){
  if(isTrophy(BADGES[i])){toast('Trophies unlock automatically from target progress');return}
  if(state.earned[i]){delete state.earned[i];state.history=state.history.filter(h=>h.badge!==i)}
  else{state.earned[i]=true;state.history.unshift({badge:i,date:new Date().toISOString().slice(0,10)})}
  syncTrophyEarned();
  renderAll();updatePageHeader('home');
}

function togglePin(i){
  if(state.pins.includes(i))state.pins=state.pins.filter(x=>x!==i);
  else if(state.pins.length<MAX_PINS)state.pins.push(i);
  else return toast('Focus list is full — maximum 5 badges');
  renderAll();
}

function openBadge(i){
  modalBadgeIndex=i;const b=BADGES[i];
  $('modalTitle').textContent=b.name;
  $('modalBody').innerHTML=`<div class="detail"><strong>How to earn</strong>${esc(b.how)}</div>${b.room?`<div class="detail"><strong>Room / game</strong>${esc(b.room)}${b.game?' • '+esc(b.game):''}${b.level?' • Level '+esc(b.level):''}</div>`:''}${b.tip?`<div class="detail"><strong>Tip / watch out</strong>${esc(b.tip)}</div>`:''}${b.hint?`<div class="detail"><strong>Hint</strong>${esc(b.hint)}</div>`:''}${b.solution?`<div class="detail"><strong>Spoiler solution</strong><button id="revealSolution" class="btn ghost">Reveal</button><div id="solutionText" style="display:none;margin-top:8px">${esc(b.solution)}</div></div>`:''}`;
  $('modalEarn').textContent=isTrophy(b)?(state.earned[i]?'Trophy unlocked':'Trophy progress automatic'):(state.earned[i]?'Mark not earned':'Mark earned');$('modalEarn').disabled=isTrophy(b);
  $('modalPin').textContent=state.pins.includes(i)?'Unpin':'Pin';
  $('badgeModal').classList.add('open');
  if($('revealSolution'))$('revealSolution').onclick=()=>{$('solutionText').style.display='block';$('revealSolution').style.display='none'};
}


function openBadgeFocus(i){
  const b=BADGES[i];
  if(!b)return;

  const pinnedPos=state.pins.indexOf(i);
  focusIndex=pinnedPos>=0?pinnedPos:0;
  const achieved=!!state.earned[i];

  $('focusPosition').textContent=pinnedPos>=0
    ? `${pinnedPos+1} / ${state.pins.length}`
    : (state.pins.length?'Badge view • not pinned':'Badge view');

  $('focusOverlayBody').innerHTML=`<section>
    <div class="focus-meta">${esc(b.room||'Any room')}${b.game?' • '+esc(b.game):''}${b.level?' • Level '+esc(b.level):''}</div>
    <h2 class="focus-title">${esc(b.name)}</h2>
    ${achieved?'<div class="focus-achieved-banner">✓ Already achieved</div>':''}
    <p class="focus-requirement">${esc(b.how)}</p>
  </section>
  <section>
    ${b.tip?`<div class="detail"><strong>Tip / watch out</strong>${esc(b.tip)}</div>`:''}
    ${b.hint?`<div class="detail"><strong>Hint</strong>${esc(b.hint)}</div>`:''}
    ${b.solution?`<div class="detail"><strong>Spoiler</strong><button id="focusReveal" class="btn ghost">Reveal</button><div id="focusSolution" style="display:none;margin-top:8px">${esc(b.solution)}</div></div>`:''}
  </section>`;

  const completeBtn=$('focusComplete');
  if(completeBtn){
    completeBtn.disabled=achieved;
    completeBtn.classList.toggle('achieved-locked',achieved);
    completeBtn.textContent=achieved?'✓ Achieved':'✓ Badge Collected';
  }

  $('focusOverlay').classList.add('open');

  if($('focusReveal'))$('focusReveal').onclick=()=>{
    $('focusSolution').style.display='block';
    $('focusReveal').style.display='none';
  };
}

function openFocusOverlay(index){
  if(!state.pins.length)return;
  focusIndex=(index+state.pins.length)%state.pins.length;
  openBadgeFocus(state.pins[focusIndex]);
}

function exportBackup(){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='activate-badge-backup-v8.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}



function emptyLevelProgress(){
  return {games:{},competitive:{},importedAt:null,player:null,source:null};
}
function ensureLevelProgressStore(){
  if(!state.levelProgressByLocation || typeof state.levelProgressByLocation!=='object'){
    state.levelProgressByLocation={};
  }

  // One-time migration: move legacy global progress into the active location.
  if(state.levelProgress && !state._levelProgressMigrated){
    const activeId=state.activeLocation || state.locations?.[0]?.id || 'home';
    const legacy=state.levelProgress;
    const hasLegacy=
      Object.keys(legacy.games||{}).length ||
      Object.keys(legacy.competitive||{}).length ||
      legacy.importedAt || legacy.player;
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
  return p;
}
function ensureLevelProgress(){
  return activeLevelProgress();
}
function csvRows(t){let a=[],r=[],f='',q=false;for(let i=0;i<t.length;i++){let c=t[i];if(q){if(c==='"'&&t[i+1]==='"'){f+='"';i++}else if(c==='"')q=false;else f+=c}else if(c==='"')q=true;else if(c===','){r.push(f);f=''}else if(c==='\n'){r.push(f);a.push(r);r=[];f=''}else if(c!=='\r')f+=c}if(f||r.length){r.push(f);a.push(r)}return a}
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

  let games=0,newLevels=0,totalCompleted=0,competitivePlayed=0;

  for(const r of rows.slice(headerIndex+1)){
    const room=String(r[0]||'').trim();
    const game=String(r[1]||'').trim();
    if(!room||!game||game.toLowerCase()==='total')continue;

    const cat=GAME_CATALOG[room]||{};
    const isCoop=(cat.cooperative||[]).includes(game);
    const isComp=(cat.competitive||[]).includes(game);

    // Competitive-only games do not have level progression.
    if(isComp&&!isCoop){
      const played=r.slice(2).some(v=>{
        const n=Number(String(v||'').replace(/,/g,'').trim());
        return Number.isFinite(n)&&n>0;
      });
      if(played){
        progress.competitive[room+'||'+game]=true;
        competitivePlayed++;
      }
      games++;
      continue;
    }

    // Cooperative (including games that also have a competitive mode): parse L1-L10.
    const key=room+'||'+game;
    const prior=progress.games[key]||{room,game,levels:{}};
    const levels={...(prior.levels||{})};
    (prior.complete||[]).forEach(level=>{
      levels[level]=levels[level]||{score:0,topScore:0,complete:true};
      levels[level].complete=true;
    });

    let foundLevel=false;
    for(let i=2;i+2<r.length;i+=3){
      const level=parseInt(String(r[i]||'').trim(),10);
      if(!(level>=1&&level<=10))continue;
      foundLevel=true;

      const score=Number(String(r[i+1]||'0').replace(/,/g,'').trim())||0;
      const topScore=Number(String(r[i+2]||'0').replace(/,/g,'').trim())||0;
      const old=levels[level]||{score:0,topScore:0,complete:false};
      const wasComplete=!!old.complete;
      const complete=score>0||wasComplete;

      levels[level]={
        score:Math.max(Number(old.score)||0,score),
        topScore:topScore||Number(old.topScore)||0,
        complete
      };
      if(complete){
        totalCompleted++;
        if(!wasComplete)newLevels++;
      }
    }

    if(foundLevel){
      progress.games[key]={room,game,levels};
      games++;
    }
  }

  if(!games)throw Error('No game rows were found in this Activate-scores.ca export.');
  progress.importedAt=new Date().toISOString();
  progress.player=player;
  progress.source='Activate-scores.ca';
  save();renderLevels();
  return {games,newLevels,totalCompleted,competitivePlayed,player};
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
    const played=[1,2,3,4,5,6,7,8,9,10].some(n=>!!x.levels?.[n]?.complete);
    return {room:x.room,game:x.game,mode:'cooperative',played};
  }).sort((a,b)=>a.room.localeCompare(b.room)||a.game.localeCompare(b.game)||a.mode.localeCompare(b.mode));
}

function renderLevels(){
  if(!$('levelsList'))return;

  const progress=activeLevelProgress();
  if($('levelsImportLocation'))$('levelsImportLocation').textContent=`Progress dataset: ${activeLocation().name}`;

  const roomSel=$('levelsRoom');
  const currentRoom=roomSel?.value||'';
  const baseEntries=progressEntries();
  const rooms=[...new Set(baseEntries.map(x=>x.room))].sort();

  if(roomSel){
    roomSel.innerHTML='<option value="">All rooms</option>'+rooms.map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join('');
    if(rooms.includes(currentRoom))roomSel.value=currentRoom;
  }

  const room=roomSel?.value||'';
  const sortMode=$('levelsSort')?.value||'room-game';

  const levelFilter=$('levelsView');
  const gameFilter=$('gamesView');
  if(levelFilter)levelFilter.classList.toggle('hidden',levelsDisplayMode!=='levels');
  if(gameFilter)gameFilter.classList.toggle('hidden',levelsDisplayMode!=='games');
  document.querySelectorAll('[data-levels-mode]').forEach(b=>b.classList.toggle('active',b.dataset.levelsMode===levelsDisplayMode));

  const sortRows=(rows)=>{
    const copy=[...rows];
    if(sortMode==='game-room'){
      copy.sort((a,b)=>a.game.localeCompare(b.game)||a.room.localeCompare(b.room)||(a.level||0)-(b.level||0));
    }else if(sortMode==='status'){
      copy.sort((a,b)=>Number(a.done??a.played)-Number(b.done??b.played)||a.room.localeCompare(b.room)||a.game.localeCompare(b.game)||(a.level||0)-(b.level||0));
    }else{
      copy.sort((a,b)=>a.room.localeCompare(b.room)||a.game.localeCompare(b.game)||(a.level||0)-(b.level||0));
    }
    return copy;
  };

  const renderGrouped=(rows,rowHtml)=>{
    const sorted=sortRows(rows);
    if(!sorted.length)return '<div class="item sub">Nothing matches this filter.</div>';

    // Keep the familiar room grouping when sorting by room/game.
    if(sortMode==='room-game' && !room){
      const groups={};
      sorted.forEach(r=>(groups[r.room]??=[]).push(r));
      return Object.entries(groups).map(([roomName,items])=>`
        <section class="level-room-group">
          <div class="level-room-heading">
            <strong>${esc(roomName)}</strong>
            <span>${items.length} ${levelsDisplayMode==='games'?'game'+(items.length===1?'':'s'):'entr'+(items.length===1?'y':'ies')}</span>
          </div>
          <div class="level-room-items">${items.map(rowHtml).join('')}</div>
        </section>`).join('');
    }
    return sorted.map(rowHtml).join('');
  };

  if(levelsDisplayMode==='games'){
    const mode=gameFilter?.value||'all';
    const allGames=gamePlayEntries().filter(x=>!room||x.room===room);
    let rows=allGames.filter(x=>{
      if(mode==='played')return x.played;
      if(mode==='unplayed')return !x.played;
      return true;
    }).map(x=>({...x,done:x.played}));

    const playedCount=allGames.filter(x=>x.played).length;
    $('levelsSummary').textContent=`${playedCount}/${allGames.length} games played • ${esc(activeLocation().name)}`;

    $('levelsImportInfo').textContent=progress.importedAt
      ? `Last import for ${activeLocation().name}: ${new Date(progress.importedAt).toLocaleString()}${progress.player?' • '+progress.player:''}`
      : `No Activate-scores.ca export imported for ${activeLocation().name} yet.`;

    $('levelsList').innerHTML=renderGrouped(rows,r=>`
      <div class="item game-play-row ${r.played?'game-played':'game-unplayed'}">
        <div class="game-status-mark" aria-hidden="true">${r.played?'✓':'○'}</div>
        <div class="game-play-main">
          <b>${esc(r.game)}</b>
          <div class="sub">${esc(r.room)} • ${r.mode==='competitive'?'Competitive':'Co-op'}</div>
        </div>
        ${r.mode==='competitive'
          ? `<button class="played-toggle ${r.played?'played':''}" data-toggle-comp-played="${esc(r.room)}||${esc(r.game)}" aria-pressed="${r.played?'true':'false'}">${r.played?'Played':'Not played'}</button>`
          : `<span class="play-state-pill ${r.played?'played':'unplayed'}">${r.played?'Played':'Not played'}</span>`
        }
      </div>`);
    return;
  }

  const mode=levelFilter?.value||'all';
  const filtered=baseEntries.filter(x=>!room||x.room===room);
  const rows=[];

  filtered.forEach(x=>{
    if(x.mode==='competitive'){
      const done=!!x.played;
      if(mode==='complete'&&!done)return;
      if(mode==='incomplete'&&done)return;
      rows.push({room:x.room,game:x.game,mode:'competitive',done});
      return;
    }

    for(let level=1;level<=10;level++){
      const info=x.levels?.[level]||x.levels?.[String(level)]||{};
      const done=!!info.complete;
      if(mode==='complete'&&!done)continue;
      if(mode==='incomplete'&&done)continue;
      rows.push({
        room:x.room,game:x.game,mode:'cooperative',level,done,
        score:info.score??0,
        topScore:info.topScore??0
      });
    }
  });

  const totalAll=filtered.reduce((sum,x)=>sum+(x.mode==='competitive'?1:10),0);
  const completeAll=filtered.reduce((sum,x)=>{
    if(x.mode==='competitive')return sum+(x.played?1:0);
    return sum+[1,2,3,4,5,6,7,8,9,10].filter(n=>x.levels?.[n]?.complete).length;
  },0);

  $('levelsSummary').textContent=baseEntries.length
    ? `${completeAll}/${totalAll} complete • ${esc(activeLocation().name)}`
    : `No progress imported • ${esc(activeLocation().name)}`;

  $('levelsImportInfo').textContent=progress.importedAt
    ? `Last import for ${activeLocation().name}: ${new Date(progress.importedAt).toLocaleString()}${progress.player?' • '+progress.player:''}`
    : `No Activate-scores.ca export imported for ${activeLocation().name} yet.`;

  $('levelsList').innerHTML=renderGrouped(rows,r=>{
    if(r.mode==='competitive'){
      return `<div class="item level-row competitive-mode ${r.done?'level-complete':'level-incomplete'}">
        <div class="game-status-mark" aria-hidden="true">${r.done?'✓':'○'}</div>
        <div class="game-play-main">
          <b>${esc(r.game)}</b>
          <div class="sub">${esc(r.room)} • Competitive • manual status</div>
        </div>
        <button class="played-toggle ${r.done?'played':''}" data-toggle-comp-played="${esc(r.room)}||${esc(r.game)}" aria-pressed="${r.done?'true':'false'}">${r.done?'Played':'Not played'}</button>
      </div>`;
    }

    const bits=[];
    if(Number(r.score)>0)bits.push(`Score ${r.score}`);
    if(Number(r.topScore)>0)bits.push(`Top ${r.topScore}`);
    return `<div class="item level-row cooperative-mode ${r.done?'level-complete':'level-incomplete'}">
      <div class="level-state-stripe" aria-hidden="true"></div>
      <div class="game-play-main">
        <b>${esc(r.game)} • Level ${r.level}</b>
        <div class="sub">${esc(r.room)} • Cooperative${bits.length?' • '+bits.join(' • '):''}</div>
      </div>
      <span class="play-state-pill ${r.done?'played':'unplayed'}">${r.done?'Complete':'Incomplete'}</span>
    </div>`;
  });
}

async function init(){
  try{
    const [badgeRes,roomRes]=await Promise.all([fetch('badges.json',{cache:'no-store'}),fetch('rooms.json',{cache:'no-store'})]);
    if(!badgeRes.ok||!roomRes.ok)throw new Error('Data files failed to load');
    BADGES=await badgeRes.json();addTrophyTargets();
    const roomData=await roomRes.json();ROOMS=roomData.rooms||[];GAMES=roomData.games||[];GAME_CATALOG=roomData.catalog||{};COMPETITIVE_INFO=roomData.competitiveInfo||{};
    loadState();syncTrophyEarned();bindEvents();renderAll();
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
  if(icon)icon.src=`icons/${meta.icon}.png`;
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
  if($('drawer')?.classList.contains('open') || $('drawerBackdrop')?.classList.contains('open')){
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
    const nav=e.target.closest('[data-view]');if(nav){showView(nav.dataset.view);return}
    const t=e.target.closest('[data-toggle-earned]');if(t)return toggleEarn(Number(t.dataset.toggleEarned));
    const fb=e.target.closest('[data-open-focus-badge]');if(fb)return openBadgeFocus(Number(fb.dataset.openFocusBadge));
    const o=e.target.closest('[data-open-badge]');if(o)return openBadge(Number(o.dataset.openBadge));
    const p=e.target.closest('[data-pin]');if(p)return togglePin(Number(p.dataset.pin));
    const fp=e.target.closest('[data-focus-pin]');if(fp)return togglePin(Number(fp.dataset.focusPin));
    const un=e.target.closest('[data-unpin]');if(un)return togglePin(Number(un.dataset.unpin));
    const of=e.target.closest('[data-open-focus]');if(of)return openFocusOverlay(Number(of.dataset.openFocus));
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
    const info=$('levelsImportInfo');
    if(info)info.textContent=`Reading ${f.name}…`;
    try{
      const text=await f.text();
      const result=importScores(text);
      if(info)info.textContent=`Imported ${result.games} games • ${result.totalCompleted} co-op levels${result.competitivePlayed?` • ${result.competitivePlayed} competitive played`:''}${result.player?' • '+result.player:''}`;
      toast(`Import complete • ${result.newLevels} new levels`);
    }catch(err){
      console.error('Activate-scores.ca import failed',err);
      if(info)info.textContent=`Import failed: ${err?.message||'Unknown error'}`;
      toast(err?.message||'Could not import Activate-scores.ca CSV');
    }finally{e.target.value=''}
  });

  onChange('levelsRoom',renderLevels);
  onChange('levelsView',renderLevels);
  onChange('levelsSort',renderLevels);
  onChange('gamesView',renderLevels);
  onClick('clearLevelProgress',()=>{if(confirm(`Clear imported level progress for ${activeLocation().name}?`)){state.levelProgressByLocation[state.activeLocation]=emptyLevelProgress();save();renderLevels()}});

  listen('badgeSearch','input',renderBadges);
  listen('competitiveSearch','input',renderCompetitive);
  listen('competitiveRoom','change',renderCompetitive);
  listen('competitivePlayed','change',renderCompetitive);
  listen('targetRoom','change',renderBadges);
  listen('badgeStatus','change',renderBadges);
  listen('badgeAvailability','change',renderBadges);
  listen('locationName','input',e=>{activeLocation().name=e.target.value;save();renderHome()});

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
  onClick('focusNext',()=>openFocusOverlay(focusIndex+1));
  onClick('focusPrev',()=>openFocusOverlay(focusIndex-1));
  onClick('focusComplete',()=>{
    if(!state.pins.length)return;
    const i=state.pins[focusIndex],target=BADGES[i];
    if(isTrophy(target)){
      syncTrophyEarned();
      if(!state.earned[i]){toast('This trophy has not unlocked yet');return}
    }else if(!state.earned[i]){
      state.earned[i]=true;
      state.history.unshift({badge:i,date:new Date().toISOString().slice(0,10)});
      syncTrophyEarned();
    }
    state.pins=state.pins.filter(x=>x!==i);
    renderAll();
    if(state.pins.length)openFocusOverlay(Math.min(focusIndex,state.pins.length-1));
    else $('focusOverlay')?.classList.remove('open');
  });

  onClick('exportBackup',exportBackup);
  onChange('importBackup',e=>{
    const f=e.target.files?.[0];if(!f)return;
    const r=new FileReader();
    r.onload=()=>{try{state=JSON.parse(r.result);state.locations.forEach(ensureLocationShape);ensureLevelProgressStore();activeLevelProgress();save();renderAll();toast('Backup restored')}catch{toast('Could not read backup')}};
    r.readAsText(f)
  });
  onClick('resetApp',()=>{if(confirm('Reset all app data?')){state=defaultState();renderAll()}});
}

if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(console.error));
init();
installBackGuard();

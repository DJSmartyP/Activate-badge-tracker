
'use strict';

const VERSION='8.4.0';
const STORAGE_KEY='activateBadgeTracker_v8';
const MAX_PINS=5;
let BADGES=[], ROOMS=[], GAMES=[];
let state=null;
let modalBadgeIndex=null;
let focusIndex=0;

const defaultState=()=>({
  earned:{},
  pins:[],
  notes:{},
  history:[],
  locations:[{id:'home',name:'My Activate',rooms:[],games:[],roomCopies:{},roomInstances:[],venueMap:{Entrance:{front:null,left:null,right:null,back:null},Exit:{front:null,left:null,right:null,back:null}}}],
  activeLocation:'home'
});

const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const save=()=>localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
const toast=msg=>{const t=$('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1600)};
const activeLocation=()=>state.locations.find(l=>l.id===state.activeLocation)||state.locations[0];
const earnedCount=()=>BADGES.filter((_,i)=>state.earned[i]).length;
const roomTypeFromInstance=n=>n==='Entrance'||n==='Exit'?n:n.replace(/\s+\d+$/,'');
const roomParts=b=>(b.room||'').split(/\s*\/\s*/).map(x=>x.trim()).filter(Boolean);
const gameParts=b=>(b.game||'').split(/\s*\/\s*/).map(x=>x.trim()).filter(Boolean);

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
  state.locations.forEach(ensureLocationShape);
}

function ensureLocationShape(l){
  l.rooms=Array.isArray(l.rooms)?l.rooms:[];
  l.games=Array.isArray(l.games)?l.games:[];
  l.roomCopies=l.roomCopies||{};
  l.roomInstances=Array.isArray(l.roomInstances)?l.roomInstances:[];
  l.venueMap=l.venueMap||{};
  l.venueMap.Entrance=l.venueMap.Entrance||{front:null,left:null,right:null,back:null};
  l.venueMap.Exit=l.venueMap.Exit||{front:null,left:null,right:null,back:null};
}

function availableHere(b){
  const l=activeLocation();
  if(!l.rooms.length&&!l.games.length)return true;
  const rp=roomParts(b), gp=gameParts(b);
  const roomOk=!rp.length||rp.some(r=>l.rooms.includes(r));
  const gameOk=!gp.length||gp.some(g=>l.games.includes(g));
  return roomOk&&gameOk;
}

function currentTrophy(){
  const n=earnedCount();
  if(n>=BADGES.length)return 'Platinum';
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
  if(n<BADGES.length)return `${BADGES.length-n} to Platinum`;
  return '100% complete';
}

function renderHome(){
  const n=earnedCount(), total=BADGES.length, pct=total?Math.round(n/total*100):0, l=activeLocation();
  $('homeSummary').innerHTML=`<div class="label">Current trophy</div><div class="big">${esc(currentTrophy())}</div><div class="sub">${esc(nextTrophyText())}</div><div class="progress top-gap"><span style="width:${pct}%"></span></div><div class="metrics"><div class="metric"><span class="label">Earned</span><b>${n}</b></div><div class="metric"><span class="label">Complete</span><b>${pct}%</b></div><div class="metric"><span class="label">Location</span><b style="font-size:15px">${esc(l.name)}</b></div></div>`;
  $('trophies').innerHTML=[['Bronze',25],['Silver',50],['Gold',75],['Platinum',total]].map(([name,need])=>`<div class="card trophy ${n>=need?'':'locked'}"><div class="row between"><span class="cup">🏆</span><span class="pill">${n>=need?'Unlocked':`${Math.max(0,need-n)} left`}</span></div><h3>${name}</h3><div class="sub">${name==='Platinum'?'100% of tracked badges':`${need} badges`}</div><div class="progress top-gap"><span style="width:${need?Math.min(100,n/need*100):0}%"></span></div></div>`).join('');
  $('homePins').innerHTML=state.pins.length?state.pins.map((i,idx)=>`<div class="item row between"><div><b>${esc(BADGES[i].name)}</b><div class="sub">${esc(BADGES[i].room||'Any room')}</div></div><button class="mini" data-open-focus="${idx}">Open</button></div>`).join(''):'<div class="item sub">No pinned badges.</div>';
  $('recent').innerHTML=state.history.length?state.history.slice(0,8).map(h=>`<div class="item"><b>${esc(BADGES[h.badge]?.name||'Badge')}</b><div class="sub">${esc(h.date||'')}</div></div>`).join(''):'<div class="item sub">No achievements recorded yet.</div>';
}

function renderBadges(){
  const q=$('badgeSearch').value.trim().toLowerCase(), status=$('badgeStatus').value, avail=$('badgeAvailability').value;
  const rows=BADGES.map((b,i)=>[b,i]).filter(([b,i])=>{
    const text=JSON.stringify(b).toLowerCase();
    const qok=!q||text.includes(q);
    const sok=status==='all'||(status==='todo'&&!state.earned[i])||(status==='done'&&state.earned[i])||(status==='pinned'&&state.pins.includes(i));
    const aok=avail==='all'||(avail==='here'&&availableHere(b))||(avail==='away'&&!availableHere(b));
    return qok&&sok&&aok;
  });
  $('badgeCount').textContent=`${rows.length} shown`;
  $('badgeList').innerHTML=rows.length?rows.map(([b,i])=>`<article class="badge ${state.earned[i]?'done':''}">
    <button class="checkbtn" data-toggle-earned="${i}">${state.earned[i]?'✓':''}</button>
    <div><h3>${esc(b.name)}</h3><p>${esc(b.how)}</p><div class="tags">${b.room?`<span class="tag">${esc(b.room)}</span>`:''}${b.game?`<span class="tag">${esc(b.game)}${b.level?' • L'+esc(b.level):''}</span>`:''}<span class="tag ${availableHere(b)?'ok':'away'}">${availableHere(b)?'Available here':'Other location'}</span></div></div>
    <div class="row"><button class="mini" data-pin="${i}">${state.pins.includes(i)?'📌':'📍'}</button><button class="mini" data-open-badge="${i}">›</button></div>
  </article>`).join(''):'<div class="item sub">No badges match those filters.</div>';
}

function renderLocations(){
  const l=activeLocation();
  $('locationList').innerHTML=state.locations.map(x=>`<button class="item ${x.id===l.id?'active':''}" data-location="${x.id}"><b>${esc(x.name)}</b><div class="sub">${x.rooms.length} rooms • ${x.games.length} games</div></button>`).join('');
  $('locationName').value=l.name;
  $('locationRooms').innerHTML=ROOMS.map(r=>`<button class="toggle ${l.rooms.includes(r)?'on':''}" data-room-toggle="${esc(r)}">${esc(r)}</button>`).join('');
  $('locationGames').innerHTML=GAMES.map(g=>`<button class="toggle ${l.games.includes(g)?'on':''}" data-game-toggle="${esc(g)}">${esc(g)}</button>`).join('');
}

function renderVenue(){
  const l=activeLocation();
  const selected=l.rooms||[];

  $('duplicateControls').innerHTML=selected.length
    ? selected.map(r=>{
        const copies=Math.max(1,Number(l.roomCopies[r]||1));
        return `<div class="item row between">
          <div><b>${esc(r)}</b><div class="sub">${copies===1?'Single room':'Duplicate room'}</div></div>
          <div class="row">
            <label class="checkline" style="margin:0">
              <input type="checkbox" data-dup-toggle="${esc(r)}" ${copies>1?'checked':''}>
              <span>Duplicate</span>
            </label>
            <select class="field" style="max-width:92px" data-dup-count="${esc(r)}" ${copies>1?'':'disabled'}>
              ${[2,3,4,5,6].map(n=>`<option value="${n}" ${copies===n?'selected':''}>${n}</option>`).join('')}
            </select>
          </div>
        </div>`;
      }).join('')
    : '<div class="item sub">Choose rooms in the Locations tab first.</div>';

  const nodes=['Entrance',...l.roomInstances,'Exit'];
  const previous=$('mapNode').value;
  $('mapNode').innerHTML=nodes.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');
  $('mapNode').value=nodes.includes(previous)?previous:'Entrance';
  renderMapEditor();
  $('mapSummary').innerHTML=nodes.map(n=>{
    const m=l.venueMap[n]||{};
    const bits=[m.front&&`Front → ${m.front}`,m.left&&`Left → ${m.left}`,m.right&&`Right → ${m.right}`,m.back&&`Back → ${m.back}`].filter(Boolean);
    return `<div class="item"><b>${esc(n)}</b><div class="sub">${bits.length?esc(bits.join(' • ')):'No connections set'}</div></div>`;
  }).join('');
}

function renderMapEditor(){
  const l=activeLocation(), node=$('mapNode').value||'Entrance';
  const nodes=['Entrance',...l.roomInstances,'Exit'].filter(n=>n!==node);
  const opts=()=>'<option value="">None</option>'+nodes.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');
  const m=l.venueMap[node]||{front:null,left:null,right:null,back:null};
  $('mapEditor').innerHTML=`<div><div class="label">Left</div><select class="field" data-direction="left">${opts()}</select></div><div><div class="label">Front</div><select class="field" data-direction="front">${opts()}</select></div><div><div class="label">Right</div><select class="field" data-direction="right">${opts()}</select></div><div class="back"><div class="label">Back</div><select class="field" data-direction="back">${opts()}</select></div>`;
  ['left','front','right','back'].forEach(d=>{$(`[data-direction="${d}"]`)});
  document.querySelectorAll('[data-direction]').forEach(sel=>{sel.value=m[sel.dataset.direction]||'';sel.onchange=()=>{l.venueMap[node]=l.venueMap[node]||{};l.venueMap[node][sel.dataset.direction]=sel.value||null;save();renderVenue()}});
}

function buildRoomCopies(){
  const l=activeLocation(), old=l.venueMap||{};
  l.roomInstances=[];

  (l.rooms||[]).forEach(r=>{
    const copies=Math.max(1,Number(l.roomCopies[r]||1));
    if(copies===1) l.roomInstances.push(r);
    else for(let i=1;i<=copies;i++) l.roomInstances.push(`${r} ${i}`);
  });

  l.venueMap={
    Entrance:old.Entrance||{front:null,left:null,right:null,back:null},
    Exit:old.Exit||{front:null,left:null,right:null,back:null}
  };
  l.roomInstances.forEach(n=>l.venueMap[n]=old[n]||{front:null,left:null,right:null,back:null});
  save();renderAll();toast('Map rooms updated');
}

function availableFocusRooms(){
  const l=activeLocation();
  if(l.roomInstances.length)return [...new Set(l.roomInstances.map(roomTypeFromInstance))];
  if(l.rooms.length)return [...l.rooms];
  return [...ROOMS];
}

function renderFocus(){
  const rooms=availableFocusRooms(), chosen=$('focusRoom').value;
  $('focusRoom').innerHTML='<option value="">Choose a room…</option>'+rooms.map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join('');
  $('focusRoom').value=rooms.includes(chosen)?chosen:'';
  $('pinCount').textContent=`${state.pins.length} / ${MAX_PINS}`;
  renderFocusChoices();
  $('pinList').innerHTML=state.pins.length?state.pins.map((i,idx)=>`<div class="item row between"><div><b>${esc(BADGES[i].name)}</b><div class="sub">${esc(BADGES[i].room||'Any room')} • ${esc(BADGES[i].how)}</div></div><div class="row"><button class="mini" data-open-focus="${idx}">Open</button><button class="mini" data-unpin="${i}">✕</button></div></div>`).join(''):'<div class="item sub">No pinned badges.</div>';
}

function renderFocusChoices(){
  const room=$('focusRoom').value, showEarned=$('focusShowEarned').checked;
  if(!room){$('focusChoices').innerHTML='<div class="item sub">Choose a room to see its badges.</div>';return}
  const rows=BADGES.map((b,i)=>[b,i]).filter(([b,i])=>roomParts(b).includes(room)&&availableHere(b)&&(showEarned||!state.earned[i]));
  $('focusChoices').innerHTML=rows.length?rows.map(([b,i])=>{const pinned=state.pins.includes(i);const full=state.pins.length>=MAX_PINS&&!pinned;return `<div class="item row between"><div><b>${state.earned[i]?'✓ ':''}${esc(b.name)}</b><div class="sub">${esc(b.how)}${b.game?' • '+esc(b.game):''}${b.level?' • L'+esc(b.level):''}</div></div><button class="mini" data-focus-pin="${i}" ${pinned||full?'disabled':''}>${pinned?'Pinned':full?'Limit 5':'Pin'}</button></div>`}).join(''):'<div class="item sub">No applicable badges for this room.</div>';
}

function renderStats(){
  const n=earnedCount(), here=BADGES.filter((b,i)=>availableHere(b)&&!state.earned[i]).length, away=BADGES.filter((b,i)=>!availableHere(b)&&!state.earned[i]).length;
  $('statsCards').innerHTML=`<div class="stat"><span class="label">Earned</span><b>${n}</b></div><div class="stat"><span class="label">Available here</span><b>${here}</b></div><div class="stat"><span class="label">Other location</span><b>${away}</b></div><div class="stat"><span class="label">Pinned</span><b>${state.pins.length}</b></div>`;
  const byRoom={};BADGES.forEach((b,i)=>{if(state.earned[i])roomParts(b).forEach(r=>byRoom[r]=(byRoom[r]||0)+1)});
  $('roomStats').innerHTML=Object.entries(byRoom).sort((a,b)=>b[1]-a[1]).map(([r,c])=>`<div class="item row between"><span>${esc(r)}</span><b>${c}</b></div>`).join('')||'<div class="item sub">No room-specific badges earned yet.</div>';
  $('historyList').innerHTML=state.history.map(h=>`<div class="item"><b>${esc(BADGES[h.badge]?.name||'Badge')}</b><div class="sub">${esc(h.date||'')}</div></div>`).join('')||'<div class="item sub">No history yet.</div>';
}

function renderAll(){renderHome();renderBadges();renderLocations();renderVenue();renderFocus();renderStats();save()}

function toggleEarn(i){
  if(state.earned[i]){delete state.earned[i];state.history=state.history.filter(h=>h.badge!==i)}
  else{state.earned[i]=true;state.history.unshift({badge:i,date:new Date().toISOString().slice(0,10)})}
  renderAll();
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
  $('modalEarn').textContent=state.earned[i]?'Mark not earned':'Mark earned';
  $('modalPin').textContent=state.pins.includes(i)?'Unpin':'Pin';
  $('badgeModal').classList.add('open');
  if($('revealSolution'))$('revealSolution').onclick=()=>{$('solutionText').style.display='block';$('revealSolution').style.display='none'};
}

function openFocusOverlay(index){
  if(!state.pins.length)return;
  focusIndex=(index+state.pins.length)%state.pins.length;
  const i=state.pins[focusIndex],b=BADGES[i];
  $('focusPosition').textContent=`${focusIndex+1} / ${state.pins.length}`;
  $('focusOverlayBody').innerHTML=`<section><div class="focus-meta">${esc(b.room||'Any room')}${b.game?' • '+esc(b.game):''}${b.level?' • Level '+esc(b.level):''}</div><h2 class="focus-title">${esc(b.name)}</h2><p class="focus-requirement">${esc(b.how)}</p></section><section>${b.tip?`<div class="detail"><strong>Tip / watch out</strong>${esc(b.tip)}</div>`:''}${b.hint?`<div class="detail"><strong>Hint</strong>${esc(b.hint)}</div>`:''}${b.solution?`<div class="detail"><strong>Spoiler</strong><button id="focusReveal" class="btn ghost">Reveal</button><div id="focusSolution" style="display:none;margin-top:8px">${esc(b.solution)}</div></div>`:''}</section>`;
  $('focusOverlay').classList.add('open');
  if($('focusReveal'))$('focusReveal').onclick=()=>{$('focusSolution').style.display='block';$('focusReveal').style.display='none'};
}

function exportBackup(){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='activate-badge-backup-v8.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

async function init(){
  try{
    const [badgeRes,roomRes]=await Promise.all([fetch('badges.json',{cache:'no-store'}),fetch('rooms.json',{cache:'no-store'})]);
    if(!badgeRes.ok||!roomRes.ok)throw new Error('Data files failed to load');
    BADGES=await badgeRes.json();
    const roomData=await roomRes.json();ROOMS=roomData.rooms||[];GAMES=roomData.games||[];
    loadState();bindEvents();renderAll();
    setTimeout(()=>$('splash').classList.add('hide'),350);
  }catch(err){
    console.error(err);
    $('splash').classList.add('hide');
    document.body.insertAdjacentHTML('afterbegin',`<div style="padding:16px;background:#5b1125;color:white">App failed to load: ${esc(err.message)}. Refresh the page after GitHub Pages finishes deploying.</div>`);
  }
}

function bindEvents(){
  document.addEventListener('click',e=>{
    const nav=e.target.closest('[data-view]');if(nav){document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));document.querySelectorAll('.nav button').forEach(b=>b.classList.remove('active'));$(nav.dataset.view).classList.add('active');nav.classList.add('active');return}
    const t=e.target.closest('[data-toggle-earned]');if(t)return toggleEarn(Number(t.dataset.toggleEarned));
    const o=e.target.closest('[data-open-badge]');if(o)return openBadge(Number(o.dataset.openBadge));
    const p=e.target.closest('[data-pin]');if(p)return togglePin(Number(p.dataset.pin));
    const fp=e.target.closest('[data-focus-pin]');if(fp)return togglePin(Number(fp.dataset.focusPin));
    const un=e.target.closest('[data-unpin]');if(un)return togglePin(Number(un.dataset.unpin));
    const of=e.target.closest('[data-open-focus]');if(of)return openFocusOverlay(Number(of.dataset.openFocus));
    const loc=e.target.closest('[data-location]');if(loc){state.activeLocation=loc.dataset.location;renderAll();return}
    const rt=e.target.closest('[data-room-toggle]');if(rt){
      const l=activeLocation(),r=rt.dataset.roomToggle;
      if(l.rooms.includes(r)){
        l.rooms=l.rooms.filter(x=>x!==r);
        delete l.roomCopies[r];
      }else{
        l.rooms=[...l.rooms,r];
        l.roomCopies[r]=l.roomCopies[r]||1;
      }
      buildRoomCopies();return
    }
    const gt=e.target.closest('[data-game-toggle]');if(gt){const l=activeLocation(),g=gt.dataset.gameToggle;l.games=l.games.includes(g)?l.games.filter(x=>x!==g):[...l.games,g];renderAll();return}
  });
  $('badgeSearch').addEventListener('input',renderBadges);$('badgeStatus').addEventListener('change',renderBadges);$('badgeAvailability').addEventListener('change',renderBadges);
  $('locationName').addEventListener('input',e=>{activeLocation().name=e.target.value;save();renderHome()});
  $('addLocation').onclick=()=>{const id='loc_'+Date.now();state.locations.push({id,name:'New location',rooms:[],games:[],roomCopies:{},roomInstances:[],venueMap:{Entrance:{front:null,left:null,right:null,back:null},Exit:{front:null,left:null,right:null,back:null}}});state.activeLocation=id;renderAll()};
  $('deleteLocation').onclick=()=>{if(state.locations.length===1)return toast('Keep at least one location');state.locations=state.locations.filter(l=>l.id!==state.activeLocation);state.activeLocation=state.locations[0].id;renderAll()};
  $('allRooms').onclick=()=>{const l=activeLocation();l.rooms=[...ROOMS];l.rooms.forEach(r=>l.roomCopies[r]=l.roomCopies[r]||1);buildRoomCopies()};$('clearRooms').onclick=()=>{const l=activeLocation();l.rooms=[];l.roomCopies={};buildRoomCopies()};
  $('allGames').onclick=()=>{activeLocation().games=[...GAMES];renderAll()};$('clearGames').onclick=()=>{activeLocation().games=[];renderAll()};
  document.addEventListener('change',e=>{
  const dt=e.target.closest('[data-dup-toggle]');
  if(dt){
    const r=dt.dataset.dupToggle;
    activeLocation().roomCopies[r]=dt.checked?2:1;
    save();renderVenue();return;
  }
  const dc=e.target.closest('[data-dup-count]');
  if(dc){
    activeLocation().roomCopies[dc.dataset.dupCount]=Number(dc.value);
    save();renderVenue();return;
  }
});
  $('buildRoomCopies').onclick=buildRoomCopies;$('mapNode').onchange=renderMapEditor;
  $('focusRoom').onchange=renderFocusChoices;$('focusShowEarned').onchange=renderFocusChoices;
  $('closeModal').onclick=()=>$('badgeModal').classList.remove('open');$('badgeModal').onclick=e=>{if(e.target.id==='badgeModal')$('badgeModal').classList.remove('open')};
  $('modalEarn').onclick=()=>{toggleEarn(modalBadgeIndex);openBadge(modalBadgeIndex)};$('modalPin').onclick=()=>{togglePin(modalBadgeIndex);openBadge(modalBadgeIndex)};
  $('closeFocusOverlay').onclick=()=>$('focusOverlay').classList.remove('open');
  $('focusNext').onclick=()=>openFocusOverlay(focusIndex+1);$('focusPrev').onclick=()=>openFocusOverlay(focusIndex-1);
  $('focusComplete').onclick=()=>{if(!state.pins.length)return;const i=state.pins[focusIndex];if(!state.earned[i]){state.earned[i]=true;state.history.unshift({badge:i,date:new Date().toISOString().slice(0,10)})}state.pins=state.pins.filter(x=>x!==i);renderAll();if(state.pins.length)openFocusOverlay(Math.min(focusIndex,state.pins.length-1));else $('focusOverlay').classList.remove('open')};
  $('backupTop').onclick=exportBackup;$('exportBackup').onclick=exportBackup;
  $('importBackup').onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{state=JSON.parse(r.result);state.locations.forEach(ensureLocationShape);save();renderAll();toast('Backup restored')}catch{toast('Could not read backup')}};r.readAsText(f)};
  $('resetApp').onclick=()=>{if(confirm('Reset all app data?')){state=defaultState();renderAll()}};
}

if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(console.error));
init();

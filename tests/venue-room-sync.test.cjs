const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const start=source.indexOf('function mergeOnlineLocation(');
const end=source.indexOf('\nfunction importOnlineProgress(',start);
assert.ok(start>=0 && end>start,'venue room merge function is available');
const mergeSource=source.slice(start,end);

function merge(existing,remoteRooms){
  const state={locations:[existing||{id:'activate-7',rooms:[]}]};
  const context={
    state,
    ROOMS:['Arena','Grid','Laser'],
    onlineLocationId:id=>`activate-${id}`,
    ensureLocationShape:()=>{}
  };
  const mergeOnlineLocation=vm.runInNewContext(`${mergeSource}\nmergeOnlineLocation`,context);
  const games=remoteRooms.map(name=>({room:{name}}));
  const result=mergeOnlineLocation({id:7,name:'Test venue'},games);
  return {rooms:Array.from(result.rooms),activateRooms:Array.from(result.activateRooms)};
}

test('initial venue load selects rooms from its games',()=>{
  assert.deepEqual(merge(null,['Arena','Grid']),{
    rooms:['Arena','Grid'],activateRooms:['Arena','Grid']
  });
});

test('refresh preserves room selections and deliberate removals',()=>{
  const existing={id:'activate-7',rooms:['Arena'],activateRooms:['Arena','Grid']};
  assert.deepEqual(merge(existing,['Grid']),{
    rooms:['Arena'],activateRooms:['Arena','Grid']
  });
  assert.deepEqual(merge(existing,['Arena','Grid','Laser']),{
    rooms:['Arena','Laser'],activateRooms:['Arena','Grid','Laser']
  });
});

test('empty game response does not clear saved rooms or their history',()=>{
  const existing={id:'activate-7',rooms:['Arena','Laser'],activateRooms:['Arena','Grid']};
  assert.deepEqual(merge(existing,[]),{
    rooms:['Arena','Laser'],activateRooms:['Arena','Grid']
  });
});

test('venue game list records exact room and game pairs and survives an empty refresh',()=>{
  const context={
    state:{locations:[]},ROOMS:['Control','Hide'],
    onlineLocationId:id=>`activate-${id}`,ensureLocationShape:()=>{}
  };
  const mergeOnlineLocation=vm.runInNewContext(`${mergeSource}\nmergeOnlineLocation`,context);
  const initial=mergeOnlineLocation({id:7,name:'Test venue'},[
    {name:'Sprint',room:{name:'Control'}},
    {name:'Connections',room:{name:'Hide'}}
  ]);
  assert.deepEqual(Array.from(initial.activateGameKeys),['Control||Sprint','Hide||Connections']);
  context.state.locations=[initial];
  const refreshed=mergeOnlineLocation({id:7,name:'Test venue'},[]);
  assert.deepEqual(Array.from(refreshed.activateGameKeys),['Control||Sprint','Hide||Connections']);
});

test('new games use the actual venue list without changing other game availability',()=>{
  const start=source.indexOf('function roomGameEntries(');
  const end=source.indexOf('\nfunction enabledGameNames(',start);
  const context={
    GAME_CATALOG:{
      Control:{competitive:['Sprint','Tails'],cooperative:[]},
      Press:{competitive:['Gem Rush'],cooperative:[]}
    },
    VENUE_SPECIFIC_GAME_KEYS:new Set(['Control||Sprint']),
    activeLocation:()=>null
  };
  const inferred=vm.runInNewContext(`${source.slice(start,end)}\ninferredGamesForLocation`,context);
  const withSprint={rooms:['Control','Press'],activateLocationId:7,activateGameKeys:['Control||Sprint']};
  const withoutSprint={rooms:['Control','Press'],activateLocationId:8,activateGameKeys:[]};
  assert.deepEqual(Array.from(inferred(withSprint),x=>x.game),['Sprint','Tails','Gem Rush']);
  assert.deepEqual(Array.from(inferred(withoutSprint),x=>x.game),['Tails','Gem Rush']);
  assert.deepEqual(Array.from(inferred({rooms:['Control','Press']}),x=>x.game),['Sprint','Tails','Gem Rush']);
});

test('competitive and level views omit a new game absent from the venue',()=>{
  const venue={rooms:['Control'],excludedGames:[],activateLocationId:8,activateGameKeys:[]};
  const catalog={Control:{competitive:['Sprint','Tails'],cooperative:[]}};
  const offered=(l,room,game)=>game!=='Sprint'||l.activateGameKeys.includes(`${room}||${game}`);
  const competitiveStart=source.indexOf('function competitiveEntries(');
  const competitiveEnd=source.indexOf('\nconst isTrophy=',competitiveStart);
  const competitive=vm.runInNewContext(`${source.slice(competitiveStart,competitiveEnd)}\ncompetitiveEntries`,{
    activeLocation:()=>venue,GAME_CATALOG:catalog,gameOfferedAtLocation:offered
  });
  assert.deepEqual(Array.from(competitive(),x=>x.game),['Tails']);

  const levelStart=source.indexOf('function progressEntries(');
  const levelEnd=source.indexOf('\nfunction gamePlayEntries(',levelStart);
  const levels=vm.runInNewContext(`${source.slice(levelStart,levelEnd)}\nprogressEntries`,{
    activeLocation:()=>venue,activeLevelProgress:()=>({games:{},competitive:{}}),
    gameModesForRoom:room=>catalog[room],gameOfferedAtLocation:offered
  });
  assert.deepEqual(Array.from(levels(),x=>x.game),['Tails']);
});

test('a deliberate clear of all rooms remains cleared on refresh',()=>{
  const existing={id:'activate-7',rooms:[],activateRooms:['Arena','Grid']};
  assert.deepEqual(merge(existing,['Arena','Grid']),{
    rooms:[],activateRooms:['Arena','Grid']
  });
});

function automaticLookup(locations,fetcher){
  const start=source.indexOf('const venueRoomRequests=');
  const end=source.indexOf('\nfunction importOnlineProgress(',start);
  const context={
    state:{activeLocation:locations[0].id,activePlayerKey:'nick',locations},
    ROOMS:['Arena','Grid','Laser','Photo'],ACTIVATE_SCORES_SYNC_ENABLED:true,
    onlineLocationId:id=>`activate-${id}`,ensureLocationShape:()=>{},
    fetchActivateScores:fetcher,save:()=>{},renderAll:()=>{},toast:()=>{},
    console:{warn:()=>{}}
  };
  context.populate=vm.runInNewContext(`${source.slice(start,end)}\npopulateVenueRooms`,context);
  return context;
}

test('first selection loads rooms, preserves Photo, and does not refill a later manual clear',async()=>{
  const calls=[];
  const context=automaticLookup([{id:'activate-7',activateLocationId:7,name:'Test',rooms:['Photo']}],async path=>{
    calls.push(path);
    return [{room:{name:'Grid'}},{room:{name:'Laser'}}];
  });
  await Promise.all([context.populate(),context.populate()]);
  assert.equal(calls.length,1,'concurrent selections share one request');
  assert.deepEqual(Array.from(context.state.locations[0].rooms),['Grid','Laser','Photo']);
  assert.ok(context.state.locations[0].venueRoomsLoadedAt);
  context.state.locations[0].rooms=[];
  await context.populate();
  assert.equal(calls.length,1);
  assert.deepEqual(context.state.locations[0].rooms,[]);
});

test('named manual venues resolve exactly and retain their identity',async()=>{
  const context=automaticLookup([{id:'manual',name:'Watford',rooms:['Photo']}],async path=>
    path.endsWith('/locations')?[{id:92,name:'Watford'}]:[{room:{name:'Grid'}}]);
  await context.populate();
  const venue=context.state.locations[0];
  assert.equal(venue.id,'manual');
  assert.equal(venue.activateLocationId,undefined);
  assert.equal(venue.roomSourceLocationId,92);
  assert.deepEqual(Array.from(venue.rooms),['Grid','Photo']);
});

test('failed or empty lookups keep saved rooms and allow a retry',async()=>{
  let calls=0;
  const context=automaticLookup([{id:'activate-7',activateLocationId:7,name:'Test',rooms:['Photo']}],async()=>{
    calls++;
    if(calls===1)throw Error('offline');
    return calls===2?[]:[{room:{name:'Grid'}}];
  });
  await context.populate();
  await context.populate();
  assert.deepEqual(context.state.locations[0].rooms,['Photo']);
  assert.equal(context.state.locations[0].venueRoomsLoadedAt,undefined);
  await context.populate();
  assert.equal(calls,3);
  assert.deepEqual(Array.from(context.state.locations[0].rooms),['Grid','Photo']);
});

test('a response cannot write into a player selected while it was loading',async()=>{
  let release;
  const context=automaticLookup([{id:'activate-7',activateLocationId:7,name:'Test',rooms:['Photo']}],
    ()=>new Promise(resolve=>{release=resolve}));
  const pending=context.populate();
  await Promise.resolve();
  context.state.activePlayerKey='another-player';
  release([{room:{name:'Grid'}}]);
  await pending;
  assert.deepEqual(context.state.locations[0].rooms,['Photo']);
});

test('manual edits made while rooms load are preserved',async()=>{
  let release;
  const context=automaticLookup([{id:'activate-7',activateLocationId:7,name:'Test',rooms:['Grid']}],
    ()=>new Promise(resolve=>{release=resolve}));
  const pending=context.populate();
  await Promise.resolve();
  context.state.locations[0].rooms=['Photo'];
  release([{room:{name:'Grid'}},{room:{name:'Laser'}}]);
  await pending;
  assert.deepEqual(Array.from(context.state.locations[0].rooms),['Laser','Photo']);
});

test('a replaced venue record is not overwritten by an older lookup',async()=>{
  let release;
  const context=automaticLookup([{id:'activate-7',activateLocationId:7,name:'Test',rooms:['Photo']}],
    ()=>new Promise(resolve=>{release=resolve}));
  const pending=context.populate();
  await Promise.resolve();
  context.state.locations[0]={...context.state.locations[0],rooms:['Laser']};
  release([{room:{name:'Grid'}}]);
  await pending;
  assert.deepEqual(context.state.locations[0].rooms,['Laser']);
});

test('an unmatched manual venue can retry with a fresh directory',async()=>{
  let directoryCalls=0;
  const context=automaticLookup([{id:'manual',name:'Watford',rooms:['Photo']}],async path=>{
    if(path.endsWith('/locations')){
      directoryCalls++;
      return directoryCalls===1?[]:[{id:92,name:'Watford'}];
    }
    return [{room:{name:'Grid'}}];
  });
  await context.populate();
  await context.populate();
  assert.equal(directoryCalls,2);
  assert.deepEqual(Array.from(context.state.locations[0].rooms),['Grid','Photo']);
});

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

test('a deliberate clear of all rooms remains cleared on refresh',()=>{
  const existing={id:'activate-7',rooms:[],activateRooms:['Arena','Grid']};
  assert.deepEqual(merge(existing,['Arena','Grid']),{
    rooms:[],activateRooms:['Arena','Grid']
  });
});

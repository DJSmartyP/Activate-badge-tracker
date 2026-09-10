import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './worker.js';

test('rejects unrelated paths',async()=>{
  const response=await worker.fetch(new Request('https://worker.example/not-allowed'),{});
  assert.equal(response.status,404);
});

test('forwards a player lookup with the required upstream origin',async()=>{
  const originalFetch=globalThis.fetch;
  let forwarded;
  globalThis.fetch=async(url,options)=>{
    forwarded={url,options};
    return new Response('[{"id":92,"name":"Watford"}]',{headers:{'Content-Type':'application/json'}});
  };
  try{
    const response=await worker.fetch(new Request('https://worker.example/api/activate/playerlocations/DJ%20Smarty',{
      headers:{Origin:'https://djsmartyp.github.io'}
    }),{});
    assert.equal(response.status,200);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://djsmartyp.github.io');
    assert.equal(forwarded.url,'https://www.activate-scores.ca/api/activate/playerlocations/DJ%20Smarty');
    assert.equal(forwarded.options.headers.Origin,'https://www.activate-scores.ca');
  }finally{
    globalThis.fetch=originalFetch;
  }
});

test('rejects browser requests from other origins',async()=>{
  const response=await worker.fetch(new Request('https://worker.example/api/activate/badges/Player',{
    headers:{Origin:'https://attacker.example'}
  }),{});
  assert.equal(response.status,403);
});

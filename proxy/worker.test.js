import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './worker.js';

test('rejects unrelated paths',async()=>{
  const response=await worker.fetch(new Request('https://worker.example/not-allowed'),{});
  assert.equal(response.status,404);
});

test('forwards an allowed public player-location lookup with the API key',async()=>{
  const originalFetch=globalThis.fetch;
  let forwarded;
  globalThis.fetch=async(url,options)=>{
    forwarded={url,options};
    return Response.json([{id:92,name:'Watford'}]);
  };
  try{
    const response=await worker.fetch(new Request('https://worker.example/api/public/activate/player/DJ%20Smarty/locations',{
      headers:{Origin:'https://djsmartyp.github.io'}
    }),{ACTIVATE_API_KEY:'test-key',ACTIVATE_RATE_LIMITER:{limit:async()=>({success:true})}});
    assert.equal(response.status,200);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://djsmartyp.github.io');
    assert.equal(forwarded.url,'https://www.activate-scores.ca/api/public/activate/player/DJ%20Smarty/locations');
    assert.equal(forwarded.options.headers['x-api-key'],'test-key');
  }finally{
    globalThis.fetch=originalFetch;
  }
});

test('returns 429 without an upstream request when the shared limit is reached',async()=>{
  const originalFetch=globalThis.fetch;
  let fetchCalled=false;
  globalThis.fetch=async()=>{fetchCalled=true;throw new Error('fetch must not be called')};
  try{
    const response=await worker.fetch(
      new Request('https://worker.example/api/public/activate/locations'),
      {ACTIVATE_API_KEY:'test-key',ACTIVATE_RATE_LIMITER:{limit:async()=>({success:false})}}
    );
    assert.equal(response.status,429);
    assert.equal(response.headers.get('Retry-After'),'60');
    assert.equal(fetchCalled,false);
  }finally{
    globalThis.fetch=originalFetch;
  }
});

test('fails closed when the API key is not configured',async()=>{
  const originalFetch=globalThis.fetch;
  let fetchCalled=false;
  globalThis.fetch=async()=>{fetchCalled=true;throw new Error('fetch must not be called')};
  try{
    const response=await worker.fetch(new Request('https://worker.example/api/public/activate/locations'),{});
    assert.equal(response.status,503);
    assert.equal(fetchCalled,false);
  }finally{
    globalThis.fetch=originalFetch;
  }
});

test('rejects browser requests from other origins',async()=>{
  const response=await worker.fetch(new Request('https://worker.example/api/public/activate/badges/Player',{
    headers:{Origin:'https://attacker.example'}
  }),{});
  assert.equal(response.status,403);
});

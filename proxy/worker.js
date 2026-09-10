const UPSTREAM='https://www.activate-scores.ca';

function allowedPath(pathname){
  return /^\/api\/activate\/playerlocations\/[^/]+$/.test(pathname)
    || /^\/api\/activate\/players\/player\/[^/]+\/location\/\d+$/.test(pathname)
    || /^\/api\/activate\/badges\/[^/]+$/.test(pathname);
}

function corsHeaders(origin,env){
  const allowed=String(env.ALLOWED_ORIGINS||'https://djsmartyp.github.io')
    .split(',').map(x=>x.trim()).filter(Boolean);
  return allowed.includes(origin)?{
    'Access-Control-Allow-Origin':origin,
    'Access-Control-Allow-Methods':'GET, OPTIONS',
    'Access-Control-Allow-Headers':'Accept',
    'Access-Control-Max-Age':'86400',
    'Vary':'Origin'
  }:{};
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    const origin=request.headers.get('Origin')||'';
    const cors=corsHeaders(origin,env);

    if(request.method==='OPTIONS'){
      return Object.keys(cors).length
        ? new Response(null,{status:204,headers:cors})
        : new Response('Origin not allowed',{status:403});
    }
    if(request.method!=='GET')return new Response('Method not allowed',{status:405,headers:{Allow:'GET, OPTIONS',...cors}});
    if(!allowedPath(url.pathname))return new Response('Not found',{status:404,headers:cors});
    if(origin && !Object.keys(cors).length)return new Response('Origin not allowed',{status:403});

    const upstream=await fetch(UPSTREAM+url.pathname+url.search,{
      headers:{
        Accept:'application/json',
        Origin:'https://www.activate-scores.ca',
        Referer:'https://www.activate-scores.ca/'
      }
    });
    return new Response(upstream.body,{
      status:upstream.status,
      headers:{'Content-Type':upstream.headers.get('Content-Type')||'application/json','Cache-Control':'private, max-age=60',...cors}
    });
  }
};

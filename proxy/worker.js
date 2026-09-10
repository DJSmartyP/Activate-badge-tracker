const UPSTREAM='https://www.activate-scores.ca';

function allowedPath(pathname){
  return pathname==='/api/public/activate/locations'
    || /^\/api\/public\/activate\/location\/\d+\/games$/.test(pathname)
    || /^\/api\/public\/activate\/badges\/[^/]+$/.test(pathname)
    || /^\/api\/public\/activate\/player\/[^/]+\/location\/\d+$/.test(pathname)
    || /^\/api\/public\/activate\/location\/\d+\/rooms\/[^/]+\/highscores$/.test(pathname)
    || /^\/api\/public\/activate\/location\/\d+\/leaderboard$/.test(pathname)
    || /^\/api\/public\/activate\/player\/[^/]+\/locations$/.test(pathname);
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

    if(!env.ACTIVATE_API_KEY){
      return Response.json({message:'Activate Scores API is not configured.'},{status:503,headers:{'Cache-Control':'no-store',...cors}});
    }
    if(!env.ACTIVATE_RATE_LIMITER){
      return Response.json({message:'Activate Scores rate limiting is not configured.'},{status:503,headers:{'Cache-Control':'no-store',...cors}});
    }

    const {success}=await env.ACTIVATE_RATE_LIMITER.limit({key:'activate-tracker-public-api'});
    if(!success){
      return Response.json(
        {message:'Activate Scores request limit reached. Try again in a minute.'},
        {status:429,headers:{'Cache-Control':'no-store','Retry-After':'60',...cors}}
      );
    }

    try{
      const upstream=await fetch(UPSTREAM+url.pathname+url.search,{
        headers:{Accept:'application/json','x-api-key':env.ACTIVATE_API_KEY}
      });
      return new Response(upstream.body,{
        status:upstream.status,
        headers:{'Content-Type':upstream.headers.get('Content-Type')||'application/json','Cache-Control':'private, max-age=60',...cors}
      });
    }catch{
      return Response.json({message:'Activate Scores is temporarily unavailable.'},{status:502,headers:{'Cache-Control':'no-store',...cors}});
    }
  }
};

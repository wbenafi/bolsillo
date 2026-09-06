import { createServer } from 'node:http';
import { request, Agent } from 'node:https';
import dns from 'node:dns/promises';
import { localEnvironment } from '../local-config.mjs';
const origin = new URL(localEnvironment().CLERK_JWT_ISSUER_DOMAIN).origin;
const host = new URL(origin).hostname;
const addresses = await dns.lookup(host, { all: true });
const address = addresses.find(a=>a.family===6) ?? addresses[0];
// Resolve before Chromium starts; Tailscale DNS is unreliable during browser QA.
// TLS still verifies the original Clerk hostname and all responses are real.
const agent = new Agent({keepAlive:true,lookup:(_host,options,callback)=>{
  if(options.all) callback(null,[address]);else callback(null,address.address,address.family);
}});
const server = createServer(async (req,res)=>{
  if(req.method==='GET'&&req.url==='/health'){res.writeHead(200,{'content-type':'application/json'}).end('{"service":"bolsillo-clerk-qa"}');return;}
  if(req.method!=='POST'){res.writeHead(405).end();return;}
  try {
    const chunks=[];for await(const chunk of req) chunks.push(chunk);
    const args=JSON.parse(Buffer.concat(chunks));const url=new URL(args.url);
    if(url.origin!==origin) {res.writeHead(403).end();return;}
    const headers={...args.headers,'accept-encoding':'identity'};delete headers.host;delete headers.connection;delete headers['content-length'];
    let result; let target=url;
    for(let redirects=0;redirects<6;redirects++){
    for(let attempt=0;;attempt++){
    try { result=await new Promise((resolve,reject)=>{
      const upstream=request(target,{method:args.method,headers,agent,timeout:20000},async response=>{
        try{const parts=[];for await(const chunk of response)parts.push(chunk);const headers=Object.fromEntries(Object.entries(response.headers).map(([k,v])=>[k,Array.isArray(v)?v.join('\n'):v]));delete headers['content-length'];resolve({status:response.statusCode,headers,body:Buffer.concat(parts).toString('base64')});}catch(error){reject(error);}
      });upstream.on('error',reject);upstream.on('timeout',()=>upstream.destroy(new Error('Clerk timeout')));upstream.end(args.body?Buffer.from(args.body,'base64'):undefined);
    });
    break; } catch(error) { if(attempt>=2 || !['ENETUNREACH','EHOSTUNREACH','ECONNRESET','ETIMEDOUT'].includes(error.code))throw error;await new Promise(resolve=>setTimeout(resolve,300*(attempt+1))); }
    }
    if([301,302,303,307,308].includes(result.status)&&result.headers.location){const next=new URL(result.headers.location,target);if(next.origin===origin){target=next;continue;}}
    break;
    }
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(result));
  } catch(error){res.writeHead(502,{'content-type':'application/json'}).end(JSON.stringify({error:error.code || error.message}));}
});
server.listen(Number(process.env.QA_RELAY_PORT ?? 9091),'127.0.0.1',()=>console.log(`QA_RELAY_READY ${server.address().port}`));

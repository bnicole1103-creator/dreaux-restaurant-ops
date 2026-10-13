import { createClient } from 'npm:@supabase/supabase-js@2.112.2'
import webpush from 'npm:web-push@3.6.7'
import { deliverBatch } from './delivery.ts'
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}})
Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(request.method!=='POST')return reply({error:'POST required'},405);
 const url=Deno.env.get('SUPABASE_URL'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!url||!service)return reply({error:'Server configuration missing'},503);
 const client=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 let body;try{body=await request.json()}catch{return reply({error:'Invalid request'},400)}
 if(body.action==='config'){
  const bearer=request.headers.get('Authorization')?.replace(/^Bearer\s+/i,'');if(!bearer)return reply({error:'Sign in first'},401);
  const user=await client.auth.getUser(bearer);if(user.error||!user.data.user)return reply({error:'Sign in first'},401);
  const publicKey=Deno.env.get('VAPID_PUBLIC_KEY');if(!publicKey)return reply({error:'Notifications not configured'},503);
  return reply({publicKey});
 }
 const token=Deno.env.get('PUSH_DISPATCH_TOKEN');
 if(body.action!=='dispatch'||!token||request.headers.get('x-push-dispatch-token')!==token)return reply({error:'Not authorized'},401);
 const publicKey=Deno.env.get('VAPID_PUBLIC_KEY'),privateKey=Deno.env.get('VAPID_PRIVATE_KEY'),subject=Deno.env.get('VAPID_SUBJECT');
 if(!publicKey||!privateKey||!subject)return reply({error:'Push keys missing'},503);
 try{
  const result=await deliverBatch(client,async job=>{
   const details=webpush.generateRequestDetails(job.subscription,JSON.stringify(job.payload),{TTL:1800,urgency:'normal',vapidDetails:{subject,publicKey,privateKey}});
   const response=await fetch(details.endpoint,{method:'POST',headers:details.headers,body:new Uint8Array(details.body),redirect:'error',signal:AbortSignal.timeout(8000)});
   await response.body?.cancel();return response.status;
  });
  return reply(result);
 }catch{console.error('Push dispatch failed; unfinished leases will retry.');return reply({error:'Delivery failed; queue will retry'},503)}
});

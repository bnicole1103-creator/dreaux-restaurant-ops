import {createClient} from 'npm:@supabase/supabase-js@2.112.2'
import {factsFrom,kinds,requestBody,parseResult,salesScriptFacts,type Kind} from './logic.ts'
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'}
Deno.serve(async req=>{
 const send=(body:unknown,status=200)=>Response.json(body,{status,headers:cors})
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return send({error:'Use POST.'},405)
 try{
  const auth=req.headers.get('authorization')??'';if(!auth.startsWith('Bearer '))return send({error:'Sign in before using the assistant.'},401)
  const raw=await req.text();if(raw.length>60000)throw Error('Use a smaller snapshot or shorter notes.')
  const input=JSON.parse(raw),{location_id,day,kind,notes='',snapshot={}}=input
  if(typeof location_id!=='string'||!/^[a-f\d-]{36}$/i.test(location_id)||!kinds.includes(kind)||typeof notes!=='string'||notes.length>6000||typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)||new Date(day+'T12:00:00Z').toISOString().slice(0,10)!==day)throw Error('Choose a valid location, date and workflow.')
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:auth}},auth:{persistSession:false}})
  const user=await db.auth.getUser();if(user.error||!user.data.user)return send({error:'Sign in again.'},401)
  const key=Deno.env.get('OPENAI_API_KEY');if(!key)return send({error:'AI is not configured. You can continue using the normal workflow.'},503)
  const claim=await db.rpc('operations_assistant_claim',{p_location:location_id,p_kind:kind});if(claim.error)return send({error:claim.error.message},claim.error.code==='42501'?403:429);if(claim.data!==true)return send({error:'Workflow access required.'},403)
  const fromTraining=kind==='sales'&&Object.hasOwn(input,'sales_script_source')
  let facts=fromTraining?salesScriptFacts(input.sales_script_source):factsFrom(kind as Kind,{draft_snapshot:snapshot})
  if(kind==='reservation'){
   const r=await db.rpc('reservation_capacity_load',{p_location_id:location_id,p_day:day});if(r.error)throw Error('Day availability could not load. Review it on Floor.')
   const data=r.data;facts=[...facts,...factsFrom(kind,{day:data.day,configured:data.configured,config:data.config,rooms:[...new Set((data.tables??[]).map((t:any)=>t.roomName))],bookings:(data.bookings??[]).map((b:any,i:number)=>({party_reference:i+1,party:b.party,start:b.start,end:b.end,live:b.live}))}).map((f,i)=>({...f,id:'live_'+(i+1)}))]
  }
  if(kind==='sales'&&!fromTraining){
   const r=await db.rpc('menu_catalog_load',{p_location_id:location_id});if(r.error)throw Error('Approved menu information could not load.')
   facts=[...facts,...factsFrom(kind,{menu:(r.data?.items??[]).filter((r:any)=>!r.archived&&r.data?.available===true).slice(0,30).map((r:any)=>({name:r.data.name,description:r.data.description}))}).map((f,i)=>({...f,id:'menu_'+(i+1)}))]
  }
  const began=Date.now(),model=Deno.env.get('OPERATIONS_AI_MODEL')||'gpt-4.1-mini'
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(requestBody(model,kind,day,fromTraining?'':notes,facts,fromTraining)),signal:AbortSignal.timeout(60000)})
  if(!response.ok)return send({error:response.status===429?'AI is busy. Continue manually or try later.':'AI review failed. Your work is unchanged.'},502)
  const body=await response.json(),result=parseResult(body,kind,facts,fromTraining?'':notes)
  // Operational telemetry excludes prompt content, guest contacts, and generated text.
  console.info(JSON.stringify({workflow:kind,model,duration_ms:Date.now()-began,input_tokens:body.usage?.input_tokens,output_tokens:body.usage?.output_tokens,version:'operations-review-v1'}))
  return send({...result,facts,...(fromTraining?{sales_script_source:true}:{}),generated_at:new Date().toISOString(),version:'operations-review-v1'})
 }catch(e){return send({error:e instanceof Error?e.message:'AI review unavailable. Continue manually.'},400)}
})

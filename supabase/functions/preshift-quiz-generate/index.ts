import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requestBody,parseQuiz,verificationRequest,verifyQuiz } from './generate.ts'
const baseHeaders={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type,x-retry-count,traceparent,tracestate,baggage','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json'}
Deno.serve(async(req:Request)=>{
 const requested=req.headers.get('Access-Control-Request-Headers')??''
 const headers={...baseHeaders,...(requested.length<=2048&&/^[a-z0-9_, \-]*$/i.test(requested)&&requested?{'Access-Control-Allow-Headers':requested}:{}),'Vary':'Access-Control-Request-Headers'}
 const send=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers})
 if(req.method==='POST')console.info('Quiz generation: POST received')
 if(req.method==='OPTIONS')return new Response('ok',{headers})
 if(req.method!=='POST')return send({error:'Use POST.'},405)
 const auth=req.headers.get('Authorization')??''
 if(!auth.startsWith('Bearer '))return send({error:'Sign in before generating a quiz.'},401)
 const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:auth}},auth:{persistSession:false}})
 const user=await client.auth.getUser();if(user.error||!user.data.user)return send({error:'Sign in again before generating a quiz.'},401)
 try{
  const raw=await req.text();if(raw.length>90000)throw Error('The pre-shift is too long.')
  const input=JSON.parse(raw),{location_id,date,title,body,count}=input
  if(typeof location_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(location_id)||typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T12:00:00Z'))||typeof title!=='string'||title.length>160||typeof body!=='string'||body.trim().length<30||body.length>30000||!Number.isInteger(count)||count<1||count>30)throw Error('Enter a valid date, 1–30 questions, and enough source content to create questions.')
  const request_id=input.request_id??crypto.randomUUID()
  if(typeof request_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request_id))throw Error('Invalid generation request.')
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({date,title,body,count,answer_policy:'source-audit-v1'})))
  const signature=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('')
  const cached=await client.rpc('quiz_generated_result',{p_location_id:location_id,p_request_id:request_id,p_signature:signature})
  if(cached.error)return send({error:cached.error.message},cached.error.code==='42501'?403:400)
  if(cached.data)return send(cached.data)
  const key=Deno.env.get('OPENAI_API_KEY');if(!key)return send({error:'Quiz generation needs OPENAI_API_KEY in Supabase Edge Function Secrets.'},503)
  const claim=await client.rpc('quiz_generation_claim',{p_location_id:location_id});if(claim.error)return send({error:claim.error.message},claim.error.code==='42501'?403:429);if(claim.data!==true)return send({error:'Manager access required.'},403)
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(requestBody(Deno.env.get('QUIZ_GENERATION_MODEL')??'gpt-4.1-mini',title,body,date,count)),signal:AbortSignal.timeout(60000)})
  if(!response.ok){
   let detail:any={};try{detail=await response.json()}catch{}
   const code=String(detail?.error?.code??'unknown').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80)
   console.error('Quiz generation: OpenAI rejected request',JSON.stringify({status:response.status,code}))
  }
  if(!response.ok)return send({error:response.status===429?'The AI service is unavailable or its API quota is exhausted. Check your API billing or try again later.':'Quiz generation failed. Check the OpenAI key and try again.'},502)
  const candidate=parseQuiz(await response.json(),body,count)
  const audit=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(verificationRequest(Deno.env.get('QUIZ_VERIFICATION_MODEL')??'gpt-4.1',body,candidate.questions)),signal:AbortSignal.timeout(45000)})
  if(!audit.ok)return send({error:'Answer verification is unavailable. No generated questions were saved; please try again.'},502)
  const generated=verifyQuiz(await audit.json(),candidate)
  const saved=await client.rpc('quiz_generated_store',{p_location_id:location_id,p_request_id:request_id,p_signature:signature,p_date:date,p_result:generated})
  if(saved.error)return send({error:'Generated questions could not be saved to the question bank. '+saved.error.message},503)
  return send(saved.data)
 }catch(e){return send({error:e instanceof Error&&e.name==='TimeoutError'?'Generation timed out. Try fewer questions.':e instanceof Error?e.message:'Unable to generate quiz.'},400)}
})

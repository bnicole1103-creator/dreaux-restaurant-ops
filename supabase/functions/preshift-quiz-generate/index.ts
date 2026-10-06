import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requestBody,parseQuiz } from './generate.ts'
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json'}
const send=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers})
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers})
 if(req.method!=='POST')return send({error:'Use POST.'},405)
 const auth=req.headers.get('Authorization')??''
 if(!auth.startsWith('Bearer '))return send({error:'Sign in before generating a quiz.'},401)
 const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:auth}},auth:{persistSession:false}})
 const user=await client.auth.getUser();if(user.error||!user.data.user)return send({error:'Sign in again before generating a quiz.'},401)
 try{
  const raw=await req.text();if(raw.length>90000)throw Error('The pre-shift is too long.')
  const input=JSON.parse(raw),{location_id,date,title,body,count}=input
  if(typeof location_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(location_id)||typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T12:00:00Z'))||typeof title!=='string'||title.length>160||typeof body!=='string'||body.trim().length<30||body.length>12000||![5,10,15,20].includes(count))throw Error('Enter a valid date and a pre-shift with enough detail to create questions.')
  const key=Deno.env.get('OPENAI_API_KEY');if(!key)return send({error:'Quiz generation needs OPENAI_API_KEY in Supabase Edge Function Secrets.'},503)
  const claim=await client.rpc('quiz_generation_claim',{p_location_id:location_id});if(claim.error)return send({error:claim.error.message},claim.error.code==='42501'?403:429);if(claim.data!==true)return send({error:'Manager access required.'},403)
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(requestBody(Deno.env.get('QUIZ_GENERATION_MODEL')??'gpt-4.1-mini',title,body,date,count)),signal:AbortSignal.timeout(90000)})
  if(!response.ok)return send({error:response.status===429?'The AI service is unavailable or its API quota is exhausted. Check your API billing or try again later.':'Quiz generation failed. Check the OpenAI key and try again.'},502)
  return send(parseQuiz(await response.json(),body,count))
 }catch(e){return send({error:e instanceof Error&&e.name==='TimeoutError'?'Generation timed out. Try fewer questions.':e instanceof Error?e.message:'Unable to generate quiz.'},400)}
})

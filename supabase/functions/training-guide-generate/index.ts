import {createClient} from 'https://esm.sh/@supabase/supabase-js@2'
import {requestBody,parseGuide,guideVersion} from './generate.ts'
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json'}
const send=(body:unknown,status=200)=>new Response(JSON.stringify(typeof body==='object'&&body!==null?{...body,generator_version:guideVersion}:body),{status,headers})
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers})
 if(req.method!=='POST')return send({error:'Use POST.'},405)
 const auth=req.headers.get('Authorization')??''
 if(!auth.startsWith('Bearer '))return send({error:'Sign in before generating a study guide.'},401)
 const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:auth}},auth:{persistSession:false}})
 const user=await client.auth.getUser();if(user.error||!user.data.user)return send({error:'Sign in again before generating a study guide.'},401)
 try{
  const raw=await req.text();if(raw.length>90000)throw Error('The pasted content is too long.')
  const {location_id,title,source}=JSON.parse(raw)
  if(typeof location_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(location_id)||typeof title!=='string'||title.length>160||typeof source!=='string'||source.trim().length<30||source.length>12000)throw Error('Paste 30–12,000 characters of training content and choose a title up to 160 characters.')
  const key=Deno.env.get('OPENAI_API_KEY');if(!key)return send({error:'Study guide generation needs OPENAI_API_KEY in Supabase Edge Function Secrets.'},503)
  const claim=await client.rpc('training_guide_generation_claim',{p_location_id:location_id});if(claim.error)return send({error:claim.error.message},claim.error.code==='42501'?403:429)
  if(claim.data!==true)return send({error:'Management access required.'},403)
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(requestBody(Deno.env.get('STUDY_GUIDE_GENERATION_MODEL')??Deno.env.get('QUIZ_GENERATION_MODEL')??'gpt-4.1-mini',title,source)),signal:AbortSignal.timeout(90000)})
  if(!response.ok)return send({error:response.status===429?'The AI service is busy or its API quota is exhausted. Check API billing or try again later.':'Study guide generation failed. Check the OpenAI key and try again.'},502)
  return send(parseGuide(await response.json(),source))
 }catch(e){return send({error:e instanceof Error&&e.name==='TimeoutError'?'Generation timed out. Try a shorter passage.':e instanceof Error?e.message:'Unable to generate a study guide.'},400)}
})

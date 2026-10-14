import {createClient} from 'https://esm.sh/@supabase/supabase-js@2'
import {requestBody,parsePost,validDate} from './generate.ts'
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type,x-retry-count,traceparent,tracestate,baggage','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json'}
Deno.serve(async(req:Request)=>{
 const requested=req.headers.get('Access-Control-Request-Headers')??'';const cors={...headers,...(requested.length<=2048&&/^[a-z0-9_, \-]*$/i.test(requested)&&requested?{'Access-Control-Allow-Headers':requested}:{}),'Vary':'Access-Control-Request-Headers'}
 const send=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors})
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return send({error:'Use POST.'},405)
 const auth=req.headers.get('Authorization')??'';if(!auth.startsWith('Bearer '))return send({error:'Sign in before generating a pre-shift.'},401)
 const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:auth}},auth:{persistSession:false}})
 const user=await client.auth.getUser();if(user.error||!user.data.user)return send({error:'Sign in again before generating a pre-shift.'},401)
 try{const raw=await req.text();if(raw.length>60000)throw Error('Too much source text.');const input=JSON.parse(raw);const {location_id,date,details,format,note_ids}=input
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
 if(typeof location_id!=='string'||!uuid.test(location_id)||!validDate(date)||typeof details!=='string'||details.length>16000||typeof format!=='string'||format.length>12000||!Array.isArray(note_ids)||note_ids.length>30||new Set(note_ids).size!==note_ids.length||note_ids.some((id:unknown)=>typeof id!=='string'||!uuid.test(id)))throw Error('Choose a valid date, up to 30 notes, and shorter source text.')
 const key=Deno.env.get('OPENAI_API_KEY');if(!key)return send({error:'Pre-shift generation needs OPENAI_API_KEY in Supabase Edge Function Secrets.'},503)
 // Existing RPC enforces manager membership, location scope and private-note ownership.
 const library=await client.rpc('preshift_presets',{p_location_id:location_id});if(library.error)return send({error:library.error.message},library.error.code==='42501'?403:400)
 const notes=note_ids.map((id:string)=>{const note=(library.data??[]).find((p:any)=>p.id===id);if(!note)throw Error('A selected note is no longer available. Reload the note library.');return {title:note.title,category:note.category,body:note.body}})
 if(details.trim().length+notes.reduce((n:number,p:any)=>n+p.body.trim().length,0)<30)throw Error('Add at least 30 characters of source notes or today’s details.')
 if(notes.reduce((n:number,p:any)=>n+p.body.length+p.title.length,details.length)>24000)throw Error('Selected notes are too long. Choose fewer notes.')
 const claim=await client.rpc('preshift_post_generation_claim',{p_location_id:location_id});if(claim.error)return send({error:claim.error.message},claim.error.code==='42501'?403:429);if(claim.data!==true)return send({error:'Manager access required.'},403)
 const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(requestBody(Deno.env.get('PRESHIFT_GENERATION_MODEL')??'gpt-4.1-mini',{date,details,notes,format})),signal:AbortSignal.timeout(90000)})
 if(!response.ok)return send({error:response.status===429?'The AI service is busy or its API quota is exhausted. Check API billing or try again later.':'The AI service could not generate a pre-shift. Check the API key and try again.'},502)
 return send({...parsePost(await response.json()),service_date:date})
 }catch(e){return send({error:e instanceof Error&&e.name==='TimeoutError'?'Generation timed out. Try fewer notes.':e instanceof Error?e.message:'Unable to generate a pre-shift.'},400)}
})

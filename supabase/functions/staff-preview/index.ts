import {createClient} from 'npm:@supabase/supabase-js@2.57.4'
import postgres from 'npm:postgres@3.4.7'
import {identifier,READ_RPCS,READ_TABLES,tableRead} from './query.ts'
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'}
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}})
const errorMessage=(e:unknown)=>e instanceof Error?e.message:'Preview request failed.'
const dbUrl=Deno.env.get('STAFF_PREVIEW_DB_URL')??Deno.env.get('SUPABASE_DB_URL')
// Server database URL only; credentials never enter the browser.
const db=dbUrl?postgres(dbUrl,{max:2,prepare:false,connect_timeout:10,idle_timeout:10,ssl:'require'}):null
Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response(null,{headers:cors})
 if(request.method!=='POST')return json({message:'POST required.'},405)
 try{
  if(Number(request.headers.get('content-length')??0)>100000)return json({message:'Request too large.'},413)
  const body=await request.json();if(JSON.stringify(body).length>100000)return json({message:'Request too large.'},413)
  const bearer=request.headers.get('authorization')??'';if(!bearer.startsWith('Bearer '))return json({message:'Sign in as a general manager.'},401)
  const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:bearer}},auth:{persistSession:false,autoRefreshToken:false}})
  const auth=await client.auth.getUser();if(auth.error||!auth.data.user)return json({message:'General manager session expired.'},401)
  const checked=await client.rpc('staff_view_check',{p_session_id:body.session});if(checked.error)return json({message:checked.error.message},403)
  const context=checked.data
  if(body.kind==='identity')return json(context)
  if(!db)return json({message:'Staff preview database connection is not configured. The server database URL is unavailable; no GM-data fallback is allowed.'},503)
  if(!['table','rpc','schedule'].includes(body.kind))return json({message:'Preview is read-only. This action is blocked.'},403)
  if(body.kind==='table'&&!['GET','HEAD'].includes(body.method))return json({message:'Preview cannot change records.'},403)
  let name=String(body.name??''),args=body.args??{}
  if(body.kind==='schedule'){name='staff_view_schedule';args={p_location_id:context.location_id,p_day:args.date}}
  if(args.p_location_id&&args.p_location_id!==context.location_id)return json({message:'Preview is limited to the selected location.'},403)
  if(body.kind!=='table'&&!READ_RPCS.has(name))return json({message:'This action is disabled in staff preview.'},403)
  const claims={sub:context.target_id,role:'authenticated',aud:'authenticated',email:context.user.email,aal:'aal1',is_anonymous:false,app_metadata:context.user.app_metadata,user_metadata:context.user.user_metadata}
  const result=await db.begin('read only',async tx=>{
   await tx.unsafe("SET LOCAL statement_timeout='5000'; SET LOCAL lock_timeout='1000'")
   await tx.unsafe("SELECT set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true),set_config('request.jwt.claim.role','authenticated',true)",[JSON.stringify(claims),context.target_id])
   await tx.unsafe('SET LOCAL ROLE authenticated')
   const isolation=await tx.unsafe("SELECT current_user AS role,current_setting('transaction_read_only') AS readonly,auth.uid() AS uid")
   if(isolation[0].role!=='authenticated'||isolation[0].readonly!=='on'||isolation[0].uid!==context.target_id)throw Error('Preview isolation check failed.')
   if(body.kind==='table'){
    if(!READ_TABLES.has(name))throw Error('This table is not supported in staff preview.')
    // Postgres.js serializes boolean parameters using strict true/false checks.
    // URL filters are strings, so convert them using the actual column type.
    const columns=await tx.unsafe("SELECT a.attname FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped AND a.atttypid=16",[name])
    const booleanColumns=new Set<string>(columns.map(c=>String(c.attname)))
    const q=tableRead(name,String(body.query??''),context.location_id,context.organization_id,context.target_id,booleanColumns)
    const rows=await tx.unsafe(q.sql,q.params as (string|boolean)[])
    if(body.single&&rows.length!==1)return {status:406,data:{message:'Expected one visible row in staff preview.',code:'PGRST116'}}
    return {status:200,data:body.single?rows[0]:Array.from(rows)}
   }
   if(typeof args!=='object'||Array.isArray(args)||args===null||Object.keys(args).length>30)throw Error('Invalid preview arguments.')
   const keys=Object.keys(args).sort();keys.forEach(identifier)
   const candidates=await tx.unsafe("SELECT p.oid,p.proretset,p.proargnames,p.pronargs,p.pronargdefaults,p.proargtypes::oid[] AS types FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=$1",[name])
   const matches=candidates.filter(p=>keys.every(k=>(p.proargnames??[]).slice(0,p.pronargs).includes(k))&&(p.proargnames??[]).slice(0,p.pronargs-p.pronargdefaults).every((k:string)=>keys.includes(k)))
   if(matches.length!==1)throw Error('Preview function is missing or ambiguous: '+name)
   const call='public.'+identifier(name)+'('+keys.map((k,i)=>identifier(k)+' => $'+(i+1)).join(',')+')'
   const values=keys.map(k=>typeof args[k]==='object'&&args[k]!==null?(Array.isArray(args[k])?args[k]:JSON.stringify(args[k])):args[k])
   const rows=await tx.unsafe(matches[0].proretset?'SELECT coalesce(jsonb_agg(to_jsonb(r)),\'[]\'::jsonb) AS value FROM '+call+' r':'SELECT to_jsonb('+call+') AS value',values)
   return {status:200,data:rows[0]?.value??null}
  })
  if(JSON.stringify(result.data).length>2000000)return json({message:'Preview result too large. Narrow the date range.'},413)
  return json(result.data,result.status)
 }catch(e){
  // Database messages may include sensitive query details. Return only safe categories.
  const code=(e as {code?:string}).code
  if(code==='25006')return json({message:'This screen attempted to write data. Staff preview blocked it.',code},403)
  if(code==='42501')return json({message:'Access restricted for the selected employee.',code},403)
  if(code)return json({message:'Preview could not load this data ('+code+'). No GM data was substituted.',code},400)
  const message=errorMessage(e);return json({message:message.includes('postgres')||message.includes('password')?'Preview connection failed. Check the server configuration.':message},400)
 }
})

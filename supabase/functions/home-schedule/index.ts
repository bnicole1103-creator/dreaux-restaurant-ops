import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import {localDay,range,listAll,scheduleRows} from './schedule.ts'
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
Deno.serve(async(req:Request)=>{
 const send=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}})
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
 if(req.method!=='POST')return send({error:'Use POST.'},405)
 try{
  const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const auth=req.headers.get('Authorization')??''
  const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false}})
  const {data:{user},error:authError}=await userClient.auth.getUser();if(authError||!user)return send({error:'Sign in required.'},401)
  const input=await req.json();const location=input.location_id
  if(typeof location!=='string'||!/^[0-9a-f-]{36}$/i.test(location))return send({error:'Select a location.'},400)
  const access=await userClient.rpc('home_schedule_access',{p_location_id:location});if(access.error||access.data!==true)return send({error:'Location access required.'},403)
  const today=localDay(new Date());const requested=input.date??today
  if(typeof requested!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(requested)||!Number.isFinite(Date.parse(requested+'T12:00:00Z'))||new Date(requested+'T12:00:00Z').toISOString().slice(0,10)!==requested)return send({error:'Choose a valid schedule date.'},400)
  if(requested!==today){const permission=await userClient.rpc('mod_is_manager',{p_location_id:location});if(permission.error||permission.data!==true)return send({error:'Manager access required for other schedule dates.'},403)}
  if(Math.abs(Date.parse(requested)-Date.parse(today))>366*86400000)return send({error:'Choose a date within one year.'},400)
  const token=Deno.env.get('SEVENSHIFTS_ACCESS_TOKEN'),company=Deno.env.get('SEVENSHIFTS_COMPANY_ID'),external=Deno.env.get('SEVENSHIFTS_LOCATION_ID'),appLocation=Deno.env.get('SEVENSHIFTS_APP_LOCATION_ID')
  if(!token||!company||!external||!appLocation||location!==appLocation||!/^\d+$/.test(company)||!/^\d+$/.test(external))return send({rows:[],synced_at:null,configured:false})
  const admin=createClient(url,key,{auth:{persistSession:false}}),day=requested
  const claim=await admin.rpc('home_schedule_claim',{p_location_id:location,p_date:day});if(claim.error)throw Error('Schedule database setup is incomplete.')
  if(claim.data===true){
   try{
    const [from,to]=range(day)
    const [shifts,users,roles]=await Promise.all([listAll(company,'shifts',{location_id:external,'start[gte]':from,'start[lte]':to,include_draft:'false',include_deleted:'false',consider_tz_in_ranges:'true'},token),listAll(company,'users',{location_id:external},token),listAll(company,'roles',{location_id:external},token)])
    const saved=await admin.from('home_schedule_cache').update({rows:scheduleRows(shifts,users,roles,external,day),synced_at:new Date().toISOString(),next_refresh_at:new Date(Date.now()+300000).toISOString(),lease_until:new Date().toISOString(),last_error:null}).eq('location_id',location).eq('schedule_date',day)
    if(saved.error)throw Error('Unable to save the schedule sync.')
   }catch(e){
    const message=e instanceof Error&&e.message.startsWith('7shifts')?e.message:'Unable to sync 7shifts. Check the server connection.'
    const failed=await admin.from('home_schedule_cache').update({last_error:message,next_refresh_at:new Date(Date.now()+60000).toISOString(),lease_until:new Date().toISOString()}).eq('location_id',location).eq('schedule_date',day)
    if(failed.error)throw Error('Unable to save the schedule sync status.')
   }
  }
  const cached=await admin.from('home_schedule_cache').select('rows,synced_at,last_error').eq('location_id',location).eq('schedule_date',day).single()
  if(cached.error)throw Error('Unable to load the schedule cache.')
  if(Array.isArray(cached.data.rows)&&cached.data.rows.some((r:Record<string,unknown>)=>!('employee_key' in r)||!('assigned' in r))){
   await admin.from('home_schedule_cache').update({next_refresh_at:new Date(0).toISOString()}).eq('location_id',location).eq('schedule_date',day)
   return send({schedule_date:day,rows:[],synced_at:cached.data.synced_at,configured:true,error:'The schedule cache needs a refresh after this update. Press Refresh targets again.'})
  }
  return send({schedule_date:day,rows:cached.data.rows,synced_at:cached.data.synced_at,configured:true,error:cached.data.last_error||(!cached.data.synced_at?'Schedule sync is in progress. Please check again shortly.':undefined)})
 }catch{return send({error:'Unable to load schedule. Check the server setup.'},500)}
})

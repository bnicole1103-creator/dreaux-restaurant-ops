import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import {localDay,range,listAll,scheduleRows} from './schedule.ts'
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
Deno.serve(async(req:Request)=>{
 const send=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}})
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
 if(req.method!=='POST')return send({error:'Use POST.'},405)
 try{
  const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const userClient=createClient(url,anon,{global:{headers:{Authorization:req.headers.get('Authorization')??''}},auth:{persistSession:false}})
  const {data:{user},error}=await userClient.auth.getUser();if(error||!user)return send({error:'Sign in required.'},401)
  const input=await req.json(),loc=input.location_id,from=input.from,to=input.to
  const valid=(s:unknown):s is string=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s
  if(typeof loc!=='string'||!/^[0-9a-f-]{36}$/i.test(loc)||!valid(from)||!valid(to)||Date.parse(to)<Date.parse(from)||Date.parse(to)-Date.parse(from)>30*86400000)return send({error:'Choose a date range of up to 31 days.'},400)
  const today=localDay(new Date());if(Math.abs(Date.parse(from)-Date.parse(today))>366*86400000||Math.abs(Date.parse(to)-Date.parse(today))>366*86400000)return send({error:'Choose dates within one year.'},400)
  const access=await userClient.rpc('crew_room_access',{p_location_id:loc});if(access.error||access.data!==true)return send({error:'Location access required.'},403)
  const token=Deno.env.get('SEVENSHIFTS_ACCESS_TOKEN'),company=Deno.env.get('SEVENSHIFTS_COMPANY_ID'),external=Deno.env.get('SEVENSHIFTS_LOCATION_ID'),appLoc=Deno.env.get('SEVENSHIFTS_APP_LOCATION_ID')
  if(!token||!company||!external||!appLoc||loc!==appLoc||!/^\d+$/.test(company)||!/^\d+$/.test(external))return send({configured:false,error:'The 7shifts connection needs configuration.'})
  const admin=createClient(url,key,{auth:{persistSession:false}})
  const claim=await admin.rpc('calendar_schedule_claim',{p_location_id:loc,p_from:from,p_to:to});if(claim.error)return send({error:'Run the calendar and crew schedule SQL first.'},500)
  if(!claim.data)return send({configured:true,cached:true})
  try{
   const start=range(from)[0],end=range(to)[1]
   const [shifts,users,roles]=await Promise.all([listAll(company,'shifts',{location_id:external,'start[gte]':start,'start[lte]':end,include_draft:'false',include_deleted:'false',consider_tz_in_ranges:'true'},token),listAll(company,'users',{location_id:external},token),listAll(company,'roles',{location_id:external},token)])
   const days=[];for(let d=new Date(from+'T12:00:00Z');d<=new Date(to+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1)){const date=d.toISOString().slice(0,10);days.push({location_id:loc,schedule_date:date,rows:scheduleRows(shifts,users,roles,external,date),synced_at:new Date().toISOString(),next_refresh_at:new Date(Date.now()+300000).toISOString(),lease_until:new Date().toISOString(),last_error:null})}
   const saved=await admin.from('home_schedule_cache').upsert(days,{onConflict:'location_id,schedule_date'});if(saved.error)throw Error('Could not save schedule cache.')
   const released=await admin.from('calendar_schedule_sync').update({next_refresh_at:new Date(Date.now()+300000).toISOString(),lease_until:new Date().toISOString()}).eq('location_id',loc).eq('from_date',from).eq('to_date',to);if(released.error)throw Error('Could not finish schedule sync.')
   return send({configured:true,synced:true})
  }catch{
   await admin.from('calendar_schedule_sync').update({next_refresh_at:new Date(Date.now()+60000).toISOString(),lease_until:new Date().toISOString()}).eq('location_id',loc).eq('from_date',from).eq('to_date',to)
   return send({configured:true,error:'Unable to refresh 7shifts. Showing the last saved schedule; try again shortly.'})
  }
 }catch{return send({error:'Unable to load crew schedule.'},500)}
})

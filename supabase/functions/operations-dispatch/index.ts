import {createClient} from 'npm:@supabase/supabase-js@2.112.2'
import {localDay,range,listAll,scheduleRows} from '../home-schedule/schedule.ts'
export async function runOperations(){
 const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
 const admin=createClient(url,key,{auth:{persistSession:false}})
 const today=localDay(new Date()),tomorrow=new Date(Date.parse(today+'T12:00:00Z')+86400000).toISOString().slice(0,10)
 const location=Deno.env.get('SEVENSHIFTS_APP_LOCATION_ID'),token=Deno.env.get('SEVENSHIFTS_ACCESS_TOKEN'),company=Deno.env.get('SEVENSHIFTS_COMPANY_ID'),external=Deno.env.get('SEVENSHIFTS_LOCATION_ID')
 if(location&&token&&company&&external)for(const day of [today,tomorrow]){
  const claim=await admin.rpc('home_schedule_claim',{p_location_id:location,p_date:day})
  if(claim.error)throw Error('Could not claim schedule sync.')
  if(claim.data===true)try{
   const [from,to]=range(day)
   const [shifts,users,roles]=await Promise.all([listAll(company,'shifts',{location_id:external,'start[gte]':from,'start[lte]':to,include_draft:'false',include_deleted:'false',consider_tz_in_ranges:'true'},token),listAll(company,'users',{location_id:external},token),listAll(company,'roles',{location_id:external},token)])
   const r=await admin.from('home_schedule_cache').update({rows:scheduleRows(shifts,users,roles,external,day),synced_at:new Date().toISOString(),next_refresh_at:new Date(Date.now()+300000).toISOString(),lease_until:new Date().toISOString(),last_error:null}).eq('location_id',location).eq('schedule_date',day);if(r.error)throw r.error
  }catch{
   await admin.from('home_schedule_cache').update({last_error:'Automatic schedule sync failed. Check 7shifts connection.',next_refresh_at:new Date(Date.now()+60000).toISOString(),lease_until:new Date().toISOString()}).eq('location_id',location).eq('schedule_date',day)
  }
 }
 const tick=await admin.rpc('staff_ops_tick');if(tick.error)throw Error('Required-work refresh failed: '+tick.error.message)
 const notifications=await admin.rpc('operations_notifications_tick');if(notifications.error)throw Error('Notification refresh failed.');
 const secret=Deno.env.get('INQUIRY_SYNC_TOKEN');if(!secret)throw Error('INQUIRY_SYNC_TOKEN is not configured.')
 const cursors=await admin.from('operations_inquiry_sync').select('*');if(cursors.error)throw cursors.error
 for(const cursor of cursors.data??[])try{
  // Feed is restaurant-scoped; the database seed rejects ambiguous restaurant locations.
  const endpoint=new URL('https://justinis-inquiry-studio.tealguppy.chatgpt.site/api/notification-feed');endpoint.searchParams.set('since',cursor.received);endpoint.searchParams.set('after',cursor.source_id)
  const response=await fetch(endpoint,{headers:{Authorization:'Bearer '+secret},signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Inquiry feed returned '+response.status)
  const data=await response.json();if(!Array.isArray(data.inquiries))throw Error('Invalid inquiry feed')
  for(const r of data.inquiries){
   let details:Record<string,unknown>={};try{details=JSON.parse(r.details)}catch{/* use basic fields */}
   const saved=await admin.rpc('operations_inquiry_ingest',{p_location_id:cursor.location_id,p_source:'Guest form',p_id:r.id,p_summary:{name:r.name,email:r.email,phone:r.phone,guests:String(r.guests),date:r.event_date,type:r.category,notes:Object.entries(details).filter(([k,v])=>v&&!['name','email','phone','category','guests','eventDate','website'].includes(k)).map(([k,v])=>k+': '+String(v)).join(' · ').slice(0,2000)}});if(saved.error)throw saved.error
   const advanced=await admin.rpc('operations_inquiry_advance',{p_location_id:cursor.location_id,p_received:r.received,p_id:r.id});if(advanced.error)throw advanced.error
  }
  await admin.from('operations_inquiry_sync').update({last_success:new Date().toISOString(),last_error:null}).eq('location_id',cursor.location_id)
 }catch(e){await admin.from('operations_inquiry_sync').update({last_error:e instanceof Error?e.message:'Inquiry sync failed'}).eq('location_id',cursor.location_id);throw e}
 return {ok:true}
}
Deno.serve(async req=>{
 const token=Deno.env.get('PUSH_DISPATCH_TOKEN')
 if(req.method!=='POST'||!token||req.headers.get('x-push-dispatch-token')!==token)return Response.json({error:'Not authorized'},{status:401})
 try{return Response.json(await runOperations())}catch(e){console.error('Operations dispatch failed:',e instanceof Error?e.message:'Unknown error');return Response.json({error:'Refresh failed; saved inquiries retry on the next run.'},{status:503})}
})

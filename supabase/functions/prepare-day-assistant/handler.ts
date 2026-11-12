import {contextFrom,parseResult,requestBody,version} from './logic.ts';
type Deps={client:(auth:string)=>any;env:(key:string)=>string|undefined;fetch:typeof fetch;now?:()=>Date};
export function createHandler(deps:Deps){return async(req:Request)=>{
 const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type,x-retry-count,traceparent,tracestate,baggage','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json'};
 const requested=req.headers.get('Access-Control-Request-Headers')??'';if(requested.length<=2048&&/^[a-z0-9_, \-]*$/i.test(requested)&&requested)headers['Access-Control-Allow-Headers']=requested;
 const send=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method==='OPTIONS')return new Response('ok',{headers});if(req.method!=='POST')return send({error:'Use POST.'},405);
 const auth=req.headers.get('Authorization')??'';if(!auth.startsWith('Bearer '))return send({error:'Sign in before reviewing the day.'},401);
 try{
 const raw=await req.text();if(raw.length>100000)throw Error('Use a smaller roster or shorter notes.');const input=JSON.parse(raw);
 const {location_id,date,notes='',proposed_roster=null,target_changes_pending=false}=input;
 if(typeof location_id!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(location_id)||typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T12:00:00Z'))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date||typeof notes!=='string'||notes.length>6000||typeof target_changes_pending!=='boolean'||proposed_roster!==null&&(!Array.isArray(proposed_roster)||proposed_roster.length>200))throw Error('Choose a valid location, service date and notes up to 6,000 characters.');
 const client=deps.client(auth),user=await client.auth.getUser();if(user.error||!user.data?.user)return send({error:'Sign in again before reviewing the day.'},401);
 const key=deps.env('OPENAI_API_KEY');if(!key)return send({error:'AI review is not configured. Ask management to finish AI setup.'},503);
 const claim=await client.rpc('prepare_day_assistant_claim',{p_location_id:location_id});if(claim.error)return send({error:claim.error.message},claim.error.code==='42501'?403:429);if(claim.data!==true)return send({error:'Management access required.'},403);
 const requests=[['crew','prepare_day_assistant_roster',{p_location_id:location_id,p_day:date,p_rows:proposed_roster}],['targets','personal_sales_targets_load',{p_location_id:location_id,p_date:date}],['capacity','reservation_capacity_load',{p_location_id:location_id,p_day:date}],['menu','menu_catalog_load',{p_location_id:location_id}]] as const;
 const results=await Promise.all(requests.map(async([name,rpc,args])=>{let timer:any;try{const result=await Promise.race([client.rpc(rpc,args),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Source timed out')),15000)})]);return [name,result] as const;}catch{return [name,{error:'Source unavailable'}] as const;}finally{clearTimeout(timer)}}));
 const data=Object.fromEntries(results);if(data.crew.error)return send({error:'The roster could not be checked. Reload it or review your schedule access.'},400);
 const context=contextFrom(data,date,proposed_roster!==null,target_changes_pending);
 const response=await deps.fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(requestBody(deps.env('PREPARE_DAY_AI_MODEL')??deps.env('PRESHIFT_GENERATION_MODEL')??'gpt-4.1-mini',context,notes)),signal:AbortSignal.timeout(75000)});
 if(!response.ok)return send({error:response.status===429?'AI is busy or its API quota is exhausted. Try again later.':'AI could not complete the review. Your preparation is unchanged.'},502);
 const review=parseResult(await response.json(),context,notes);
 return send({version,service_date:date,generated_at:(deps.now?.()??new Date()).toISOString(),...review,...context,facts:[...context.facts,...(notes.trim()?[{id:'manager_notes',text:notes,source:'Your notes'}]:[])],proposal:proposed_roster!==null});
 }catch(e){return send({error:e instanceof Error?e.message:'Unable to review the day.'},400);}
};}

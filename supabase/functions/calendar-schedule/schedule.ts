export type Row=Record<string,unknown>
export function localDay(at:Date){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(at)}
export function midnight(day:string){
 const target=new Date(`${day}T00:00:00Z`).getTime();let instant=target
 for(let i=0;i<3;i++){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant))
  const get=(type:string)=>Number(parts.find(p=>p.type===type)?.value)
  instant+=target-Date.UTC(get('year'),get('month')-1,get('day'),get('hour'),get('minute'),get('second'))
 }
 return new Date(instant).toISOString()
}
export function range(day:string){const next=new Date(`${day}T12:00:00Z`);next.setUTCDate(next.getUTCDate()+1);return [midnight(day),midnight(next.toISOString().slice(0,10))]}
export function scheduleRows(shifts:Row[],users:Row[],roles:Row[],location:string,day:string){
 const people=new Map(users.map(u=>[String(u.id),[u.preferred_first_name||u.first_name,u.preferred_last_name||u.last_name].filter(Boolean).join(' ')]))
 const jobs=new Map(roles.map(r=>[String(r.id),String(r.name||'')]))
 return shifts.filter(s=>String(s.location_id)===location&&!s.deleted&&!s.soft_deleted&&!s.draft&&s.publish_status==='published'&&typeof s.start==='string'&&typeof s.end==='string'&&Number.isFinite(Date.parse(s.start))&&Number.isFinite(Date.parse(s.end))&&localDay(new Date(s.start))===day)
 .map(s=>({id:String(s.id),employee_key:s.user_id==null?'':String(s.user_id),assigned:s.user_id!=null&&!s.open&&!s.unassigned,name:people.get(String(s.user_id))||(s.open||s.unassigned?'Open shift':'Team member'),role:jobs.get(String(s.role_id))||'Shift',station:String(s.station_name||''),start:String(s.start),end:String(s.end),close:!!s.close,business_decline:!!s.business_decline})).sort((a,b)=>a.start.localeCompare(b.start)||a.name.localeCompare(b.name))
}
export async function listAll(company:string,resource:string,params:Record<string,string>,token:string,fetcher:typeof fetch=fetch){
 const deadline=Date.now()+25000;const rows:Row[]=[];let cursor:string|null=null;const seen=new Set<string>()
 for(let page=0;page<50;page++){
  if(Date.now()>=deadline)throw Error('7shifts sync timed out. Please try again.');
  const url=new URL(`https://api.7shifts.com/v2/company/${company}/${resource}`)
  Object.entries({...params,limit:'100',...(cursor?{cursor}:{})}).forEach(([k,v])=>url.searchParams.set(k,v))
  const res=await fetcher(url,{headers:{Authorization:`Bearer ${token}`,'x-api-version':'2022-05-01',accept:'application/json'},signal:AbortSignal.timeout(Math.max(1,Math.min(12000,deadline-Date.now())))})
  if(!res.ok)throw Error(`7shifts request failed (${res.status}). Check token access, plan, and company/location IDs.`)
  const body=await res.json();if(!Array.isArray(body.data))throw Error('7shifts returned an unexpected response.')
  rows.push(...body.data);cursor=body.meta?.cursor?.next??null
  if(!cursor)return rows
  if(seen.has(cursor))throw Error('7shifts pagination did not finish.');seen.add(cursor)
 }
 throw Error('7shifts schedule exceeds the sync limit.')
}

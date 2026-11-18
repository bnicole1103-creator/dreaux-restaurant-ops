import {supabase} from './supabase'
import type {ConfirmationState} from './reservationConfirmation'
type Job={id:string;resolve:(state:ConfirmationState|null)=>void;reject:(error:Error)=>void}
const queues=new Map<string,Job[]>();const inflight=new Map<string,Promise<ConfirmationState|null>>()
const missing=(error:{code?:string}|null)=>error?.code==='PGRST202'||error?.code==='42883'
export function readConfirmation(location:string,id:string){
 const key=location+':'+id,existing=inflight.get(key);if(existing)return existing
 const promise=new Promise<ConfirmationState|null>((resolve,reject)=>{
  const jobs=queues.get(location),job={id,resolve,reject};if(jobs){jobs.push(job);return}
  queues.set(location,[job]);setTimeout(()=>void flush(location),0)
 }).finally(()=>inflight.delete(key));inflight.set(key,promise);return promise
}
async function flush(location:string){
 const jobs=queues.get(location)??[];queues.delete(location)
 for(let offset=0;offset<jobs.length;offset+=250){const chunk=jobs.slice(offset,offset+250)
  try{
   const r=await supabase.rpc('reservation_confirmation_summaries',{p_location:location,p_ids:[...new Set(chunk.map(j=>j.id))]}).abortSignal(AbortSignal.timeout(15000))
   if(missing(r.error)){
    // Older deployments keep working while the additive migration is installed.
    // Bound fallback concurrency; never bypass access failures.
    for(let i=0;i<chunk.length;i+=4)await Promise.all(chunk.slice(i,i+4).map(async job=>{try{const old=await supabase.rpc('reservation_guest_link_status',{p_id:job.id}).abortSignal(AbortSignal.timeout(15000));if(old.error)throw Error(old.error.message);job.resolve(old.data)}catch(e){job.reject(Error(String((e as Error).message??e)))}}))
   }else{if(r.error)throw Error(r.error.message);for(const job of chunk){if(!Object.prototype.hasOwnProperty.call(r.data??{},job.id))job.reject(Error('Reservation unavailable at this location.'));else job.resolve(r.data[job.id])}}
  }catch(e){for(const job of chunk)job.reject(Error(String((e as Error).message??e)))}
 }
}
export async function createStaffConfirmationLink(id:string){
 let r=await supabase.rpc('reservation_staff_link_create',{p_id:id})
 if(missing(r.error))r=await supabase.rpc('reservation_guest_link_create',{p_id:id})
 return r
}

import {supabase} from './supabase'
export type GuestContact={key:string;id:string|null;name:string;phone:string|null;email:string|null;notes:string|null;date:string;status:string;version:number;party:number;arrived:number|null;guest_id:string|null;source?:string}
type Waiter={key:string;resolve:(row:GuestContact)=>void;reject:(error:Error)=>void}
const batches=new Map<string,Waiter[]>()
// One backend call for the reservation rows rendered together. No persistent guest cache.
export function readGuestContact(location:string,key:string):Promise<GuestContact>{
 return new Promise((resolve,reject)=>{
  const queue=batches.get(location);const waiter={key,resolve,reject};if(queue){queue.push(waiter);return}
  batches.set(location,[waiter]);setTimeout(async()=>{
   const jobs=batches.get(location)??[];batches.delete(location)
   for(let offset=0;offset<jobs.length;offset+=250){const chunk=jobs.slice(offset,offset+250)
   try{const keys=[...new Set(chunk.map(j=>j.key))];const [r,origins]=await Promise.all([supabase.rpc('reservation_contact_rows',{p_location_id:location,p_keys:keys}),supabase.rpc('reservation_sources',{p_location_id:location,p_keys:keys})]);if(r.error)throw r.error;r.data=(r.data??[]).map((row:GuestContact)=>({...row,source:origins.error?'Unavailable':origins.data?.[row.id??row.key]??'Not recorded'}))
    const rows=new Map((r.data??[]).map((row:GuestContact)=>[row.key,row]));for(const job of chunk){const row=rows.get(job.key) as GuestContact|undefined;if(row)job.resolve(row);else job.reject(Error('Reservation contact unavailable.'))}
   }catch(e){for(const job of chunk)job.reject(Error(String((e as Error).message??e)))}
   }
  },0)
 })
}

const watchers=new Set<()=>void>();let timer:ReturnType<typeof setInterval>|undefined
const refresh=()=>{if(document.visibilityState==='visible')for(const fn of watchers)fn()}
export function watchGuestRefresh(fn:()=>void){watchers.add(fn);if(!timer){timer=setInterval(refresh,30000);window.addEventListener('focus',refresh);window.addEventListener('reservations-changed',refresh)}return()=>{watchers.delete(fn);if(!watchers.size&&timer){clearInterval(timer);timer=undefined;window.removeEventListener('focus',refresh);window.removeEventListener('reservations-changed',refresh)}}}

import {PartySizeInput} from './PartySizeInput'
import {useEffect,useMemo,useRef,useState} from 'react'
import {supabase} from '../lib/supabase'
import {capacityClock,planCapacity,type CapacityData} from '../lib/reservationCapacity'
import {seatsRemaining} from '../lib/reservationSeats'
import {liveSeatingOptions} from '../lib/liveSeatingFinder'
import './LiveSeatingFinder.css'
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
export function LiveSeatingFinder({location,canSeat,onSeat,onShow}:{location:string;canSeat:boolean;onSeat:(ids:string[],party:number)=>void;onShow:(ids:string[])=>void}){
 const [data,setData]=useState<CapacityData|null>(null),[party,setParty]=useState('2'),[room,setRoom]=useState(''),[selected,setSelected]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false),[checking,setChecking]=useState(false),[revision,setRevision]=useState(0),[updated,setUpdated]=useState<number|null>(null)
 const host=useRef<HTMLElement>(null),menu=useRef<HTMLDetailsElement>(null)
 const generation=useRef(0),lock=useRef(false),contextRef=useRef(location),mounted=useRef(true),canSeatRef=useRef(canSeat);contextRef.current=location;canSeatRef.current=canSeat
 useEffect(()=>{const close=(e:PointerEvent)=>{if(!host.current?.contains(e.target as Node))menu.current?.removeAttribute('open')};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[])
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
 useEffect(()=>{if(!location)return;const update=()=>{if(document.visibilityState==='visible')setRevision(v=>v+1)}
 const channel=supabase.channel('live-seating-finder:'+location+':'+Math.random())
 .on('postgres_changes',{event:'*',schema:'public',table:'reservations',filter:'location_id=eq.'+location},update)
 .on('postgres_changes',{event:'*',schema:'public',table:'table_sessions'},update)
 .on('postgres_changes',{event:'*',schema:'public',table:'table_session_tables'},update)
 .on('postgres_changes',{event:'*',schema:'public',table:'floor_tables',filter:'location_id=eq.'+location},update).subscribe()
 const timer=window.setInterval(update,15000)
 window.addEventListener('reservations-changed',update);window.addEventListener('focus',update);document.addEventListener('visibilitychange',update)
 return()=>{window.clearInterval(timer);window.removeEventListener('reservations-changed',update);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update);void supabase.removeChannel(channel)}
 },[location])
 useEffect(()=>{if(!location)return;let live=true;const ticket=++generation.current;setLoading(true);setError('')
 let timeout:ReturnType<typeof setTimeout>
 void Promise.race([Promise.resolve(supabase.rpc('reservation_capacity_load',{p_location_id:location,p_day:today()})),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(Error('Live availability timed out. Refresh before seating.')),10000)})]).then(r=>{if(live&&ticket===generation.current){if(r.error)throw r.error;setData(r.data);setUpdated(Date.now())}}).catch(e=>{if(live)setError(String(e.message??e))}).finally(()=>{clearTimeout(timeout);if(live)setLoading(false)})
 return()=>{live=false;clearTimeout(timeout)}
 },[location,revision])
 const plan=useMemo(()=>data?planCapacity(data):null,[data])
 const availability=useMemo(()=>data?liveSeatingOptions(data,Number(party),room):null,[data,party,room])
 const remaining=data?seatsRemaining(data,data.now,plan):null
 const live=data?[...new Map(data.bookings.filter(b=>b.live).map(b=>[b.id,b])).values()]:[]
 const guests=live.some(b=>!Number.isInteger(b.party)||b.party<1)?null:live.reduce((n,b)=>n+b.party,0)
 const occupied=new Set(live.flatMap(b=>b.tableIds)).size
 const choices=availability?.options??[],choice=choices.find(c=>c.ids.join(':')===selected)??choices[0]
 const rooms=data?[...new Map(data.tables.map(t=>[t.room,t.roomName])).entries()]:[]
 useEffect(()=>{setData(null);setUpdated(null);setSelected('');setRoom('')},[location])
 async function choose(){
  if(!choice||!data||lock.current||error||!canSeat)return
  lock.current=true;setChecking(true);setError('');const context=location
  try{
   const result=await supabase.rpc('reservation_capacity_load',{p_location_id:location,p_day:today()})
   if(result.error)throw result.error
   const fresh=result.data as CapacityData
   if(!mounted.current||contextRef.current!==context||!canSeatRef.current)return
   setData(fresh);setUpdated(Date.now())
   const available=liveSeatingOptions(fresh,Number(party),room).options.find(c=>c.ids.length===choice.ids.length&&c.ids.every(id=>choice.ids.includes(id)))
   if(!available)throw Error('Availability changed. Choose one of the updated combinations.')
   onSeat(available.ids,Number(party));menu.current?.removeAttribute('open')
  }catch(e){if(mounted.current&&contextRef.current===context)setError(String((e as Error).message??e))}finally{lock.current=false;if(mounted.current)setChecking(false)}
 }
 return <section ref={host} className="floor-seating-counts live-seating-finder" aria-label="Live seating finder" onKeyDown={e=>{if(e.key==='Escape'&&menu.current?.open){menu.current.removeAttribute('open');menu.current.querySelector('summary')?.focus();e.stopPropagation()}}}>
 <div className="live-seating-numbers" aria-live="polite"><strong aria-label={(data?guests??'Unknown':'—')+' guests seated now'}>{data?guests??'?':'—'} seated</strong><strong aria-label={remaining?.remaining==null?'Available seats unverified':remaining.remaining+' seats available now'}>{remaining?.remaining==null?'Available: ?':remaining.remaining+' available'+(remaining.estimated?'*':'')}</strong></div>
 <small>{data?occupied:'—'} occupied tables · {data?.tables.reduce((n,t)=>n+t.seats,0)??'—'} total seats</small>
 <div className="live-seating-quick"><label>Party<PartySizeInput aria-label="Guests to seat" type="number" inputMode="numeric" min={1} max={500} value={party} disabled={checking} onChange={e=>{setParty(e.target.value);setSelected('')}}/></label><p aria-live="polite">{choice?<><strong>Best now:</strong> {choices[0].label} · {choices[0].seats} seats</>:availability?.next?<><strong>Next: {capacityClock(availability.next.start)}</strong> · {availability.next.label}</>:loading&&!data?'Checking…':availability?.unverified?'Availability unverified':'No verified fit now'}</p></div>
 {error&&<small role="alert">Live update unavailable. Open combinations to refresh.</small>}
 <div className="live-seating-footer"><details ref={menu} className="live-seating-dropdown"><summary>Tables &amp; combinations ({choices.length}) ▾</summary><div className="live-seating-dropdown-body">
 <div className="live-seating-menu-heading"><strong>Find tables · {party||'?'} guests</strong><button type="button" aria-label="Close combinations" onClick={()=>{menu.current?.removeAttribute('open');menu.current?.querySelector('summary')?.focus()}}>×</button></div>
 <label>Room<select value={room} disabled={checking} onChange={e=>{setRoom(e.target.value);setSelected('')}}><option value="">Any room</option>{rooms.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
 {error&&<p role="alert">{error}</p>}
 {choices.length>0&&choice&&<><label>Available combinations<select value={choice.ids.join(':')} disabled={loading||checking||!!error} onChange={e=>setSelected(e.target.value)}>{choices.map((c,i)=><option key={c.ids.join(':')} value={c.ids.join(':')}>{i===0?'Best verified fit · ':''}{c.label} · {c.seats} seats · {c.room}</option>)}</select></label><div className="live-seating-actions"><button type="button" disabled={loading||checking||!!error} onClick={()=>{onShow(choice.ids);menu.current?.removeAttribute('open')}}>Show on floor map</button><button type="button" className="primary-button" disabled={!canSeat||loading||checking||!!error} onClick={()=>void choose()}>{checking?'Rechecking…':'Seat this party'}</button></div></>}
 {!choices.length&&availability?.next&&<p role="status"><strong>Next verified fit: {capacityClock(availability.next.start)}</strong> · {availability.next.label} · {availability.next.seats} seats · {availability.next.room}</p>}
 {!choices.length&&!availability?.next&&availability&&<p role="status">{availability.unverified?'Availability unverified. ':''}{availability.reason}</p>}
 <small>All open parties at this location. Counts exclude occupied/reserved tables, blocks and reset time. * includes suggested assignments. Uses saved {data?.config.duration??'—'}-minute dining time + {data?.config.buffer??'—'}-minute reset. Occupied tables reopen after checkout; departure times are not guessed.</small>
 {!canSeat&&<p>Open/select today’s shift to seat a party.</p>}
 <button type="button" disabled={loading||checking} onClick={()=>setRevision(v=>v+1)}>{loading?'Updating…':'Refresh live availability'}</button><small>Automatic updates with a 15-second fallback. Seating rechecks availability first.</small>
 </div></details>{updated&&<small>Updated {new Date(updated).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit',hour12:true})}</small>}</div>
 </section>
}

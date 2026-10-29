import {useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {Receipt,CalendarPlus,ClipboardList} from 'lucide-react'
import {useAppAccess} from './AppAccess'
import {EmployeeReceiptWallet} from './EmployeeReceiptWallet'
import {ManualReservation,reservationToday} from './ManualReservation'
import {FutureReservations} from './FutureReservations'
import {StockBoard} from './StockBoard'
import {TaskDialog} from './TaskDialog'
import {loadTenantData} from '../lib/tenant'
import {supabase} from '../lib/supabase'
import {serviceDay} from '../lib/serviceDay'
import './HomeQuickActions.css'
type EditorState={busy:boolean;dirty:boolean}
export function HomeQuickActions({location}:{location:string}){
 const access=useAppAccess(),[open,setOpen]=useState<'receipts'|'reservations'|'stock'|null>(null),[state,setState]=useState<EditorState>({busy:false,dirty:false}),[notice,setNotice]=useState(''),[error,setError]=useState(''),[retry,setRetry]=useState(0)
 const [reservation,setReservation]=useState<{organization:string;tables:{id:string;table_name:string}[]}|null>(null)
 const trigger=useRef<HTMLElement|null>(null)
 function launch(which:typeof open){trigger.current=document.activeElement as HTMLElement;setState({busy:false,dirty:false});setError('');setNotice('');setReservation(null);setOpen(which)}
 function close(){if(state.busy)return;if(state.dirty&&!window.confirm('Discard unsaved changes and close this popup?'))return;setOpen(null);requestAnimationFrame(()=>trigger.current?.focus())}
 useEffect(()=>{if(open!=='reservations')return;let live=true;setError('');setReservation(null);void(async()=>{const tenant=await loadTenantData();if(!tenant.locations.some(l=>l.id===location))throw Error('This location is unavailable. Reload Home.');const r=await supabase.from('floor_tables').select('id,table_name').eq('location_id',location).order('table_name');if(r.error)throw r.error;if(live)setReservation({organization:tenant.organization.id,tables:r.data??[]})})().catch(e=>{if(live)setError(String(e.message??e))});return()=>{live=false}},[open,location,retry])
 return <><nav className="home-quick-actions" aria-label="Quick restaurant actions"><button type="button" onClick={()=>launch('receipts')} aria-haspopup="dialog"><Receipt size={21} aria-hidden="true"/>+ Receipts</button>{access.manager&&access.can('floor','reservations')&&<button type="button" onClick={()=>launch('reservations')} aria-haspopup="dialog"><CalendarPlus size={21} aria-hidden="true"/>+ Reservations</button>}{access.can('home','stock')&&<button type="button" onClick={()=>launch('stock')} aria-haspopup="dialog"><ClipboardList size={21} aria-hidden="true"/>86 Board</button>}</nav>{notice&&<p role="status">{notice}</p>}
 {open==='reservations'&&reservation?<ManualReservation savedReservations={<FutureReservations location={location} onEditorState={setState}/>} externalEditorState={state} location={location} organization={reservation.organization} tables={reservation.tables} initialDate={reservationToday()} onClose={()=>{setOpen(null);requestAnimationFrame(()=>trigger.current?.focus())}} onSaved={text=>{setNotice(text);window.dispatchEvent(new Event('reservations-changed'))}}/>:open&&createPortal(<TaskDialog title={open==='receipts'?'Receipts':open==='stock'?'86 Board':'Add reservation'} busy={state.busy} onClose={close}>{open==='receipts'?<EmployeeReceiptWallet location={location} day={serviceDay()} initialExpanded onEditorState={setState}/>:open==='stock'?<StockBoard location={location} onEditorState={setState}/>:error?<p role="alert">{error} <button type="button" onClick={()=>setRetry(v=>v+1)}>Retry</button></p>:<p role="status">Loading reservation form…</p>}</TaskDialog>,document.body)}
 </>
}

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'
import '../pages/InventoryPage.css'

export type DisposalLine = { brand: string; size: string; quantity: number }
export type DisposalSheet = {
 id: string; user_id?: string; employee: string; submitted_at: string;
 updated_at?: string | null; edit_version: number; lines: DisposalLine[]
}
const sizes = ['1.75 L', '1 L', '750 mL', 'Pint']
const message = (e: unknown) => String((e as {message?: string})?.message ?? e)
function timestamp(value: string) {
 return new Date(value).toLocaleString('en-US', {timeZone:'America/Chicago',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})+' CT'
}
function validate(lines: DisposalLine[]) {
 if (!lines.length || lines.length > 100) throw Error('Enter 1 to 100 disposal rows.')
 const seen = new Set<string>()
 for (const line of lines) {
  if (!line.brand || !sizes.includes(line.size)) throw Error('Choose a brand and bottle size for each row.')
  if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 10000) throw Error('Quantity must be a whole number from 1 to 10000.')
  const key = JSON.stringify([line.brand, line.size])
  if (seen.has(key)) throw Error('Combine rows with the same brand and size.')
  seen.add(key)
 }
}

export function DisposalSheets({locationId, sheets, brands, manager, onRefresh}: {
 locationId: string; sheets: DisposalSheet[]; brands: string[]; manager: boolean;
 onRefresh: () => Promise<void>
}) {
 const [editing, setEditing] = useState<DisposalSheet | null>(null)
 const [draft, setDraft] = useState<DisposalLine[]>([])
 const [busy, setBusy] = useState(false)
 const [error, setError] = useState('')
 const [success, setSuccess] = useState('')
 const saving = useRef(false)
 useEffect(() => {setEditing(null);setDraft([]);setError('');setSuccess('')}, [locationId])
 function start(sheet: DisposalSheet) {
  if (saving.current) return
  if (editing && !window.confirm('Discard the unsaved disposal edits?')) return
  setEditing(sheet);setDraft(sheet.lines.map(line => ({...line})));setError('');setSuccess('')
 }
 function cancel() {
  if (saving.current) return
  if (!window.confirm('Discard the unsaved disposal edits?')) return
  setEditing(null);setDraft([]);setError('')
 }
 async function mutate(sheet: DisposalSheet, remove: boolean) {
  if (saving.current) return
  setError('');setSuccess('')
  if (remove && !window.confirm('Delete '+sheet.employee+'’s disposal sheet submitted '+timestamp(sheet.submitted_at)+'? This removes it from disposal history and summaries.')) return
  if (!remove) {
   try {validate(draft)} catch (e) {setError(message(e));return}
  }
  saving.current=true;setBusy(true)
  try {
   const args = {p_location_id:locationId,p_sheet_id:sheet.id,p_expected_version:sheet.edit_version}
   const result = remove
    ? await supabase.rpc('inventory_disposal_delete',args)
    : await supabase.rpc('inventory_disposal_update',{...args,p_lines:draft})
   if (result.error) throw result.error
   setEditing(null);setDraft([])
   setSuccess(remove?'Disposal sheet deleted.':'Disposal changes saved.')
   try {await onRefresh()} catch {setError('Changes saved, but the list could not refresh. Select Refresh to reload it.')}
  } catch (e) {setError(message(e))}
  finally {saving.current=false;setBusy(false)}
 }
 return <div style={{display:'grid',gap:12}}>
  {error && <p role="alert">{error}</p>}
  {success && <p role="status">{success}</p>}
  {sheets.map(sheet => <article className="inventory-card" key={sheet.id}>
   <strong>{sheet.employee}</strong>
   <p>Submitted {timestamp(sheet.submitted_at)} · {sheet.lines.reduce((n,line)=>n+Number(line.quantity),0)} bottles</p>
   {sheet.updated_at && <p>Edited {timestamp(sheet.updated_at)}</p>}
   <details><summary>View disposal sheet</summary>
    <div style={{overflowX:'auto'}}><table style={{width:'100%'}}><thead><tr><th scope="col">Brand</th><th scope="col">Bottle size</th><th scope="col">Quantity</th></tr></thead>
     <tbody>{sheet.lines.map((line,index)=><tr key={index}><td>{line.brand}</td><td>{line.size}</td><td>{line.quantity}</td></tr>)}</tbody>
    </table></div>
   </details>
   {manager && <div style={{display:'flex',gap:12,flexWrap:'wrap',marginTop:12}}>
    <button type="button" disabled={busy} onClick={()=>start(sheet)}>Edit disposal sheet</button>
    <button type="button" disabled={busy} onClick={()=>void mutate(sheet,true)}>Delete disposal sheet</button>
   </div>}
   {editing?.id === sheet.id && <fieldset className="inventory-card" disabled={busy}>
    <legend>Edit submitted disposal sheet</legend>
    <p>Changes keep the original employee and submission date.</p>
    {draft.map((line,index)=><div className="inventory-row" key={index}>
     <label>Brand<select value={line.brand} onChange={event=>setDraft(rows=>rows.map((row,i)=>i===index?{...row,brand:event.target.value}:row))}>
      <option value="">Choose brand</option>{Array.from(new Set([...brands,...sheet.lines.map(row=>row.brand)])).sort().map(brand=><option key={brand}>{brand}</option>)}
     </select></label>
     <label>Bottle size<select value={line.size} onChange={event=>setDraft(rows=>rows.map((row,i)=>i===index?{...row,size:event.target.value}:row))}>
      <option value="">Choose size</option>{sizes.map(size=><option key={size}>{size}</option>)}
     </select></label>
     <label>Quantity<input type="number" inputMode="numeric" min="1" max="10000" step="1" value={line.quantity||''}
      onChange={event=>setDraft(rows=>rows.map((row,i)=>i===index?{...row,quantity:Number(event.target.value)}:row))}/></label>
     <button type="button" aria-label={'Remove row '+(index+1)} onClick={()=>setDraft(rows=>rows.filter((_,i)=>i!==index))}>Remove row</button>
    </div>)}
    <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
     <button type="button" disabled={draft.length>=100} onClick={()=>setDraft(rows=>[...rows,{brand:'',size:'',quantity:1}])}>Add row</button>
     <button type="button" className="primary-button" disabled={!draft.length} onClick={()=>void mutate(editing,false)}>{busy?'Saving…':'Save changes'}</button>
     <button type="button" onClick={cancel}>Cancel</button>
    </div>
   </fieldset>}
  </article>)}
 </div>
}

function serviceDate() {
 const parts = new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date())
 const get = (type: string) => parts.find(part=>part.type===type)?.value ?? ''
 const date = new Date(get('year')+'-'+get('month')+'-'+get('day')+'T12:00:00Z')
 if (Number(get('hour'))<4) date.setUTCDate(date.getUTCDate()-1)
 return date.toISOString().slice(0,10)
}
export function DisposalSummary() {
 const [location,setLocation] = useState('')
 const [day,setDay] = useState(serviceDate)
 const [brands,setBrands] = useState<string[]>([])
 const [sheets,setSheets] = useState<DisposalSheet[]>([])
 const [manager,setManager] = useState(false)
 const [loading,setLoading] = useState(true)
 const [error,setError] = useState('')
 const request = useRef(0)
 useEffect(()=>{
  let live=true
  void loadTenantData().then(tenant=>{
   if(!live)return
   const id=tenant.locations[0]?.id
   if(!id)throw Error('No active location.')
   setLocation(id)
  }).catch(e=>{if(live){setError(message(e));setLoading(false)}})
  return()=>{live=false;request.current+=1}
 },[])
 async function load(id: string, date: string) {
  const ticket=++request.current
  setLoading(true);setError('');setSheets([]);setBrands([]);setManager(false)
  try {
   const [summary,catalog]=await Promise.all([
    supabase.rpc('inventory_disposal_summary_day',{p_location_id:id,p_day:date}),
    supabase.rpc('inventory_disposal_load',{p_location_id:id})
   ])
   if(summary.error)throw summary.error
   if(catalog.error)throw catalog.error
   if(ticket!==request.current)return
   setSheets(summary.data?.sheets??[]);setManager(summary.data?.manager===true);setBrands(catalog.data?.brands??[])
  } catch(e){if(ticket===request.current)setError(message(e));throw e}
  finally {if(ticket===request.current)setLoading(false)}
 }
 useEffect(()=>{if(location&&day)void load(location,day).catch(()=>{});return()=>{request.current+=1}},[location,day])
 // Follow the current service day at 4 AM; historical date choices remain fixed.
 useEffect(()=>{
  let previous=serviceDate()
  const timer=window.setInterval(()=>{
   const next=serviceDate()
   if(next!==previous){setDay(selected=>selected===previous?next:selected);previous=next}
  },30000)
  return()=>window.clearInterval(timer)
 },[])
 const bottles=sheets.reduce((total,sheet)=>total+sheet.lines.reduce((n,line)=>n+Number(line.quantity),0),0)
 const workers=Array.from(new Map(sheets.map(sheet=>[sheet.user_id??sheet.id,sheet.employee])).values())
 return <section className="page inventory-page">
  <h1>Disposal Summary</h1>
  <p>{manager?'Review disposal submissions and the employees who completed them.':'View your submitted disposal sheets.'}</p>
  <label>Service date <input type="date" value={day} max={serviceDate()} onChange={event=>{if(event.target.value)setDay(event.target.value)}}/></label>
  <p>Service dates run from 4 AM to 4 AM Central.</p>
  <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
   <button type="button" disabled={loading} onClick={()=>setDay(serviceDate())}>Today</button>
   <button type="button" disabled={loading||!location} onClick={()=>void load(location,day).catch(()=>{})}>Refresh</button>
  </div>
  {error&&<p role="alert">{error}</p>}
  {loading?<p role="status">Loading disposal summary…</p>:<>
   <div className="inventory-card"><strong>{sheets.length} submissions · {workers.length} {manager?'employees':'employee'} · {bottles} bottles</strong>
    <p>{manager?'Disposal workers: ':'Submitted by: '}{workers.join(', ')||'No submissions for this date.'}</p>
   </div>
   <DisposalSheets key={location+day} locationId={location} sheets={sheets} brands={brands} manager={manager} onRefresh={()=>load(location,day)}/>
  </>}
 </section>
}


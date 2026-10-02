import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadTenantData } from '../lib/tenant'
import { supabase } from '../lib/supabase'
import './ManagerCloseoutPage.css'
export function CloseoutHub() {
  const [manager,setManager] = useState(false)
  const [error,setError] = useState('')
  useEffect(() => { let active=true; void (async () => {
    try { const t=await loadTenantData(); const loc=t.locations[0]; if (!loc) throw new Error('No active location found.')
      const {data,error}=await supabase.rpc('mod_is_manager',{p_location_id:loc.id}); if(error) throw error
      if(active) setManager(!!data)
    } catch(e) { if(active) setError(String((e as {message?:string}).message ?? e)) }
  })(); return () => {active=false} },[])
  return <section className="mod-page"><h1>Closeout</h1><p>Choose the form for your shift.</p>
    <article className="mod-review"><h2>Staff Closeout</h2><p>Complete your sales, cash, tips, and shift questions.</p><Link to="/closeout/staff">Open Staff Closeout →</Link></article>
    {manager && <><article className="mod-review"><h2>Manager Closeout</h2><p>Complete the cash deposit, register check, and private staff reviews.</p><Link to="/closeout/manager">Open Manager Closeout →</Link></article>
      <article className="mod-review"><h2>Form &amp; Points Settings</h2><p>Edit questions, categories, reasons, and point values.</p><Link to="/closeout/settings">Open Settings →</Link></article></>}
    {error && <p role="alert">{error}</p>}
  </section>
}

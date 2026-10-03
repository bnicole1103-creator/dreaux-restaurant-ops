import { PointEntryEditor } from '../components/PointEntryEditor'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'
import './PointsPage.css'
type Standing = { user_id: string; name: string; total: number; rank: number }
type PointEvent = { business_date: string; points: number; description: string }
type Dashboard = { standings: Standing[]; history: PointEvent[] }
function currentMonth() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit' }).formatToParts(new Date())
  return `${parts.find(p => p.type === 'year')?.value}-${parts.find(p => p.type === 'month')?.value}`
}
export function PointsPage() {
  const [view, setView] = useState<'individual' | 'leaderboard'>('individual')
  const [month, setMonth] = useState(currentMonth)
  const [locationId, setLocationId] = useState('')
  const [userId, setUserId] = useState('')
  const [manager, setManager] = useState(false)
  const [gm,setGm]=useState(false)
  const [refresh,setRefresh]=useState(0)
  const [dashboard, setDashboard] = useState<Dashboard>({ standings: [], history: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const tenant = await loadTenantData()
        const location = tenant.locations[0]
        if (!location) throw new Error('No active location found.')
        const { data, error: userError } = await supabase.auth.getUser()
        if (userError) throw userError
        const permission = await supabase.rpc('mod_is_manager', { p_location_id: location.id })
        if (permission.error) throw permission.error
        const generalManager=await supabase.rpc('closeout_is_gm',{p_location_id:location.id})
        if(generalManager.error)throw generalManager.error
        if (active) { setUserId(data.user?.id ?? ''); setManager(!!permission.data); setGm(!!generalManager.data); setLocationId(location.id) }
      } catch (e) {
        if (active) { setError(String((e as { message?: string }).message ?? e)); setLoading(false) }
      }
    })()
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!locationId || !month) return
    let active = true
    setLoading(true); setError('')
    void (async () => {
      try {
        const { data, error: queryError } = await supabase.rpc('mod_points_dashboard', {
          p_location_id: locationId, p_month: `${month}-01`,
        })
        if (queryError) throw queryError
        if (active) setDashboard(data as Dashboard)
      } catch (e) { if (active) setError(String((e as { message?: string }).message ?? e)) }
      finally { if (active) setLoading(false) }
    })()
    return () => { active = false }
  }, [locationId, month, refresh])
  const mine = dashboard.standings.find(s => s.user_id === userId)
  return <section className="points-page">
    <div className="page-heading"><p className="eyebrow">LNX Systems</p><h1>Points & Leaderboard</h1>
      <p className="muted">Track your progress and celebrate the team.</p></div>
    {manager && <p><Link to="/closeout/awards">Award / Deduct Points →</Link></p>}
    <label>Month <input type="month" value={month} required onChange={e => { if (e.target.value) setMonth(e.target.value) }} /></label>
    <p className="muted">100 starting points each month. Winner: $100 + spotlight. Runner-up: $50 + first-cut pass.</p>
    <div className="points-switch" role="group" aria-label="Points views">
      <button type="button" aria-pressed={view === 'individual'} onClick={() => setView('individual')}>My Points</button>
      <button type="button" aria-pressed={view === 'leaderboard'} onClick={() => setView('leaderboard')}>Leaderboard</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">Loading points…</p>}
    {!loading && !error && (view === 'individual' ? <>
      <div className="points-stats">
        <article className="points-card"><h2>Monthly Points</h2><p className="points-value">{mine?.total ?? '—'}</p></article>
        <article className="points-card"><h2>Team Rank</h2><p className="points-value">{mine?.rank ?? '—'}</p></article>
      </div>
      <article className="points-card"><h2>Points History</h2><p>Monthly starting balance: +100</p>
        {dashboard.history.length ? <div className="points-table-wrap"><table className="points-table">
          <thead><tr><th>Date</th><th>Activity</th><th>Points</th></tr></thead>
          <tbody>{dashboard.history.map((e, i) => <tr key={i}><td>{e.business_date}</td>
            <td>{e.description}</td><td>{e.points > 0 ? '+' : ''}{e.points}</td></tr>)}</tbody>
        </table></div> : <p className="muted">No point adjustments this month.</p>}
      </article>
    </> : <article className="points-card"><h2>Team Leaderboard</h2>
      <p className="muted">Tied totals share a rank. Final prize ties require manager review.</p>
      <div className="points-table-wrap"><table className="points-table"><caption>Monthly team standings</caption>
        <thead><tr><th>Rank</th><th>Team Member</th><th>Points</th></tr></thead>
        <tbody>{dashboard.standings.map(s => <tr key={s.user_id}><td>{s.rank}</td><td>{s.name}</td><td>{s.total}</td></tr>)}</tbody>
      </table></div></article>)}
    {gm && <PointEntryEditor location={locationId} month={month} onChanged={()=>setRefresh(v=>v+1)} />}
  </section>
}


// page-designer-instrumented
import { PageWord } from "../components/PageDesign"
import { ScreenText } from "../components/ScreenText"
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
  return <section data-design-block="copy.6804095348b4534f.1" className="points-page">
    <div data-design-block="copy.3f7c7eb5092ef959.1" className="page-heading"><p data-design-block="copy.f6a7ab23d63be064.1" className="eyebrow"><ScreenText id="PointsPage.262da4df982b420d">LNX Systems</ScreenText></p><h1 data-design-block="copy.f38aa4d1b5095c0c.1"><ScreenText id="PointsPage.7227d397db4a9148">Points & Leaderboard</ScreenText></h1>
      <p data-design-block="copy.ba8f526071f4b63b.1" className="muted"><ScreenText id="PointsPage.29c57305376b3dd7">Track your progress and celebrate the team.</ScreenText></p></div>
    {manager && <p data-design-block="copy.aaa41820a7b2efd3.1"><Link to="/closeout/awards"><ScreenText id="PointsPage.c2ae010ecda1aae1">Award / Deduct Points →</ScreenText></Link></p>}
    <label data-design-block="copy.fb586aab6aca00ba.1"><ScreenText id="PointsPage.92018619691663a6">Month </ScreenText><input type="month" value={month} required onChange={e => { if (e.target.value) setMonth(e.target.value) }} /></label>
    <p data-design-block="copy.ba8f526071f4b63b.2" className="muted"><ScreenText id="PointsPage.85dcf42e118af84f">100 starting points each month. Winner: $100 + spotlight. Runner-up: $50 + first-cut pass.</ScreenText></p>
    <div data-design-block="copy.9a17d5d17d36fbf0.1" className="points-switch" role="group" aria-label="Points views">
      <button data-design-block="copy.cc7ca8c8c6bc5a4f.1" type="button" aria-pressed={view === 'individual'} onClick={() => setView('individual')}><ScreenText id="PointsPage.c62c430488cafb76">My Points</ScreenText></button>
      <button data-design-block="copy.9b244c870e37a08a.1" type="button" aria-pressed={view === 'leaderboard'} onClick={() => setView('leaderboard')}><ScreenText id="PointsPage.deb2f609e7bc3c81">Leaderboard</ScreenText></button>
    </div>
    {error && <p data-design-block="copy.5c478803ca835481.1" role="alert">{error}</p>}
    {loading && <p data-design-block="copy.bbd275d649930e49.1" role="status"><ScreenText id="PointsPage.e78e48fd3cbb9452">Loading points…</ScreenText></p>}
    {!loading && !error && (view === 'individual' ? <>
      <div data-design-block="copy.290a939301e25500.1" className="points-stats">
        <article data-design-block="copy.8bd6e18cc9706408.1" className="points-card"><h2 data-design-block="copy.cf61283aac8eec10.1"><ScreenText id="PointsPage.8e1782649e375df9">Monthly Points</ScreenText></h2><p data-design-block="copy.20cdbc4ecc72a0c8.1" className="points-value">{mine?.total ?? '—'}</p></article>
        <article data-design-block="copy.8bd6e18cc9706408.2" className="points-card"><h2 data-design-block="copy.cf61283aac8eec10.2"><ScreenText id="PointsPage.2fac1087c80e5afe">Team Rank</ScreenText></h2><p data-design-block="copy.20cdbc4ecc72a0c8.2" className="points-value">{mine?.rank ?? '—'}</p></article>
      </div>
      <article data-design-block="copy.8bd6e18cc9706408.3" className="points-card"><h2 data-design-block="copy.cf61283aac8eec10.3"><ScreenText id="PointsPage.7c6d65131b8f4099">Points History</ScreenText></h2><p data-design-block="copy.aaa41820a7b2efd3.2"><ScreenText id="PointsPage.3a329828f93c1c68">Monthly starting balance: +100</ScreenText></p>
        {dashboard.history.length ? <div data-design-block="copy.46595f88b74ad3d3.1" className="points-table-wrap"><table className="points-table">
          <thead><tr><th><ScreenText id="PointsPage.ce41d9a585ca24c8">Date</ScreenText></th><th><ScreenText id="PointsPage.c5c21bab8b486453">Activity</ScreenText></th><th><ScreenText id="PointsPage.ff94246eb2bb289a">Points</ScreenText></th></tr></thead>
          <tbody>{dashboard.history.map((e, i) => <tr key={i}><td>{e.business_date}</td>
            <td>{e.description}</td><td>{e.points > 0 ? <PageWord id="copy.73caa2496555a3c6.1">{"+"}</PageWord> : <PageWord id="copy.df6ce1b283484f2f.1">{""}</PageWord>}{e.points}</td></tr>)}</tbody>
        </table></div> : <p data-design-block="copy.ba8f526071f4b63b.3" className="muted"><ScreenText id="PointsPage.2206727e97da939d">No point adjustments this month.</ScreenText></p>}
      </article>
    </> : <article data-design-block="copy.8bd6e18cc9706408.4" className="points-card"><h2 data-design-block="copy.cf61283aac8eec10.4"><ScreenText id="PointsPage.d7848a33da6c724d">Team Leaderboard</ScreenText></h2>
      <p data-design-block="copy.ba8f526071f4b63b.4" className="muted"><ScreenText id="PointsPage.4380866cc0b528a9">Tied totals share a rank. Final prize ties require manager review.</ScreenText></p>
      <div data-design-block="copy.46595f88b74ad3d3.2" className="points-table-wrap"><table className="points-table"><caption><ScreenText id="PointsPage.d445873f8049aaa4">Monthly team standings</ScreenText></caption>
        <thead><tr><th><ScreenText id="PointsPage.febf9850512da3b5">Rank</ScreenText></th><th><ScreenText id="PointsPage.29018cc18c7e2d93">Team Member</ScreenText></th><th><ScreenText id="PointsPage.0e216e68dda20f0b">Points</ScreenText></th></tr></thead>
        <tbody>{dashboard.standings.map(s => <tr key={s.user_id}><td>{s.rank}</td><td>{s.name}</td><td>{s.total}</td></tr>)}</tbody>
      </table></div></article>)}
    {gm && <PointEntryEditor location={locationId} month={month} onChanged={()=>setRefresh(v=>v+1)} />}
  </section>
}


import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { serviceDay, serviceDateLabel } from '../lib/serviceDay'
import { salesMoney } from '../lib/salesTargets'
import { homeTargetPlan } from '../lib/homeTargetPlan'
import './ProfileSalesTargets.css'

type Targets = { ready: boolean; date: string; reason?: string; team_target?: number | null; individual_target?: number | null; assigned_hours?: number | null; locked?: boolean }
export function ProfileSalesTargets({ location }: { location: string }) {
  const [data, setData] = useState<Targets | null>(null)
  const [date, setDate] = useState(serviceDay)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [spend, setSpend] = useState('35')
  useEffect(() => {
    const update = () => { if (document.visibilityState === 'visible') { setDate(serviceDay()); setRefresh(v => v + 1) } }
    const timer = setInterval(update, 60000)
    window.addEventListener('focus', update)
    window.addEventListener('crew-schedule-changed', update)
    window.addEventListener('sales-targets-changed', update)
    document.addEventListener('visibilitychange', update)
    return () => { clearInterval(timer); window.removeEventListener('focus', update); window.removeEventListener('crew-schedule-changed', update); window.removeEventListener('sales-targets-changed', update); document.removeEventListener('visibilitychange', update) }
  }, [])
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20000)
    setData(null); setError(''); setLoading(true)
    void (async () => {
      try {
        if (!location) return
        const result = await supabase.rpc('my_home_sales_targets', { p_location_id: location, p_date: date }).abortSignal(controller.signal)
        if (result.error) throw result.error
        if (active) setData(result.data as Targets)
      } catch (e) { if (active) setError(String((e as { message?: string }).message || 'Unable to load sales targets. Please refresh.')) }
      finally { clearTimeout(timer); if (active) setLoading(false) }
    })()
    return () => { active = false; clearTimeout(timer); controller.abort() }
  }, [location, date, refresh])
  const personal = data?.individual_target == null ? null : Number(data.individual_target)
  const team = data?.team_target == null ? null : Number(data.team_target)
  const hours = data?.assigned_hours == null ? null : Number(data.assigned_hours)
  const plan = data?.ready ? homeTargetPlan(personal ?? team, personal === null ? null : hours, spend) : null
  return <section className="profile-sales-targets" aria-label="Today's sales targets" aria-busy={loading}>
    <div className="profile-target-heading"><h2>Today’s sales targets</h2><button type="button" disabled={loading} onClick={() => { setDate(serviceDay()); setRefresh(v => v + 1) }}>Refresh targets</button></div>
    <p>{serviceDateLabel(date)} · Net sales</p>
    {loading ? <p role="status">Loading targets…</p> : error ? <p role="alert">{error}</p> : data?.ready ? <>
      <dl className="profile-target-totals"><div><dt>Team target</dt><dd>{team === null ? 'Not available' : salesMoney(team)}</dd></div>
        {personal !== null && <div><dt>My assigned target</dt><dd>{salesMoney(personal)}</dd></div>}
      </dl>
      {personal === null && <p>No individual target assigned for today.</p>}
      {plan && <div className="profile-target-plan"><h3>{personal === null ? 'Quick plan for the team goal' : 'Quick plan for my target'}</h3>
        {plan.hourly !== null && <p><strong>{salesMoney(plan.hourly)} per scheduled hour</strong> across {hours} assigned hours.</p>}
        {plan.guests !== null && <p><strong>{plan.guests} {plan.guests === 1 ? 'guest' : 'guests'}</strong> averaging {salesMoney(plan.spend!)} in net sales each would reach this goal.</p>}
        <label>Example average spend per guest ($)<input type="number" min="0.01" step="0.01" value={spend} onChange={e => setSpend(e.target.value)} /></label>
        {plan.guests === null && <p>Enter a positive average spend to calculate a guest goal.</p>}
        <small>Planning estimates, not a sales-progress total. Average spend excludes tax and tips.</small>
        <details><summary>Ways to get there</summary><ul>
          <li>Start with a specific cocktail recommendation and offer an appetizer while guests decide.</li>
          <li>Watch drinks and offer another round at the right moment.</li>
          <li>Offer dessert before presenting the check.</li>
          <li>Small additions count: an extra $5 in net sales for each of 10 guests adds $50.</li>
        </ul></details>
      </div>}
    </> : <p>{data?.reason || 'Targets have not been assigned for today.'}</p>}
  </section>
}

import {DesignSection} from './DesignSection'
import { SalesTargetVideos } from './SalesTargetVideos'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { serviceDay, serviceDateLabel } from '../lib/serviceDay'
import { salesMoney } from '../lib/salesTargets'
import { salesProgressPlan } from '../lib/salesProgressPlan'
import './ProfileSalesTargets.css'

type Targets = { ready: boolean; date: string; reason?: string; team_target?: number | null; individual_target?: number | null; assigned_hours?: number | null; locked?: boolean }
export function ProfileSalesTargets({ location }: { location: string }) {
  const [data, setData] = useState<Targets | null>(null)
  const [date, setDate] = useState(serviceDay)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [spend, setSpend] = useState('35')
  const [currentSales, setCurrentSales] = useState('')
  useEffect(() => {setData(null);setCurrentSales('');setSpend('35')}, [location,date])
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
    setError(''); setLoading(true)
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
  const usingTeam = personal === null
  const goalLabel = usingTeam ? 'Team goal calculator' : 'My goal calculator'
  const plan = data?.ready ? salesProgressPlan(personal ?? team,spend,currentSales) : null
  return <DesignSection as="section" data-design-block="home.targets" data-layout-item="true" data-layout-label="Sales targets and coaching videos" className="profile-sales-targets" aria-label="Today's sales targets" aria-busy={loading}>
    <div className="profile-target-heading"><h2>Today’s sales targets</h2><button type="button" disabled={loading} aria-label="Refresh targets" title="Refresh targets" onClick={() => { setDate(serviceDay()); setRefresh(v => v + 1) }}>↻</button></div>
    <p>{serviceDateLabel(date)} · Net sales</p>
    <div className="profile-target-top"><div className="profile-target-numbers">
      {data?.ready&&<><dl className="profile-target-totals"><div><dt>Team target</dt><dd>{team === null ? 'Not available' : salesMoney(team)}</dd></div>
        <div><dt>My assigned target</dt><dd>{personal===null?'Not assigned':salesMoney(personal)}</dd></div>
      </dl>
      {personal===null&&<p>Using team sales.</p>}</>}
    </div><SalesTargetVideos key={location} location={location} compact /></div>
    {loading&&!data ? <p role="status">Loading targets…</p> : error ? <p role="alert">{error}</p> : data?.ready ? <>
      {plan&&<details className="profile-target-plan" aria-label={goalLabel} data-design-block="home.targets.calculator">
        <summary>{goalLabel}</summary>
        <div className="profile-target-inputs">
          <label>{usingTeam ? 'Team current net sales ($)' : 'My current net sales ($)'}<input type="number" inputMode="decimal" min="0" step="0.01" placeholder="Enter current sales" value={currentSales} onChange={e=>setCurrentSales(e.target.value)}/></label>
          <label>Average spend per guest ($)<input type="number" inputMode="decimal" min="0.01" step="0.01" value={spend} onChange={e=>setSpend(e.target.value)}/></label>
        </div>
        <small>Enter net sales before tax and tips. These are manual planning estimates.</small>
        {plan.current===null?<p role="status">{currentSales.trim()===''?(usingTeam ? 'Enter the team’s combined current sales, including 0 at the start of service.' : 'Enter your current sales, including 0 at the start of your shift.'):'Enter a valid current net sales amount of 0 or more.'}</p>:<>
          <div className="profile-target-progress" aria-label={usingTeam ? 'Team sales progress' : 'My sales progress'}>
            <progress max={100} value={plan.percent??0} aria-label={usingTeam ? 'Progress toward the team target' : 'Progress toward my assigned target'}/>
            <dl><div><dt>Current sales</dt><dd>{salesMoney(plan.current)}</dd></div><div><dt>Still to go</dt><dd data-testid="target-remaining">{salesMoney(plan.remaining!)}</dd></div></dl>
          </div>
          {plan.stage==='reached'&&<p role="status">Target reached{plan.over!>0?' · '+salesMoney(plan.over!)+' above goal':''}.</p>}
        </>}
      </details>}
    </> : <p>{data?.reason || 'Targets have not been assigned for today.'}</p>}
    <details className="profile-target-scripts" data-design-block="home.targets.scripts"><summary>Team plan</summary>
      {plan?.current!==null&&plan&&<div className="profile-target-next" role="status" aria-live="polite">
            {plan.stage==='reached'?<p>Keep making thoughtful recommendations and maintain the same service standards.</p>:<>
              <strong>{salesMoney(plan.remaining!)} left to reach {usingTeam ? 'the team target' : 'your individual target'}.</strong>
              {plan.guests!==null?<p>About <b>{plan.guests} more {plan.guests===1?'guest':'guests'}</b> at {salesMoney(plan.spend!)} average net spend would cover the amount left.</p>:<p>Enter a positive average spend to estimate how many more guests would cover the gap.</p>}
              <p>{plan.stage==='close'?'You’re close: check for a useful next offer at the tables currently being served.':'Build the next checks: lead with a specific drink recommendation, suggest a starter, and follow up at the right moment.'}</p>
              <small>Another example: {plan.fiveDollarAdds} additional $5 net-sales {plan.fiveDollarAdds===1?'addition':'additions'}, or {plan.tenDollarAdds} additional $10 {plan.tenDollarAdds===1?'addition':'additions'}, would cover the gap. Use your actual menu prices.</small>
            </>}
          </div>}
      <h3>Recommendations &amp; selling scripts</h3>
      <p>Choose the offer that fits the guest and the stage of their meal.</p>
      <h3>Welcome &amp; first drink</h3><p>“Are you in the mood for something refreshing or something liquor-forward? I can recommend a cocktail.”</p>
      <h3>A starter while they decide</h3><p>“Would you like to start with an appetizer for the table while you look over the menu?”</p>
      <h3>The next round</h3><p>“Would you like another of the same, or would you like me to recommend something different?”</p>
      <h3>Dessert before the check</h3><p>“Would you like to finish with dessert? I can walk you through today’s options.”</p>
    </details>
  </DesignSection>
}

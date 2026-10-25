import {MenuSalesPlanner} from './MenuSalesPlanner'
import {MonthlySalesTracker} from './MonthlySalesTracker'
import {DesignSection} from './DesignSection'
import {SalesTargetVideos} from './SalesTargetVideos'
import {useEffect,useState} from 'react'
import {supabase} from '../lib/supabase'
import {serviceDay,serviceDateLabel} from '../lib/serviceDay'
import {salesMoney} from '../lib/salesTargets'
import {salesProgressPlan} from '../lib/salesProgressPlan'
import {type SalesMenuItem,type MenuService} from '../lib/menuCatalog'
import './ProfileSalesTargets.css'
type Targets={can_manage?:boolean;ready:boolean;date:string;reason?:string;team_target?:number|null;individual_target?:number|null}
const currentMenu=():MenuService=>{const d=new Date(),day=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',weekday:'short'}).format(d),hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Chicago',hour:'2-digit',hourCycle:'h23'}).format(d));return ['Fri','Sat','Sun'].includes(day)&&hour>=11&&hour<16?'brunch':'regular'}
const message=(e:unknown)=>String((e as {message?:string})?.message??e)
export function ProfileSalesTargets({location}:{location:string}){
 const [data,setData]=useState<Targets|null>(null),[date,setDate]=useState(serviceDay),[loading,setLoading]=useState(true),[error,setError]=useState(''),[refresh,setRefresh]=useState(0)
 const [potential,setPotential]=useState({team:'',individual:''})
 const [scope,setScope]=useState<'team'|'individual'>('team'),[current,setCurrent]=useState({team:'',individual:''}),[spend,setSpend]=useState('35'),[menu,setMenu]=useState<SalesMenuItem[]>([]),[menuError,setMenuError]=useState(''),[menuLoading,setMenuLoading]=useState(false),[open,setOpen]=useState(false)
 useEffect(()=>{setPotential({team:'',individual:''});setData(null);setCurrent({team:'',individual:''});setSpend('35');setMenu([])},[location,date])
 useEffect(()=>{const update=()=>{if(document.visibilityState==='visible'){setDate(serviceDay());setRefresh(v=>v+1)}};const timer=setInterval(update,60000);for(const event of ['focus','crew-schedule-changed','sales-targets-changed','menu-catalog-changed'])window.addEventListener(event,update);document.addEventListener('visibilitychange',update);return()=>{clearInterval(timer);for(const event of ['focus','crew-schedule-changed','sales-targets-changed','menu-catalog-changed'])window.removeEventListener(event,update);document.removeEventListener('visibilitychange',update)}},[])
 useEffect(()=>{let live=true;const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);setLoading(true);setError('');void(async()=>{try{if(!location)return;const r=await supabase.rpc('my_home_sales_targets',{p_location_id:location,p_date:date}).abortSignal(controller.signal);if(r.error)throw r.error;if(live)setData(r.data as Targets)}catch(e){if(live){setData(null);setError(message(e))}}finally{clearTimeout(timer);if(live)setLoading(false)}})();return()=>{live=false;clearTimeout(timer);controller.abort()}},[location,date,refresh])
 useEffect(()=>{if(!open||!location)return;let live=true;const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);setMenuLoading(true);setMenuError('');void(async()=>{try{const r=await supabase.rpc('menu_sales_items',{p_location_id:location}).abortSignal(controller.signal);if(r.error)throw r.error;if(live)setMenu(r.data??[])}catch(e){if(live){setMenu([]);setMenuError(message(e))}}finally{clearTimeout(timer);if(live)setMenuLoading(false)}})();return()=>{live=false;clearTimeout(timer);controller.abort()}},[location,open,refresh])
 const value=scope==='team'?data?.team_target:data?.individual_target,goal=data?.ready&&value!==null&&value!==undefined&&Number.isFinite(Number(value))?Number(value):null
 const draft=potential[scope].trim(),trial=draft!==''?Number(draft):null,calculationGoal=draft!==''?(Number.isFinite(trial)&&trial!>0&&trial!<=100000000&&Math.abs(trial!*100-Math.round(trial!*100))<.00001?trial:null):goal
 const plan=calculationGoal===null?null:salesProgressPlan(calculationGoal,spend,current[scope])
 const label=scope==='team'?'Team':'Individual'
 return <DesignSection as="section" data-design-block="home.targets" data-layout-item="true" data-layout-label="Sales target calculator and videos" className="profile-sales-targets" aria-label="Today's sales targets" aria-busy={loading}>
 <div className="profile-target-heading"><h2>Today’s sales goal</h2><button type="button" disabled={loading} aria-label="Refresh targets" title="Refresh targets" onClick={()=>{setDate(serviceDay());setRefresh(v=>v+1)}}>↻</button></div><p>{serviceDateLabel(date)} · Net sales</p>
 <div className="profile-target-top"><div className="profile-target-numbers"><label className="profile-goal-select">Calculate for<select aria-label="Calculate for" value={scope} onChange={e=>setScope(e.target.value as 'team'|'individual')}><option value="team">Team goal</option><option value="individual">Individual goal</option></select></label>
 {loading?<p role="status">Loading goal…</p>:error?<p role="alert">{error}</p>:goal===null?<p role="status">No goal assigned for that day.{scope==='team'&&data?.reason?<small>{data.reason}</small>:null}</p>:<dl className="profile-target-totals"><div><dt>{label} goal</dt><dd>{salesMoney(goal)}</dd></div></dl>}</div><SalesTargetVideos key={location} location={location} compact/></div>
 {!loading&&!error&&<details open={open} className="profile-target-plan" data-design-block="home.targets.calculator" onToggle={e=>setOpen(e.currentTarget.open)}><summary>{label} goal calculator</summary>
 <label>Potential target to try ($)<input aria-label="Potential target to try ($)" type="number" min="0.01" max="100000000" step="0.01" value={potential[scope]} placeholder={goal===null?'Enter a target':String(goal)} onChange={e=>setPotential(old=>({...old,[scope]:e.target.value}))}/></label><small>{draft?'Preview only — this does not change an assigned goal.':'Leave blank to use the assigned goal.'}</small>
 <div className="profile-target-inputs"><label>{scope==='team'?'Team current net sales ($)':'My current net sales ($)'}<input type="number" inputMode="decimal" min="0" step="0.01" value={current[scope]} placeholder="Enter current sales" onChange={e=>setCurrent(old=>({...old,[scope]:e.target.value}))}/></label><label>Average spend per guest ($)<input type="number" inputMode="decimal" min="0.01" step="0.01" value={spend} onChange={e=>setSpend(e.target.value)}/></label></div>
 {!plan?<p role="status">Enter a valid potential target to calculate a plan.</p>:plan.current===null?<p role="status">Enter {scope==='team'?'the team’s combined':'your'} current net sales, including 0 at the start.</p>:<><div className="profile-target-progress"><progress max={100} value={plan.percent??0} aria-label={label+' goal progress'}/><dl><div><dt>Current sales</dt><dd>{salesMoney(plan.current)}</dd></div><div><dt>Still to go</dt><dd data-testid="target-remaining">{salesMoney(plan.remaining!)}</dd></div></dl></div>{plan.stage==='reached'?<p role="status">Goal reached{plan.over!>0?' · '+salesMoney(plan.over!)+' above goal':''}.</p>:<>{plan.guests!==null&&<p>About {plan.guests} more {plan.guests===1?'guest':'guests'} at {salesMoney(plan.spend!)} average net spend.</p>}
 {menuLoading?<p role="status">Loading menu prices…</p>:menuError?<p role="alert">Menu unavailable: {menuError} <button type="button" onClick={()=>setRefresh(v=>v+1)}>Retry menu prices</button></p>:<MenuSalesPlanner key={location+date+scope} items={menu} service={currentMenu()} remaining={plan.remaining!}/>}

 </>}</>}
 <small>Manual planning calculator. Enter current net sales before tax and tips.</small></details>}
 <MonthlySalesTracker location={location} compact/>
 </DesignSection>
}

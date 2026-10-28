import {useEffect,useState} from 'react'
import {Link} from 'react-router-dom'
import {DetailedSalesTargets} from '../components/ProfileSalesTargets'
import {useAppAccess} from '../components/AppAccess'
import {loadTenantData} from '../lib/tenant'
export function SalesCalculatorPage(){
 const access=useAppAccess(),[location,setLocation]=useState(''),[error,setError]=useState('')
 useEffect(()=>{let live=true;void loadTenantData().then(t=>{if(!t.locations[0])throw Error('No active location.');if(live)setLocation(t.locations[0].id)}).catch(e=>{if(live)setError(String(e.message??e))});return()=>{live=false}},[])
 return <section className="page"><Link to="/">← Home</Link><h1>Sales targets & plan</h1><p>Detailed calculation, menu-item planning, coaching videos and monthly progress.</p>{access.admin&&access.can('settings','sales')&&<p><Link to="/settings/sales-targets">Manage assigned team and employee targets →</Link></p>}{error&&<p role="alert">{error}</p>}{!location&&!error&&<p role="status">Loading sales calculator…</p>}{location&&<DetailedSalesTargets location={location}/>}</section>
}

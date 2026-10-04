import { NavLink } from 'react-router-dom'
import { CloseoutSummaryPage } from './CloseoutSummary'
import { CashPage } from './CashPage'
import './SettingsNavigation.css'
export function SummaryPage({cash=false}:{cash?:boolean}){
 return <><nav className="summary-tabs" aria-label="Summary views"><NavLink to="/closeout-summary" end>Closeouts</NavLink><NavLink to="/closeout-summary/cash">Cash</NavLink></nav>{cash?<CashPage/>:<CloseoutSummaryPage/>}</>
}

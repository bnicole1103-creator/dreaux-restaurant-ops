import { ScreenText } from "../components/ScreenText"
import { NavLink } from 'react-router-dom'
import { CloseoutSummaryPage } from './CloseoutSummary'
import { CashPage } from './CashPage'
import './SettingsNavigation.css'
export function SummaryPage({cash=false}:{cash?:boolean}){
 return <><nav className="summary-tabs" aria-label="Summary views"><NavLink to="/closeout-summary" end><ScreenText id="SummaryPage.e29d49cab08dfe4a">Closeouts</ScreenText></NavLink><NavLink to="/closeout-summary/cash"><ScreenText id="SummaryPage.149035aa258681ef">Cash</ScreenText></NavLink></nav>{cash?<CashPage/>:<CloseoutSummaryPage/>}</>
}

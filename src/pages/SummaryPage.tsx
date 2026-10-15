import {PageWord} from '../components/PageDesign'
// page-designer-instrumented
import { ScreenText } from "../components/ScreenText"
import { Link, useSearchParams } from 'react-router-dom'
import { DisposalSummary } from '../components/DisposalSheets'
import { CloseoutSummaryPage } from './CloseoutSummary'
import { CashPage } from './CashPage'
import './SettingsNavigation.css'
export function SummaryPage({cash=false}:{cash?:boolean}){
 const [params]=useSearchParams()
 const disposal=!cash&&params.get('view')==='disposal'
 return <><nav data-design-block="copy.b7b74a218aba1fbb.1" className="summary-tabs" aria-label="Summary views">
  <Link to="/closeout-summary" className={!cash&&!disposal?'active':undefined} aria-current={!cash&&!disposal?'page':undefined}><ScreenText id="SummaryPage.e29d49cab08dfe4a">Closeouts</ScreenText></Link>
  <Link to="/closeout-summary/cash" className={cash?'active':undefined} aria-current={cash?'page':undefined}><ScreenText id="SummaryPage.149035aa258681ef">Cash</ScreenText></Link>
  <Link to="/closeout-summary?view=disposal" className={disposal?'active':undefined} aria-current={disposal?'page':undefined}><PageWord id="sectioncopy.9141dcf205507aaa0b98">{"Disposal"}</PageWord></Link>
 </nav>{cash?<CashPage/>:disposal?<DisposalSummary/>:<CloseoutSummaryPage/>}</>
}

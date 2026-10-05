import { ScreenText } from "../components/ScreenText"
import { Link } from 'react-router-dom'
import { useManagementAccess } from '../components/ManagementAccess'
import './ManagerCloseoutPage.css'
export function CloseoutHub() {
  const access = useManagementAccess()
  return <section className="mod-page"><h1><ScreenText id="CloseoutHub.150b399557d01236">Closeout</ScreenText></h1><p><ScreenText id="CloseoutHub.fe9d0dce579ca5c9">Choose the form for your shift.</ScreenText></p>
    <article className="mod-review"><h2><ScreenText id="CloseoutHub.09b2f0ed3310116a">Staff Closeout</ScreenText></h2><p><ScreenText id="CloseoutHub.679f9fd98658d2fc">Complete your sales, cash, tips, and shift questions.</ScreenText></p><Link to="/closeout/staff"><ScreenText id="CloseoutHub.3d3d6a8ac79389ec">Open Staff Closeout →</ScreenText></Link></article>
    <article className="mod-review"><h2><ScreenText id="CloseoutHub.c5974b145fd52498">Closeout Summary</ScreenText></h2><p>{access.manager ? "View all staff closeouts and the team recap." : "View your own closeouts."}</p><Link to="/closeout-summary"><ScreenText id="CloseoutHub.8b80a7ed4ed96752">Open Summary →</ScreenText></Link></article>
    {access.manager && <>
      <article className="mod-review"><h2><ScreenText id="CloseoutHub.5a0c7948f9a8e57c">Manager Closeout</ScreenText></h2><p><ScreenText id="CloseoutHub.e4ed0ffa117d3cc0">Complete the cash deposit, register check, and private staff reviews.</ScreenText></p><Link to="/closeout/manager"><ScreenText id="CloseoutHub.b5f151a95a328e5b">Open Manager Closeout →</ScreenText></Link></article>
      <article className="mod-review"><h2><ScreenText id="CloseoutHub.c042e14cd0556c31">Award / Deduct Points</ScreenText></h2><p><ScreenText id="CloseoutHub.959e6e6e1fe511ff">Apply an existing point category to an employee.</ScreenText></p><Link to="/closeout/awards"><ScreenText id="CloseoutHub.2af52bb3240d25cb">Open Points Adjustments →</ScreenText></Link></article>
    </>}
    {access.gm && <article className="mod-review"><h2><ScreenText id="CloseoutHub.8f31c04b843d0986">Form &amp; Points Settings</ScreenText></h2><p><ScreenText id="CloseoutHub.695b65a48cac8641">Edit questions, categories, reasons, and point values.</ScreenText></p><Link to="/closeout/settings"><ScreenText id="CloseoutHub.42f17c4540c0b8d3">Open Settings →</ScreenText></Link></article>}
    {access.gm && <article className="mod-review"><h2><ScreenText id="CloseoutHub.763e8ef414fa8e22">Permissions</ScreenText></h2><p><ScreenText id="CloseoutHub.1e3940c66064d609">Choose staff, manager, or general manager access.</ScreenText></p><Link to="/closeout/permissions"><ScreenText id="CloseoutHub.bf2e1b7855d92a89">Manage Permissions →</ScreenText></Link></article>}
    {access.error && <p role="alert">{access.error}</p>}
  </section>
}

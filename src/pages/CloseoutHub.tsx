// page-designer-instrumented
import { PageWord } from "../components/PageDesign"
import { ScreenText } from "../components/ScreenText"
import { Link } from 'react-router-dom'
import { useManagementAccess } from '../components/ManagementAccess'
import './ManagerCloseoutPage.css'
export function CloseoutHub() {
  const access = useManagementAccess()
  return <section data-design-block="copy.ef7fd73ecbc29435.1" className="mod-page"><h1 data-design-block="copy.705692e005f05abc.1"><ScreenText id="CloseoutHub.150b399557d01236">Closeout</ScreenText></h1><p data-design-block="copy.fceacfa9b27cce96.1"><ScreenText id="CloseoutHub.fe9d0dce579ca5c9">Choose the form for your shift.</ScreenText></p>
    <article data-design-block="copy.50a508630fea3a91.1" className="mod-review"><h2 data-design-block="copy.d4d53e66fa01d794.1"><ScreenText id="CloseoutHub.09b2f0ed3310116a">Staff Closeout</ScreenText></h2><p data-design-block="copy.fceacfa9b27cce96.2"><ScreenText id="CloseoutHub.679f9fd98658d2fc">Complete your sales, cash, tips, and shift questions.</ScreenText></p><Link to="/closeout/staff"><ScreenText id="CloseoutHub.3d3d6a8ac79389ec">Open Staff Closeout →</ScreenText></Link></article>
    <article data-design-block="copy.50a508630fea3a91.2" className="mod-review"><h2 data-design-block="copy.d4d53e66fa01d794.2"><ScreenText id="CloseoutHub.c5974b145fd52498">Closeout Summary</ScreenText></h2><p data-design-block="copy.fceacfa9b27cce96.3">{access.manager ? <PageWord id="copy.465fc6df4a72b3d2.1">{"View all staff closeouts and the team recap."}</PageWord> : <PageWord id="copy.32eec4139bbcb647.1">{"View your own closeouts."}</PageWord>}</p><Link to="/closeout-summary"><ScreenText id="CloseoutHub.8b80a7ed4ed96752">Open Summary →</ScreenText></Link></article>
    {access.manager && <>
      <article data-design-block="copy.50a508630fea3a91.3" className="mod-review"><h2 data-design-block="copy.d4d53e66fa01d794.3"><ScreenText id="CloseoutHub.5a0c7948f9a8e57c">Manager Closeout</ScreenText></h2><p data-design-block="copy.fceacfa9b27cce96.4"><ScreenText id="CloseoutHub.e4ed0ffa117d3cc0">Complete the cash deposit, register check, and private staff reviews.</ScreenText></p><Link to="/closeout/manager"><ScreenText id="CloseoutHub.b5f151a95a328e5b">Open Manager Closeout →</ScreenText></Link></article>
      <article data-design-block="copy.50a508630fea3a91.4" className="mod-review"><h2 data-design-block="copy.d4d53e66fa01d794.4"><ScreenText id="CloseoutHub.c042e14cd0556c31">Award / Deduct Points</ScreenText></h2><p data-design-block="copy.fceacfa9b27cce96.5"><ScreenText id="CloseoutHub.959e6e6e1fe511ff">Apply an existing point category to an employee.</ScreenText></p><Link to="/closeout/awards"><ScreenText id="CloseoutHub.2af52bb3240d25cb">Open Points Adjustments →</ScreenText></Link></article>
    </>}
    {access.gm && <article data-design-block="copy.50a508630fea3a91.5" className="mod-review"><h2 data-design-block="copy.d4d53e66fa01d794.5"><ScreenText id="CloseoutHub.8f31c04b843d0986">Form &amp; Points Settings</ScreenText></h2><p data-design-block="copy.fceacfa9b27cce96.6"><ScreenText id="CloseoutHub.695b65a48cac8641">Edit questions, categories, reasons, and point values.</ScreenText></p><Link to="/closeout/settings"><ScreenText id="CloseoutHub.42f17c4540c0b8d3">Open Settings →</ScreenText></Link></article>}
    {access.gm && <article data-design-block="copy.50a508630fea3a91.6" className="mod-review"><h2 data-design-block="copy.d4d53e66fa01d794.6"><ScreenText id="CloseoutHub.763e8ef414fa8e22">Permissions</ScreenText></h2><p data-design-block="copy.fceacfa9b27cce96.7"><ScreenText id="CloseoutHub.1e3940c66064d609">Choose staff, manager, or general manager access.</ScreenText></p><Link to="/closeout/permissions"><ScreenText id="CloseoutHub.bf2e1b7855d92a89">Manage Permissions →</ScreenText></Link></article>}
    {access.error && <p data-design-block="copy.941b3329913922fd.1" role="alert">{access.error}</p>}
  </section>
}

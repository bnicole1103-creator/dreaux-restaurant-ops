// page-designer-instrumented
import { PageWord } from "../components/PageDesign"
import { ScreenText } from "../components/ScreenText"
import { Link } from 'react-router-dom'
import { useManagementAccess } from '../components/ManagementAccess'
import './ManagerCloseoutPage.css'
export function CloseoutHub() {
  const access = useManagementAccess()
  return <section data-design-block="copy.ef7fd73ecbc29435.1" className="mod-page closeout-hub"><h1 data-design-block="copy.705692e005f05abc.1"><ScreenText id="CloseoutHub.150b399557d01236">Closeout</ScreenText></h1><p data-design-block="copy.fceacfa9b27cce96.1"><ScreenText id="CloseoutHub.fe9d0dce579ca5c9">Choose the form for your shift.</ScreenText></p>
    <div className="closeout-hub-actions"><article data-design-block="copy.50a508630fea3a91.1" className="mod-review"><h2 data-design-block="copy.d4d53e66fa01d794.1"><ScreenText id="CloseoutHub.09b2f0ed3310116a">Staff Closeout</ScreenText></h2><p data-design-block="copy.fceacfa9b27cce96.2"><ScreenText id="CloseoutHub.679f9fd98658d2fc">Complete your sales, cash, tips, and shift questions.</ScreenText></p><Link to="/closeout/staff"><ScreenText id="CloseoutHub.3d3d6a8ac79389ec">Open Staff Closeout →</ScreenText></Link></article>
    <article data-design-block="copy.50a508630fea3a91.2" className="mod-review"><h2 data-design-block="copy.d4d53e66fa01d794.2"><ScreenText id="CloseoutHub.c5974b145fd52498">Closeout Summary</ScreenText></h2><p data-design-block="copy.fceacfa9b27cce96.3">{access.manager ? <PageWord id="copy.465fc6df4a72b3d2.1">{"View all staff closeouts and the team recap."}</PageWord> : <PageWord id="copy.32eec4139bbcb647.1">{"View your own closeouts."}</PageWord>}</p><Link to="/closeout-summary"><ScreenText id="CloseoutHub.8b80a7ed4ed96752">Open Summary →</ScreenText></Link></article>
    <article data-design-block="section.6038e4c9dbb6910f796f" className="mod-review"><h2><PageWord id="sectioncopy.81f0a313b6947c97a3ff">{"Disposal count sheet"}</PageWord></h2><p><PageWord id="sectioncopy.f9eff078762576c35356">{"Record disposed bottles and review submitted sheets."}</PageWord></p><Link to="/inventory"><PageWord id="sectioncopy.3df176d6e039f847c185">{"Open Disposal →"}</PageWord></Link></article>
    {access.manager && <>
      <article data-design-block="copy.50a508630fea3a91.3" className="mod-review"><h2 data-design-block="copy.d4d53e66fa01d794.3"><ScreenText id="CloseoutHub.5a0c7948f9a8e57c">Manager Closeout</ScreenText></h2><p data-design-block="copy.fceacfa9b27cce96.4"><ScreenText id="CloseoutHub.e4ed0ffa117d3cc0">Complete the cash deposit, register check, and private staff reviews.</ScreenText></p><Link to="/closeout/manager"><ScreenText id="CloseoutHub.b5f151a95a328e5b">Open Manager Closeout →</ScreenText></Link></article>
      
    </>}
    
    
    </div>{access.error && <p data-design-block="copy.941b3329913922fd.1" role="alert">{access.error}</p>}
  </section>
}

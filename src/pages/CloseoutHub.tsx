import { Link } from 'react-router-dom'
import { useManagementAccess } from '../components/ManagementAccess'
import './ManagerCloseoutPage.css'
export function CloseoutHub() {
  const access = useManagementAccess()
  return <section className="mod-page"><h1>Closeout</h1><p>Choose the form for your shift.</p>
    <article className="mod-review"><h2>Staff Closeout</h2><p>Complete your sales, cash, tips, and shift questions.</p><Link to="/closeout/staff">Open Staff Closeout →</Link></article>
    <article className="mod-review"><h2>Closeout Summary</h2><p>{access.manager ? "View all staff closeouts and the team recap." : "View your own closeouts."}</p><Link to="/closeout-summary">Open Summary →</Link></article>
    {access.manager && <>
      <article className="mod-review"><h2>Manager Closeout</h2><p>Complete the cash deposit, register check, and private staff reviews.</p><Link to="/closeout/manager">Open Manager Closeout →</Link></article>
      <article className="mod-review"><h2>Award / Deduct Points</h2><p>Apply an existing point category to an employee.</p><Link to="/closeout/awards">Open Points Adjustments →</Link></article>
    </>}
    {access.gm && <article className="mod-review"><h2>Form &amp; Points Settings</h2><p>Edit questions, categories, reasons, and point values.</p><Link to="/closeout/settings">Open Settings →</Link></article>}
    {access.gm && <article className="mod-review"><h2>Permissions</h2><p>Choose staff, manager, or general manager access.</p><Link to="/closeout/permissions">Manage Permissions →</Link></article>}
    {access.error && <p role="alert">{access.error}</p>}
  </section>
}

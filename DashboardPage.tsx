export function DashboardPage() {
  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">Operations dashboard</p>
        <h1>Good shift starts here.</h1>
        <p className="muted">The professional app foundation is ready for tenant onboarding and live modules.</p>
      </section>
      <section className="metric-grid">
        <article className="metric-card"><span>Locations</span><strong>—</strong></article>
        <article className="metric-card"><span>Current covers</span><strong>—</strong></article>
        <article className="metric-card"><span>Open alerts</span><strong>—</strong></article>
      </section>
    </>
  )
}

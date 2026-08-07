import { useEffect, useState } from 'react'
import {
  loadTenantData,
  type TenantData,
} from '../lib/tenant'

export function DashboardPage() {
  const [tenant, setTenant] = useState<TenantData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const data = await loadTenantData()
        setTenant(data)
      } catch (caughtError) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : 'Unable to load organization data.',
        )
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [])

  if (loading) {
    return <div className="empty-state">Loading your restaurant…</div>
  }

  if (error) {
    return (
      <div className="empty-state">
        <strong>We could not load your restaurant.</strong>
        <span>{error}</span>
      </div>
    )
  }

  if (!tenant) {
    return (
      <div className="empty-state">
        <strong>No organization was found.</strong>
      </div>
    )
  }

  const primaryLocation = tenant.locations[0]

  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">Operations dashboard</p>
        <h1>{tenant.organization.name}</h1>

        <p className="muted">
          {primaryLocation
            ? `${primaryLocation.name}${
                primaryLocation.city
                  ? ` · ${primaryLocation.city}, ${primaryLocation.state}`
                  : ''
              }`
            : 'No active locations found.'}
        </p>
      </section>

      <section className="metric-grid">
        <article className="metric-card">
          <span>Locations</span>
          <strong>{tenant.locations.length}</strong>
        </article>

        <article className="metric-card">
          <span>Current covers</span>
          <strong>—</strong>
        </article>

        <article className="metric-card">
          <span>Open alerts</span>
          <strong>—</strong>
        </article>
      </section>

      <section className="module-grid">
        <article className="module-card">
          <h2>FloorFlow</h2>
          <p>
            Live floor, server rotation, upcoming reservations,
            birthdays, VIP moments, timers, and service alerts.
          </p>
        </article>

        <article className="module-card">
          <h2>CashFlow</h2>
          <p>
            Drawer sessions, deposits, voids, comps,
            receipt images, and manager cashout.
          </p>
        </article>

        <article className="module-card">
          <h2>TeamFlow</h2>
          <p>
            Shift tasks, sales goals, rewards,
            coaching, and performance tracking.
          </p>
        </article>

        <article className="module-card">
          <h2>InsightFlow</h2>
          <p>
            Covers, table turns, sales performance,
            labor, and operational reporting.
          </p>
        </article>
      </section>
    </>
  )
}

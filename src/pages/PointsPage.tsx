import { useState } from 'react'
import './PointsPage.css'

export function PointsPage() {
  const [view, setView] = useState<'individual' | 'leaderboard'>('individual')

  return (
    <section className="points-page">
      <div className="page-heading">
        <p className="eyebrow">LNX Systems</p>
        <h1>Points & Leaderboard</h1>
        <p className="muted">Track your progress and celebrate the team.</p>
      </div>

      <div className="points-switch" role="group" aria-label="Points views">
        <button
          type="button"
          aria-pressed={view === 'individual'}
          onClick={() => setView('individual')}
        >
          My Points
        </button>
        <button
          type="button"
          aria-pressed={view === 'leaderboard'}
          onClick={() => setView('leaderboard')}
        >
          Leaderboard
        </button>
      </div>

      {view === 'individual' ? (
        <div>
          <div className="points-stats">
            <article className="points-card">
              <h2>Total Points</h2>
              <p className="points-value">—</p>
              <p className="muted">Your earned points will appear here.</p>
            </article>
            <article className="points-card">
              <h2>Team Rank</h2>
              <p className="points-value">—</p>
              <p className="muted">Your position on the leaderboard.</p>
            </article>
          </div>

          <article className="points-card">
            <h2>Points History</h2>
            <p className="muted">
              Points data is not connected yet. Once connected, this
              section will show each award, its date, and the reason.
            </p>
          </article>
        </div>
      ) : (
        <article className="points-card">
          <h2>Team Leaderboard</h2>
          <p className="muted">Compare team members by earned points.</p>
          <div className="points-table-wrap">
            <table className="points-table">
              <caption>Team standings</caption>
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Team Member</th>
                  <th scope="col">Points</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={3}>
                    Rankings will appear once points data is connected.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
      )}
    </section>
  )
}

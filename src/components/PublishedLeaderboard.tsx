import { useRef, useState } from 'react'
import { TeamProfileName } from './TeamProfileName'
import { supabase } from '../lib/supabase'

export type Standing = { user_id: string; name: string; total: number; rank: number }
export type LeaderboardPublication = {
  id: string; month: string; published_at: string; standings: Standing[]
}
export function publicationLabel(publication: LeaderboardPublication) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(publication.published_at)) + ' (Central)'
}
function StandingsTable({ rows, caption, locationId }: {
  rows: Standing[]; caption: string; locationId: string
}) {
  return <div className="points-table-wrap"><table className="points-table">
    <caption>{caption}</caption>
    <thead><tr><th scope="col">Rank</th><th scope="col">Team Member</th><th scope="col">Points</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.user_id}><td>{row.rank}</td><td>
      <TeamProfileName userId={row.user_id} locationId={locationId} name={row.name}/>
    </td><td>{row.total}</td></tr>)}</tbody>
  </table></div>
}
export function PublishedLeaderboard({ locationId, month, publication, preview, gm, onPublished }: {
  locationId: string; month: string; publication: LeaderboardPublication | null;
  preview: Standing[]; gm: boolean; onPublished: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const locked = useRef(false)
  async function publish() {
    if (!gm || locked.current || !preview.length) return
    locked.current = true
    setSaving(true); setError(''); setMessage('')
    try {
      const result = await supabase.rpc('publish_points_leaderboard', {
        p_location_id: locationId, p_month: `${month}-01`,
        p_expected_publication: publication?.id ?? null, p_expected_standings: preview,
      })
      if (result.error) throw result.error
      if (!result.data?.id) throw new Error('Publication could not be confirmed. Refresh before trying again.')
      setMessage('Leaderboard published. Staff will see these standings until you publish again.')
      onPublished()
    } catch (e) {
      setError(String((e as { message?: string }).message ?? e))
    } finally { locked.current = false; setSaving(false) }
  }
  return <>
    <h2>Published Team Leaderboard</h2>
    {publication ? <>
      <p>Published {publicationLabel(publication)} · Points month: {publication.month.slice(0, 7)}</p>
      <p className="muted">These standings stay the same until the next publication. Tied totals share a rank.</p>
      <StandingsTable locationId={locationId} rows={publication.standings} caption="Last published standings"/>
    </> : <p>The leaderboard hasn’t been published yet.</p>}
    {gm && <details className="leaderboard-publish">
      <summary>GM: preview and publish leaderboard</summary>
      <p>Private live preview for {month}. Review these standings, then publish your weekly update when you are ready.</p>
      <StandingsTable locationId={locationId} rows={preview} caption={`Private preview · ${month}`}/>
      <button type="button" onClick={onPublished} disabled={saving}>Refresh preview</button>{' '}
      <button type="button" onClick={() => void publish()} disabled={saving || !preview.length}>
        {saving ? 'Publishing…' : 'Publish leaderboard'}
      </button>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </details>}
  </>
}

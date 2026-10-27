import { useRef, useState } from 'react'
import { TeamProfileName } from './TeamProfileName'
import { supabase } from '../lib/supabase'

export type Standing = { user_id: string; name: string; total: number; rank: number }
export type LeaderboardPublication = {
  id: string; month: string; week_start?: string; revision?: number;
  replaces_id?: string | null; published_at: string; standings: Standing[]
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
function currentWeekStart() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? ''
  const central = `${value('year')}-${value('month')}-${value('day')}`
  const day = new Date(`${central}T12:00:00Z`)
  const offset = (day.getUTCDay() + 6) % 7
  day.setUTCDate(day.getUTCDate() - offset)
  return day.toISOString().slice(0, 10)
}
export function PublishedLeaderboard({ locationId, month, publication, preview, manager, onPublished }: {
  locationId: string; month: string; publication: LeaderboardPublication | null;
  preview: Standing[]; manager: boolean; onPublished: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const locked = useRef(false)
  async function publish() {
    if (!manager || locked.current || !preview.length) return
    locked.current = true
    setSaving(true); setError(''); setMessage('')
    try {
      const result = await supabase.rpc('publish_weekly_points_leaderboard', {
        p_location_id: locationId, p_month: `${month}-01`,
        p_week_start: currentWeekStart(),
        p_expected_publication: publication?.id ?? null, p_expected_standings: preview,
      })
      if (result.error) throw result.error
      if (!result.data?.id) throw new Error('Publication could not be confirmed. Refresh before trying again.')
      setMessage(publication?.week_start === currentWeekStart()
        ? 'Replacement leaderboard published. Staff now see the corrected weekly standings.'
        : 'Weekly leaderboard published. Staff now see these standings.')
      onPublished()
    } catch (e) {
      setError(String((e as { message?: string }).message ?? e))
    } finally { locked.current = false; setSaving(false) }
  }
  return <>
    <h2>Published Team Leaderboard</h2>
    {publication ? <>
      <p>{publication.week_start ? `Week of ${publication.week_start}` : `Points month ${publication.month.slice(0, 7)}`} · Published {publicationLabel(publication)}{(publication.revision ?? 1) > 1 ? ` · Replacement ${publication.revision}` : ''}</p>
      <p className="muted">These weekly standings stay frozen until Management publishes a replacement or the next week. Tied totals share a rank.</p>
      <StandingsTable locationId={locationId} rows={publication.standings} caption="Last published standings"/>
    </> : <p>The leaderboard hasn’t been published yet.</p>}
    {manager && <details className="leaderboard-publish">
      <summary>Management: preview and publish weekly rank</summary>
      <p>Private live preview for {month}. Publishing again during the same week creates a replacement and preserves the audit history.</p>
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

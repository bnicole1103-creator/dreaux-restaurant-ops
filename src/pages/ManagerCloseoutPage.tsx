import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'
import { loadLocationTeam } from '../lib/team'
import type { TeamMember } from '../lib/team'
import type { Shift } from '../lib/shifts'
import './ManagerCloseoutPage.css'

type Review = { user_id: string; rating: number; reason: string }
type SavedCloseout = { submitted_by: string; updated_at: string; reviews: Review[] }
function localDate() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const get = (type: string) => parts.find(p => p.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}
function errorMessage(error: unknown) {
  return error && typeof error === 'object' && 'message' in error
    ? String(error.message) : 'Unable to load or save manager closeout.'
}
export function ManagerCloseoutPage() {
  const [locationId, setLocationId] = useState('')
  const [locationName, setLocationName] = useState('')
  const [team, setTeam] = useState<TeamMember[]>([])
  const [date, setDate] = useState(localDate)
  const [shifts, setShifts] = useState<Shift[]>([])
  const [shiftId, setShiftId] = useState('')
  const [reviews, setReviews] = useState<Review[]>([])
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [shiftLoading, setShiftLoading] = useState(false)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [allowed, setAllowed] = useState(false)
  const [canEdit, setCanEdit] = useState(true)
  const [currentUser, setCurrentUser] = useState('')
  const [elevated, setElevated] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true
    async function initialize() {
      try {
        const tenant = await loadTenantData()
        const location = tenant.locations[0]
        if (!location) throw new Error('No active location found.')
        const permission = await supabase.rpc('mod_is_manager', { p_location_id: location.id })
        if (permission.error) throw permission.error
        if (!permission.data) throw new Error('This page is available to managers only.')
        const { data, error: userError } = await supabase.auth.getUser()
        if (userError) throw userError
        if (!data.user) throw new Error('Sign in to continue.')
        const members = await loadLocationTeam(location.id)
        if (!active) return
        setCurrentUser(data.user.id)
        setElevated(['owner', 'general_manager'].includes(members.find(m => m.user_id === data.user?.id)?.role ?? ''))
        setTeam(members.filter(m => m.user_id !== data.user?.id))
        setAllowed(true)
        setLocationId(location.id)
        setLocationName(location.name)
      } catch (e) { if (active) setError(errorMessage(e)) }
      finally { if (active) setLoading(false) }
    }
    void initialize()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!locationId) return
    let active = true
    setShiftLoading(true); setShiftId(''); setShifts([]); setReviews([])
    setConfirmed(false); setMessage(''); setError('')
    void (async () => {
      try {
        const { data, error: queryError } = await supabase.from('shifts')
          .select('id, organization_id, location_id, shift_date, shift_name, status')
          .eq('location_id', locationId).eq('shift_date', date)
          .neq('status', 'cancelled').order('created_at')
        if (queryError) throw queryError
        if (active) setShifts((data ?? []) as Shift[])
      } catch (e) { if (active) setError(errorMessage(e)) }
      finally { if (active) setShiftLoading(false) }
    })()
    return () => { active = false }
  }, [locationId, date])

  useEffect(() => {
    if (!shiftId) return
    let active = true
    setReviewLoading(true); setReviews([]); setConfirmed(false); setMessage(''); setError('')
    void (async () => {
      try {
        const { data, error: queryError } = await supabase.rpc('mod_get_closeout', { p_shift_id: shiftId })
        if (queryError) throw queryError
        const saved = data as SavedCloseout | null
        if (!active) return
        setReviews(saved?.reviews ?? [])
        setCanEdit(!saved || saved.submitted_by === currentUser || elevated)
        if (saved) setMessage('Saved closeout loaded. Changes recalculate points without counting another rating.')
      } catch (e) { if (active) setError(errorMessage(e)) }
      finally { if (active) setReviewLoading(false) }
    })()
    return () => { active = false }
  }, [shiftId, currentUser, elevated])

  function toggle(id: string) {
    setConfirmed(false)
    setReviews(rows => rows.some(r => r.user_id === id)
      ? rows.filter(r => r.user_id !== id) : [...rows, { user_id: id, rating: 0, reason: '' }])
  }
  function update(id: string, patch: Partial<Review>) {
    setMessage(''); setReviews(rows => rows.map(r => r.user_id === id ? { ...r, ...patch } : r))
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setError(''); setMessage('')
    if (!confirmed || !reviews.length || reviews.some(r => !r.rating || !r.reason.trim())) {
      setError('Select all staff who worked, rate each person, explain each rating, and confirm the roster.')
      return
    }
    setSaving(true)
    try {
      const { error: saveError } = await supabase.rpc('mod_submit_closeout', {
        p_shift_id: shiftId, p_reviews: reviews, p_roster_confirmed: confirmed,
      })
      if (saveError) throw saveError
      setMessage('Manager closeout saved. Performance points have been updated.')
    } catch (e) { setError(errorMessage(e)) }
    finally { setSaving(false) }
  }
  if (loading) return <section className="page"><p>Loading manager closeout…</p></section>
  return <section className="mod-page">
    <Link to="/rewards">← Points</Link>
    <p className="eyebrow">MANAGER ONLY</p><h1>Manager Closeout</h1>
    <p>{locationName} · Private shift performance review</p>
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {allowed && <>
      <p className="muted">1–2: −25 per shift · 3–4 twice in a Tuesday–Sunday week: −20 ·
        5–7: meets expectations · 8 twice: +20 · 9–10: +25 per shift.
        The same MOD may submit both ratings on separate shifts.</p>
      <form onSubmit={submit}>
        <fieldset disabled={saving} className="mod-controls">
          <label>Shift date<input type="date" required max={localDate()} value={date}
            onChange={e => setDate(e.target.value)} /></label>
          <label>Shift<select required value={shiftId} disabled={shiftLoading}
            onChange={e => setShiftId(e.target.value)}>
            <option value="">Select a shift</option>
            {shifts.map(s => <option key={s.id} value={s.id}>{s.shift_name} ({s.status})</option>)}
          </select></label>
        </fieldset>
        {shiftLoading && <p>Loading shifts…</p>}
        {!shiftLoading && !shifts.length && <p>No shifts found for this date. Create the shift on the Floor page first.</p>}
        {reviewLoading && <p>Loading private reviews…</p>}
        {shiftId && !reviewLoading && <fieldset disabled={saving || !canEdit}>
          <legend>Staff who worked this shift</legend>
          <p>Select everyone you supervised. Your own rating is completed by another manager.</p>
          {Array.from(new Set([...team.map(m => m.user_id), ...reviews.map(r => r.user_id)])).map(id => {
            const member = team.find(m => m.user_id === id)
            const review = reviews.find(r => r.user_id === id)
            const name = member?.profile?.preferred_name || member?.profile?.full_name || 'Former team member'
            return <article className="mod-review" key={id}>
              <label className="mod-check"><input type="checkbox" checked={!!review}
                onChange={() => toggle(id)} />{name}{member ? ` · ${member.role.replace(/_/g, ' ')}` : ''}</label>
              {review && <div className="mod-fields">
                <label>Rating for {name}<select required value={review.rating || ''}
                  onChange={e => update(id, { rating: Number(e.target.value) })}>
                  <option value="">Select 1–10</option>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}
                </select></label>
                <label>Why? (private)<textarea required maxLength={2000} rows={3} value={review.reason}
                  onChange={e => update(id, { reason: e.target.value })}
                  placeholder="Describe specific actions or examples from this shift." /></label>
              </div>}
            </article>
          })}
          <label className="mod-check"><input type="checkbox" required checked={confirmed}
            onChange={e => setConfirmed(e.target.checked)} />I included everyone I supervised who worked this shift.</label>
          <button type="submit" disabled={!reviews.length || !confirmed}>{saving ? 'Saving…' : 'Submit Manager Closeout'}</button>
        </fieldset>}
        {shiftId && !reviewLoading && !canEdit && <p>Only the submitting MOD, owner, or GM can edit this saved closeout.</p>}
      </form>
    </>}
  </section>
}

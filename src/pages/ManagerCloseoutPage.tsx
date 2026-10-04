import { submissionLabel } from '../lib/submissionTime'
import { CloseoutQuestions, useCloseoutConfig, checkAnswers, questionLabel } from '../components/CloseoutConfig'
import type { Answers, Question } from '../components/CloseoutConfig'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'
import { loadLocationTeam } from '../lib/team'
import type { TeamMember } from '../lib/team'
import type { Shift } from '../lib/shifts'
import './ManagerCloseoutPage.css'

type Review = { user_id: string; rating: number; reason: string; category?: string }
function splitReason(reason: string) {
 const match = /^Category: ([^\n]+)(?:\n([\s\S]*))?$/.exec(reason)
 return match ? {category: match[1], reason: match[2] ?? ''} : {category: '', reason}
}
type SavedCloseout = { submitted_by: string; updated_at: string; reviews: Review[]; cash_deposit: number | null; cash_left_at: string | null; register_balanced: boolean | null; register_difference: number | null; register_notes: string | null }
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
  const { config, error: configError } = useCloseoutConfig(locationId)
  const [answers, setAnswers] = useState<Answers>({})
  const [savedQuestions, setSavedQuestions] = useState<Question[]>([])
  const [locationName, setLocationName] = useState('')
  const [team, setTeam] = useState<TeamMember[]>([])
  const [date, setDate] = useState(localDate)
  const [shifts, setShifts] = useState<Shift[]>([])
  const [shiftId, setShiftId] = useState('')
  const [creatingShift, setCreatingShift] = useState(false)
  const [reviews, setReviews] = useState<Review[]>([])
  const [shiftMvp, setShiftMvp] = useState('')
  const categories = [...new Set([...(config?.rules.filter(r => r.active).map(r => r.category.trim().replace(/\s+/g, ' ')).filter(Boolean) ?? []), 'Other'])]
  const [deposit, setDeposit] = useState('')
  const [cashLeft, setCashLeft] = useState('')
  const [balanced, setBalanced] = useState('')
  const [difference, setDifference] = useState('')
  const [cashNotes, setCashNotes] = useState('')
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
  const [stamp,setStamp]=useState<{submitted_at:string;updated_at:string}|null>(null)

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
    setStamp(null); setShiftLoading(true); setShiftId(''); setShifts([]); setReviews([]); setShiftMvp('')
    setConfirmed(false); setMessage(''); setError('')
    setAnswers({}); setSavedQuestions([]); setDeposit(''); setCashLeft(''); setBalanced(''); setDifference(''); setCashNotes('')
    void (async () => {
      try {
        const { data, error: queryError } = await supabase.from('shifts')
          .select('id, organization_id, location_id, shift_date, shift_name, status')
          .eq('location_id', locationId).eq('shift_date', date)
          .neq('status', 'cancelled').order('created_at')
        if (queryError) throw queryError
        if (active) { const rows = (data ?? []) as Shift[]; setShifts(rows); if(rows.length === 1) setShiftId(rows[0].id) }
      } catch (e) { if (active) setError(errorMessage(e)) }
      finally { if (active) setShiftLoading(false) }
    })()
    return () => { active = false }
  }, [locationId, date])

  useEffect(() => {
    if (!shiftId) return
    let active = true
    setAnswers({}); setSavedQuestions([]); setDeposit(''); setCashLeft(''); setBalanced(''); setDifference(''); setCashNotes('')
    setStamp(null); setReviewLoading(true); setReviews([]); setShiftMvp(''); setConfirmed(false); setMessage(''); setError('')
    void (async () => {
      try {
        const { data, error: queryError } = await supabase.rpc('mod_get_closeout', { p_shift_id: shiftId })
        if (queryError) throw queryError
        const extra = await supabase.rpc('closeout_manager_answers', { p_shift_id: shiftId })
        if (extra.error) throw extra.error
        const timestamp=await supabase.rpc('closeout_manager_submission',{p_shift_id:shiftId})
        if(timestamp.error)throw timestamp.error
        const saved = data as SavedCloseout | null
        if (!active) return
        setStamp(timestamp.data)
        setAnswers(extra.data?.answers ?? {})
        setSavedQuestions(extra.data?.questions ?? [])
        setReviews((saved?.reviews ?? []).map(r => ({...r, ...splitReason(r.reason)})))
        setShiftMvp(extra.data?.shift_mvp ?? '')
        setDeposit(saved?.cash_deposit != null ? String(saved.cash_deposit) : '')
        setCashLeft(saved?.cash_left_at ?? '')
        setBalanced(saved?.register_balanced == null ? '' : saved.register_balanced ? 'yes' : 'no')
        setDifference(saved?.register_difference != null ? String(saved.register_difference) : '')
        setCashNotes(saved?.register_notes ?? '')
        setCanEdit(!saved || saved.submitted_by === currentUser || elevated)
        if (saved) setMessage('Saved closeout loaded. Changes recalculate points without counting another rating.')
      } catch (e) { if (active) setError(errorMessage(e)) }
      finally { if (active) setReviewLoading(false) }
    })()
    return () => { active = false }
  }, [shiftId, currentUser, elevated])

  async function addShift(newShiftName: string) {
    const requestedDate = date
    if(creatingShift || !newShiftName.trim()) return
    setCreatingShift(true); setError('')
    try {
      const {data, error} = await supabase.rpc('closeout_create_shift', {
        p_location_id: locationId, p_date: requestedDate, p_name: newShiftName.trim()
      })
      if(error) throw error
      const shift = data as Shift
      setShifts(rows => rows.some(row => row.id === shift.id) ? rows : [...rows, shift])
      setShiftId(shift.id)
    } catch(e) { setError(errorMessage(e)) }
    finally { setCreatingShift(false) }
  }
  function toggle(id: string) {
    setConfirmed(false)
    if (shiftMvp === id) setShiftMvp('')
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
    if (!confirmed || !reviews.length || reviews.some(r => !r.rating || !r.category?.trim())) {
      setError('Select all staff who worked, rate each person, choose a reason category, and confirm the roster.')
      return
    }
    if (!deposit.trim() || !Number.isFinite(Number(deposit)) || Number(deposit) < 0 ||
      !cashLeft.trim() || !balanced || (balanced === 'no' &&
        (!difference.trim() || !Number.isFinite(Number(difference)) || Number(difference) === 0 || !cashNotes.trim()))) {
      setError('Enter the cash deposit, where it was left, and whether the register balanced. Explain any shortage or overage.')
      return
    }
    setSaving(true)
    try {
      const customAnswers = {...checkAnswers(config, 'manager', answers), _shift_mvp: shiftMvp}
      const submittedReviews = reviews.map(r => ({user_id: r.user_id, rating: r.rating, reason: `Category: ${r.category}\n${r.reason.trim()}`}))
      if (submittedReviews.some(r => r.reason.length > 2000)) throw new Error('Shorten the rating notes to fit 2,000 characters with the category.')
      const { error: saveError } = await supabase.rpc('mod_submit_closeout', {
        p_answers: customAnswers, p_shift_id: shiftId, p_reviews: submittedReviews, p_roster_confirmed: confirmed,
        p_cash_deposit: Number(deposit), p_cash_left_at: cashLeft.trim(),
        p_register_balanced: balanced === 'yes',
        p_register_difference: balanced === 'yes' ? 0 : Number(difference),
        p_register_notes: cashNotes.trim(),
      })
      if (saveError) throw saveError
      // The save succeeded. Clear the form before loading the optional receipt.
      setShiftId('')
      setReviews([])
      setShiftMvp('')
      setAnswers({})
      setSavedQuestions([])
      setDeposit('')
      setCashLeft('')
      setBalanced('')
      setDifference('')
      setCashNotes('')
      setConfirmed(false)
      setCanEdit(true)
      setStamp(null)
      setMessage('Manager closeout saved. Performance points have been updated. Select a shift to start another closeout or reopen a saved one.')
      try {
        const timestamp=await supabase.rpc('closeout_manager_submission',{p_shift_id:shiftId})
        if (!timestamp.error && timestamp.data?.submitted_at) {
          setMessage(`Manager closeout saved. Submitted: ${submissionLabel(timestamp.data.submitted_at)}. Performance points have been updated. Select a shift to start another closeout or reopen a saved one.`)
        }
      } catch {
        // A receipt lookup failure must not turn a successful save into an error.
      }
    } catch (e) { setError(errorMessage(e)) }
    finally { setSaving(false) }
  }
  if (loading) return <section className="page"><p>Loading manager closeout…</p></section>
  return <section className="mod-page">
    <Link to="/closeout">← Closeout</Link>
    <p className="eyebrow">MANAGER ONLY</p><h1>Manager Closeout</h1>
    <p>{locationName} · Private shift performance review</p>
    {configError && <p role="alert">{configError}</p>}
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {stamp && <p>Submitted: {submissionLabel(stamp.submitted_at)}{stamp.updated_at!==stamp.submitted_at && <> · Last updated: {submissionLabel(stamp.updated_at)}</>}</p>}
    {allowed && <>
      <form onSubmit={submit}>
        <fieldset disabled={saving || creatingShift} className="mod-controls">
          <label>Shift date<input type="date" required max={localDate()} value={date}
            onChange={e => setDate(e.target.value)} /></label>
          <label>Shift<select required value={shiftId} disabled={shiftLoading}
            onChange={e => { const value = e.target.value; if(value.startsWith("new:")) void addShift(value.slice(4)); else setShiftId(value) }}>
            <option value="">Select a shift</option>
            {shifts.map(s => <option key={s.id} value={s.id}>{s.shift_name}</option>)}
            {["Brunch", "Lunch", "Dinner", "Full Day"].filter(name => !shifts.some(s => s.shift_name.toLowerCase() === name.toLowerCase())).map(name => <option key={name} value={`new:${name}`}>{name} — create shift</option>)}
          </select></label>
        </fieldset>
        {shiftLoading && <p>Loading shifts…</p>}
        {creatingShift && <p>Creating shift…</p>}
        {reviewLoading && <p>Loading private reviews…</p>}
        {shiftId && !reviewLoading && <fieldset disabled={saving || !canEdit}>
          <legend>Shift closeout</legend>
          <h2>Staff who worked this shift</h2>
          <p>Select everyone you supervised. Your own rating is completed by another manager.</p>
          <label>Add staff member<select value="" onChange={e => {if(e.target.value) toggle(e.target.value)}}>
            <option value="">Select staff who worked this shift</option>
            {team.filter(m => !reviews.some(r => r.user_id === m.user_id)).map(m => <option key={m.user_id} value={m.user_id}>{m.profile?.preferred_name || m.profile?.full_name || 'Team member'} · {m.role.replace(/_/g, ' ')}</option>)}
          </select></label>
          {reviews.map(review => {
            const id = review.user_id
            const member = team.find(m => m.user_id === id)
            const name = member?.profile?.preferred_name || member?.profile?.full_name || 'Former team member'
            return <article className="mod-review" key={id}><h3>{name}</h3>
              <button type="button" onClick={() => toggle(id)}>Remove from this shift</button>
              <div className="mod-fields">
                <label>{questionLabel(config, 'rating', 'Rating')} · {name}<select required value={review.rating || ''}
                  onChange={e => update(id, { rating: Number(e.target.value) })}>
                  <option value="">Select 1–10</option>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}
                </select></label>
                <label>{questionLabel(config, 'rating_reason', 'Why this rating?')}<select required value={review.category ?? ''}
                  onChange={e => update(id, {category: e.target.value})}>
                  <option value="">Choose a category</option>
                  {review.category && !categories.includes(review.category) && <option value={review.category}>{review.category} (saved category)</option>}
                  {categories.map(category => <option key={category} value={category}>{category}</option>)}
                </select></label>
                <label>Specific examples (optional, private)<textarea maxLength={1800} rows={3} value={review.reason}
                  onChange={e => update(id, { reason: e.target.value })}
                  placeholder="Add context about this employee’s shift." /></label>
              </div>
            </article>
          })}
          <article className="mod-review"><h2>Shift MVP</h2>
            <label>Who stood out this shift? (optional)<select value={shiftMvp} onChange={e => setShiftMvp(e.target.value)}>
              <option value="">No MVP selected</option>
              {reviews.map(r => { const m = team.find(member => member.user_id === r.user_id); return <option key={r.user_id} value={r.user_id}>{m?.profile?.preferred_name || m?.profile?.full_name || 'Team member'}</option> })}
            </select></label>
          </article>
          <h2>Cash deposit &amp; register</h2>
          <div className="mod-fields">
            <label>{questionLabel(config, 'deposit', "Cash deposit amount ($)")}<input required type="number" min="0" max="999999999.99" step="0.01"
              value={deposit} onChange={e => setDeposit(e.target.value)} /></label>
            <label>{questionLabel(config, 'cash_left', "Where was the cash left?")}<input required maxLength={500} value={cashLeft}
              onChange={e => setCashLeft(e.target.value)} placeholder="Location and bag or envelope reference" /></label>
            <label>{questionLabel(config, 'balanced', "Was the register balanced?")}<select required value={balanced}
              onChange={e => { setBalanced(e.target.value); setDifference(''); setCashNotes('') }}>
              <option value="">Select an answer</option><option value="yes">Yes</option><option value="no">No</option>
            </select></label>
            {balanced === 'no' && <>
              <label>{questionLabel(config, 'difference', "Register difference ($)")}<input required type="number" step="0.01" min="-999999999.99" max="999999999.99"
                value={difference} onChange={e => setDifference(e.target.value)} />
                <small>Negative for a shortage; positive for an overage.</small></label>
              <label>{questionLabel(config, 'cash_notes', "Explain the difference")}<textarea required rows={3} maxLength={2000} value={cashNotes}
                onChange={e => setCashNotes(e.target.value)} /></label>
            </>}
          </div>
          <CloseoutQuestions config={config} audience="manager" answers={answers} onChange={setAnswers} />
          {savedQuestions.some(q => !config?.questions.some(current => current.id === q.id && current.active && current.label === q.label)) && <article className="mod-review"><h2>Archived answers from this closeout</h2>
            {savedQuestions.filter(q => !config?.questions.some(current => current.id === q.id && current.active && current.label === q.label)).map(q => <p key={q.id}>{q.label}: {answers[q.id] || 'No answer'}</p>)}
          </article>}
          <label className="mod-check"><input type="checkbox" required checked={confirmed}
            onChange={e => setConfirmed(e.target.checked)} />I included everyone I supervised who worked this shift.</label>
          <button type="submit" disabled={!reviews.length || !confirmed}>{saving ? 'Saving…' : 'Submit Manager Closeout'}</button>
        </fieldset>}
        {shiftId && !reviewLoading && !canEdit && <p>Only the submitting MOD, owner, or GM can edit this saved closeout.</p>}
      </form>
    </>}
  </section>
}



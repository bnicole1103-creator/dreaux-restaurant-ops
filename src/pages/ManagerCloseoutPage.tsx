import { ScreenText } from "../components/ScreenText"
import './ManagerRatingGuide.css'
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
  if (loading) return <section className="page"><p><ScreenText id="ManagerCloseoutPage.09310404aab17db7">Loading manager closeout…</ScreenText></p></section>
  return <section className="mod-page">
    <Link to="/closeout"><ScreenText id="ManagerCloseoutPage.84dae12b44d2a1b4">← Closeout</ScreenText></Link>
    <p className="eyebrow"><ScreenText id="ManagerCloseoutPage.1fd28e8b873fc628">MANAGER ONLY</ScreenText></p><h1><ScreenText id="ManagerCloseoutPage.adb158d73c5ee404">Manager Closeout</ScreenText></h1>
    <p>{locationName}<ScreenText id="ManagerCloseoutPage.b0bdef3954084e4a"> · Private shift performance review</ScreenText></p>
    {configError && <p role="alert">{configError}</p>}
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {stamp && <p><ScreenText id="ManagerCloseoutPage.77476d75d9140c97">Submitted: </ScreenText>{submissionLabel(stamp.submitted_at)}{stamp.updated_at!==stamp.submitted_at && <><ScreenText id="ManagerCloseoutPage.d5bb16ce999eef86"> · Last updated: </ScreenText>{submissionLabel(stamp.updated_at)}</>}</p>}
    {allowed && <>
      <form onSubmit={submit}>
        <fieldset disabled={saving || creatingShift} className="mod-controls">
          <label><ScreenText id="ManagerCloseoutPage.2202e5e40ee243a8">Shift date</ScreenText><input type="date" required max={localDate()} value={date}
            onChange={e => setDate(e.target.value)} /></label>
          <label><ScreenText id="ManagerCloseoutPage.157828d4940d9702">Shift</ScreenText><select required value={shiftId} disabled={shiftLoading}
            onChange={e => { const value = e.target.value; if(value.startsWith("new:")) void addShift(value.slice(4)); else setShiftId(value) }}>
            <option value=""><ScreenText id="ManagerCloseoutPage.2e2d17cc21484d52">Select a shift</ScreenText></option>
            {shifts.map(s => <option key={s.id} value={s.id}>{s.shift_name}</option>)}
            {["Brunch", "Lunch", "Dinner", "Full Day"].filter(name => !shifts.some(s => s.shift_name.toLowerCase() === name.toLowerCase())).map(name => <option key={name} value={`new:${name}`}>{name}<ScreenText id="ManagerCloseoutPage.c0165ed6e7811073"> — create shift</ScreenText></option>)}
          </select></label>
        </fieldset>
        {shiftLoading && <p><ScreenText id="ManagerCloseoutPage.04eecb585c2af027">Loading shifts…</ScreenText></p>}
        {creatingShift && <p><ScreenText id="ManagerCloseoutPage.b2e1bb32e9d242cc">Creating shift…</ScreenText></p>}
        {reviewLoading && <p><ScreenText id="ManagerCloseoutPage.779a089a26f12e4c">Loading private reviews…</ScreenText></p>}
        {shiftId && !reviewLoading && <fieldset disabled={saving || !canEdit}>
          <legend><ScreenText id="ManagerCloseoutPage.30ab09d20fac2ce2">Shift closeout</ScreenText></legend>
          <section className="mod-rating-guide" aria-labelledby="rating-guide-heading">
            <h2 id="rating-guide-heading"><ScreenText id="ManagerCloseoutPage.f5960a21b5ce2a31">Staff ratings · What the numbers mean</ScreenText></h2>
            <dl>
              <div><dt>1–2</dt><dd><ScreenText id="ManagerCloseoutPage.c862fd8a7e1bf3aa">Immediate intervention needed</ScreenText></dd></div>
              <div><dt>3–4</dt><dd><ScreenText id="ManagerCloseoutPage.3378174a42e4b2c1">Poor performance · Needs coaching</ScreenText></dd></div>
              <div><dt>5–7</dt><dd><ScreenText id="ManagerCloseoutPage.5ec953daa38e3a61">Meets expectations</ScreenText></dd></div>
              <div><dt>8</dt><dd><ScreenText id="ManagerCloseoutPage.785e74a9f555fab6">Above expectations</ScreenText></dd></div>
              <div><dt>9–10</dt><dd><ScreenText id="ManagerCloseoutPage.cba738c03149ce2e">Excellent performance</ScreenText></dd></div>
            </dl>
            <p><ScreenText id="ManagerCloseoutPage.d1a53be6c6a73c3b">Ratings and review notes are visible to managers only. Employees see a points adjustment only when an existing point rule applies.</ScreenText></p>
          </section>
          <h2><ScreenText id="ManagerCloseoutPage.1a185e0991f763b1">Staff who worked this shift</ScreenText></h2>
          <p><ScreenText id="ManagerCloseoutPage.1f37c15a83ce909b">Select everyone you supervised. Your own rating is completed by another manager.</ScreenText></p>
          <label><ScreenText id="ManagerCloseoutPage.ac046e18262bb92f">Add staff member</ScreenText><select value="" onChange={e => {if(e.target.value) toggle(e.target.value)}}>
            <option value=""><ScreenText id="ManagerCloseoutPage.fb3cb81aca03408d">Select staff who worked this shift</ScreenText></option>
            {team.filter(m => !reviews.some(r => r.user_id === m.user_id)).map(m => <option key={m.user_id} value={m.user_id}>{m.profile?.preferred_name || m.profile?.full_name || 'Team member'} · {m.role.replace(/_/g, ' ')}</option>)}
          </select></label>
          {reviews.map(review => {
            const id = review.user_id
            const member = team.find(m => m.user_id === id)
            const name = member?.profile?.preferred_name || member?.profile?.full_name || 'Former team member'
            return <article className="mod-review" key={id}><h3>{name}</h3>
              <button type="button" onClick={() => toggle(id)}><ScreenText id="ManagerCloseoutPage.81883b17a3fea7ca">Remove from this shift</ScreenText></button>
              <div className="mod-fields">
                <label>{questionLabel(config, 'rating', 'Rating')} · {name}<select required value={review.rating || ''}
                  onChange={e => update(id, { rating: Number(e.target.value) })}>
                  <option value=""><ScreenText id="ManagerCloseoutPage.b025205640aa1910">Select 1–10</ScreenText></option>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n} · {n <= 2 ? 'Immediate intervention' : n <= 4 ? 'Needs coaching' : n <= 7 ? 'Meets expectations' : n === 8 ? 'Above expectations' : 'Excellent'}</option>)}
                </select></label>
                <label>{questionLabel(config, 'rating_reason', 'Why this rating?')}<select required value={review.category ?? ''}
                  onChange={e => update(id, {category: e.target.value})}>
                  <option value=""><ScreenText id="ManagerCloseoutPage.c3683f3872b7cbbd">Choose a category</ScreenText></option>
                  {review.category && !categories.includes(review.category) && <option value={review.category}>{review.category}<ScreenText id="ManagerCloseoutPage.8adb3b5f65f15041"> (saved category)</ScreenText></option>}
                  {categories.map(category => <option key={category} value={category}>{category}</option>)}
                </select></label>
                <label><ScreenText id="ManagerCloseoutPage.72dd478ce861585f">Specific examples (optional, private)</ScreenText><textarea maxLength={1800} rows={3} value={review.reason}
                  onChange={e => update(id, { reason: e.target.value })}
                  placeholder="Add context about this employee’s shift." /></label>
              </div>
            </article>
          })}
          <article className="mod-review"><h2><ScreenText id="ManagerCloseoutPage.7b278dbffcc825b9">Shift MVP</ScreenText></h2>
            <label><ScreenText id="ManagerCloseoutPage.ccfeac4132cad92f">Who stood out this shift? (optional)</ScreenText><select value={shiftMvp} onChange={e => setShiftMvp(e.target.value)}>
              <option value=""><ScreenText id="ManagerCloseoutPage.fb73f0c0d429ce03">No MVP selected</ScreenText></option>
              {reviews.map(r => { const m = team.find(member => member.user_id === r.user_id); return <option key={r.user_id} value={r.user_id}>{m?.profile?.preferred_name || m?.profile?.full_name || 'Team member'}</option> })}
            </select></label>
          </article>
          <h2><ScreenText id="ManagerCloseoutPage.a8a2758d60a53a18">Cash deposit &amp; register</ScreenText></h2>
          <div className="mod-fields">
            <label>{questionLabel(config, 'deposit', "Cash deposit amount ($)")}<input required type="number" min="0" max="999999999.99" step="0.01"
              value={deposit} onChange={e => setDeposit(e.target.value)} /></label>
            <label>{questionLabel(config, 'cash_left', "Where was the cash left?")}<input required maxLength={500} value={cashLeft}
              onChange={e => setCashLeft(e.target.value)} placeholder="Location and bag or envelope reference" /></label>
            <label>{questionLabel(config, 'balanced', "Was the register balanced?")}<select required value={balanced}
              onChange={e => { setBalanced(e.target.value); setDifference(''); setCashNotes('') }}>
              <option value=""><ScreenText id="ManagerCloseoutPage.de994e02cc2dd028">Select an answer</ScreenText></option><option value="yes"><ScreenText id="ManagerCloseoutPage.fb445af8657396a2">Yes</ScreenText></option><option value="no"><ScreenText id="ManagerCloseoutPage.c8ab7d6d4e30b2d9">No</ScreenText></option>
            </select></label>
            {balanced === 'no' && <>
              <label>{questionLabel(config, 'difference', "Register difference ($)")}<input required type="number" step="0.01" min="-999999999.99" max="999999999.99"
                value={difference} onChange={e => setDifference(e.target.value)} />
                <small><ScreenText id="ManagerCloseoutPage.7fda744786eba784">Negative for a shortage; positive for an overage.</ScreenText></small></label>
              <label>{questionLabel(config, 'cash_notes', "Explain the difference")}<textarea required rows={3} maxLength={2000} value={cashNotes}
                onChange={e => setCashNotes(e.target.value)} /></label>
            </>}
          </div>
          <CloseoutQuestions config={config} audience="manager" answers={answers} onChange={setAnswers} />
          {savedQuestions.some(q => !config?.questions.some(current => current.id === q.id && current.active && current.label === q.label)) && <article className="mod-review"><h2><ScreenText id="ManagerCloseoutPage.b8bb83d7f397b820">Archived answers from this closeout</ScreenText></h2>
            {savedQuestions.filter(q => !config?.questions.some(current => current.id === q.id && current.active && current.label === q.label)).map(q => <p key={q.id}>{q.label}: {answers[q.id] || 'No answer'}</p>)}
          </article>}
          <label className="mod-check"><input type="checkbox" required checked={confirmed}
            onChange={e => setConfirmed(e.target.checked)} /><ScreenText id="ManagerCloseoutPage.9978865bd56536f3">I included everyone I supervised who worked this shift.</ScreenText></label>
          <button type="submit" disabled={!reviews.length || !confirmed}>{saving ? 'Saving…' : 'Submit Manager Closeout'}</button>
        </fieldset>}
        {shiftId && !reviewLoading && !canEdit && <p><ScreenText id="ManagerCloseoutPage.30caf0d1c89056fc">Only the submitting MOD, owner, or GM can edit this saved closeout.</ScreenText></p>}
      </form>
    </>}
  </section>
}

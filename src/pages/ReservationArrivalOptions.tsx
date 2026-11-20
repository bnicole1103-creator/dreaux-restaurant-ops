import { TimeInput12 } from '../components/TimeInput12'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { time12 } from '../lib/time12'
import { arrivalClockValue } from '../lib/inquiryArrivalOptions'

type Offer = { can_request?: boolean; time?: string; min_day?: string; max_day?: string; request_kind?: string; requested_day?: string; requested_time?: string; day: string; party: number; selected: string | null; booked: boolean; options: string[] }
const clock = (value: string) => time12(arrivalClockValue(new Date(value)))
const dayLabel = (value: string) => new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric',
}).format(new Date(value + 'T12:00:00Z'))

export function ReservationArrivalOptions() {
  const [offer, setOffer] = useState<Offer | null>(null)
  const [requestKind, setRequestKind] = useState<'date' | 'waitlist' | null>(null)
  const [day, setDay] = useState('')
  const [time, setTime] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [choice, setChoice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? ''

  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve(supabase.rpc('inquiry_guest_followup', { p_token: token })
      .abortSignal(AbortSignal.any([controller.signal, AbortSignal.timeout(15000)])))
      .then(result => {
        if (controller.signal.aborted) return
        if (result.error) setError(result.error.message.startsWith('This arrival link is unavailable')
          ? 'This reservation link is unavailable.' : result.error.message)
        else setOffer(result.data)
      }).catch(() => {
        if (!controller.signal.aborted) setError('Could not load your options. Reopen your link to try again.')
      })
    return () => controller.abort()
  }, [token])

  async function select(action: 'arrival' | 'date' | 'waitlist') {
    if (lock.current || (action === 'arrival' ? !choice : !day || !time || !name.trim() || !phone.trim())) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const result = await supabase.rpc('inquiry_guest_followup', {
        p_token: token, p_action: action, ...(action === 'arrival'
          ? {p_arrival: choice} : {p_day: day, p_time: time, p_name: name, p_phone: phone}),
      }).abortSignal(AbortSignal.timeout(15000))
      if (result.error) throw result.error
      setOffer(result.data)
    } catch (caught) {
      const message = (caught as Error).message
      if (message.startsWith('That time is no longer available')) {
        setOffer(previous => previous && { ...previous, options: [] })
        setChoice('')
      } else {
        setError(message)
      }
    } finally {
      setBusy(false)
      lock.current = false
    }
  }

  return <main className="page" style={{ maxWidth: 640, margin: '24px auto', padding: 24 }}>
    <h1>Reservation options at JusTini’s</h1>
    {offer && <p>{dayLabel(offer.day)} · {offer.party} {offer.party === 1 ? 'guest' : 'guests'} · New Orleans time</p>}
    {error && <p role="alert">{error}</p>}
    {!offer && !error && <p role="status">Checking arrival options…</p>}
    {offer?.booked ? <p role="status">This inquiry already has a booking.</p>
      : offer?.selected ? <p role="status">We received your selection for <strong>{clock(offer.selected)}</strong>. JusTini’s will review it and follow up to complete your reservation.</p>
      : offer?.request_kind && offer.requested_day && offer.requested_time
      ? <p role="status">{offer.request_kind === 'waitlist' ? 'You joined the waitlist for ' : 'We received your request for '}{dayLabel(offer.requested_day)} at {time12(offer.requested_time)}. We’ll contact you if we can offer a reservation.</p>
      : offer && <>
      {offer.options.length > 0 && <>
        <p>Your requested times are unavailable. Choose an alternate time and we’ll review your request.</p>
        <form onSubmit={event => { event.preventDefault(); void select('arrival') }}>
          <fieldset disabled={busy}>
            <legend>Arrival times</legend>
            {offer.options.map((option, index) => <label key={option} style={{ display: 'block', padding: '12px 0' }}>
              <input type="radio" name="arrival" required value={option}
                checked={choice === option} onChange={() => setChoice(option)} /> {clock(option)}{index === 0 ? ' · Next available' : ''}
            </label>)}
            <button type="submit" className="primary-button" disabled={!choice || busy}>{busy ? 'Sending…' : 'Send my selection'}</button>
          </fieldset>
        </form>
      </>}
      {offer.can_request ? <>
        {!offer.options.length && <p>Your requested times are unavailable.</p>}
        <div className="feed-actions">
          <button type="button" disabled={busy} aria-pressed={requestKind === 'date'} onClick={() => {
            setError(''); setRequestKind('date'); if (day === offer.day) setDay('')
          }}>Pick another date</button>
          <button type="button" disabled={busy} aria-pressed={requestKind === 'waitlist'} onClick={() => {
            setError(''); setRequestKind('waitlist')
            if (!day && (!offer.min_day || offer.day >= offer.min_day)) setDay(offer.day)
            if (!time) setTime(offer.time?.slice(0, 5) ?? '')
          }}>Join the waitlist</button>
        </div>
        {requestKind && <form onSubmit={event => { event.preventDefault(); void select(requestKind) }}>
          <fieldset disabled={busy}>
            <legend>{requestKind === 'waitlist' ? 'Waitlist request' : 'Request another date'}</legend>
            <label>Preferred date<input type="date" required min={offer.min_day} max={offer.max_day} value={day} onChange={event => setDay(event.target.value)}/></label>
            {requestKind === 'date' && day === offer.day && <p>Choose a different date.</p>}
            <label>Preferred time<TimeInput12 required value={time} onChange={event => setTime(event.target.value)}/></label>
            <label>Name<input autoComplete="name" required maxLength={200} value={name} onChange={event => setName(event.target.value)}/></label>
            <label>Phone number<input type="tel" autoComplete="tel" required maxLength={100} value={phone} onChange={event => setPhone(event.target.value)}/></label>
            <p>We’ll review your request and send you a link if we can offer a reservation.</p>
            <button type="submit" className="primary-button" disabled={busy || !time || (requestKind === 'date' && day === offer.day)}>
              {busy ? 'Submitting…' : requestKind === 'waitlist' ? 'Join waitlist' : 'Submit date request'}
            </button>
          </fieldset>
        </form>}
      </> : !offer.options.length && <p role="status">These arrival options are no longer available.</p>}
      </>}
    <p><a href="/privacy">Privacy Policy</a></p>
  </main>
}

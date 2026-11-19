import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { time12 } from '../lib/time12'
import { arrivalClockValue } from '../lib/inquiryArrivalOptions'

type Offer = { day: string; party: number; selected: string | null; booked: boolean; options: string[] }
const clock = (value: string) => time12(arrivalClockValue(new Date(value)))
const dayLabel = (value: string) => new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric',
}).format(new Date(value + 'T12:00:00Z'))

export function ReservationArrivalOptions() {
  const [offer, setOffer] = useState<Offer | null>(null)
  const [choice, setChoice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? ''

  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve(supabase.rpc('inquiry_arrival_offer_guest', { p_token: token })
      .abortSignal(AbortSignal.any([controller.signal, AbortSignal.timeout(15000)])))
      .then(result => {
        if (controller.signal.aborted) return
        if (result.error) setError(result.error.message)
        else setOffer(result.data)
      }).catch(() => {
        if (!controller.signal.aborted) setError('Could not load your options. Reopen your link to try again.')
      })
    return () => controller.abort()
  }, [token])

  async function select() {
    if (!choice || lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const result = await supabase.rpc('inquiry_arrival_offer_guest', {
        p_token: token, p_arrival: choice,
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
    <h1>Choose another time at JusTini’s</h1>
    {offer && <p>{dayLabel(offer.day)} · {offer.party} {offer.party === 1 ? 'guest' : 'guests'} · New Orleans time</p>}
    {error && <p role="alert">{error}</p>}
    {!offer && !error && <p role="status">Checking arrival options…</p>}
    {offer?.booked ? <p role="status">This inquiry already has a booking. Reply to JusTini’s if you need to make a change.</p>
      : offer?.selected ? <p role="status">We received your selection for <strong>{clock(offer.selected)}</strong>. JusTini’s will review it and follow up to complete your reservation.</p>
      : offer && (offer.options.length ? <>
        <p>Your requested times are unavailable. Choose an alternate time and we’ll review your request.</p>
        <form onSubmit={event => { event.preventDefault(); void select() }}>
          <fieldset disabled={busy}>
            <legend>Arrival times</legend>
            {offer.options.map((option, index) => <label key={option} style={{ display: 'block', padding: '12px 0' }}>
              <input type="radio" name="arrival" required value={option}
                checked={choice === option} onChange={() => setChoice(option)} /> {clock(option)}{index === 0 ? ' · Next available' : ''}
            </label>)}
            <button type="submit" className="primary-button" disabled={!choice || busy}>{busy ? 'Sending…' : 'Send my selection'}</button>
          </fieldset>
        </form>
      </> : <p role="status">These options expired or availability changed. Please reply to JusTini’s for updated times.</p>)}
    <p><a href="/privacy">Privacy Policy</a></p>
  </main>
}

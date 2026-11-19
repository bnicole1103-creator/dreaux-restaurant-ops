import { useEffect, useRef, useState } from 'react'
import type { InquiryReservationSource } from './InquiryReservationDialog'
import { nextInquiryArrivals, arrivalClockValue } from '../lib/inquiryArrivalOptions'
import { time12 } from '../lib/time12'
import { confirmationOrigin } from '../lib/reservationConfirmation'
import { messageComposerUrl } from '../lib/messageComposer'
import { supabase } from '../lib/supabase'

type Selection = { day: string; arrival: string }

export function InquiryArrivalOffer({ location, inquiry, onUse }: {
  location: string
  inquiry: InquiryReservationSource
  onUse?: (day: string, time: string) => void
}) {
  const [selection, setSelection] = useState<Selection | null>(null)
  const [offer, setOffer] = useState<{ link: string; arrivals: number[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const lock = useRef(false)
  const args = { p_location: location, p_source: inquiry.source, p_inquiry: inquiry.id }
  const guests = Number(inquiry.guests)
  const canOffer = /^\d{4}-\d{2}-\d{2}$/.test(inquiry.date) && Number.isInteger(guests) && guests >= 1 && guests <= 500

  useEffect(() => {
    let active = true
    async function refresh() {
      try {
        const result = await supabase.rpc('inquiry_arrival_offer_selection', args).abortSignal(AbortSignal.timeout(10000))
        if (active && !result.error) setSelection(result.data)
      } catch {
        // A temporary refresh failure does not erase the last known selection.
      }
    }
    void refresh()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 15000)
    return () => { active = false; window.clearInterval(timer) }
  }, [location, inquiry.source, inquiry.id])

  async function generate(replace = false) {
    if (lock.current || !canOffer) return
    lock.current = true
    setBusy(true)
    setOffer(null)
    setError('')
    setNotice('')
    try {
      const capacity = await supabase.rpc('reservation_capacity_load', {
        p_location_id: location, p_day: inquiry.date,
      }).abortSignal(AbortSignal.timeout(15000))
      if (capacity.error) throw capacity.error
      const arrivals = nextInquiryArrivals(capacity.data, inquiry)
      if (!arrivals.length) throw Error('No later arrival time is available on the requested date. Ask the guest about another date.')
      const result = await supabase.rpc('inquiry_arrival_offer_create', {
        ...args, p_day: inquiry.date, p_party: guests, p_minutes: arrivals, p_fingerprint: capacity.data.fingerprint, p_replace: replace,
      }).abortSignal(AbortSignal.timeout(15000))
      if (result.error) throw result.error
      setSelection(null)
      setOffer({ link: confirmationOrigin + '/reservation-arrival-options#token=' + result.data, arrivals })
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  const time = selection && arrivalClockValue(new Date(selection.arrival))
  const message = offer && 'JusTini’s New Orleans: We’re unable to accommodate your requested reservation times. Please choose an alternate arrival time here: ' + offer.link
  const sms = message && messageComposerUrl(inquiry.phone, message, /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent))

  return <section aria-label="Alternate arrival times">
    {selection && time ? <>
      <p role="status"><strong>Guest selected {time12(time)} Central on {selection.day}.</strong></p>
      {canOffer && <button type="button" disabled={busy} onClick={() => {
        if (window.confirm('Replace this offer and ask the guest to select a new time?')) void generate(true)
      }}>{busy ? 'Checking availability…' : 'Replace arrival offer'}</button>}
      {onUse && <button type="button" onClick={() => onUse(selection.day, time)}>Use guest’s selected time</button>}
    </> : <>
      <button type="button" disabled={busy || !canOffer} onClick={() => void generate()}>
        {busy ? 'Checking availability…' : 'Generate alternate-times link'}
      </button>
      {!canOffer && <p>Add the inquiry date and party size to offer alternate times.</p>}
    </>}
    {offer && message && !selection && <>
      <p>Offering {offer.arrivals.map(minute => time12(arrivalClockValue(new Date(minute * 60000)))).join(', ')} Central on {inquiry.date}.</p>
      <label>Guest invitation<textarea readOnly rows={4} value={message} onFocus={event => event.target.select()} /></label>
      <div className="feed-actions">
        <button type="button" onClick={() => void Promise.resolve().then(() => navigator.clipboard.writeText(message))
          .then(() => setNotice('Invitation copied.')).catch(() => setNotice('Select the invitation text to copy it.'))}>Copy invitation</button>
        {sms && <a href={sms}>Open in Messages</a>}
        {inquiry.email && <a href={'mailto:' + encodeURIComponent(inquiry.email) + '?subject=' +
          encodeURIComponent('Alternate arrival times at JusTini’s') + '&body=' + encodeURIComponent(message)}>Open email draft</a>}
      </div>
      <p>Send the invitation to the guest. Keep the inquiry open so staff can review the selected time.</p>
    </>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
  </section>
}

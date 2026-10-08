// page-designer-instrumented
import { PageWord } from "../components/PageDesign"
import { ScreenText } from '../components/ScreenText'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'
import './GuestFeedback.css'
import { Link } from 'react-router-dom'

type Preset = {
  id: string
  label: string
  min_party_size: number
  max_party_size: number | null
  subject: string
  message: string
}

type Inquiry = {
  id: string
  guest_name: string
  phone: string | null
  email: string | null
  party_size: number
  inquiry_type: string
  preferred_date: string | null
  preferred_time: string | null
  second_preferred_time: string | null
  third_preferred_time: string | null
  guest_notes: string
  internal_notes: string
  preset_label: string
  guest_subject: string
  guest_message: string
  status: string
  created_at: string
}

const todayCentral = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

function timeLabel(value: string) {
  if (!value) return ''
  const match = value.match(/^(\d{1,2}):(\d{2})/)
  if (!match) return value
  const hour = Number(match[1])
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? 'PM' : 'AM'}`
}

function renderTemplate(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replace(new RegExp(`{{${key}}}`, 'g'), value),
    template,
  )
}

export function ReservationInquiryPage() {
  const [locationId, setLocationId] = useState('')
  const [locationName, setLocationName] = useState('JusTini’s')
  const [presets, setPresets] = useState<Preset[]>([])
  const [recent, setRecent] = useState<Inquiry[]>([])
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState<null | {
    inquiry_type: string
    subject: string
    message: string
    preset_label: string
    phone: string
    email: string
  }>(null)
  const [editingPresets, setEditingPresets] = useState(false)
  const [draftPresets, setDraftPresets] = useState<Preset[]>([])

  const [guestName, setGuestName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [partySize, setPartySize] = useState('2')
  const [preferredDate, setPreferredDate] = useState(todayCentral)
  const [preferredTime, setPreferredTime] = useState('')
  const [secondTime, setSecondTime] = useState('')
  const [thirdTime, setThirdTime] = useState('')
  const [guestNotes, setGuestNotes] = useState('')
  const [internalNotes, setInternalNotes] = useState('')

  const partyCount = Number(partySize) || 0
  const isLargeParty = partyCount > 15
  const matchingPreset = useMemo(
    () =>
      presets.find(
        (preset) =>
          partyCount >= preset.min_party_size &&
          (preset.max_party_size === null || partyCount <= preset.max_party_size),
      ) ?? null,
    [partyCount, presets],
  )

  const previewValues = {
    location_name: locationName,
    guest_name: guestName.trim() || 'there',
    party_size: partySize || '',
    date: preferredDate || '',
    time: timeLabel(preferredTime),
    second_time: timeLabel(secondTime),
    third_time: timeLabel(thirdTime),
    notes: guestNotes,
  }

  const largePartyPreview = matchingPreset
    ? renderTemplate(matchingPreset.message, previewValues)
    : ''

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const tenant = await loadTenantData()
        const loc = tenant.locations[0]
        if (!loc) throw Error('No active location found.')
        if (!live) return
        setLocationId(loc.id)
        setLocationName(loc.name)
      } catch (caught) {
        if (live) {
          setError(String((caught as { message?: string }).message ?? caught))
          setLoading(false)
        }
      }
    })()
    return () => {
      live = false
    }
  }, [])

  async function load(location: string) {
    setLoading(true)
    setError('')
    try {
      const result = await supabase.rpc('reservation_inquiry_load', {
        p_location_id: location,
      })
      if (result.error) throw result.error
      setCanManage(Boolean(result.data?.can_manage))
      setPresets((result.data?.presets ?? []) as Preset[])
      setDraftPresets((result.data?.presets ?? []) as Preset[])
      setRecent((result.data?.recent ?? []) as Inquiry[])
    } catch (caught) {
      setError(String((caught as { message?: string }).message ?? caught))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (locationId) void load(locationId)
  }, [locationId])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setSuccess(null)
    try {
      const result = await supabase.rpc('reservation_inquiry_submit', {
        p_location_id: locationId,
        p_content: {
          guest_name: guestName,
          phone,
          email,
          party_size: Number(partySize),
          preferred_date: isLargeParty ? null : preferredDate,
          preferred_time: isLargeParty ? null : preferredTime,
          second_preferred_time: isLargeParty ? null : secondTime,
          third_preferred_time: isLargeParty ? null : thirdTime,
          guest_notes: guestNotes,
          internal_notes: internalNotes,
        },
      })
      if (result.error) throw result.error
      setSuccess({ ...result.data, phone: phone.trim(), email: email.trim() })
      setGuestName('')
      setPhone('')
      setEmail('')
      setPartySize('2')
      setPreferredDate(todayCentral())
      setPreferredTime('')
      setSecondTime('')
      setThirdTime('')
      setGuestNotes('')
      setInternalNotes('')
      await load(locationId)
    } catch (caught) {
      setError(String((caught as { message?: string }).message ?? caught))
    } finally {
      setSaving(false)
    }
  }

  async function savePresets() {
    setSaving(true)
    setError('')
    try {
      const result = await supabase.rpc('reservation_inquiry_save_presets', {
        p_location_id: locationId,
        p_presets: draftPresets,
      })
      if (result.error) throw result.error
      setCanManage(Boolean(result.data?.can_manage))
      setPresets((result.data?.presets ?? []) as Preset[])
      setDraftPresets((result.data?.presets ?? []) as Preset[])
      setRecent((result.data?.recent ?? []) as Inquiry[])
      setEditingPresets(false)
    } catch (caught) {
      setError(String((caught as { message?: string }).message ?? caught))
    } finally {
      setSaving(false)
    }
  }

  function updatePreset(index: number, patch: Partial<Preset>) {
    setDraftPresets((rows) =>
      rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    )
  }

  function addPreset() {
    setDraftPresets((rows) => [
      ...rows,
      {
        id: crypto.randomUUID(),
        label: 'Private party inquiry',
        min_party_size: 16,
        max_party_size: null,
        subject: 'We received your JusTini’s private party inquiry',
        message:
          'Hi {{guest_name}}, thank you for reaching out to {{location_name}}. We received your request for {{party_size}} guests. Please reply with as much detail as possible about your event.',
      },
    ])
  }

  const smsLink = success && success.phone
    ? `sms:${success.phone}?&body=${encodeURIComponent(success.message)}`
    : ''
  const emailLink = success && success.email
    ? `mailto:${success.email}?subject=${encodeURIComponent(success.subject)}&body=${encodeURIComponent(success.message)}`
    : ''

  return (
    <section className="page guest-feedback-inbox">
      <p className="eyebrow">{locationName}</p>
      <h1>
        <ScreenText id="ReservationInquiryPage.title">Reservation inquiry form</ScreenText>
      </h1>
      {canManage && <p><Link to="/inquiry-inbox">Open shared inquiry inbox</Link></p>}
      <p>
        <ScreenText id="ReservationInquiryPage.intro">Hosts can capture the inquiry, route parties of 15 or fewer into table seating, and route parties over 15 into private party follow-up.</ScreenText>
      </p>

      {error && <p role="alert">{error}</p>}
      {loading && <p role="status"><ScreenText id="ReservationInquiryPage.loading">Loading inquiry tools…</ScreenText></p>}

      {!loading && (
        <>
          <form className="gf-entry" onSubmit={submit}>
            <fieldset disabled={saving}>
              <label>
                <ScreenText id="ReservationInquiryPage.guestName">Guest name</ScreenText>
                <input required maxLength={200} value={guestName} onChange={(event) => setGuestName(event.target.value)} />
              </label>
              <label>
                <ScreenText id="ReservationInquiryPage.phone">Phone number</ScreenText>
                <input type="tel" maxLength={80} value={phone} onChange={(event) => setPhone(event.target.value)} />
              </label>
              <label>
                <ScreenText id="ReservationInquiryPage.email">Email</ScreenText>
                <input type="email" maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} />
              </label>
              <label>
                <ScreenText id="ReservationInquiryPage.partySize">Party size</ScreenText>
                <input required type="number" min={1} max={500} step={1} value={partySize} onChange={(event) => setPartySize(event.target.value)} />
              </label>

              {isLargeParty ? (
                <section className="gf-entry">
                  <h2>
                    <ScreenText id="ReservationInquiryPage.privateParty">Private party follow-up</ScreenText>
                  </h2>
                  <p>
                    <ScreenText id="ReservationInquiryPage.privatePartyBody">Parties over 15 need private party or catering information. Add any details the guest gives you so management can follow up with the right offer.</ScreenText>
                  </p>
                  <label>
                    <ScreenText id="ReservationInquiryPage.largeNotes">Guest details and event notes</ScreenText>
                    <textarea rows={5} maxLength={5000} value={guestNotes} onChange={(event) => setGuestNotes(event.target.value)} placeholder="Occasion, desired date, budget, seating style, food, cocktails, private/semi-private area…" />
                  </label>
                  {matchingPreset ? (
                    <div>
                      <strong>{matchingPreset.label}</strong>
                      <p className="gf-message">{largePartyPreview}</p>
                    </div>
                  ) : (
                    <p role="alert">
                      <ScreenText id="ReservationInquiryPage.noPreset">No active preset matches this party size.</ScreenText>
                    </p>
                  )}
                </section>
              ) : (
                <section className="gf-entry">
                  <h2>
                    <ScreenText id="ReservationInquiryPage.tableSeating">Traditional table seating</ScreenText>
                  </h2>
                  <p>
                    <ScreenText id="ReservationInquiryPage.tableSeatingBody">Traditional table seating is available for parties of 15 or fewer. Capture backup times in case the first request is unavailable.</ScreenText>
                  </p>
                  <label>
                    <ScreenText id="ReservationInquiryPage.date">Preferred date</ScreenText>
                    <input required type="date" min={todayCentral()} value={preferredDate} onChange={(event) => setPreferredDate(event.target.value)} />
                  </label>
                  <label>
                    <ScreenText id="ReservationInquiryPage.firstTime">First preferred time</ScreenText>
                    <input required type="time" value={preferredTime} onChange={(event) => setPreferredTime(event.target.value)} />
                  </label>
                  <label>
                    <ScreenText id="ReservationInquiryPage.secondTime">Second preferred time</ScreenText>
                    <input type="time" value={secondTime} onChange={(event) => setSecondTime(event.target.value)} />
                  </label>
                  <label>
                    <ScreenText id="ReservationInquiryPage.thirdTime">Third preferred time</ScreenText>
                    <input type="time" value={thirdTime} onChange={(event) => setThirdTime(event.target.value)} />
                  </label>
                  <label>
                    <ScreenText id="ReservationInquiryPage.tableNotes">Guest requests or notes</ScreenText>
                    <textarea rows={4} maxLength={5000} value={guestNotes} onChange={(event) => setGuestNotes(event.target.value)} />
                  </label>
                </section>
              )}

              <label>
                <ScreenText id="ReservationInquiryPage.internalNotes">Host/internal notes</ScreenText>
                <textarea rows={3} maxLength={5000} value={internalNotes} onChange={(event) => setInternalNotes(event.target.value)} />
              </label>
              <button className="primary-button" type="submit" disabled={saving || !guestName.trim() || (!phone.trim() && !email.trim())}>
                {saving ? <PageWord id="ReservationInquiryPage.saving">Saving…</PageWord> : <PageWord id="ReservationInquiryPage.save">Save inquiry</PageWord>}
              </button>
            </fieldset>
          </form>

          {success && (
            <section className="gf-entry" role="status">
              <h2>
                <ScreenText id="ReservationInquiryPage.saved">Inquiry saved</ScreenText>
              </h2>
              <p><strong>{success.subject}</strong></p>
              <p className="gf-message">{success.message}</p>
              <div className="gf-actions">
                {smsLink && <a href={smsLink}><PageWord id="ReservationInquiryPage.textGuest">Text guest</PageWord></a>}
                {emailLink && <a href={emailLink}><PageWord id="ReservationInquiryPage.emailGuest">Email guest</PageWord></a>}
              </div>
            </section>
          )}

          {canManage && (
            <section className="gf-entry">
              <div className="gf-actions">
                <h2>
                  <ScreenText id="ReservationInquiryPage.presets">Private party presets</ScreenText>
                </h2>
                <button type="button" onClick={() => setEditingPresets((value) => !value)}>
                  {editingPresets ? <PageWord id="ReservationInquiryPage.closePresets">Close preset editor</PageWord> : <PageWord id="ReservationInquiryPage.editPresets">Edit presets</PageWord>}
                </button>
              </div>
              {editingPresets && (
                <>
                  {draftPresets.map((preset, index) => (
                    <article className="gf-entry" key={preset.id}>
                      <label>
                        <ScreenText id="ReservationInquiryPage.presetLabel">Preset label</ScreenText>
                        <input value={preset.label} onChange={(event) => updatePreset(index, { label: event.target.value })} />
                      </label>
                      <label>
                        <ScreenText id="ReservationInquiryPage.minGuests">Minimum guests</ScreenText>
                        <input type="number" min={1} value={preset.min_party_size} onChange={(event) => updatePreset(index, { min_party_size: Number(event.target.value) })} />
                      </label>
                      <label>
                        <ScreenText id="ReservationInquiryPage.maxGuests">Maximum guests</ScreenText>
                        <input value={preset.max_party_size ?? ''} onChange={(event) => updatePreset(index, { max_party_size: event.target.value ? Number(event.target.value) : null })} placeholder="No limit" />
                      </label>
                      <label>
                        <ScreenText id="ReservationInquiryPage.subject">Subject</ScreenText>
                        <input value={preset.subject} onChange={(event) => updatePreset(index, { subject: event.target.value })} />
                      </label>
                      <label>
                        <ScreenText id="ReservationInquiryPage.message">Message</ScreenText>
                        <textarea rows={7} value={preset.message} onChange={(event) => updatePreset(index, { message: event.target.value })} />
                      </label>
                    </article>
                  ))}
                  <div className="gf-actions">
                    <button type="button" onClick={addPreset}><PageWord id="ReservationInquiryPage.addPreset">Add preset</PageWord></button>
                    <button className="primary-button" type="button" disabled={saving} onClick={() => void savePresets()}><PageWord id="ReservationInquiryPage.savePresets">Save presets</PageWord></button>
                  </div>
                </>
              )}
            </section>
          )}

          <section className="gf-entry">
            <h2>
              <ScreenText id="ReservationInquiryPage.recent">Recent inquiries</ScreenText>
            </h2>
            {!recent.length ? (
              <p><ScreenText id="ReservationInquiryPage.noRecent">No inquiries saved yet.</ScreenText></p>
            ) : (
              recent.map((row) => (
                <article className="gf-entry" key={row.id}>
                  <h3>{row.guest_name} · {row.party_size} guests</h3>
                  <p>{row.inquiry_type === 'private_party' ? 'Private party' : 'Table seating'} · {row.status}</p>
                  <p>{new Date(row.created_at).toLocaleString('en-US', { timeZone: 'America/Chicago' })} Central</p>
                  {(row.phone || row.email) && <p>{[row.phone, row.email].filter(Boolean).join(' · ')}</p>}
                  {row.preferred_date && <p>{row.preferred_date} · {[timeLabel(row.preferred_time ?? ''), timeLabel(row.second_preferred_time ?? ''), timeLabel(row.third_preferred_time ?? '')].filter(Boolean).join(' / ')}</p>}
                  {row.guest_notes && <p className="gf-message">{row.guest_notes}</p>}
                </article>
              ))
            )}
          </section>
        </>
      )}
    </section>
  )
}

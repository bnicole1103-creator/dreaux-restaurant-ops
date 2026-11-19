export function inquiryDetails(value: unknown): Record<string, unknown> {
  let details = value
  if (typeof details === 'string') {
    try { details = JSON.parse(details) } catch { return { Details: details } }
  }
  return details && typeof details === 'object' && !Array.isArray(details)
    ? details as Record<string, unknown>
    : {}
}

export function inquiryReservationFields(inquiry: {
  name: string; phone: string; email: string; guests: number; date: string; details: Record<string, unknown>
}) {
  const details = inquiryDetails(inquiry.details)
  const candidates = (keys: string[]) => keys.map(key => String(details[key] ?? '').trim())
  const first = (keys: string[]) => candidates(keys).find(Boolean) ?? ''
  const time = candidates(['First time','eventTime','time','firstTime','preferred_time','preferredTime','reservation_time'])
    .map(inquiryClock).find(Boolean) ?? ''
  const date = [inquiry.date, ...candidates(['eventDate', 'event_date', 'preferred_date', 'reservation_date'])]
    .find(value => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) ?? ''
  const party = [inquiry.guests, ...candidates(['guests', 'party_size', 'partySize'])]
    .map(Number).find(value => Number.isInteger(value) && value >= 1 && value <= 500)
  return {
    name: inquiry.name?.trim() || first(['name', 'guest_name', 'guestName']),
    phone: inquiry.phone?.trim() || first(['phone', 'guest_phone', 'guestPhone']),
    email: inquiry.email?.trim() || first(['email', 'guest_email', 'guestEmail']),
    date, time, size: party ? String(party) : '',
  }
}

export function inquiryClock(value: unknown) {
  const match = /^(\d{1,2})(?::([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?)?\s*(a\.?m\.?|p\.?m\.?)?$/i.exec(String(value??'').trim())
  if (!match) return ''
  const [, h, minute, period] = match
  const hour = Number(h)
  if (period ? hour < 1 || hour > 12 : !minute || hour > 23) return ''
  return String(period ? hour % 12 + (period.toLowerCase().startsWith('p') ? 12 : 0) : hour).padStart(2, '0') + ':' + (minute ?? '00')
}

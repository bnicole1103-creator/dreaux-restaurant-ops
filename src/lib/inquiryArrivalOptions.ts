import { inquirySeatingPreference, seatingArea } from './reservationSeating'
import { planCapacity, type CapacityData } from './reservationCapacity'
import type { InquiryReservationSource } from '../components/InquiryReservationDialog'

const central = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
const centralDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
})

export const arrivalClockValue = (instant: Date) => central.format(instant)

const requestedKeys = [
  'First time', 'Second time', 'Third time', 'eventTime', 'time', 'firstTime', 'secondTime',
  'thirdTime', 'preferred_time', 'second_preferred_time', 'third_preferred_time',
]

function requestedClock(value: unknown) {
  const match = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?\s*(AM|PM)?$/i.exec(String(value ?? '').trim())
  if (!match) return ''
  const hours = Number(match[1])
  const period = match[3]?.toUpperCase()
  if (period ? hours < 1 || hours > 12 : hours > 23) return ''
  const hour = period ? hours % 12 + (period === 'PM' ? 12 : 0) : hours
  return String(hour).padStart(2, '0') + ':' + match[2]
}

export function nextInquiryArrivalOffers(data: CapacityData, inquiry: InquiryReservationSource) {
  if (!data.configured || data.config.closed) return []
  const requested = requestedKeys.map(key => requestedClock(inquiry.details[key])).filter(Boolean)
  const first = requested[0] ?? ''
  const verified: {minute:number;area:string}[] = []
  // Legacy callers and inquiries without an explicit preference default to indoor.
  const seating = inquirySeatingPreference(inquiry.details)
  for (const slot of [...data.slots].sort((a, b) => a.value - b.value)) {
    const instant = new Date(slot.value * 60000)
    const clock = arrivalClockValue(instant)
    if (slot.value <= data.now || slot.value > data.close - 15 || centralDay.format(instant) !== data.day
      || clock < first || requested.includes(clock)) continue
    const plan = planCapacity(data, {
      id: 'candidate', name: 'New reservation', party: Number(inquiry.guests),
      start: slot.value, end: slot.value + data.config.duration, tableIds: [], room: '', version: 0, seating,
    })
    if (plan.ok) verified.push({minute:slot.value,area:seatingArea(data.tables.filter(t=>plan.assignments.candidate?.includes(t.id)))})
    if (verified.length === 3) break
  }
  return verified
}

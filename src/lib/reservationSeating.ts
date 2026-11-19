import type { CapacityTable } from './reservationCapacity'

export const seatingOptions = [
  ['indoor', 'Indoor dining'], ['bar', 'Bar seating'], ['courtyard', 'Outdoor seating in the Courtyard'],
] as const
export type SeatingPreference = typeof seatingOptions[number][0]
export const seatingLabel = (preference: SeatingPreference) => seatingOptions.find(([key]) => key === preference)?.[1] ?? ''

export function inquirySeatingPreference(details: Record<string, unknown>): SeatingPreference {
  const note = String(details['Guest notes'] ?? '').match(/^Seating preference: (.+)$/im)?.[1]
  const value = String(details.seatingPreference ?? details.seating_preference ?? details.seating ?? note ?? '').toLowerCase().trim()
  if (value.includes('courtyard') || value.includes('outdoor') || value === 'outside') return 'courtyard'
  if (value === 'bar' || value === 'bar seating') return 'bar'
  return 'indoor'
}

const highTop = (table: CapacityTable) => /^H[1-8]$/i.test((table.name ?? '').trim())
const diningTable = (table: CapacityTable) => /^T[1-6]$/i.test((table.name ?? '').trim())
const greatRoom = (table: CapacityTable) => /great\s*room/i.test(table.roomName)
const courtyard = (table: CapacityTable) => /courtyard|outdoor|patio/i.test(table.roomName)
const bar = (table: CapacityTable) => !highTop(table) && /\bbar\b/i.test(table.roomName + ' ' + table.name)

export function seatingArea(tables: CapacityTable[]) {
  if (!tables.length) return ''
  if (tables.every(courtyard)) return 'outdoor seating in the Courtyard'
  if (tables.every(bar)) return 'bar seating'
  if (tables.every(highTop)) return 'the indoor high-top'
  if (tables.every(greatRoom)) return 'the Great Room'
  return 'indoor dining'
}

export function reservationSeatingRank(tables: CapacityTable[], party: number, preference: SeatingPreference): number {
  if (!tables.length || tables.some(table => table.room !== tables[0].room)) return Infinity
  if (tables.some(greatRoom) && (party < 5 || party > 7)) return Infinity
  if (tables.some(highTop) && party > 10) return Infinity
  if (preference === 'bar') return tables.every(bar) ? 0 : Infinity
  if (tables.some(bar)) return Infinity
  if (preference === 'courtyard') return tables.every(courtyard) ? 0 : Infinity
  if (tables.some(courtyard)) return tables.every(courtyard) ? 10 : Infinity
  if (party >= 5 && party <= 7 && tables.every(greatRoom)) return 0
  if (party >= 8 && party <= 10 && tables.every(highTop)) return 0
  if (party <= 4) {
    if (party === 4 && tables.length === 2 && tables.every(t => t.seats === 2 && diningTable(t))) return 0
    if (tables.every(t => t.seats === 2 && diningTable(t))) return 1
    if (tables.every(t => t.seats === 2)) return 2
    if (tables.every(diningTable)) return 3
  }
  return tables.every(highTop) ? 5 : 4
}

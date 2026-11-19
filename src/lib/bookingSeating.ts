import { seatingArea } from './reservationSeating'
import { supabase } from './supabase'

export async function bookingSeating(location: string, id: string) {
  const reservation = await supabase.from('reservations').select('dining_area,table_ids,table_id')
    .eq('location_id', location).eq('id', id).abortSignal(AbortSignal.timeout(8000)).maybeSingle()
  if (reservation.error || !reservation.data) return ''
  const { dining_area, table_ids, table_id } = reservation.data
  if (!dining_area) return ''
  const ids = table_ids?.length ? table_ids : table_id ? [table_id] : []
  if (!ids.length) return dining_area
  const tables = await supabase.from('floor_tables').select('id,table_name,seat_count,room_id')
    .eq('location_id', location).in('id', ids).abortSignal(AbortSignal.timeout(8000))
  if (tables.error || tables.data?.length !== ids.length) return dining_area
  return seatingArea(tables.data.map(t => ({
    id:t.id, name:t.table_name, seats:t.seat_count, room:t.room_id, roomName:dining_area,
  })))
}

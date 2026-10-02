import { supabase } from './supabase'

export type Shift = {
  id: string
  organization_id: string
  location_id: string
  shift_date: string
  shift_name: string
  status: 'scheduled' | 'open' | 'closed' | 'cancelled'
}

export function todayDate() {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date())
  const get = (type: string) => parts.find(p => p.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

export async function loadTodayShifts(
  locationId: string,
): Promise<Shift[]> {
  const { data, error } = await supabase
    .from('shifts')
    .select(
      'id, organization_id, location_id, shift_date, shift_name, status',
    )
    .eq('location_id', locationId)
    .eq('shift_date', todayDate())
    .in('status', ['scheduled', 'open'])
    .order('created_at')

  if (error) throw error

  return (data ?? []) as Shift[]
}

export async function createShift({
  organizationId,
  locationId,
  shiftName,
}: {
  organizationId: string
  locationId: string
  shiftName: string
}): Promise<Shift> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError) throw userError
  if (!user) throw new Error('You must be signed in.')

  const { data, error } = await supabase
    .from('shifts')
    .insert({
      organization_id: organizationId,
      location_id: locationId,
      shift_date: todayDate(),
      shift_name: shiftName,
      status: 'open',
      opened_by: user.id,
      opened_at: new Date().toISOString(),
    })
    .select(
      'id, organization_id, location_id, shift_date, shift_name, status',
    )
    .single()

  if (error) throw error

  return data as Shift
}


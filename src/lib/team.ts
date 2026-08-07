import { supabase } from './supabase'

export type TeamMember = {
  user_id: string
  role: string
  status: string
  can_edit_floor: boolean
  profile: {
    full_name: string
    preferred_name: string | null
    photo_url: string | null
  } | null
}

export async function loadLocationTeam(
  locationId: string,
): Promise<TeamMember[]> {
  const { data, error } = await supabase
    .from('location_memberships')
    .select(`
      user_id,
      role,
      status,
      can_edit_floor,
      profile:profiles!location_memberships_user_id_fkey (
        full_name,
        preferred_name,
        photo_url
      )
    `)
    .eq('location_id', locationId)
    .eq('status', 'active')
    .order('role')

  if (error) {
    throw error
  }

  return (data ?? []) as TeamMember[]
}

import { supabase } from './supabase'

type ProfileRecord = {
  full_name: string
  preferred_name: string | null
  photo_url: string | null
}

export type TeamMember = {
  user_id: string
  role: string
  status: string
  can_edit_floor: boolean
  profile: ProfileRecord | null
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

  if (error) throw error

  return (data ?? []).map((member) => {
    const relatedProfile = member.profile

    return {
      user_id: member.user_id,
      role: member.role,
      status: member.status,
      can_edit_floor: member.can_edit_floor,
      profile: Array.isArray(relatedProfile)
        ? relatedProfile[0] ?? null
        : relatedProfile ?? null,
    }
  }) as TeamMember[]
}

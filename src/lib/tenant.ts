import { supabase } from './supabase'

export type Organization = {
  id: string
  name: string
  slug: string
  organization_type: string
  status: string
  timezone: string
}

export type Location = {
  id: string
  organization_id: string
  name: string
  location_code: string | null
  city: string | null
  state: string | null
  timezone: string
  is_active: boolean
}

export type TenantData = {
  organization: Organization
  locations: Location[]
}

export async function loadTenantData(): Promise<TenantData> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError) {
    throw userError
  }

  if (!user) {
    throw new Error('No signed-in user was found.')
  }

  const { data: memberships, error: membershipError } = await supabase
    .from('organization_memberships')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .limit(1)

  if (membershipError) {
    throw membershipError
  }

  const organizationId = memberships?.[0]?.organization_id

  if (!organizationId) {
    throw new Error('This user is not connected to an organization.')
  }

  const { data: organization, error: organizationError } = await supabase
    .from('organizations')
    .select(
      'id, name, slug, organization_type, status, timezone',
    )
    .eq('id', organizationId)
    .single()

  if (organizationError) {
    throw organizationError
  }

  const { data: locations, error: locationsError } = await supabase
    .from('locations')
    .select(
      'id, organization_id, name, location_code, city, state, timezone, is_active',
    )
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .order('name')

  if (locationsError) {
    throw locationsError
  }

  return {
    organization,
    locations: locations ?? [],
  }
}

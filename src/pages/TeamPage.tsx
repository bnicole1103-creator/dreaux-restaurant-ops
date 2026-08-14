import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'

type LocationRole =
  | 'owner'
  | 'general_manager'
  | 'manager'
  | 'assistant_manager'
  | 'host'
  | 'server'
  | 'bartender'
  | 'busser'
  | 'kitchen'
  | 'employee'

type TeamRow = {
  user_id: string
  role: LocationRole
  status: string
  employee_number: string | null
  full_name: string
  preferred_name: string | null
  phone: string | null
  photo_url: string | null
}

const roleOptions: Array<{
  value: LocationRole
  label: string
}> = [
  { value: 'general_manager', label: 'General Manager' },
  { value: 'manager', label: 'Manager' },
  { value: 'assistant_manager', label: 'Assistant Manager' },
  { value: 'host', label: 'Host' },
  { value: 'server', label: 'Server' },
  { value: 'bartender', label: 'Bartender' },
  { value: 'busser', label: 'Busser' },
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'employee', label: 'Employee' },
]

function roleLabel(role: string) {
  return (
    roleOptions.find((option) => option.value === role)?.label ??
    role
      .split('_')
      .map(
        (part) =>
          part.charAt(0).toUpperCase() + part.slice(1),
      )
      .join(' ')
  )
}

export function TeamPage() {
  const [organizationId, setOrganizationId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [locationName, setLocationName] = useState('')

  const [team, setTeam] = useState<TeamRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [showInvite, setShowInvite] = useState(false)
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [preferredName, setPreferredName] = useState('')
  const [phone, setPhone] = useState('')
  const [employeeNumber, setEmployeeNumber] = useState('')
  const [role, setRole] = useState<LocationRole>('host')

  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const activeCount = useMemo(
    () =>
      team.filter((member) => member.status === 'active')
        .length,
    [team],
  )

  useEffect(() => {
    initialize()
  }, [])

  async function initialize() {
    try {
      setLoading(true)
      setError('')

      const tenant = await loadTenantData()
      const location= tenant.locations[0]

      if (!tenant?.organization?.id || !location?.id) {throw new Error(
                'This user is not connected to an organization and location.',
        )
      }

      setOrganizationId(tenant.organization.id)
      setLocationId(location.id)
      setLocationName(location.name ?? '')

      await loadTeam(location.id)
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to load team.',
      )
    } finally {
      setLoading(false)
    }
  }

  async function loadTeam(targetLocationId: string) {
    const {
      data: memberships,
      error: membershipsError,
    } = await supabase
      .from('location_memberships')
      .select(
        'user_id, role, status, employee_number, created_at',
      )
      .eq('location_id', targetLocationId)
      .order('created_at')

    if (membershipsError) {
      throw membershipsError
    }

    const userIds = (memberships ?? []).map(
      (membership) => membership.user_id,
    )

    if (userIds.length === 0) {
      setTeam([])
      return
    }

    const { data: profiles, error: profilesError } =
      await supabase
        .from('profiles')
        .select(
          'id, full_name, preferred_name, phone, photo_url',
        )
        .in('id', userIds)

    if (profilesError) {
      throw profilesError
    }

    const profileMap = new Map(
      (profiles ?? []).map((profile) => [
        profile.id,
        profile,
      ]),
    )

    const rows: TeamRow[] = (memberships ?? []).map(
      (membership) => {
        const profile = profileMap.get(membership.user_id)

        return {
          user_id: membership.user_id,
          role: membership.role as LocationRole,
          status: membership.status,
          employee_number:
            membership.employee_number ?? null,
          full_name:
            profile?.full_name ?? 'Unnamed Team Member',
          preferred_name:
            profile?.preferred_name ?? null,
          phone: profile?.phone ?? null,
          photo_url: profile?.photo_url ?? null,
        }
      },
    )

    rows.sort((a, b) =>
      (a.preferred_name || a.full_name).localeCompare(
        b.preferred_name || b.full_name,
      ),
    )

    setTeam(rows)
  }

  function resetInviteForm() {
    setEmail('')
    setFullName('')
    setPreferredName('')
    setPhone('')
    setEmployeeNumber('')
    setRole('host')
  }

  async function inviteTeamMember() {
    if (!organizationId || !locationId) {
      setError('Organization or location is missing.')
      return
    }

    if (!email.trim() || !fullName.trim()) {
      setError('Name and email are required.')
      return
    }

    try {
      setSaving(true)
      setMessage('')
      setError('')

      const { data, error: inviteError } =
        await supabase.functions.invoke(
          'invite-team-member',
          {
            body: {
              email: email.trim(),
              full_name: fullName.trim(),
              preferred_name:
                preferredName.trim() || undefined,
              phone: phone.trim() || undefined,
              organization_id: organizationId,
              location_id: locationId,
              role,
              employee_number:
                employeeNumber.trim() || undefined,
              redirect_to: window.location.origin,
            },
          },
        )

      if (inviteError) {
        throw new Error(inviteError.message)
      }

      setMessage(
        data?.message ??
          'Team member was added successfully.',
      )

      await loadTeam(locationId)

      resetInviteForm()
      setShowInvite(false)
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to add team member.',
      )
    } finally {
      setSaving(false)
    }
  }

  async function updateRole(
    userId: string,
    nextRole: LocationRole,
  ) {
    try {
      setError('')

      const { error: updateError } = await supabase
        .from('location_memberships')
        .update({ role: nextRole })
        .eq('location_id', locationId)
        .eq('user_id', userId)

      if (updateError) {
        throw updateError
      }

      setTeam((current) =>
        current.map((member) =>
          member.user_id === userId
            ? { ...member, role: nextRole }
            : member,
        ),
      )
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to update role.',
      )
    }
  }

  async function toggleActive(member: TeamRow) {
    try {
      setError('')

      const nextStatus =
        member.status === 'active' ? 'inactive' : 'active'

      const { error: updateError } = await supabase
        .from('location_memberships')
        .update({ status: nextStatus })
        .eq('location_id', locationId)
        .eq('user_id', member.user_id)

      if (updateError) {
        throw updateError
      }

      setTeam((current) =>
        current.map((item) =>
          item.user_id === member.user_id
            ? { ...item, status: nextStatus }
            : item,
        ),
      )
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to update team member.',
      )
    }
  }

  if (loading) {
    return (
      <section>
        <div className="page-heading">
          <p className="eyebrow">LNX Systems</p>
          <h1>Team</h1>
          <p className="muted">Loading team…</p>
        </div>
      </section>
    )
  }

  return (
    <section>
      <div className="page-heading">
        <p className="eyebrow">LNX Systems</p>
        <h1>Team</h1>
        <p className="muted">
          {locationName || 'Current Location'} · {activeCount}{' '}
          active team members
        </p>
      </div>

      {error && (
        <div
          style={{
            marginTop: '12px',
            padding: '12px',
            borderRadius: '12px',
            border: '1px solid #ef4444',
            background: 'rgba(127,29,29,.25)',
          }}
        >
          {error}
        </div>
      )}

      {message && (
        <div
          style={{
            marginTop: '12px',
            padding: '12px',
            borderRadius: '12px',
            border: '1px solid #22c55e',
            background: 'rgba(20,83,45,.25)',
          }}
        >
          {message}
        </div>
      )}

      <button
        className="primary-button"
        style={{
          width: '100%',
          marginTop: '18px',
          padding: '13px',
        }}
        onClick={() => setShowInvite(true)}
      >
        + Add Team Member
      </button>

      <div
        style={{
          display: 'grid',
          gap: '10px',
          marginTop: '18px',
        }}
      >
        {team.map((member) => (
          <div
            key={member.user_id}
            style={{
              padding: '14px',
              borderRadius: '14px',
              background: '#111827',
              border: '1px solid #334155',
              opacity:
                member.status === 'active' ? 1 : 0.6,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '12px',
                alignItems: 'flex-start',
              }}
            >
              <div>
                <strong
                  style={{
                    display: 'block',
                    fontSize: '17px',
                  }}
                >
                  {member.preferred_name ||
                    member.full_name}
                </strong>

                {member.preferred_name &&
                  member.preferred_name !==
                    member.full_name && (
                    <div
                      style={{
                        marginTop: '2px',
                        opacity: 0.65,
                        fontSize: '12px',
                      }}
                    >
                      {member.full_name}
                    </div>
                  )}

                <div
                  style={{
                    marginTop: '5px',
                    color: '#f4b860',
                    fontSize: '13px',
                  }}
                >
                  {roleLabel(member.role)}
                </div>
              </div>

              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 700,
                }}
              >
                {member.status === 'active'
                  ? '🟢 Active'
                  : '⚪ Inactive'}
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '8px',
                marginTop: '12px',
              }}
            >
              <select
                value={member.role}
                onChange={(event) =>
                  updateRole(
                    member.user_id,
                    event.target.value as LocationRole,
                  )
                }
              >
                {member.role === 'owner' && (
                  <option value="owner">Owner</option>
                )}

                {roleOptions.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </option>
                ))}
              </select>

              <button
                onClick={() => toggleActive(member)}
              >
                {member.status === 'active'
                  ? 'Deactivate'
                  : 'Reactivate'}
              </button>
            </div>
          </div>
        ))}

        {team.length === 0 && (
          <div
            style={{
              padding: '20px',
              textAlign: 'center',
              opacity: 0.7,
            }}
          >
            No team members found.
          </div>
        )}
      </div>

      {showInvite && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <p className="eyebrow">Team Management</p>
            <h2>Add Team Member</h2>

            <label>
              Full name
              <input
                value={fullName}
                onChange={(event) =>
                  setFullName(event.target.value)
                }
                placeholder="Courtney Chambers"
              />
            </label>

            <label style={{ marginTop: '10px' }}>
              Preferred name
              <input
                value={preferredName}
                onChange={(event) =>
                  setPreferredName(event.target.value)
                }
                placeholder="Courtney"
              />
            </label>

            <label style={{ marginTop: '10px' }}>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) =>
                  setEmail(event.target.value)
                }
                placeholder="courtney@example.com"
              />
            </label>

            <label style={{ marginTop: '10px' }}>
              Phone
              <input
                value={phone}
                onChange={(event) =>
                  setPhone(event.target.value)
                }
                placeholder="504-555-0100"
              />
            </label>

            <label style={{ marginTop: '10px' }}>
              Role
              <select
                value={role}
                onChange={(event) =>
                  setRole(
                    event.target.value as LocationRole,
                  )
                }
              >
                {roleOptions.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ marginTop: '10px' }}>
              Employee number
              <input
                value={employeeNumber}
                onChange={(event) =>
                  setEmployeeNumber(event.target.value)
                }
                placeholder="Optional"
              />
            </label>

            <div className="modal-actions">
              <button
                onClick={() => {
                  setShowInvite(false)
                  setError('')
                }}
              >
                Cancel
              </button>

              <button
                className="primary-button"
                onClick={inviteTeamMember}
                disabled={
                  saving ||
                  !email.trim() ||
                  !fullName.trim()
                }
              >
                {saving
                  ? 'Sending…'
                  : 'Send Invite'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

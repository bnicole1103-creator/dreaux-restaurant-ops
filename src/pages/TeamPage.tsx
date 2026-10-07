// page-designer-instrumented
import { PageWord, PageInput } from "../components/PageDesign"
import { ScreenText } from "../components/ScreenText"
import { EmployeeProfile } from '../components/EmployeeProfile'
import { useManagementAccess } from '../components/ManagementAccess'
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
  { value: 'owner', label: 'Owner' },
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

function errorMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String(error.message) || fallback
  }
  return fallback
}

export function TeamPage() {
  const [profileUser,setProfileUser]=useState('')
  const [viewerId,setViewerId]=useState('')
  const profileAccess=useManagementAccess()
  useEffect(()=>{let live=true;void supabase.auth.getUser().then(r=>{if(live)setViewerId(r.data.user?.id??'')});return()=>{live=false}},[])
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
        .select('user_id')
        .single()

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
        errorMessage(caughtError, 'Unable to update role.'),
      )
    }
  }

  async function toggleActive(member: TeamRow) {
    try {
      setError('')

      const nextStatus =
        member.status === 'active' ? 'suspended' : 'active'

      const { error: updateError } = await supabase
        .from('location_memberships')
        .update({ status: nextStatus })
        .eq('location_id', locationId)
        .eq('user_id', member.user_id)
        .select('user_id')
        .single()

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
        errorMessage(caughtError, 'Unable to update team member.'),
      )
    }
  }

  if (loading) {
    return (
      <section data-design-block="copy.4c43cbee06845863.1">
        <div data-design-block="copy.e32e085900ed1308.1" className="page-heading">
          <p data-design-block="copy.7c3584cc95fdafc8.1" className="eyebrow"><ScreenText id="TeamPage.262da4df982b420d">LNX Systems</ScreenText></p>
          <h1 data-design-block="copy.2d15be00ac397f1a.1"><ScreenText id="TeamPage.ba414bfe8fe6cf7b">Team</ScreenText></h1>
          <p data-design-block="copy.9a0abcbc5e238444.1" className="muted"><ScreenText id="TeamPage.9ab27c4cb1072ec7">Loading team…</ScreenText></p>
        </div>
      </section>
    )
  }

  return (
    <section data-design-block="copy.4c43cbee06845863.2">
      <div data-design-block="copy.e32e085900ed1308.2" className="page-heading">
        <p data-design-block="copy.7c3584cc95fdafc8.2" className="eyebrow"><ScreenText id="TeamPage.c1b5f294c1f55228">LNX Systems</ScreenText></p>
        <h1 data-design-block="copy.2d15be00ac397f1a.2"><ScreenText id="TeamPage.f8c6bdd37125a5eb">Team</ScreenText></h1>
        <p data-design-block="copy.9a0abcbc5e238444.2" className="muted">
          {locationName || 'Current Location'}<PageWord id="copy.eab76aa7af0bc1b2.1">· </PageWord>{activeCount}{' '}<ScreenText id="TeamPage.35779cd02cf5c4ef">
          active team members
        </ScreenText></p>
      </div>

      {error && (
        <div data-design-block="copy.e0ab435294e08379.1"
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
        <div data-design-block="copy.c38532aaffa61db2.1"
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

      <button data-design-block="copy.b00cb3cf7897edda.1"
        className="primary-button"
        style={{
          width: '100%',
          marginTop: '18px',
          padding: '13px',
        }}
        onClick={() => setShowInvite(true)}
      ><ScreenText id="TeamPage.7b09c6cb92544e56">
        + Add Team Member
      </ScreenText></button>

      <div data-design-block="copy.2c9f0e066c23a9e5.1"
        style={{
          display: 'grid',
          gap: '10px',
          marginTop: '18px',
        }}
      >
        {team.map((member) => (
          <div data-design-block="copy.66bf4e38430df29f.1"
            key={member.user_id}
            style={{
              padding: '14px',
              borderRadius: '14px',
              background: '#ffffff',
              border: '1px solid var(--app-border)',
              opacity:
                member.status === 'active' ? 1 : 0.6,
            }}
          >
            <div data-design-block="copy.3524ae46d03d8a6f.1"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '12px',
                alignItems: 'flex-start',
              }}
            >
              <div data-design-block="copy.d644361ed64c08f1.1">
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
                    <div data-design-block="copy.eff6b2695ee15157.1"
                      style={{
                        marginTop: '2px',
                        opacity: 0.65,
                        fontSize: '12px',
                      }}
                    >
                      {member.full_name}
                    </div>
                  )}

                <div data-design-block="copy.412f0462412f6fda.1"
                  style={{
                    marginTop: '5px',
                    color: '#f4b860',
                    fontSize: '13px',
                  }}
                >
                  {roleLabel(member.role)}
                </div>
              </div>

              <div data-design-block="copy.ed57497e2f2445f6.1"
                style={{
                  fontSize: '12px',
                  fontWeight: 700,
                }}
              >
                {member.status === 'active'
                  ? <PageWord id="copy.4066a7adf2c231ed.1">{"🟢 Active"}</PageWord>
                  : <PageWord id="copy.2863be56bff5604d.1">{"⚪ Inactive"}</PageWord>}
              </div>
            </div>

            {(profileAccess.manager||viewerId===member.user_id)&&<button data-design-block="copy.04b416d7841d6c6c.1" type="button" className="wt-profile-link" onClick={()=>setProfileUser(member.user_id)}><ScreenText id="TeamPage.b2ea937011e56c51">View employee profile</ScreenText></button>}
            <div data-design-block="copy.e2dc7a1a95db3c76.1"
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
                

                {roleOptions.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </option>
                ))}
              </select>

              <button data-design-block="copy.76f84758895d8417.1"
                onClick={() => toggleActive(member)}
              >
                {member.status === 'active'
                  ? <PageWord id="copy.02f9740f534e5478.1">{"Deactivate"}</PageWord>
                  : <PageWord id="copy.159d8d4ae0f3300d.1">{"Reactivate"}</PageWord>}
              </button>
            </div>
          </div>
        ))}

        {team.length === 0 && (
          <div data-design-block="copy.f2e4d2249a93cd3a.1"
            style={{
              padding: '20px',
              textAlign: 'center',
              opacity: 0.7,
            }}
          ><ScreenText id="TeamPage.b03343aec9127b16">
            No team members found.
          </ScreenText></div>
        )}
      </div>

      {profileUser&&<EmployeeProfile key={profileUser} locationId={locationId} userId={profileUser} onClose={()=>setProfileUser('')} />}
      {showInvite && (
        <div data-design-block="copy.d08ca345ae0725ab.1" className="modal-backdrop">
          <div data-design-block="copy.78089139315be863.1" className="modal-card">
            <p data-design-block="copy.7c3584cc95fdafc8.3" className="eyebrow"><ScreenText id="TeamPage.291bcd306c2e6ef4">Team Management</ScreenText></p>
            <h2 data-design-block="copy.617a3eabbc359aaf.1"><ScreenText id="TeamPage.1821210729db4e68">Add Team Member</ScreenText></h2>

            <label data-design-block="copy.6555634b7e0c4bb3.1"><ScreenText id="TeamPage.c648d0d1f86472a9">
              Full name
              </ScreenText><PageInput designId="copy.7596479ae37f8bbd.1"
                value={fullName}
                onChange={(event) =>
                  setFullName(event.target.value)
                }
                placeholder="Courtney Chambers"
              />
            </label>

            <label data-design-block="copy.ebb1caebaa81c102.1" style={{ marginTop: '10px' }}><ScreenText id="TeamPage.7c0979fda0d91b63">
              Preferred name
              </ScreenText><PageInput designId="copy.0ca61d2531817e2a.1"
                value={preferredName}
                onChange={(event) =>
                  setPreferredName(event.target.value)
                }
                placeholder="Courtney"
              />
            </label>

            <label data-design-block="copy.ebb1caebaa81c102.2" style={{ marginTop: '10px' }}><ScreenText id="TeamPage.82076b654a58ad2e">
              Email
              </ScreenText><PageInput designId="copy.4b971b0d19fd420a.1"
                type="email"
                value={email}
                onChange={(event) =>
                  setEmail(event.target.value)
                }
                placeholder="courtney@example.com"
              />
            </label>

            <label data-design-block="copy.ebb1caebaa81c102.3" style={{ marginTop: '10px' }}><ScreenText id="TeamPage.7768a75fc61fe2c6">
              Phone
              </ScreenText><PageInput designId="copy.30722145e8ce6864.1"
                value={phone}
                onChange={(event) =>
                  setPhone(event.target.value)
                }
                placeholder="504-555-0100"
              />
            </label>

            <label data-design-block="copy.ebb1caebaa81c102.4" style={{ marginTop: '10px' }}><ScreenText id="TeamPage.19c01864eac1320a">
              Role
              </ScreenText><select
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

            <label data-design-block="copy.ebb1caebaa81c102.5" style={{ marginTop: '10px' }}><ScreenText id="TeamPage.ba1269b8eb9126c7">
              Employee number
              </ScreenText><PageInput designId="copy.fe9f33cc6ff8e5f1.1"
                value={employeeNumber}
                onChange={(event) =>
                  setEmployeeNumber(event.target.value)
                }
                placeholder="Optional"
              />
            </label>

            <div data-design-block="copy.5b345ea6ffc6797d.1" className="modal-actions">
              <button data-design-block="copy.3aa38101f6bb5fbf.1"
                onClick={() => {
                  setShowInvite(false)
                  setError('')
                }}
              ><ScreenText id="TeamPage.d5c515dcd12201f0">
                Cancel
              </ScreenText></button>

              <button data-design-block="copy.e25a3bb1aa5f7968.1"
                className="primary-button"
                onClick={inviteTeamMember}
                disabled={
                  saving ||
                  !email.trim() ||
                  !fullName.trim()
                }
              >
                {saving
                  ? <PageWord id="copy.fc2672923a339789.1">{"Sending…"}</PageWord>
                  : <PageWord id="copy.2a1840ca99bdfff4.1">{"Send Invite"}</PageWord>}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'
import {
  loadLocationTeam,
  type TeamMember,
} from '../lib/team'
import {
  createShift,
  loadTodayShifts,
  type Shift,
} from '../lib/shifts'

type Room = {
  id: string
  location_id: string
  name: string
  display_order: number
}

type FloorTable = {
  id: string
  location_id: string
  room_id: string
  table_name: string
  seat_count: number
  shape: 'round' | 'square' | 'rectangle'
  position_x: number
  position_y: number
  width: number
  height: number
}

type ServerAssignment = {
  id: string
  table_id: string
  server_id: string
}

export function FloorPage() {
  const [organizationId, setOrganizationId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [locationName, setLocationName] = useState('')

  const [rooms, setRooms] = useState<Room[]>([])
  const [tables, setTables] = useState<FloorTable[]>([])
  const [team, setTeam] = useState<TeamMember[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [activeShiftId, setActiveShiftId] = useState('')
  const [assignments, setAssignments] =
    useState<ServerAssignment[]>([])

  const [activeRoomId, setActiveRoomId] = useState('')
  const [selectedTableIds, setSelectedTableIds] =
    useState<string[]>([])

  const [showShiftPanel, setShowShiftPanel] = useState(false)
  const [newShiftName, setNewShiftName] = useState('Dinner')
  const [showAssignPanel, setShowAssignPanel] = useState(false)
  const [selectedServerId, setSelectedServerId] = useState('')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadFloor() {
      try {
        const tenant = await loadTenantData()
        const location = tenant.locations[0]

        if (!location) {
          throw new Error('No active location was found.')
        }

        setOrganizationId(tenant.organization.id)
        setLocationId(location.id)
        setLocationName(location.name)

        const [
          roomResult,
          tableResult,
          teamResult,
          shiftResult,
        ] = await Promise.all([
          supabase
            .from('rooms')
            .select('id, location_id, name, display_order')
            .eq('location_id', location.id)
            .eq('is_active', true)
            .order('display_order'),

          supabase
            .from('floor_tables')
            .select(`
              id,
              location_id,
              room_id,
              table_name,
              seat_count,
              shape,
              position_x,
              position_y,
              width,
              height
            `)
            .eq('location_id', location.id)
            .eq('is_active', true),

          loadLocationTeam(location.id),

          loadTodayShifts(location.id),
        ])

        if (roomResult.error) throw roomResult.error
        if (tableResult.error) throw tableResult.error

        const nextRooms = roomResult.data ?? []
        const nextShifts = shiftResult ?? []

        setRooms(nextRooms)
        setTables((tableResult.data ?? []) as FloorTable[])
        setTeam(teamResult)
        setShifts(nextShifts)
        setActiveRoomId(nextRooms[0]?.id ?? '')
        setActiveShiftId(nextShifts[0]?.id ?? '')
      } catch (caughtError) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : 'Unable to load the floor.',
        )
      } finally {
        setLoading(false)
      }
    }

    loadFloor()
  }, [])

  useEffect(() => {
    if (!activeShiftId) {
      setAssignments([])
      return
    }

    loadAssignments(activeShiftId)
  }, [activeShiftId])

  async function loadAssignments(shiftId: string) {
    const { data, error: assignmentError } = await supabase
      .from('server_assignments')
      .select('id, table_id, server_id')
      .eq('shift_id', shiftId)

    if (assignmentError) {
      setError(assignmentError.message)
      return
    }

    setAssignments((data ?? []) as ServerAssignment[])
  }

  const activeTables = useMemo(
    () =>
      tables.filter(
        (table) => table.room_id === activeRoomId,
      ),
    [tables, activeRoomId],
  )

  const activeShift = shifts.find(
    (shift) => shift.id === activeShiftId,
  )

  function toggleTable(tableId: string) {
    setSelectedTableIds((current) =>
      current.includes(tableId)
        ? current.filter((id) => id !== tableId)
        : [...current, tableId],
    )
  }

  function memberName(userId: string) {
    const member = team.find(
      (teamMember) => teamMember.user_id === userId,
    )

    return (
      member?.profile?.preferred_name ||
      member?.profile?.full_name ||
      'Employee'
    )
  }

  function tableServer(tableId: string) {
    const assignment = assignments.find(
      (item) => item.table_id === tableId,
    )

    return assignment
      ? memberName(assignment.server_id)
      : ''
  }

  async function handleCreateShift() {
    if (!organizationId || !locationId) return

    try {
      setSaving(true)
      setError('')

      const shift = await createShift({
        organizationId,
        locationId,
        shiftName: newShiftName,
      })

      setShifts((current) => [...current, shift])
      setActiveShiftId(shift.id)
      setShowShiftPanel(false)
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to create the shift.',
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleAssign() {
    if (!activeShiftId) {
      setError('Open or select a shift before assigning tables.')
      return
    }

    if (!selectedServerId || selectedTableIds.length === 0) {
      return
    }

    try {
      setSaving(true)
      setError('')

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError) throw userError
      if (!user) throw new Error('You must be signed in.')

      const rows = selectedTableIds.map((tableId) => ({
        organization_id: organizationId,
        location_id: locationId,
        shift_id: activeShiftId,
        table_id: tableId,
        server_id: selectedServerId,
        assigned_by: user.id,
        assigned_at: new Date().toISOString(),
      }))

      const { error: assignmentError } = await supabase
        .from('server_assignments')
        .upsert(rows, {
          onConflict: 'shift_id,table_id',
        })

      if (assignmentError) throw assignmentError

      await loadAssignments(activeShiftId)

      setSelectedTableIds([])
      setSelectedServerId('')
      setShowAssignPanel(false)
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to assign the selected tables.',
      )
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="empty-state">Loading floor plan…</div>
  }

  if (error && rooms.length === 0) {
    return (
      <div className="empty-state">
        <strong>We could not load FloorFlow.</strong>
        <span>{error}</span>
      </div>
    )
  }

  return (
    <section>
      <div className="page-heading">
        <p className="eyebrow">FloorFlow</p>
        <h1>Live floor</h1>
        <p className="muted">{locationName}</p>
      </div>

      <div className="shift-toolbar">
        {shifts.length > 0 ? (
          <select
            value={activeShiftId}
            onChange={(event) =>
              setActiveShiftId(event.target.value)
            }
          >
            {shifts.map((shift) => (
              <option key={shift.id} value={shift.id}>
                {shift.shift_name} · {shift.status}
              </option>
            ))}
          </select>
        ) : (
          <span>No open shift</span>
        )}

        <button onClick={() => setShowShiftPanel(true)}>
          Open shift
        </button>
      </div>

      {error && (
        <div className="inline-error">{error}</div>
      )}

      <div className="room-tabs">
        {rooms.map((room) => (
          <button
            key={room.id}
            className={
              room.id === activeRoomId ? 'active' : ''
            }
            onClick={() => {
              setActiveRoomId(room.id)
              setSelectedTableIds([])
            }}
          >
            {room.name}
          </button>
        ))}
      </div>

      <div className="floor-canvas">
        {activeTables.map((table) => {
          const selected =
            selectedTableIds.includes(table.id)
          const assignedServer = tableServer(table.id)

          return (
            <button
              key={table.id}
              className={`floor-table ${table.shape} ${
                selected ? 'selected' : ''
              }`}
              style={{
                left: `${table.position_x}%`,
                top: `${table.position_y}%`,
                width: `${table.width}%`,
                height: `${table.height}%`,
              }}
              onClick={() => toggleTable(table.id)}
            >
              <strong>{table.table_name}</strong>

              <span>
                {assignedServer ||
                  `${table.seat_count} seats`}
              </span>
            </button>
          )
        })}
      </div>

      {selectedTableIds.length > 0 && (
        <div className="floor-action-bar">
          <span>
            {selectedTableIds.length}{' '}
            {selectedTableIds.length === 1
              ? 'table'
              : 'tables'}{' '}
            selected
          </span>

          <button
            onClick={() => setSelectedTableIds([])}
          >
            Clear
          </button>

          <button
            onClick={() => {
              if (!activeShift) {
                setError(
                  'Open or select a shift before assigning tables.',
                )
                return
              }

              setShowAssignPanel(true)
            }}
          >
            Assign
          </button>

          <button disabled>Seat</button>
          <button disabled>Status</button>
        </div>
      )}

      {showShiftPanel && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h2>Open today’s shift</h2>

            <label>
              Shift
              <select
                value={newShiftName}
                onChange={(event) =>
                  setNewShiftName(event.target.value)
                }
              >
                <option>Dinner</option>
                <option>Lunch</option>
                <option>Brunch</option>
                <option>Private Event</option>
              </select>
            </label>

            <div className="modal-actions">
              <button
                onClick={() => setShowShiftPanel(false)}
              >
                Cancel
              </button>

              <button
                className="primary-button"
                onClick={handleCreateShift}
                disabled={saving}
              >
                {saving ? 'Opening…' : 'Open shift'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAssignPanel && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h2>Assign selected tables</h2>

            <label>
              Employee
              <select
                value={selectedServerId}
                onChange={(event) =>
                  setSelectedServerId(event.target.value)
                }
              >
                <option value="">
                  Choose an employee
                </option>

                {team.map((member) => (
                  <option
                    key={member.user_id}
                    value={member.user_id}
                  >
                    {memberName(member.user_id)} ·{' '}
                    {member.role.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </label>

            <div className="modal-actions">
              <button
                onClick={() => setShowAssignPanel(false)}
              >
                Cancel
              </button>

              <button
                className="primary-button"
                onClick={handleAssign}
                disabled={!selectedServerId || saving}
              >
                {saving ? 'Assigning…' : 'Assign tables'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

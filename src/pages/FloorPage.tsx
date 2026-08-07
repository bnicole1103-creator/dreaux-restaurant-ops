import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'

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

export function FloorPage() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [tables, setTables] = useState<FloorTable[]>([])
  const [activeRoomId, setActiveRoomId] = useState('')
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([])
  const [locationName, setLocationName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadFloor() {
      try {
        const tenant = await loadTenantData()
        const location = tenant.locations[0]

        if (!location) {
          throw new Error('No active location was found.')
        }

        setLocationName(location.name)

        const { data: roomData, error: roomError } = await supabase
          .from('rooms')
          .select('id, location_id, name, display_order')
          .eq('location_id', location.id)
          .eq('is_active', true)
          .order('display_order')

        if (roomError) throw roomError

        const { data: tableData, error: tableError } = await supabase
          .from('floor_tables')
          .select(
            'id, location_id, room_id, table_name, seat_count, shape, position_x, position_y, width, height',
          )
          .eq('location_id', location.id)
          .eq('is_active', true)

        if (tableError) throw tableError

        const nextRooms = roomData ?? []
        setRooms(nextRooms)
        setTables((tableData ?? []) as FloorTable[])
        setActiveRoomId(nextRooms[0]?.id ?? '')
      } catch (caughtError) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : 'Unable to load the floor plan.',
        )
      } finally {
        setLoading(false)
      }
    }

    loadFloor()
  }, [])

  const activeTables = useMemo(
    () => tables.filter((table) => table.room_id === activeRoomId),
    [tables, activeRoomId],
  )

  function toggleTable(tableId: string) {
    setSelectedTableIds((current) =>
      current.includes(tableId)
        ? current.filter((id) => id !== tableId)
        : [...current, tableId],
    )
  }

  if (loading) {
    return <div className="empty-state">Loading floor plan…</div>
  }

  if (error) {
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

      <div className="room-tabs">
        {rooms.map((room) => (
          <button
            key={room.id}
            className={room.id === activeRoomId ? 'active' : ''}
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
          const selected = selectedTableIds.includes(table.id)

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
              <span>{table.seat_count} seats</span>
            </button>
          )
        })}
      </div>

      {selectedTableIds.length > 0 && (
        <div className="floor-action-bar">
          <span>
            {selectedTableIds.length}{' '}
            {selectedTableIds.length === 1 ? 'table' : 'tables'} selected
          </span>

          <button onClick={() => setSelectedTableIds([])}>
            Clear
          </button>

          <button disabled>Assign</button>
          <button disabled>Seat</button>
          <button disabled>Status</button>
        </div>
      )}
    </section>
  )
}

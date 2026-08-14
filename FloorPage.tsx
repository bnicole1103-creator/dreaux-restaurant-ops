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

type ShiftSectionCard = {
  id: string
  configurationId: string
  name: string
  employeeId: string
  tableIds: string[]
  totalSeats: number
}

type ActiveTableSession = {
  id: string
  primaryTableId: string
  serverId: string | null
  guestName: string | null
  partySize: number
  status: string
  seatedAt: string
  tableIds: string[]
}


type ReservationRecord = {
  id: string
  reservation_time: string | null
  guest_name: string
  party_size: number
  phone: string | null
  email: string | null
  table_id: string | null
  table_name: string | null
  status: string
  occasion: string | null
  is_birthday: boolean
  is_vip: boolean
  notes: string | null
}

type SmartRecommendation = {
  employeeId: string
  employeeName: string
  score: number
  avgSalesPerHour: number
  avgNetSales: number
  historicalUses: number
  currentSeats: number
  exactHistory: boolean
  reason: string
}


type RotationCounter = {
  id: string
  user_id: string | null
  slot_number: number
  display_name: string
  cover_count: number
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

  const [sectionCards, setSectionCards] =
    useState<ShiftSectionCard[]>([])

  const [activeSessions, setActiveSessions] =
    useState<ActiveTableSession[]>([])

  const [reservations, setReservations] =
    useState<ReservationRecord[]>([])

  const [showReservationsPanel, setShowReservationsPanel] =
    useState(false)

  const [reservationUploadMessage, setReservationUploadMessage] =
    useState('')

  const [showSmartPanel, setShowSmartPanel] = useState(false)

  const [smartRecommendations, setSmartRecommendations] =
    useState<SmartRecommendation[]>([])

  const [smartLoading, setSmartLoading] = useState(false)

  const [showTableEditor, setShowTableEditor] = useState(false)
  const [editingTableId, setEditingTableId] = useState('')
  const [editTableName, setEditTableName] = useState('')
  const [editSeatCount, setEditSeatCount] = useState(2)

  const [showAddTablePanel, setShowAddTablePanel] = useState(false)
  const [newTableName, setNewTableName] = useState('')
  const [newTableSeats, setNewTableSeats] = useState(2)
  const [newTableShape, setNewTableShape] =
    useState<'round' | 'square' | 'rectangle'>('round')


  const [showRotationPanel, setShowRotationPanel] = useState(false)
  const [rotationServers, setRotationServers] =
    useState<RotationCounter[]>([])
  const [rotationServerCount, setRotationServerCount] = useState(4)
  const [rotationSetupUserIds, setRotationSetupUserIds] =
    useState<string[]>(['', '', '', ''])
  const [rotationCustomNames, setRotationCustomNames] =
    useState<string[]>(['', '', '', ''])

  const [clockTick, setClockTick] = useState(Date.now())

  const [activeRoomId, setActiveRoomId] = useState('')

  const [selectedTableIds, setSelectedTableIds] =
    useState<string[]>([])

const [showTablePanel, setShowTablePanel] = useState(false)

  const [showShiftPanel, setShowShiftPanel] = useState(false)
const [showSeatPanel, setShowSeatPanel] = useState(false)

const [guestName, setGuestName] = useState('')
const [guestPhone, setGuestPhone] = useState('')
const [guestEmail, setGuestEmail] = useState('')
const [partySize, setPartySize] = useState(1)
  const [newShiftName, setNewShiftName] = useState('Dinner')

  const [showSectionPanel, setShowSectionPanel] =
    useState(false)

  const [sectionName, setSectionName] = useState('')

  const [selectedServerId, setSelectedServerId] =
    useState('')

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
            .select(
              'id, location_id, name, display_order',
            )
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

        setTables(
          (tableResult.data ?? []) as FloorTable[],
        )

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
    const intervalId = window.setInterval(() => {
      setClockTick(Date.now())
    }, 30000)

    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    if (!activeShiftId) {
      setAssignments([])
      setSectionCards([])
      setActiveSessions([])
      return
    }

    loadAssignments(activeShiftId)
    loadSections(activeShiftId)
    loadTableSessions(activeShiftId)
    loadRotation(activeShiftId)

    if (locationId) {
      loadReservations(locationId)
    }
  }, [activeShiftId, locationId])

  async function loadAssignments(shiftId: string) {
    const { data, error: assignmentError } =
      await supabase
        .from('server_assignments')
        .select('id, table_id, server_id')
        .eq('shift_id', shiftId)

    if (assignmentError) {
      setError(assignmentError.message)
      return
    }

    setAssignments(
      (data ?? []) as ServerAssignment[],
    )
  }

  async function loadSections(shiftId: string) {
    const {
      data: shiftSections,
      error: sectionError,
    } = await supabase
      .from('shift_sections')
      .select(`
        id,
        section_configuration_id,
        employee_id,
        assignment_status
      `)
      .eq('shift_id', shiftId)
      .neq('assignment_status', 'cancelled')

    if (sectionError) {
      setError(sectionError.message)
      return
    }

    try {
      const cards = await Promise.all(
        (shiftSections ?? []).map(
          async (section) => {
            const [
              configurationResult,
              tableResult,
            ] = await Promise.all([
              supabase
                .from('section_configurations')
                .select(
                  'id, name, total_seats',
                )
                .eq(
                  'id',
                  section.section_configuration_id,
                )
                .single(),

              supabase
                .from('shift_section_tables')
                .select('table_id')
                .eq(
                  'shift_section_id',
                  section.id,
                ),
            ])

            if (configurationResult.error) {
              throw configurationResult.error
            }

            if (tableResult.error) {
              throw tableResult.error
            }

            return {
              id: section.id,

              configurationId:
                section.section_configuration_id,

              name:
                configurationResult.data.name ||
                'Section',

              employeeId: section.employee_id,

              tableIds: (
                tableResult.data ?? []
              ).map((row) => row.table_id),

              totalSeats:
                configurationResult.data.total_seats ??
                0,
            }
          },
        ),
      )

      setSectionCards(cards)
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to load sections.',
      )
    }
  }

  async function loadTableSessions(shiftId: string) {
    const { data: sessions, error: sessionError } =
      await supabase
        .from('table_sessions')
        .select(`
          id,
          table_id,
          server_id,
          guest_name,
          party_size,
          status,
          seated_at,
          closed_at
        `)
        .eq('shift_id', shiftId)
        .is('closed_at', null)

    if (sessionError) {
      setError(sessionError.message)
      return
    }

    const sessionRows = sessions ?? []

    if (sessionRows.length === 0) {
      setActiveSessions([])
      return
    }

    const sessionIds = sessionRows.map((session) => session.id)

    const { data: links, error: linkError } =
      await supabase
        .from('table_session_tables')
        .select('table_session_id, table_id')
        .in('table_session_id', sessionIds)

    if (linkError) {
      setError(linkError.message)
      return
    }

    const linkedTables = links ?? []

    const nextSessions: ActiveTableSession[] =
      sessionRows.map((session) => {
        const tableIds = linkedTables
          .filter(
            (link) =>
              link.table_session_id === session.id,
          )
          .map((link) => link.table_id)

        if (
          session.table_id &&
          !tableIds.includes(session.table_id)
        ) {
          tableIds.unshift(session.table_id)
        }

        return {
          id: session.id,
          primaryTableId: session.table_id,
          serverId: session.server_id,
          guestName: session.guest_name,
          partySize: session.party_size ?? 1,
          status: session.status ?? 'seated',
          seatedAt: session.seated_at,
          tableIds,
        }
      })

    setActiveSessions(nextSessions)
  }

  async function loadReservations(locationIdValue: string) {
    const reservationDate =
      new Date().toLocaleDateString('en-CA')

    const { data, error: reservationError } =
      await supabase
        .from('reservations')
        .select(`
          id,
          reservation_time,
          guest_name,
          party_size,
          phone,
          email,
          table_id,
          table_name,
          status,
          occasion,
          is_birthday,
          is_vip,
          notes
        `)
        .eq('location_id', locationIdValue)
        .eq('reservation_date', reservationDate)
        .order('reservation_time')

    if (reservationError) {
      setError(reservationError.message)
      return
    }

    setReservations((data ?? []) as ReservationRecord[])
  }

  function normalizeCsvHeader(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
  }

  function parseCsv(csvText: string) {
    const rows: string[][] = []
    let row: string[] = []
    let cell = ''
    let quoted = false

    for (let index = 0; index < csvText.length; index += 1) {
      const character = csvText[index]
      const next = csvText[index + 1]

      if (character === '"' && quoted && next === '"') {
        cell += '"'
        index += 1
        continue
      }

      if (character === '"') {
        quoted = !quoted
        continue
      }

      if (character === ',' && !quoted) {
        row.push(cell.trim())
        cell = ''
        continue
      }

      if (
        (character === '\n' || character === '\r') &&
        !quoted
      ) {
        if (character === '\r' && next === '\n') {
          index += 1
        }

        row.push(cell.trim())
        cell = ''

        if (row.some((value) => value.length > 0)) {
          rows.push(row)
        }

        row = []
        continue
      }

      cell += character
    }

    row.push(cell.trim())

    if (row.some((value) => value.length > 0)) {
      rows.push(row)
    }

    if (rows.length < 2) {
      return []
    }

    const headers = rows[0].map(normalizeCsvHeader)

    return rows.slice(1).map((values) => {
      const record: Record<string, string> = {}

      headers.forEach((header, index) => {
        record[header] = values[index] ?? ''
      })

      return record
    })
  }

  function csvValue(
    row: Record<string, string>,
    aliases: string[],
  ) {
    for (const alias of aliases) {
      const value = row[normalizeCsvHeader(alias)]

      if (value?.trim()) {
        return value.trim()
      }
    }

    return ''
  }

  function truthyCsv(value: string) {
    const normalized = value.trim().toLowerCase()

    return [
      'yes',
      'y',
      'true',
      '1',
      'vip',
      'birthday',
    ].includes(normalized)
  }

  async function handleReservationUpload(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0]

    if (!file || !locationId) {
      return
    }

    try {
      setSaving(true)
      setError('')
      setReservationUploadMessage('Reading reservation file…')

      const csvText = await file.text()
      const rows = parseCsv(csvText)

      if (rows.length === 0) {
        throw new Error(
          'The CSV did not contain any reservation rows.',
        )
      }

      const reservationDate =
        new Date().toLocaleDateString('en-CA')

      const insertRows = rows
        .map((row) => {
          const guestName = csvValue(row, [
            'guest_name',
            'guest',
            'name',
            'customer_name',
            'reservation_name',
          ])

          if (!guestName) {
            return null
          }

          const tableName = csvValue(row, [
            'table',
            'table_name',
            'table_number',
            'tables',
          ])

          const matchedTable = tableName
            ? tables.find(
                (table) =>
                  table.table_name.toLowerCase() ===
                  tableName.toLowerCase(),
              )
            : undefined

          const occasion = csvValue(row, [
            'occasion',
            'special_occasion',
          ])

          const notes = csvValue(row, [
            'notes',
            'guest_notes',
            'reservation_notes',
            'special_requests',
          ])

          const birthdayValue = csvValue(row, [
            'birthday',
            'is_birthday',
          ])

          const vipValue = csvValue(row, [
            'vip',
            'is_vip',
            'vip_status',
          ])

          const combinedFlags =
            `${occasion} ${notes}`.toLowerCase()

          const partySize = Math.max(
            1,
            Number(
              csvValue(row, [
                'party_size',
                'covers',
                'guests',
                'guest_count',
                'size',
              ]),
            ) || 1,
          )

          return {
            organization_id: organizationId,
            location_id: locationId,
            reservation_date: reservationDate,
            reservation_time:
              csvValue(row, [
                'reservation_time',
                'time',
                'booking_time',
                'start_time',
              ]) || null,
            guest_name: guestName,
            party_size: partySize,
            phone:
              csvValue(row, [
                'phone',
                'phone_number',
                'mobile',
              ]) || null,
            email:
              csvValue(row, ['email', 'email_address']) ||
              null,
            table_id: matchedTable?.id ?? null,
            table_name: tableName || null,
            status:
              csvValue(row, [
                'status',
                'reservation_status',
              ]) || 'booked',
            occasion: occasion || null,
            is_birthday:
              truthyCsv(birthdayValue) ||
              combinedFlags.includes('birthday'),
            is_vip:
              truthyCsv(vipValue) ||
              combinedFlags.includes('vip'),
            dining_area:
              csvValue(row, [
                'dining_area',
                'area',
                'room',
                'section',
              ]) || null,
            notes: notes || null,
            imported_source: 'csv',
            external_reservation_id:
              csvValue(row, [
                'reservation_id',
                'booking_id',
                'confirmation_number',
              ]) || null,
          }
        })
        .filter(
          (
            row,
          ): row is NonNullable<typeof row> =>
            row !== null,
        )

      if (insertRows.length === 0) {
        throw new Error(
          'No usable reservations were found in the CSV.',
        )
      }

      const { error: deleteError } = await supabase
        .from('reservations')
        .delete()
        .eq('location_id', locationId)
        .eq('reservation_date', reservationDate)
        .eq('imported_source', 'csv')

      if (deleteError) {
        throw deleteError
      }

      const { error: insertError } = await supabase
        .from('reservations')
        .insert(insertRows)

      if (insertError) {
        throw insertError
      }

      await loadReservations(locationId)

      const matchedCount = insertRows.filter(
        (row) => row.table_id,
      ).length

      setReservationUploadMessage(
        `${insertRows.length} reservations uploaded · ${matchedCount} matched to tables`,
      )

      setShowReservationsPanel(true)
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to upload reservations.',
      )
    } finally {
      setSaving(false)
      event.target.value = ''
    }
  }

  function formatReservationTime(timeValue: string | null) {
    if (!timeValue) return 'Time TBD'

    const match = timeValue.match(/^(\d{1,2}):(\d{2})/)

    if (!match) return timeValue

    const hour24 = Number(match[1])
    const minutes = match[2]

    if (
      Number.isNaN(hour24) ||
      hour24 < 0 ||
      hour24 > 23
    ) {
      return timeValue
    }

    const period = hour24 >= 12 ? 'PM' : 'AM'
    const hour12 = hour24 % 12 || 12

    return `${hour12}:${minutes} ${period}`
  }

  function reservationForTable(tableId: string) {
    return (
      reservations.find(
        (reservation) =>
          reservation.table_id === tableId &&
          !['cancelled', 'canceled', 'seated'].includes(
            reservation.status.toLowerCase(),
          ),
      ) ?? null
    )
  }

  async function handleSmartSection() {
    if (selectedTableIds.length === 0) {
      return
    }

    try {
      setSmartLoading(true)
      setError('')

      const selectedSorted = [...selectedTableIds].sort()

      const { data: candidateLinks, error: candidateError } =
        await supabase
          .from('shift_section_tables')
          .select('shift_section_id, table_id')
          .in('table_id', selectedTableIds)

      if (candidateError) {
        throw candidateError
      }

      const candidateIds = Array.from(
        new Set(
          (candidateLinks ?? []).map(
            (row) => row.shift_section_id,
          ),
        ),
      )

      let exactSectionIds: string[] = []

      if (candidateIds.length > 0) {
        const { data: allLinks, error: linksError } =
          await supabase
            .from('shift_section_tables')
            .select('shift_section_id, table_id')
            .in('shift_section_id', candidateIds)

        if (linksError) {
          throw linksError
        }

        const grouped = new Map<string, string[]>()

        ;(allLinks ?? []).forEach((row) => {
          const current =
            grouped.get(row.shift_section_id) ?? []

          current.push(row.table_id)
          grouped.set(row.shift_section_id, current)
        })

        exactSectionIds = Array.from(grouped.entries())
          .filter(([, tableIds]) => {
            const historicalSorted = [...tableIds].sort()

            return (
              historicalSorted.length ===
                selectedSorted.length &&
              historicalSorted.every(
                (tableId, index) =>
                  tableId === selectedSorted[index],
              )
            )
          })
          .map(([sectionId]) => sectionId)
      }

      let performanceQuery = supabase
        .from('section_performance')
        .select(
          'employee_id, net_sales, sales_per_hour, shift_section_id',
        )
        .eq('location_id', locationId)

      if (exactSectionIds.length > 0) {
        performanceQuery = performanceQuery.in(
          'shift_section_id',
          exactSectionIds,
        )
      }

      const {
        data: performanceRows,
        error: performanceError,
      } = await performanceQuery.limit(500)

      if (performanceError) {
        throw performanceError
      }

      const employeeStats = new Map<
        string,
        {
          salesPerHour: number
          netSales: number
          count: number
        }
      >()

      ;(performanceRows ?? []).forEach((row) => {
        const current = employeeStats.get(row.employee_id) ?? {
          salesPerHour: 0,
          netSales: 0,
          count: 0,
        }

        current.salesPerHour +=
          Number(row.sales_per_hour) || 0
        current.netSales += Number(row.net_sales) || 0
        current.count += 1

        employeeStats.set(row.employee_id, current)
      })

      const currentSeatLoad = new Map<string, number>()

      assignments.forEach((assignment) => {
        const table = tables.find(
          (item) => item.id === assignment.table_id,
        )

        currentSeatLoad.set(
          assignment.server_id,
          (currentSeatLoad.get(assignment.server_id) ?? 0) +
            (table?.seat_count ?? 0),
        )
      })

      const eligibleTeam = team.filter((member) => {
        const role = member.role.toLowerCase()

        return (
          role.includes('server') ||
          role.includes('bartender') ||
          role.includes('manager')
        )
      })

      const candidates =
        eligibleTeam.length > 0 ? eligibleTeam : team

      const historicalAverages = candidates.map((member) => {
        const stats = employeeStats.get(member.user_id)
        const count = stats?.count ?? 0

        return {
          member,
          avgSalesPerHour:
            count > 0
              ? (stats?.salesPerHour ?? 0) / count
              : 0,
          avgNetSales:
            count > 0
              ? (stats?.netSales ?? 0) / count
              : 0,
          uses: count,
          currentSeats:
            currentSeatLoad.get(member.user_id) ?? 0,
        }
      })

      const maxSalesPerHour = Math.max(
        1,
        ...historicalAverages.map(
          (item) => item.avgSalesPerHour,
        ),
      )

      const maxSeatLoad = Math.max(
        1,
        ...historicalAverages.map(
          (item) => item.currentSeats,
        ),
      )

      const recommendations = historicalAverages
        .map((item) => {
          const performancePoints =
            item.uses > 0
              ? (item.avgSalesPerHour / maxSalesPerHour) * 70
              : 35

          const balancePoints =
            30 *
            (1 - item.currentSeats / maxSeatLoad)

          const score = Math.round(
            Math.min(
              100,
              Math.max(
                0,
                performancePoints + balancePoints,
              ),
            ),
          )

          const exactHistory = exactSectionIds.length > 0

          return {
            employeeId: item.member.user_id,
            employeeName: memberName(item.member.user_id),
            score,
            avgSalesPerHour: item.avgSalesPerHour,
            avgNetSales: item.avgNetSales,
            historicalUses: item.uses,
            currentSeats: item.currentSeats,
            exactHistory,
            reason:
              item.uses > 0
                ? exactHistory
                  ? 'Historical performance on this exact table combination plus current section balance.'
                  : 'Historical section performance plus current section balance.'
                : 'No historical performance yet; recommendation is based mainly on current section balance.',
          }
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)

      setSmartRecommendations(recommendations)
      setShowSmartPanel(true)
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to calculate section recommendations.',
      )
    } finally {
      setSmartLoading(false)
    }
  }

  const activeTables = useMemo(
    () =>
      tables.filter(
        (table) =>
          table.room_id === activeRoomId,
      ),
    [tables, activeRoomId],
  )

  const selectedTables = useMemo(
    () =>
      tables.filter((table) =>
        selectedTableIds.includes(table.id),
      ),
    [tables, selectedTableIds],
  )

  const selectedSeatCount = useMemo(
    () =>
      selectedTables.reduce(
        (total, table) =>
          total + table.seat_count,
        0,
      ),
    [selectedTables],
  )
  const selectedTable =
  selectedTableIds.length === 1
    ? tables.find(
        (table) =>
          table.id === selectedTableIds[0],
      ) ?? null
    : null

  const activeShift = shifts.find(
    (shift) => shift.id === activeShiftId,
  )

  function toggleTable(tableId: string) {
    setSelectedTableIds((current) =>
      current.includes(tableId)
        ? current.filter(
            (id) => id !== tableId,
          )
        : [...current, tableId],
    )
  }

  function memberName(userId: string) {
    const member = team.find(
      (teamMember) =>
        teamMember.user_id === userId,
    )

    return (
      member?.profile?.preferred_name ||
      member?.profile?.full_name ||
      'Employee'
    )
  }

  function tableServer(tableId: string) {
    const assignment = assignments.find(
      (item) =>
        item.table_id === tableId,
    )

    return assignment
      ? memberName(assignment.server_id)
      : ''
  }

  function tableSession(tableId: string) {
    return (
      activeSessions.find((session) =>
        session.tableIds.includes(tableId),
      ) ?? null
    )
  }

  function elapsedMinutes(seatedAt: string) {
    const started = new Date(seatedAt).getTime()

    if (Number.isNaN(started)) {
      return 0
    }

    return Math.max(
      0,
      Math.floor((clockTick - started) / 60000),
    )
  }


  function statusLabel(status: string) {
    switch (status) {
      case 'drinks':
        return '🟡 Drinks'
      case 'food':
        return '🟠 Food'
      case 'check':
        return '🟣 Check'
      case 'dirty':
        return '⚫ Dirty'
      case 'manager':
        return '🔴 Manager'
      case 'seated':
        return '🔵 Seated'
      default:
        return '🟢 Ready'
    }
  }

  function statusColor(status: string) {
    switch (status) {
      case 'drinks':
        return '#ca8a04'
      case 'food':
        return '#ea580c'
      case 'check':
        return '#7c3aed'
      case 'dirty':
        return '#4b5563'
      case 'manager':
        return '#dc2626'
      case 'seated':
        return '#2563eb'
      default:
        return undefined
    }
  }

  async function handleStatusChange(
    sessionId: string,
    nextStatus: string,
  ) {
    if (!activeShiftId) return

    try {
      setSaving(true)
      setError('')

      const updatePayload =
        nextStatus === 'ready'
          ? {
              status: 'ready',
              closed_at: new Date().toISOString(),
            }
          : {
              status: nextStatus,
              closed_at: null,
            }

      const { error: statusError } = await supabase
        .from('table_sessions')
        .update(updatePayload)
        .eq('id', sessionId)

      if (statusError) {
        throw statusError
      }

      await loadTableSessions(activeShiftId)

      if (nextStatus === 'ready') {
        setShowTablePanel(false)
        setSelectedTableIds([])
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to update table status.',
      )
    } finally {
      setSaving(false)
    }
  }

  async function loadRotation(shiftId: string) {
    const { data, error: rotationError } = await supabase
      .from('rotation_counters')
      .select(
        'id, user_id, slot_number, display_name, cover_count',
      )
      .eq('shift_id', shiftId)
      .order('slot_number')

    if (rotationError) {
      setError(rotationError.message)
      return
    }

    setRotationServers((data ?? []) as RotationCounter[])
  }

  function resizeRotationSetup(countValue: number) {
    const count = Math.max(1, Math.min(20, countValue))

    setRotationServerCount(count)

    setRotationSetupUserIds((current) =>
      Array.from({ length: count }, (_, index) => current[index] ?? ''),
    )

    setRotationCustomNames((current) =>
      Array.from({ length: count }, (_, index) => current[index] ?? ''),
    )
  }

  function eligibleRotationTeam() {
    const eligible = team.filter((member) => {
      const role = member.role.toLowerCase()

      return (
        role.includes('server') ||
        role.includes('bartender')
      )
    })

    return eligible.length > 0 ? eligible : team
  }

  async function handleBuildRotation() {
    if (!activeShiftId || !locationId || !organizationId) {
      setError('Open or select a shift first.')
      return
    }

    try {
      setSaving(true)
      setError('')

      const rows = Array.from(
        { length: rotationServerCount },
        (_, index) => {
          const selectedUserId =
            rotationSetupUserIds[index] ?? ''

          const selectedMember = team.find(
            (member) => member.user_id === selectedUserId,
          )

          const customName =
            (rotationCustomNames[index] ?? '').trim()

          const displayName =
            selectedMember
              ? memberName(selectedMember.user_id)
              : customName

          if (!displayName) {
            throw new Error(
              `Choose a name for server ${index + 1}.`,
            )
          }

          return {
            organization_id: organizationId,
            location_id: locationId,
            shift_id: activeShiftId,
            user_id: selectedMember?.user_id ?? null,
            slot_number: index + 1,
            display_name: displayName,
            cover_count: 0,
          }
        },
      )

      const { error: deleteError } = await supabase
        .from('rotation_counters')
        .delete()
        .eq('shift_id', activeShiftId)

      if (deleteError) throw deleteError

      const { error: insertError } = await supabase
        .from('rotation_counters')
        .insert(rows)

      if (insertError) throw insertError

      await loadRotation(activeShiftId)
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to build rotation.',
      )
    } finally {
      setSaving(false)
    }
  }

  async function addRotationCovers(
    rotationId: string,
    amount: number,
  ) {
    const server = rotationServers.find(
      (item) => item.id === rotationId,
    )

    if (!server) return

    const nextCount = Math.max(
      0,
      server.cover_count + amount,
    )

    setRotationServers((current) =>
      current.map((item) =>
        item.id === rotationId
          ? { ...item, cover_count: nextCount }
          : item,
      ),
    )

    const { error: updateError } = await supabase
      .from('rotation_counters')
      .update({ cover_count: nextCount })
      .eq('id', rotationId)

    if (updateError) {
      setError(updateError.message)
      await loadRotation(activeShiftId)
    }
  }

  async function resetRotation() {
    if (!activeShiftId) return

    const { error: resetError } = await supabase
      .from('rotation_counters')
      .update({ cover_count: 0 })
      .eq('shift_id', activeShiftId)

    if (resetError) {
      setError(resetError.message)
      return
    }

    await loadRotation(activeShiftId)
  }

  async function clearRotation() {
    if (!activeShiftId) return

    const { error: clearError } = await supabase
      .from('rotation_counters')
      .delete()
      .eq('shift_id', activeShiftId)

    if (clearError) {
      setError(clearError.message)
      return
    }

    setRotationServers([])
    resizeRotationSetup(rotationServerCount)
  }

  function nextRotationServer() {
    if (rotationServers.length === 0) return null

    return [...rotationServers].sort(
      (a, b) =>
        a.cover_count - b.cover_count ||
        a.slot_number - b.slot_number,
    )[0]
  }

  function openTableEditor(table: FloorTable) {
    setEditingTableId(table.id)
    setEditTableName(table.table_name)
    setEditSeatCount(table.seat_count)
    setShowTableEditor(true)
  }

  async function handleSaveTableEdits() {
    if (!editingTableId) return

    try {
      setSaving(true)
      setError('')

      const cleanName = editTableName.trim()

      if (!cleanName) {
        throw new Error('Table name is required.')
      }

      const seatCount = Math.max(1, Math.round(editSeatCount))

      const { error: updateError } = await supabase
        .from('floor_tables')
        .update({
          table_name: cleanName,
          seat_count: seatCount,
        })
        .eq('id', editingTableId)
        .eq('location_id', locationId)

      if (updateError) throw updateError

      setTables((current) =>
        current.map((table) =>
          table.id === editingTableId
            ? {
                ...table,
                table_name: cleanName,
                seat_count: seatCount,
              }
            : table,
        ),
      )

      setShowTableEditor(false)
      setEditingTableId('')
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to update the table.',
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleAddTable() {
    if (!activeRoomId || !locationId) {
      setError('Choose a room before adding a table.')
      return
    }

    try {
      setSaving(true)
      setError('')

      const cleanName = newTableName.trim()

      if (!cleanName) {
        throw new Error('Enter a table name.')
      }

      const roomTables = tables.filter(
        (table) => table.room_id === activeRoomId,
      )

      const column = roomTables.length % 6
      const row = Math.floor(roomTables.length / 6)

      const { data: createdTable, error: insertError } =
        await supabase
          .from('floor_tables')
          .insert({
            location_id: locationId,
            room_id: activeRoomId,
            table_name: cleanName,
            seat_count: Math.max(
              1,
              Math.round(newTableSeats),
            ),
            shape: newTableShape,
            position_x: 8 + column * 15,
            position_y: 10 + row * 18,
            width:
              newTableShape === 'rectangle' ? 16 : 10,
            height: 10,
            is_active: true,
          })
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
          .single()

      if (insertError) throw insertError

      setTables((current) => [
        ...current,
        createdTable as FloorTable,
      ])

      setNewTableName('')
      setNewTableSeats(2)
      setNewTableShape('round')
      setShowAddTablePanel(false)
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to add the table.',
      )
    } finally {
      setSaving(false)
    }
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

      setShifts((current) => [
        ...current,
        shift,
      ])

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

  async function handleCreateSection() {
    if (!activeShiftId) {
      setError(
        'Open or select a shift first.',
      )
      return
    }

    if (
      !selectedServerId ||
      selectedTableIds.length === 0
    ) {
      return
    }

    const finalSectionName =
      sectionName.trim() ||
      `Section ${String.fromCharCode(
        65 + sectionCards.length,
      )}`

    try {
      setSaving(true)
      setError('')

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError) throw userError

      if (!user) {
        throw new Error(
          'You must be signed in.',
        )
      }

      const {
        data: configuration,
        error: configurationError,
      } = await supabase
        .from('section_configurations')
        .insert({
          organization_id: organizationId,
          location_id: locationId,
          name: finalSectionName,
          total_seats: selectedSeatCount,
          is_saved_template: false,
          created_by: user.id,
        })
        .select('id')
        .single()

      if (configurationError) {
        throw configurationError
      }

      const configurationTables =
        selectedTableIds.map((tableId) => ({
          section_configuration_id:
            configuration.id,
          table_id: tableId,
        }))

      const {
        error: configurationTablesError,
      } = await supabase
        .from('section_configuration_tables')
        .insert(configurationTables)

      if (configurationTablesError) {
        throw configurationTablesError
      }

      const {
        data: shiftSection,
        error: shiftSectionError,
      } = await supabase
        .from('shift_sections')
        .insert({
          organization_id: organizationId,
          location_id: locationId,
          shift_id: activeShiftId,
          section_configuration_id:
            configuration.id,
          employee_id: selectedServerId,
          assigned_by: user.id,
          assignment_status: 'active',
        })
        .select('id')
        .single()

      if (shiftSectionError) {
        throw shiftSectionError
      }

      const shiftTables =
        selectedTableIds.map((tableId) => ({
          shift_section_id:
            shiftSection.id,
          table_id: tableId,
        }))

      const { error: shiftTablesError } =
        await supabase
          .from('shift_section_tables')
          .insert(shiftTables)

      if (shiftTablesError) {
        throw shiftTablesError
      }

      const assignmentRows =
        selectedTableIds.map((tableId) => ({
          organization_id: organizationId,
          location_id: locationId,
          shift_id: activeShiftId,
          table_id: tableId,
          server_id: selectedServerId,
          assigned_by: user.id,
          assigned_at:
            new Date().toISOString(),
        }))

      const { error: assignmentError } =
        await supabase
          .from('server_assignments')
          .upsert(assignmentRows, {
            onConflict:
              'shift_id,table_id',
          })

      if (assignmentError) {
        throw assignmentError
      }

      await Promise.all([
        loadAssignments(activeShiftId),
        loadSections(activeShiftId),
      ])

      setSelectedTableIds([])
      setSelectedServerId('')
      setSectionName('')
      setShowSectionPanel(false)
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to create the section.',
      )
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="empty-state">
        Loading floor plan…
      </div>
    )
  }
  async function handleSeatGuests() {
    if (selectedTableIds.length === 0 || !activeShiftId) {
      setError('Select at least one table and open a shift first.')
      return
    }

    try {
      setSaving(true)
      setError('')

      const primaryTableId = selectedTableIds[0]

      const assignedServer = assignments.find(
        (item) => item.table_id === primaryTableId,
      )

      const {
        data: session,
        error: sessionError,
      } = await supabase
        .from('table_sessions')
        .insert({
          organization_id: organizationId,
          location_id: locationId,
          shift_id: activeShiftId,
          table_id: primaryTableId,
          server_id: assignedServer?.server_id ?? null,
          guest_name: guestName.trim() || null,
          guest_phone: guestPhone.trim() || null,
          guest_email: guestEmail.trim() || null,
          party_size: partySize,
          status: 'seated',
          seated_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (sessionError) {
        throw sessionError
      }

      const sessionTables = selectedTableIds.map((tableId) => ({
        table_session_id: session.id,
        table_id: tableId,
      }))

      const { error: tableLinkError } = await supabase
        .from('table_session_tables')
        .insert(sessionTables)

      if (tableLinkError) {
        throw tableLinkError
      }

      await loadTableSessions(activeShiftId)

      setGuestName('')
      setGuestPhone('')
      setGuestEmail('')
      setPartySize(1)
      setShowSeatPanel(false)
      setSelectedTableIds([])
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to seat guests.',
      )
    } finally {
      setSaving(false)
    }
  }

  if (error && rooms.length === 0) {
    return (
      <div className="empty-state">
        <strong>
          We could not load FloorFlow.
        </strong>

        <span>{error}</span>
      </div>
    )
  }

  return (
    <section>
      <div className="page-heading">
        <p className="eyebrow">
          FloorFlow
        </p>

        <h1>Live floor</h1>

        <p className="muted">
          {locationName}
        </p>
      </div>

      <div className="shift-toolbar">
        {shifts.length > 0 ? (
          <select
            value={activeShiftId}
            onChange={(event) =>
              setActiveShiftId(
                event.target.value,
              )
            }
          >
            {shifts.map((shift) => (
              <option
                key={shift.id}
                value={shift.id}
              >
                {shift.shift_name} ·{' '}
                {shift.status}
              </option>
            ))}
          </select>
        ) : (
          <span>No open shift</span>
        )}

        <button
          onClick={() =>
            setShowShiftPanel(true)
          }
        >
          Open shift
        </button>

        <button
          onClick={() => setShowReservationsPanel(true)}
        >
          Reservations ({reservations.length})
        </button>

        <label
          style={{
            padding: '10px 12px',
            border: '1px solid #334155',
            borderRadius: '11px',
            background: '#111b2d',
            color: '#f8fafc',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Upload CSV
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={handleReservationUpload}
            style={{ display: 'none' }}
          />
        </label>

        <button
          onClick={() => setShowAddTablePanel(true)}
          disabled={!activeRoomId}
        >
          + Add Table
        </button>

        <button
          onClick={() => setShowRotationPanel(true)}
          disabled={!activeShiftId}
        >
          Rotation
        </button>
      </div>

      {error && (
        <div className="inline-error">
          {error}
        </div>
      )}

      <div className="room-tabs">
        {rooms.map((room) => (
          <button
            key={room.id}
            className={
              room.id === activeRoomId
                ? 'active'
                : ''
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

      {/* LIVE FLOOR */}
      <div className="floor-canvas">
        {activeTables.map((table) => {
          const selected =
            selectedTableIds.includes(
              table.id,
            )

          const assignedServer =
            tableServer(table.id)

          const activeSession =
            tableSession(table.id)

          const upcomingReservation =
            reservationForTable(table.id)

          return (
            <button
              key={table.id}
              className={`floor-table ${
                table.shape
              } ${
                selected ? 'selected' : ''
              } ${
                activeSession ? 'occupied' : ''
              }`}
              style={{
                left: `${table.position_x}%`,
                top: `${table.position_y}%`,
                width: `${table.width}%`,
                height: `${table.height}%`,
                background: activeSession
                  ? statusColor(activeSession.status)
                  : undefined,
                color: activeSession
                  ? '#ffffff'
                  : undefined,
                border: selected
                  ? '3px solid #f4b860'
                  : undefined,
              }}
              onClick={() =>
                toggleTable(table.id)
              }
            >
              <strong>
                {table.table_name}
              </strong>

              <span>
                {assignedServer ||
                  `${table.seat_count} seats`}
              </span>

              {!activeSession && upcomingReservation && (
                <span
                  style={{
                    display: 'block',
                    marginTop: '4px',
                    fontSize: '10px',
                    fontWeight: 700,
                  }}
                >
                  {formatReservationTime(upcomingReservation.reservation_time)} ·{' '}
                  {upcomingReservation.guest_name}
                  {upcomingReservation.is_birthday ? ' 🎂' : ''}
                  {upcomingReservation.is_vip ? ' ⭐' : ''}
                </span>
              )}

              {activeSession && (
                <>
                  <span
                    style={{
                      display: 'block',
                      marginTop: '4px',
                      fontSize: '10px',
                      fontWeight: 700,
                    }}
                  >
                    {statusLabel(activeSession.status)}
                  </span>

                  <span
                    style={{
                      display: 'block',
                      marginTop: '2px',
                      fontSize: '11px',
                      fontWeight: 700,
                    }}
                  >
                    {activeSession.partySize} guests ·{' '}
                    {elapsedMinutes(
                      activeSession.seatedAt,
                    )}
                    m
                  </span>
                </>
              )}
            </button>
          )
        })}
      </div>

      {/* SECTION CARDS — BELOW FLOOR */}
      {sectionCards.length > 0 && (
        <div
          style={{
            marginTop: '24px',
            marginBottom: '120px',
          }}
        >
          <p className="eyebrow">
            Tonight&apos;s Floor
          </p>

          <h2>Sections</h2>

          <div
            style={{
              display: 'grid',
              gap: '12px',
              marginTop: '12px',
            }}
          >
            {sectionCards.map(
              (section) => {
                const sectionTables =
                  tables.filter((table) =>
                    section.tableIds.includes(
                      table.id,
                    ),
                  )

                return (
                  <button
                    key={section.id}
                    onClick={() =>
                      setSelectedTableIds(
                        section.tableIds,
                      )
                    }
                    style={{
                      textAlign: 'left',
                      padding: '16px',
                      borderRadius: '16px',
                      border:
                        '1px solid #334155',
                      background: '#111827',
                      color: '#f8fafc',
                      cursor: 'pointer',
                      width: '100%',
                    }}
                  >
                    <strong
                      style={{
                        display: 'block',
                        fontSize: '18px',
                      }}
                    >
                      {section.name}
                    </strong>

                    <span
                      style={{
                        display: 'block',
                        marginTop: '4px',
                        color: '#f4b860',
                      }}
                    >
                      {memberName(
                        section.employeeId,
                      )}
                    </span>

                    <span
                      style={{
                        display: 'block',
                        marginTop: '10px',
                      }}
                    >
                      {sectionTables
                        .map(
                          (table) =>
                            table.table_name,
                        )
                        .join(', ')}
                    </span>

                    <span
                      style={{
                        display: 'block',
                        marginTop: '6px',
                        opacity: 0.7,
                        fontSize: '13px',
                      }}
                    >
                      {
                        section.tableIds.length
                      }{' '}
                      tables ·{' '}
                      {section.totalSeats} seats
                    </span>
                  </button>
                )
              },
            )}
          </div>
        </div>
      )}

      {/* TABLE ACTION BAR */}
      {selectedTableIds.length > 0 && (
        <div className="floor-action-bar">
          <span>
            {selectedTableIds.length}{' '}
            {selectedTableIds.length === 1
              ? 'table'
              : 'tables'}{' '}
            · {selectedSeatCount} seats
          </span>

          <button
            onClick={() =>
              setSelectedTableIds([])
            }
          >
            Clear
          </button>
          {selectedTable && (
  <button
    onClick={() =>
      setShowTablePanel(true)
    }
  >
    Details
  </button>
)}

          <button
            onClick={() => {
              if (!activeShift) {
                setError(
                  'Open or select a shift before creating a section.',
                )
                return
              }

              setShowSectionPanel(true)
            }}
          >
            Create Section
          </button>


          <button
            onClick={handleSmartSection}
            disabled={smartLoading}
          >
            {smartLoading ? 'Analyzing…' : 'Smart Section'}
          </button>

          <button
            disabled={selectedTableIds.length === 0}
            onClick={() => {
              setShowSeatPanel(true)
            }}
          >
            Seat
          </button>

          <button disabled>
            Status
          </button>
        </div>
      )}

      {/* OPEN SHIFT PANEL */}
      {showShiftPanel && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h2>
              Open today&apos;s shift
            </h2>

            <label>
              Shift

              <select
                value={newShiftName}
                onChange={(event) =>
                  setNewShiftName(
                    event.target.value,
                  )
                }
              >
                <option>Dinner</option>
                <option>Lunch</option>
                <option>Brunch</option>
                <option>
                  Private Event
                </option>
              </select>
            </label>

            <div className="modal-actions">
              <button
                onClick={() =>
                  setShowShiftPanel(false)
                }
              >
                Cancel
              </button>

              <button
                className="primary-button"
                onClick={handleCreateShift}
                disabled={saving}
              >
                {saving
                  ? 'Opening…'
                  : 'Open shift'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE SECTION PANEL */}
      {showSectionPanel && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h2>Create section</h2>

            <label>
              Section name

              <input
                value={sectionName}
                onChange={(event) =>
                  setSectionName(
                    event.target.value,
                  )
                }
                placeholder="Optional — Section A"
              />
            </label>

            <label
              style={{
                marginTop: '14px',
              }}
            >
              Server

              <select
                value={selectedServerId}
                onChange={(event) =>
                  setSelectedServerId(
                    event.target.value,
                  )
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
                    {memberName(
                      member.user_id,
                    )}{' '}
                    ·{' '}
                    {member.role
                      .split('_')
                      .join(' ')}
                  </option>
                ))}
              </select>
            </label>

            <div
              style={{
                padding: '12px',
                borderRadius: '12px',
                background: '#0f172a',
                marginTop: '14px',
              }}
            >
              <strong>
                {selectedTableIds.length}{' '}
                {selectedTableIds.length === 1
                  ? 'table'
                  : 'tables'}
              </strong>

              <div
                style={{
                  marginTop: '6px',
                }}
              >
                {selectedTables
                  .map(
                    (table) =>
                      table.table_name,
                  )
                  .join(', ')}
              </div>

              <div
                style={{
                  marginTop: '6px',
                  opacity: 0.75,
                }}
              >
                {selectedSeatCount} seats
              </div>
            </div>

            <div className="modal-actions">
              <button
                onClick={() => {
                  setShowSectionPanel(false)
                  setSectionName('')
                  setSelectedServerId('')
                }}
              >
                Cancel
              </button>

              <button
                className="primary-button"
                onClick={
                  handleCreateSection
                }
                disabled={
                  !selectedServerId ||
                  saving
                }
              >
                {saving
                  ? 'Creating…'
                  : 'Create section'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showReservationsPanel && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <p className="eyebrow">Reservations</p>
            <h2>Today's Reservations</h2>

            {reservationUploadMessage && (
              <div
                style={{
                  padding: '10px 12px',
                  marginBottom: '12px',
                  borderRadius: '10px',
                  background: '#0f172a',
                }}
              >
                {reservationUploadMessage}
              </div>
            )}

            <div
              style={{
                display: 'grid',
                gap: '8px',
                maxHeight: '55vh',
                overflowY: 'auto',
              }}
            >
              {reservations.length === 0 ? (
                <div className="empty-state">
                  No reservations uploaded for this shift.
                </div>
              ) : (
                reservations.map((reservation) => (
                  <div
                    key={reservation.id}
                    style={{
                      padding: '12px',
                      borderRadius: '12px',
                      background: '#0f172a',
                      border: '1px solid #334155',
                    }}
                  >
                    <strong>
                      {formatReservationTime(reservation.reservation_time)} ·{' '}
                      {reservation.guest_name}
                    </strong>

                    <div style={{ marginTop: '4px' }}>
                      {reservation.party_size} guests
                      {reservation.table_name
                        ? ` · ${reservation.table_name}`
                        : ' · Unassigned table'}
                    </div>

                    <div
                      style={{
                        marginTop: '4px',
                        opacity: 0.75,
                        fontSize: '13px',
                      }}
                    >
                      {reservation.is_birthday ? '🎂 Birthday ' : ''}
                      {reservation.is_vip ? '⭐ VIP ' : ''}
                      {reservation.occasion || ''}
                    </div>
                  </div>
                ))
              )}
            </div>

            <button
              style={{
                width: '100%',
                marginTop: '14px',
                padding: '12px',
              }}
              onClick={() => setShowReservationsPanel(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {showSmartPanel && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <p className="eyebrow">SectionIQ</p>
            <h2>Smart Section</h2>

            <div
              style={{
                padding: '12px',
                borderRadius: '12px',
                background: '#0f172a',
                marginBottom: '14px',
              }}
            >
              <strong>
                {selectedTables
                  .map((table) => table.table_name)
                  .join(', ')}
              </strong>

              <div style={{ marginTop: '5px', opacity: 0.75 }}>
                {selectedSeatCount} seats ·{' '}
                {reservations
                  .filter((reservation) =>
                    selectedTableIds.includes(
                      reservation.table_id ?? '',
                    ),
                  )
                  .reduce(
                    (total, reservation) =>
                      total + reservation.party_size,
                    0,
                  )}{' '}
                upcoming reserved covers
              </div>
            </div>

            <div style={{ display: 'grid', gap: '10px' }}>
              {smartRecommendations.map(
                (recommendation, index) => (
                  <div
                    key={recommendation.employeeId}
                    style={{
                      padding: '14px',
                      borderRadius: '14px',
                      border: '1px solid #334155',
                      background:
                        index === 0 ? '#172033' : '#0f172a',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: '12px',
                        alignItems: 'center',
                      }}
                    >
                      <strong>
                        {index === 0 ? '⭐ ' : ''}
                        {recommendation.employeeName}
                      </strong>

                      <strong>
                        {recommendation.score}/100
                      </strong>
                    </div>

                    <div
                      style={{
                        marginTop: '6px',
                        fontSize: '13px',
                        opacity: 0.8,
                      }}
                    >
                      {recommendation.historicalUses > 0
                        ? `${recommendation.historicalUses} historical uses · $${recommendation.avgSalesPerHour.toFixed(
                            0,
                          )}/hr avg`
                        : 'No historical sales data yet'}
                    </div>

                    <div
                      style={{
                        marginTop: '4px',
                        fontSize: '13px',
                        opacity: 0.8,
                      }}
                    >
                      Current assigned capacity:{' '}
                      {recommendation.currentSeats} seats
                    </div>

                    <div
                      style={{
                        marginTop: '6px',
                        fontSize: '13px',
                      }}
                    >
                      {recommendation.reason}
                    </div>

                    <button
                      className="primary-button"
                      style={{
                        width: '100%',
                        marginTop: '10px',
                      }}
                      onClick={() => {
                        setSelectedServerId(
                          recommendation.employeeId,
                        )
                        setShowSmartPanel(false)
                        setShowSectionPanel(true)
                      }}
                    >
                      Use This Server
                    </button>
                  </div>
                ),
              )}

              {smartRecommendations.length === 0 && (
                <div className="empty-state">
                  No eligible employees were found.
                </div>
              )}
            </div>

            <button
              style={{
                width: '100%',
                marginTop: '14px',
                padding: '12px',
              }}
              onClick={() => setShowSmartPanel(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}



      {showRotationPanel && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <p className="eyebrow">Quick Rotation</p>
            <h2>Cover Counter</h2>

            {rotationServers.length === 0 ? (
              <>
                <label>
                  Number of servers
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={rotationServerCount}
                    onChange={(event) =>
                      resizeRotationSetup(
                        Number(event.target.value) || 1,
                      )
                    }
                  />
                </label>

                <div
                  style={{
                    display: 'grid',
                    gap: '10px',
                    marginTop: '14px',
                    maxHeight: '52vh',
                    overflowY: 'auto',
                  }}
                >
                  {Array.from(
                    { length: rotationServerCount },
                    (_, index) => (
                      <div
                        key={index}
                        style={{
                          padding: '12px',
                          borderRadius: '12px',
                          background: '#0f172a',
                          border: '1px solid #334155',
                        }}
                      >
                        <strong>
                          Server {index + 1}
                        </strong>

                        <select
                          style={{ marginTop: '8px' }}
                          value={
                            rotationSetupUserIds[index] ?? ''
                          }
                          onChange={(event) => {
                            const value = event.target.value

                            setRotationSetupUserIds(
                              (current) =>
                                current.map(
                                  (item, itemIndex) =>
                                    itemIndex === index
                                      ? value
                                      : item,
                                ),
                            )

                            if (value) {
                              setRotationCustomNames(
                                (current) =>
                                  current.map(
                                    (item, itemIndex) =>
                                      itemIndex === index
                                        ? ''
                                        : item,
                                  ),
                              )
                            }
                          }}
                        >
                          <option value="">
                            Choose from team
                          </option>

                          {eligibleRotationTeam().map(
                            (member) => (
                              <option
                                key={member.user_id}
                                value={member.user_id}
                              >
                                {memberName(member.user_id)}
                              </option>
                            ),
                          )}
                        </select>

                        <div
                          style={{
                            margin: '8px 0',
                            textAlign: 'center',
                            opacity: 0.65,
                            fontSize: '12px',
                          }}
                        >
                          OR
                        </div>

                        <input
                          value={
                            rotationCustomNames[index] ?? ''
                          }
                          onChange={(event) => {
                            const value = event.target.value

                            setRotationCustomNames(
                              (current) =>
                                current.map(
                                  (item, itemIndex) =>
                                    itemIndex === index
                                      ? value
                                      : item,
                                ),
                            )

                            if (value.trim()) {
                              setRotationSetupUserIds(
                                (current) =>
                                  current.map(
                                    (item, itemIndex) =>
                                      itemIndex === index
                                        ? ''
                                        : item,
                                  ),
                              )
                            }
                          }}
                          placeholder="Type a name"
                        />
                      </div>
                    ),
                  )}
                </div>

                <button
                  className="primary-button"
                  style={{
                    width: '100%',
                    marginTop: '14px',
                  }}
                  onClick={handleBuildRotation}
                  disabled={saving}
                >
                  {saving ? 'Starting…' : 'Start Rotation'}
                </button>
              </>
            ) : (
              <>
                <div
                  style={{
                    padding: '12px',
                    marginBottom: '12px',
                    borderRadius: '12px',
                    background: '#0f172a',
                    border: '1px solid #334155',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '12px',
                    }}
                  >
                    <div>
                      <strong>Running Cover Count</strong>
                      <div
                        style={{
                          marginTop: '2px',
                          opacity: 0.7,
                          fontSize: '12px',
                        }}
                      >
                        Live total across the rotation
                      </div>
                    </div>

                    <div
                      style={{
                        fontSize: '22px',
                        fontWeight: 800,
                      }}
                    >
                      {rotationServers.reduce(
                        (sum, server) =>
                          sum + server.cover_count,
                        0,
                      )}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gap: '10px',
                    maxHeight: '55vh',
                    overflowY: 'auto',
                  }}
                >
                  {[...rotationServers]
                    .sort(
                      (a, b) =>
                        a.cover_count - b.cover_count ||
                        a.slot_number - b.slot_number,
                    )
                    .map((server) => {
                      const nextUp =
                        nextRotationServer()?.id === server.id

                      return (
                    <div
                      key={server.id}
                      style={{
                        padding: '12px',
                        borderRadius: '12px',
                        background: '#0f172a',
                        border: nextUp
                          ? '2px solid #f4b860'
                          : '1px solid #334155',
                      }}
                    >
                      {nextUp && (
                        <div
                          style={{
                            marginBottom: '6px',
                            color: '#f4b860',
                            fontSize: '12px',
                            fontWeight: 800,
                            textTransform: 'uppercase',
                            letterSpacing: '0.08em',
                          }}
                        >
                          Next Up
                        </div>
                      )}
                    <div
                      key={server.id}
                      style={{
                        padding: '12px',
                        borderRadius: '12px',
                        background: '#0f172a',
                        border: '1px solid #334155',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: '12px',
                          alignItems: 'center',
                        }}
                      >
                        <strong
                          style={{
                            fontSize: '17px',
                          }}
                        >
                          {server.display_name}
                        </strong>

                        <strong
                          style={{
                            minWidth: '48px',
                            textAlign: 'center',
                            fontSize: '24px',
                          }}
                        >
                          {server.cover_count}
                        </strong>
                      </div>

                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns:
                            'repeat(5, 1fr)',
                          gap: '6px',
                          marginTop: '10px',
                        }}
                      >
                        {[1, 2, 3, 4, 5].map((covers) => (
                          <button
                            key={covers}
                            onClick={() =>
                              addRotationCovers(
                                server.id,
                                covers,
                              )
                            }
                          >
                            +{covers}
                          </button>
                        ))}
                      </div>

                      <button
                        style={{
                          width: '100%',
                          marginTop: '6px',
                        }}
                        onClick={() =>
                          addRotationCovers(server.id, -1)
                        }
                      >
                        −1 Cover
                      </button>
                    </div>
                      </div>
                      )
                    })}
                </div>

                <div className="modal-actions">
                  <button onClick={resetRotation}>
                    Reset Counts
                  </button>

                  <button onClick={clearRotation}>
                    Change Servers
                  </button>
                </div>
              </>
            )}

            <button
              style={{
                width: '100%',
                marginTop: '12px',
                padding: '12px',
              }}
              onClick={() => setShowRotationPanel(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {showTableEditor && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <p className="eyebrow">Floor Setup</p>
            <h2>Edit Table</h2>

            <label>
              Table name
              <input
                value={editTableName}
                onChange={(event) =>
                  setEditTableName(event.target.value)
                }
                placeholder="B7"
              />
            </label>

            <label style={{ marginTop: '12px' }}>
              Number of seats
              <input
                type="number"
                min="1"
                max="50"
                value={editSeatCount}
                onChange={(event) =>
                  setEditSeatCount(
                    Math.max(
                      1,
                      Number(event.target.value) || 1,
                    ),
                  )
                }
              />
            </label>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '8px',
                marginTop: '12px',
              }}
            >
              <button
                onClick={() =>
                  setEditSeatCount((current) =>
                    Math.max(1, current - 1),
                  )
                }
              >
                − Seat
              </button>

              <button
                onClick={() =>
                  setEditSeatCount((current) => current + 1)
                }
              >
                + Seat
              </button>
            </div>

            <div className="modal-actions">
              <button
                onClick={() => setShowTableEditor(false)}
              >
                Cancel
              </button>

              <button
                className="primary-button"
                onClick={handleSaveTableEdits}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save Table'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddTablePanel && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <p className="eyebrow">Floor Setup</p>
            <h2>Add Table</h2>

            <div
              style={{
                marginBottom: '12px',
                opacity: 0.75,
              }}
            >
              Adding to:{' '}
              {rooms.find((room) => room.id === activeRoomId)
                ?.name || 'Current room'}
            </div>

            <label>
              Table name
              <input
                value={newTableName}
                onChange={(event) =>
                  setNewTableName(event.target.value)
                }
                placeholder="B7"
              />
            </label>

            <label style={{ marginTop: '12px' }}>
              Seats
              <input
                type="number"
                min="1"
                max="50"
                value={newTableSeats}
                onChange={(event) =>
                  setNewTableSeats(
                    Math.max(
                      1,
                      Number(event.target.value) || 1,
                    ),
                  )
                }
              />
            </label>

            <label style={{ marginTop: '12px' }}>
              Shape
              <select
                value={newTableShape}
                onChange={(event) =>
                  setNewTableShape(
                    event.target.value as
                      | 'round'
                      | 'square'
                      | 'rectangle',
                  )
                }
              >
                <option value="round">Round</option>
                <option value="square">Square</option>
                <option value="rectangle">
                  Rectangle
                </option>
              </select>
            </label>

            <div className="modal-actions">
              <button
                onClick={() => setShowAddTablePanel(false)}
              >
                Cancel
              </button>

              <button
                className="primary-button"
                onClick={handleAddTable}
                disabled={saving || !newTableName.trim()}
              >
                {saving ? 'Adding…' : 'Add Table'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTablePanel && selectedTable && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <p className="eyebrow">Table Details</p>

            <h2>{selectedTable.table_name}</h2>

            <div
              style={{
                display: 'grid',
                gap: '12px',
                marginTop: '16px',
                marginBottom: '20px',
              }}
            >
              <div>
                <strong>Seats</strong>
                <div>{selectedTable.seat_count}</div>
              </div>

              <div>
                <strong>Server</strong>
                <div>
                  {tableServer(selectedTable.id) || 'Unassigned'}
                </div>
              </div>

              <div>
                <strong>Status</strong>
                <div>
                  {tableSession(selectedTable.id)
                    ? statusLabel(
                        tableSession(selectedTable.id)!.status,
                      )
                    : '🟢 Ready'}
                </div>
              </div>

              {tableSession(selectedTable.id) && (
                <>
                  <div>
                    <strong>Party</strong>
                    <div>
                      {tableSession(selectedTable.id)
                        ?.guestName || 'Walk-in'}
                    </div>
                  </div>

                  <div>
                    <strong>Guests</strong>
                    <div>
                      {
                        tableSession(selectedTable.id)
                          ?.partySize
                      }
                    </div>
                  </div>

                  <div>
                    <strong>Time Seated</strong>
                    <div>
                      {elapsedMinutes(
                        tableSession(selectedTable.id)!
                          .seatedAt,
                      )}{' '}
                      min
                    </div>
                  </div>
                </>
              )}
            </div>

            <div
              style={{
                display: 'grid',
                gap: '10px',
              }}
            >
              <button
                className="primary-button"
                onClick={() => {
                  setShowTablePanel(false)
                  setShowSeatPanel(true)
                }}
              >
                Seat Guests
              </button>

              {tableSession(selectedTable.id) ? (
                <>
                  <button
                    onClick={() =>
                      handleStatusChange(
                        tableSession(selectedTable.id)!.id,
                        'seated',
                      )
                    }
                    disabled={saving}
                  >
                    🔵 Seated
                  </button>

                  <button
                    onClick={() =>
                      handleStatusChange(
                        tableSession(selectedTable.id)!.id,
                        'drinks',
                      )
                    }
                    disabled={saving}
                  >
                    🟡 Drinks
                  </button>

                  <button
                    onClick={() =>
                      handleStatusChange(
                        tableSession(selectedTable.id)!.id,
                        'food',
                      )
                    }
                    disabled={saving}
                  >
                    🟠 Food
                  </button>

                  <button
                    onClick={() =>
                      handleStatusChange(
                        tableSession(selectedTable.id)!.id,
                        'check',
                      )
                    }
                    disabled={saving}
                  >
                    🟣 Check
                  </button>

                  <button
                    onClick={() =>
                      handleStatusChange(
                        tableSession(selectedTable.id)!.id,
                        'dirty',
                      )
                    }
                    disabled={saving}
                  >
                    ⚫ Dirty / Needs Busser
                  </button>

                  <button
                    onClick={() =>
                      handleStatusChange(
                        tableSession(selectedTable.id)!.id,
                        'manager',
                      )
                    }
                    disabled={saving}
                  >
                    🔴 Manager Assist
                  </button>

                  <button
                    className="primary-button"
                    onClick={() =>
                      handleStatusChange(
                        tableSession(selectedTable.id)!.id,
                        'ready',
                      )
                    }
                    disabled={saving}
                  >
                    🟢 Mark Ready / Close Table
                  </button>
                </>
              ) : (
                <button disabled>
                  No active table session
                </button>
              )}

              <button disabled>
                Transfer Table
              </button>

              <button
                onClick={() => {
                  setShowTablePanel(false)
                  openTableEditor(selectedTable)
                }}
              >
                Edit Table
              </button>

              <button
                onClick={() => setShowTablePanel(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showSeatPanel && selectedTableIds.length > 0 && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <p className="eyebrow">Seat Guests</p>

            <h2>
              {selectedTableIds.length === 1
                ? selectedTables[0]?.table_name
                : `${selectedTableIds.length} Tables`}
            </h2>

            <div
              style={{
                marginTop: '8px',
                marginBottom: '12px',
                opacity: 0.75,
              }}
            >
              {selectedTables
                .map((table) => table.table_name)
                .join(', ')}
            </div>

            <label>
              Guest name
              <input
                value={guestName}
                onChange={(event) =>
                  setGuestName(event.target.value)
                }
                placeholder="Guest name"
              />
            </label>

            <label style={{ marginTop: '12px' }}>
              Phone number
              <input
                value={guestPhone}
                onChange={(event) =>
                  setGuestPhone(event.target.value)
                }
                placeholder="504-555-1234"
              />
            </label>

            <label style={{ marginTop: '12px' }}>
              Email
              <input
                type="email"
                value={guestEmail}
                onChange={(event) =>
                  setGuestEmail(event.target.value)
                }
                placeholder="guest@email.com"
              />
            </label>

            <label style={{ marginTop: '12px' }}>
              Party size
              <input
                type="number"
                min="1"
                value={partySize}
                onChange={(event) =>
                  setPartySize(
                    Math.max(
                      1,
                      Number(event.target.value) || 1,
                    ),
                  )
                }
              />
            </label>

            <div className="modal-actions">
              <button
                onClick={() => {
                  setShowSeatPanel(false)
                  setGuestName('')
                  setGuestPhone('')
                  setGuestEmail('')
                  setPartySize(1)
                }}
              >
                Cancel
              </button>

              <button
                className="primary-button"
                onClick={handleSeatGuests}
                disabled={saving}
              >
                {saving ? 'Seating…' : 'Seat Table'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
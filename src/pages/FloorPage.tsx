import { ManualReservation, reservationToday } from '../components/ManualReservation'
import { ScreenText } from "../components/ScreenText"
import { WalkinPanel, type Walkin } from '../components/WalkinPanel'
import { SectionEmployeePicker } from '../components/SectionEmployeePicker'
import { SectionSchedule, type SectionPlan } from '../components/SectionSchedule'
import { floorRoomRatio, floorTableGeometry } from '../lib/floorPhotoLayout'
import './FloorMap.css'
import { recommendSections } from '../lib/smartSections'
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'
import {
  loadLocationTeam,
  type TeamMember,
} from '../lib/team'
import {
  createShift,
  type Shift,
} from '../lib/shifts'
import './FloorSelection.css'

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
  server_id: string | null
  guest_name?: string | null
}

type ShiftSectionCard = {
  id: string
  configurationId: string
  name: string
  employeeId: string | null
  guestName?: string | null
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
  avgSalesPerHour: number | null
  timedUses: number
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


type RotationLogEntry = {
  id: string
  rotation_counter_id: string | null
  user_id: string | null
  display_name: string
  table_id: string | null
  table_name: string | null
  covers_delta: number
  action: string
  created_at: string
}

export function FloorPage() {
  const [pendingWalkin,setPendingWalkin]=useState<Walkin|null>(null)
  const [walkinRefresh,setWalkinRefresh]=useState(0)
  const [smartNotice,setSmartNotice]=useState('')
  const [floorNotice,setFloorNotice]=useState('')
  const [seatServerId,setSeatServerId]=useState('')
  const [manualReservation,setManualReservation]=useState(false)
  const [organizationId, setOrganizationId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [locationName, setLocationName] = useState('')

  const [rooms, setRooms] = useState<Room[]>([])
  const [tables, setTables] = useState<FloorTable[]>([])
  const [team, setTeam] = useState<TeamMember[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [activeShiftId, setActiveShiftId] = useState('')

  const [baseAssignments, setAssignments] =
    useState<ServerAssignment[]>([])

  const [baseSectionCards, setSectionCards] =
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
  const [showRotationLogPanel, setShowRotationLogPanel] =
    useState(false)
  const [rotationLog, setRotationLog] =
    useState<RotationLogEntry[]>([])
  const [rotationTableByServer, setRotationTableByServer] =
    useState<Record<string, string>>({})
  const [rotationCoversByServer, setRotationCoversByServer] =
    useState<Record<string, number>>({})


  const [clockTick, setClockTick] = useState(Date.now())

  const [scheduleRefresh,setScheduleRefresh]=useState(0)
  const [sectionPlans,setSectionPlans]=useState<SectionPlan[]>([])
  const [serverClockOffset,setServerClockOffset]=useState(0)
  const activePlans=useMemo(()=>sectionPlans.filter(p=>p.published_at && p.assignable && new Date(p.starts_at).getTime()<=clockTick+serverClockOffset && clockTick+serverClockOffset<new Date(p.ends_at).getTime()),[sectionPlans,clockTick,serverClockOffset])
  const plannedTables=useMemo(()=>new Set(activePlans.flatMap(p=>p.table_ids)),[activePlans])
  const assignments=useMemo(()=>[
    ...baseAssignments.filter(a=>!plannedTables.has(a.table_id)),
    ...activePlans.flatMap(p=>p.table_ids.map(id=>({id:`${p.id}:${id}`,table_id:id,server_id:p.employee_id,guest_name:p.guest_name})))
  ],[baseAssignments,activePlans,plannedTables])
  const sectionCards=useMemo(()=>[
    ...baseSectionCards.map(c=>({...c,tableIds:c.tableIds.filter(id=>!plannedTables.has(id)),totalSeats:c.tableIds.filter(id=>!plannedTables.has(id)).reduce((sum,id)=>sum+(tables.find(t=>t.id===id)?.seat_count??0),0)})).filter(c=>c.tableIds.length),
    ...activePlans.map(p=>({id:p.id,configurationId:p.id,name:`${p.name} (scheduled)`,employeeId:p.employee_id,guestName:p.guest_name,tableIds:p.table_ids,totalSeats:p.table_ids.reduce((sum,id)=>sum+(tables.find(t=>t.id===id)?.seat_count??0),0)}))
  ],[baseSectionCards,activePlans,plannedTables,tables])

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

  const [sectionGuestName,setSectionGuestName]=useState('')
  const [selectedServerId, setSelectedServerId] =
    useState('')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // --- Floor arrangement (drag-to-position) ---
  const [arrangeMode, setArrangeMode] = useState(false)
  const [draggingTableId, setDraggingTableId] = useState('')
  const floorCanvasRef = useRef<HTMLDivElement | null>(null)

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

          loadFloorShifts(location.id),
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

  async function loadFloorShifts(loc: string): Promise<Shift[]> {
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date())
    const get=(key:string)=>parts.find(p=>p.type===key)?.value
    const date=`${get('year')}-${get('month')}-${get('day')}`
    const r=await supabase.from('shifts').select('id,organization_id,location_id,shift_date,shift_name,status').eq('location_id',loc).eq('shift_date',date).in('status',['scheduled','open','closed']).order('created_at')
    if(r.error)throw r.error
    return ((r.data ?? []) as Shift[]).sort((a,b)=>({open:0,scheduled:1,closed:2,cancelled:3}[a.status]-{open:0,scheduled:1,closed:2,cancelled:3}[b.status]))
  }
  function openSeating() {
    if(activeShift?.status!=='open'){setError('Open the shift before seating guests. You can assign sections while it is scheduled or closed.');return}
    const servers=[...new Set(selectedTableIds.map(id=>assignments.find(a=>a.table_id===id)?.server_id).filter(Boolean))]
    setSeatServerId(servers.length===1?servers[0] ?? '':'')
    setShowSeatPanel(true)
  }
  async function loadAssignments(shiftId: string) {
    const { data, error: assignmentError } =
      await supabase
        .from('server_assignments')
        .select('id, table_id, server_id, guest_name')
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
        guest_name,
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
              guestName: section.guest_name,

              tableIds: (
                tableResult.data ?? []
              ).map((row) => row.table_id),

              totalSeats:
                (tableResult.data ?? []).reduce((sum,row)=>sum+(tables.find(t=>t.id===row.table_id)?.seat_count ?? 0),0),
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
      reservationToday()

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
        reservationToday()

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

      const merge=await supabase.rpc('reservation_merge',{p_location_id:locationId,p_rows:insertRows})
      if(merge.error)throw merge.error

      await loadReservations(locationId)

      setReservationUploadMessage(`${merge.data.added} new reservations added · ${merge.data.duplicates} duplicates skipped · ${merge.data.matched} new reservations matched to tables`)

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
    if (!selectedTableIds.length || smartLoading || saving || arrangeMode) return
    setSmartLoading(true);setSmartNotice('');setSmartRecommendations([]);setShowSmartPanel(true)
    const selected=[...selectedTableIds]
    const candidates=team.filter(m=>['server','bartender','manager','assistant_manager','general_manager','owner'].includes(m.role)).map(m=>({id:m.user_id,name:memberName(m.user_id)}))
    const loads:Record<string,number>={}
    assignments.filter(a=>!selected.includes(a.table_id)).forEach(a=>{if(a.server_id)loads[a.server_id]=(loads[a.server_id]??0)+(tables.find(t=>t.id===a.table_id)?.seat_count??0)})
    let rows:{employee_id:string;net_sales:number|null;table_match:boolean;hours_worked:number|null}[]=[]
    try {
      const history=await supabase.rpc('floor_closeout_history',{p_location_id:locationId,p_table_ids:selected})
      if(history.error)throw history.error
      rows=history.data??[]
      setSmartNotice('Uses up to 30 positive-sales server closeouts per person from the last 90 days. Matching table combinations are preferred when available. Recorded clock-in and clock-out enable hourly comparisons. Older forms still contribute net sales history. Current table capacity also affects suggestions.')
    } catch (e) {
      setSmartNotice(`Closeout sales history could not load: ${String((e as {message?:string}).message??e)}. Suggestions below use current assigned capacity.`)
    } finally {
      setSmartRecommendations(recommendSections(candidates,rows,loads));setSmartLoading(false)
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
    if (arrangeMode) return

    setSelectedTableIds((current) =>
      current.includes(tableId)
        ? current.filter(
            (id) => id !== tableId,
          )
        : [...current, tableId],
    )
  }

  // --- Drag-to-position handlers (Arrange Floor mode) ---
  function handleTablePointerDown(
    event: React.PointerEvent<HTMLButtonElement>,
    tableId: string,
  ) {
    if (!arrangeMode) return

    event.currentTarget.setPointerCapture(event.pointerId)
    setDraggingTableId(tableId)
  }

  function handleTablePointerMove(
    event: React.PointerEvent<HTMLButtonElement>,
  ) {
    if (!arrangeMode || !draggingTableId) return

    const canvas = floorCanvasRef.current

    if (!canvas) return

    const rect = canvas.getBoundingClientRect()

    const table = tables.find(
      (item) => item.id === draggingTableId,
    )

    if (!table) return

    const rawX =
      ((event.clientX - rect.left) / rect.width) * 100 -
      table.width / 2

    const rawY =
      ((event.clientY - rect.top) / rect.height) * 100 -
      table.height / 2

    const clampedX = Math.max(
      0,
      Math.min(100 - table.width, rawX),
    )

    const clampedY = Math.max(
      0,
      Math.min(100 - table.height, rawY),
    )

    setTables((current) =>
      current.map((item) =>
        item.id === draggingTableId
          ? {
              ...item,
              position_x: clampedX,
              position_y: clampedY,
            }
          : item,
      ),
    )
  }

  async function handleTablePointerUp() {
    if (!arrangeMode || !draggingTableId) return

    const tableId = draggingTableId
    setDraggingTableId('')

    const table = tables.find(
      (item) => item.id === tableId,
    )

    if (!table) return

    const { error: positionError } = await supabase
      .from('floor_tables')
      .update({
        position_x: table.position_x,
        position_y: table.position_y,
      })
      .eq('id', tableId)

    if (positionError) {
      setError(positionError.message)
    }
  }

  function memberName(userId: string | null) {
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
    const seated=activeSessions.find(session=>session.tableIds.includes(tableId)||session.primaryTableId===tableId)
    if(seated?.serverId)return memberName(seated.serverId)

    const assignment = assignments.find(
      (item) =>
        item.table_id === tableId,
    )

    return assignment
      ? assignment.guest_name || memberName(assignment.server_id)
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

    const nextRotation = (data ?? []) as RotationCounter[]
    setRotationServers(nextRotation)

    setRotationCoversByServer((current) => {
      const next = { ...current }
      nextRotation.forEach((server) => {
        if (!next[server.id]) next[server.id] = 2
      })
      return next
    })
  }

  async function loadRotationLog(shiftId: string) {
    const { data, error: logError } = await supabase
      .from('rotation_log')
      .select(
        'id, rotation_counter_id, user_id, display_name, table_id, table_name, covers_delta, action, created_at',
      )
      .eq('shift_id', shiftId)
      .order('created_at', { ascending: false })
      .limit(300)

    if (logError) {
      setError(logError.message)
      return
    }

    setRotationLog((data ?? []) as RotationLogEntry[])
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

  async function updateRotationCounter(
    rotationId: string,
    amount: number,
  ) {
    const server = rotationServers.find(
      (item) => item.id === rotationId,
    )

    if (!server) return null

    const nextCount = Math.max(
      0,
      server.cover_count + amount,
    )

    const actualDelta = nextCount - server.cover_count

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
      return null
    }

    return actualDelta
  }

  async function submitRotationSeating(
    rotationId: string,
    coversOverride?: number,
  ) {
    if (!activeShiftId || !locationId || !organizationId) {
      setError('Open or select a shift first.')
      return
    }

    const server = rotationServers.find(
      (item) => item.id === rotationId,
    )

    if (!server) return

    const tableId = rotationTableByServer[rotationId] ?? ''
    const table = tables.find((item) => item.id === tableId)

    if (!table) {
      setError(`Choose a table for ${server.display_name}.`)
      return
    }

    const covers = Math.max(
      1,
      Math.round(
        coversOverride ??
          rotationCoversByServer[rotationId] ??
          table.seat_count ??
          1,
      ),
    )

    try {
      setSaving(true)
      setError('')

      const actualDelta = await updateRotationCounter(
        rotationId,
        covers,
      )

      if (actualDelta === null) return

      const {
        data: { user },
      } = await supabase.auth.getUser()

      const { error: logError } = await supabase
        .from('rotation_log')
        .insert({
          organization_id: organizationId,
          location_id: locationId,
          shift_id: activeShiftId,
          rotation_counter_id: rotationId,
          user_id: server.user_id,
          display_name: server.display_name,
          table_id: table.id,
          table_name: table.table_name,
          covers_delta: actualDelta,
          action: 'seated',
          created_by: user?.id ?? null,
        })

      if (logError) {
        await updateRotationCounter(rotationId, -actualDelta)
        throw logError
      }

      setRotationCoversByServer((current) => ({
        ...current,
        [rotationId]: table.seat_count,
      }))

      await loadRotationLog(activeShiftId)
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to record the rotation seating.',
      )
    } finally {
      setSaving(false)
    }
  }

  async function correctRotationCover(rotationId: string) {
    if (!activeShiftId || !locationId || !organizationId) return

    const server = rotationServers.find(
      (item) => item.id === rotationId,
    )

    if (!server || server.cover_count <= 0) return

    try {
      setSaving(true)
      setError('')

      const actualDelta = await updateRotationCounter(
        rotationId,
        -1,
      )

      if (actualDelta === null || actualDelta === 0) return

      const {
        data: { user },
      } = await supabase.auth.getUser()

      const { error: logError } = await supabase
        .from('rotation_log')
        .insert({
          organization_id: organizationId,
          location_id: locationId,
          shift_id: activeShiftId,
          rotation_counter_id: rotationId,
          user_id: server.user_id,
          display_name: server.display_name,
          table_id: null,
          table_name: null,
          covers_delta: actualDelta,
          action: 'correction',
          created_by: user?.id ?? null,
        })

      if (logError) throw logError

      await loadRotationLog(activeShiftId)
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to correct the rotation count.',
      )
    } finally {
      setSaving(false)
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
    setRotationTableByServer({})
    setRotationCoversByServer({})
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

      let shift:Shift
      if(activeShift?.status==='scheduled'){
        const u=await supabase.auth.getUser();if(u.error)throw u.error
        const r=await supabase.from('shifts').update({status:'open',opened_by:u.data.user?.id,opened_at:new Date().toISOString()}).eq('id',activeShift.id).eq('location_id',locationId).eq('status','scheduled').select('id,organization_id,location_id,shift_date,shift_name,status').single()
        if(r.error)throw r.error
        shift=r.data as Shift
      }else shift=await createShift({organizationId,locationId,shiftName:newShiftName})
      setShifts(await loadFloorShifts(locationId))
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

  async function clearSectionAssignments(all=false){
    if(saving)return
    if(!window.confirm(all?'Clear all section assignments for this shift and active timed sections? Seated parties keep their server. Future plans are kept.':'Clear section assignments for the selected tables? Seated parties keep their server.'))return
    setSaving(true);setError('')
    try{const r=await supabase.rpc('floor_clear_section_assignments',{p_location_id:locationId,p_shift_id:activeShiftId||null,p_table_ids:all?null:selectedTableIds});if(r.error)throw r.error
      const planned=await supabase.rpc('floor_schedule_list',{p_location_id:locationId});if(planned.error)throw planned.error;setSectionPlans(planned.data.plans??[]);setScheduleRefresh(v=>v+1)
      if(activeShiftId)await Promise.all([loadAssignments(activeShiftId),loadSections(activeShiftId)])
      setSelectedTableIds([]);setFloorNotice(all?'Section assignments cleared. Select tables to build new sections.':'Selected table assignments cleared.')
    }catch(e){setError(String((e as {message?:string}).message??e))}finally{setSaving(false)}
  }
  async function handleCreateSection() {
    if (
      (!selectedServerId || (selectedServerId==='__name__'&&!sectionGuestName.trim())) ||
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

      const r=await supabase.rpc('floor_assign_section_person',{
        p_location_id:locationId,p_shift_id:activeShiftId || null,p_shift_name:newShiftName,
        p_name:finalSectionName,p_server_id:selectedServerId==='__name__'?null:selectedServerId,p_guest_name:selectedServerId==='__name__'?sectionGuestName.trim():null,p_table_ids:selectedTableIds,
      })
      if(r.error)throw r.error
      const shiftId=String(r.data.shift_id)
      setShifts(await loadFloorShifts(locationId));setActiveShiftId(shiftId)
      await Promise.all([loadAssignments(shiftId),loadSections(shiftId)])
      setFloorNotice('Section assigned. '+(r.data.status==='scheduled'?'Shift is scheduled; service has not opened.':''))
      setSelectedTableIds([])
      setSelectedServerId('');setSectionGuestName('')
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
      <div className="empty-state"><ScreenText id="FloorPage.6bd3823f78ebe444">
        Loading floor plan…
      </ScreenText></div>
    )
  }
  async function handleSeatGuests() {
    if (selectedTableIds.length === 0 || activeShift?.status!=='open') {
      setError('Select at least one table and open a shift first.')
      return
    }

    try {
      setSaving(true)
      setError('')

      const r=await supabase.rpc(pendingWalkin?'floor_seat_walkin':'floor_seat_party',{
        ...(pendingWalkin?{p_walkin_id:pendingWalkin.id,p_version:pendingWalkin.version}:{}),
        p_location_id:locationId,p_shift_id:activeShiftId,p_table_ids:selectedTableIds,
        p_server_id:seatServerId || null,p_guest_name:guestName,p_guest_phone:guestPhone,
        p_guest_email:guestEmail,p_party_size:partySize,
      })
      if(r.error)throw r.error
      setPendingWalkin(null)
      setWalkinRefresh(v=>v+1)
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
        <strong><ScreenText id="FloorPage.9affe661a5cddb9c">
          We could not load FloorFlow.
        </ScreenText></strong>

        <span>{error}</span>
      </div>
    )
  }

  return (
    <section>
      <div className="page-heading">
        <p className="eyebrow"><ScreenText id="FloorPage.5e1b43a1ec471952">
          FloorFlow
        </ScreenText></p>

        <h1><ScreenText id="FloorPage.6cd9d194a59b8361">Live floor</ScreenText></h1>

        <p className="muted">
          {locationName}
        </p>
      </div>


      <WalkinPanel locationId={locationId} refreshKey={walkinRefresh} onSeat={row=>{setPendingWalkin(row);setGuestName(row.guest_name);setGuestPhone(row.phone);setGuestEmail(row.email);setPartySize(row.party_size);if(selectedTableIds.length)openSeating()}} />
      {pendingWalkin&&<div className="wt-card" role="status"><strong><ScreenText id="FloorPage.72ad81f5e33ac981">Seating </ScreenText>{pendingWalkin.guest_name}<ScreenText id="FloorPage.0e1b1fe85997c7d1"> · party of </ScreenText>{pendingWalkin.party_size}</strong><p><ScreenText id="FloorPage.aaf48aa3abcc020d">Select their tables, then press Seat. Their check-in is marked seated when seating succeeds.</ScreenText></p><button type="button" disabled={saving} onClick={()=>{setPendingWalkin(null);setGuestName('');setGuestPhone('');setGuestEmail('');setPartySize(1)}}><ScreenText id="FloorPage.a3bf126804af00d4">Cancel walk-in selection</ScreenText></button></div>}

      {/* FLOOR SECTIONS AT TOP */}
      <SectionSchedule refreshKey={scheduleRefresh} locationId={locationId} selectedTableIds={selectedTableIds} tables={tables} employees={team.map(m=>({id:m.user_id,name:memberName(m.user_id)}))} onLoaded={(plans,offset)=>{setSectionPlans(plans);setServerClockOffset(offset)}} onSelect={setSelectedTableIds} />
      {sectionCards.length>0 && <section className="floor-section-summary"><p className="eyebrow"><ScreenText id="FloorPage.2e081cd59ce390e4">Current Floor</ScreenText></p><h2><ScreenText id="FloorPage.773db4a763e3d6a3">Assigned sections</ScreenText></h2><button type="button" disabled={saving||arrangeMode} onClick={()=>void clearSectionAssignments(true)}><ScreenText id="FloorPage.abe16c2c033d7292">Clear all sections</ScreenText></button><div>{sectionCards.map(c=><button key={c.id} onClick={()=>setSelectedTableIds(c.tableIds)}><strong>{c.name}</strong><span className="section-server">{c.guestName || memberName(c.employeeId)}</span><span>{tables.filter(t=>c.tableIds.includes(t.id)).map(t=>t.table_name).join(', ')}</span><span>{c.tableIds.length}<ScreenText id="FloorPage.7b01d68c1fbd4367"> tables · </ScreenText>{c.totalSeats}<ScreenText id="FloorPage.5a8f27d4d02c6b32"> seats</ScreenText></span></button>)}</div></section>}

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
          <span><ScreenText id="FloorPage.edbbd1c1ad3bf9bc">No shift selected · sections can be planned now</ScreenText></span>
        )}

        <button
          onClick={() =>
            setShowShiftPanel(true)
          }
        ><ScreenText id="FloorPage.546456d48459c5bd">
          Open shift
        </ScreenText></button>

        <button
          onClick={() => setShowReservationsPanel(true)}
        ><ScreenText id="FloorPage.c8c2e54ac7c982eb">
          Reservations (</ScreenText>{reservations.length})
        </button>

        <button type="button" disabled={saving||!locationId||!organizationId} onClick={()=>setManualReservation(true)}>+ Add reservation</button>
        {manualReservation&&<ManualReservation location={locationId} organization={organizationId} tables={tables} onClose={()=>setManualReservation(false)} onSaved={message=>{setReservationUploadMessage(message);setShowReservationsPanel(true);void loadReservations(locationId)}}/>}

        <label
          style={{
            padding: '10px 12px',
            border: '1px solid var(--app-border)',
            borderRadius: '11px',
            background: '#ffffff',
            color: 'var(--app-text)',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        ><ScreenText id="FloorPage.346926535ae5abe0">
          Upload CSV
          </ScreenText><input
            type="file"
            accept=".csv,text/csv"
            onChange={handleReservationUpload}
            style={{ display: 'none' }}
          />
        </label>

        <button
          onClick={() => setShowAddTablePanel(true)}
          disabled={!activeRoomId}
        ><ScreenText id="FloorPage.c4b9828f0770442f">
          + Add Table
        </ScreenText></button>

        <button
          onClick={() => {
            setArrangeMode((current) => !current)
            setSelectedTableIds([])
          }}
          disabled={!activeRoomId}
          style={
            arrangeMode
              ? {
                  background: '#f4b860',
                  color: '#ffffff',
                  fontWeight: 700,
                }
              : undefined
          }
        >
          {arrangeMode ? '✓ Done Arranging' : 'Arrange Floor'}
        </button>

        <button
          onClick={() => setShowRotationPanel(true)}
          disabled={!activeShiftId}
        ><ScreenText id="FloorPage.b15408ef8847a3b6">
          Rotation
        </ScreenText></button>
      </div>

      {error && (
        <div className="inline-error">
          {error}
        </div>
      )}

      {arrangeMode && (
        <div
          style={{
            padding: '10px 14px',
            margin: '10px 0',
            borderRadius: '10px',
            background: '#ffffff',
            border: '1px dashed #f4b860',
            color: '#f4b860',
            fontSize: '13px',
          }}
        ><ScreenText id="FloorPage.e2482425827e283f">
          Drag any table to match your real floor layout. Positions save automatically when you let go.
        </ScreenText></div>
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
            }}
          >
            {room.name}
          </button>
        ))}
      </div>

      <section className="floor-section-tools" aria-label="Section assignment">
        <div><strong><ScreenText id="FloorPage.7ae0af4dfe409f5d">Sections & tables</ScreenText></strong><p><ScreenText id="FloorPage.4ac45f2a6bb70ad0">Tap tables to select them. Switch rooms to include more tables.</ScreenText></p></div>
        <div className="floor-selection-list">{selectedTables.length?selectedTables.map(t=><button type="button" key={t.id} onClick={()=>toggleTable(t.id)}>{t.table_name} ×</button>):<span><ScreenText id="FloorPage.f8add3ec5d2c9bb7">No tables selected</ScreenText></span>}</div>
        <div className="floor-selection-actions"><button type="button" disabled={!selectedTableIds.length || smartLoading || saving || arrangeMode} onClick={()=>void handleSmartSection()}>{smartLoading?'Analyzing…':'✨ Smart Section'}</button><button type="button" disabled={!selectedTableIds.length || saving || arrangeMode} onClick={()=>setShowSectionPanel(true)}><ScreenText id="FloorPage.3df282d311f231b2">Assign section</ScreenText></button><button type="button" disabled={!selectedTableIds.length || saving || arrangeMode} onClick={openSeating}><ScreenText id="FloorPage.ec891dc9c52cf729">Seat selected tables</ScreenText></button><button type="button" disabled={!selectedTableIds.length} onClick={()=>setSelectedTableIds([])}><ScreenText id="FloorPage.2a943581190c3312">Clear selection</ScreenText></button><button type="button" disabled={!selectedTableIds.length||saving||arrangeMode} onClick={()=>void clearSectionAssignments()}><ScreenText id="FloorPage.310acd98ecea24b1">Clear assignments</ScreenText></button></div>

        {floorNotice && <p role="status">{floorNotice}</p>}
      </section>
      
       <p className="floor-map-hint"><ScreenText id="FloorPage.f3780ffe48f2e882">Swipe sideways on the map to view the whole room. Tap multiple tables to select them.</ScreenText></p>
       {/* LIVE FLOOR */}
       <div className="floor-map-scroll">
      <div
        className="floor-canvas"
        ref={floorCanvasRef}
        style={
          arrangeMode
            ? {
                position: 'relative',
                border: '1px dashed var(--app-accent, #d7b795)',
                aspectRatio: String(1/floorRoomRatio(rooms.find(r=>r.id===activeRoomId)?.name??'')),
                touchAction: 'none',
              }
            : { position: 'relative',aspectRatio: String(1/floorRoomRatio(rooms.find(r=>r.id===activeRoomId)?.name??'')) }
        }
      >
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
              aria-pressed={selected}
              aria-label={`${table.table_name}, ${table.seat_count} seats${selected ? ", selected" : ""}`}
              className={`floor-table ${
                table.shape
              } ${
                selected ? 'selected' : ''
              } ${
                activeSession ? 'occupied' : ''
              }`}
              style={{
                ...floorTableGeometry(table),
                background: activeSession
                  ? statusColor(activeSession.status)
                  : undefined,
                color: activeSession
                  ? '#ffffff'
                  : undefined,
                border: selected
                  ? '3px solid var(--app-accent, #d7b795)'
                  : arrangeMode
                  ? '2px dashed var(--app-muted)'
                  : undefined,
                cursor: arrangeMode
                  ? 'grab'
                  : undefined,
                touchAction: arrangeMode
                  ? 'none'
                  : undefined,
                opacity:
                  arrangeMode &&
                  draggingTableId === table.id
                    ? 0.7
                    : undefined,
              }}
              onClick={() =>
                toggleTable(table.id)
              }
              onPointerDown={(event) =>
                handleTablePointerDown(
                  event,
                  table.id,
                )
              }
              onPointerMove={
                handleTablePointerMove
              }
              onPointerUp={handleTablePointerUp}
              onPointerCancel={
                handleTablePointerUp
              }
            >
              <strong>
                {table.table_name}
              </strong>

              <span className="floor-table-caption">
                {assignedServer ||
                  `${table.seat_count} seats`}
              </span>

              {!activeSession && upcomingReservation && (
                <span className="floor-table-status"
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
                  <span className="floor-table-status"
                    style={{
                      display: 'block',
                      marginTop: '4px',
                      fontSize: '10px',
                      fontWeight: 700,
                    }}
                  >
                    {statusLabel(activeSession.status)}
                  </span>

                  <span className="floor-table-status"
                    style={{
                      display: 'block',
                      marginTop: '2px',
                      fontSize: '11px',
                      fontWeight: 700,
                    }}
                  >
                    {activeSession.partySize}<ScreenText id="FloorPage.157d0929048b90c2"> guests ·</ScreenText>{' '}
                    {elapsedMinutes(
                      activeSession.seatedAt,
                    )}<ScreenText id="FloorPage.0f0cfbadeed9a791">
                    m
                  </ScreenText></span>
                </>
              )}
            </button>
          )
        })}
        <p className="floor-map-room-name">{rooms.find(r=>r.id===activeRoomId)?.name}</p>
      </div>
      </div>

       {/* TABLE ACTION BAR */}
      {selectedTableIds.length > 0 && (
        <div className="floor-action-bar">
          <span>
            {selectedTableIds.length}{' '}
            {selectedTableIds.length === 1
              ? 'table'
              : 'tables'}{' '}
            · {selectedSeatCount}<ScreenText id="FloorPage.3da2884b5dc69618"> seats
          </ScreenText></span>

          <button
            onClick={() =>
              setSelectedTableIds([])
            }
          ><ScreenText id="FloorPage.7c1a046c38f0618b">
            Clear selection
          </ScreenText></button>
          {selectedTable && (
  <button
    onClick={() =>
      setShowTablePanel(true)
    }
  ><ScreenText id="FloorPage.9b2f77700fe7077c">
    Details
  </ScreenText></button>
)}

          <button
            onClick={() => {
              setShowSectionPanel(true)
            }}
          ><ScreenText id="FloorPage.c2a5b2c20b98da29">
            Assign Section
          </ScreenText></button>


          <button
            onClick={handleSmartSection}
            disabled={smartLoading}
          >
            {smartLoading ? 'Analyzing…' : 'Smart Section'}
          </button>

          <button
            disabled={selectedTableIds.length === 0}
            onClick={() => {
              openSeating()
            }}
          ><ScreenText id="FloorPage.abad2549f07a8373">
            Seat
          </ScreenText></button>

          <button disabled><ScreenText id="FloorPage.bcb4cdbb6790706c">
            Status
          </ScreenText></button>
        </div>
      )}

      {/* OPEN SHIFT PANEL */}
      {showShiftPanel && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h2>
              {activeShift?.status==='scheduled'?`Open ${activeShift.shift_name}`:'Open today’s shift'}
            </h2>

            <label><ScreenText id="FloorPage.72315bf916b430e1">
              Shift

              </ScreenText><select disabled={activeShift?.status==='scheduled'}
                value={newShiftName}
                onChange={(event) =>
                  setNewShiftName(
                    event.target.value,
                  )
                }
              >
                <option><ScreenText id="FloorPage.644f79249f780284">Dinner</ScreenText></option>
                <option><ScreenText id="FloorPage.5a58428e7ba03821">Lunch</ScreenText></option>
                <option><ScreenText id="FloorPage.d61e76a805bdb17f">Brunch</ScreenText></option>
                <option><ScreenText id="FloorPage.de40e31eea0cffd5">
                  Private Event
                </ScreenText></option>
              </select>
            </label>

            <div className="modal-actions">
              <button
                onClick={() =>
                  setShowShiftPanel(false)
                }
              ><ScreenText id="FloorPage.35b3af9424bcbf32">
                Cancel
              </ScreenText></button>

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
            <h2><ScreenText id="FloorPage.9a4fc2a1500f6947">Assign section</ScreenText></h2>{error && <p role="alert">{error}</p>}
            {!activeShiftId && <label><ScreenText id="FloorPage.faa027d1375e76e3">Plan for shift</ScreenText><select value={newShiftName} onChange={e=>setNewShiftName(e.target.value)}>{['Dinner','Lunch','Brunch','Private Event'].map(n=><option key={n}>{n}</option>)}</select></label>}
            <p>{activeShift?`${activeShift.shift_name} · ${activeShift.status}`:'Saving creates a scheduled shift without opening service.'}</p>

            <label><ScreenText id="FloorPage.210fa5dbf4d02111">
              Section name

              </ScreenText><input
                value={sectionName}
                onChange={(event) =>
                  setSectionName(
                    event.target.value,
                  )
                }
                placeholder="Optional — Section A"
              />
            </label>

            <SectionEmployeePicker employees={team.map(m=>({id:m.user_id,name:memberName(m.user_id)}))} employeeId={selectedServerId==='__name__'?null:selectedServerId} guestName={sectionGuestName} disabled={saving} onChange={(id,name)=>{setSelectedServerId(id===null?'__name__':id);setSectionGuestName(name)}}/>

            <div
              style={{
                padding: '12px',
                borderRadius: '12px',
                background: '#ffffff',
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
                {selectedSeatCount}<ScreenText id="FloorPage.fa8697cfed39b3b2"> seats
              </ScreenText></div>
            </div>

            <div className="modal-actions">
              <button
                onClick={() => {
                  setShowSectionPanel(false)
                  setSectionName('')
                  setSelectedServerId('')
                }}
              ><ScreenText id="FloorPage.972ac17323d8046d">
                Cancel
              </ScreenText></button>

              <button
                className="primary-button"
                onClick={
                  handleCreateSection
                }
                disabled={
                  (!selectedServerId || (selectedServerId==='__name__'&&!sectionGuestName.trim())) || !selectedTableIds.length ||
                  saving
                }
              >
                {saving
                  ? 'Creating…'
                  : 'Save section'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showReservationsPanel && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <p className="eyebrow"><ScreenText id="FloorPage.58f3288ba914ecb7">Reservations</ScreenText></p>
            <h2><ScreenText id="FloorPage.def1336055c8be14">Today's Reservations</ScreenText></h2>

            {reservationUploadMessage && (
              <div
                style={{
                  padding: '10px 12px',
                  marginBottom: '12px',
                  borderRadius: '10px',
                  background: '#ffffff',
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
                <div className="empty-state"><ScreenText id="FloorPage.8cdc268eec105d05">
                  No reservations uploaded for this shift.
                </ScreenText></div>
              ) : (
                reservations.map((reservation) => (
                  <div
                    key={reservation.id}
                    style={{
                      padding: '12px',
                      borderRadius: '12px',
                      background: '#ffffff',
                      border: '1px solid var(--app-border)',
                    }}
                  >
                    <strong>
                      {formatReservationTime(reservation.reservation_time)} ·{' '}
                      {reservation.guest_name}
                    </strong>

                    <div style={{ marginTop: '4px' }}>
                      {reservation.party_size}<ScreenText id="FloorPage.bc0b2dc8673deba3"> guests
                      </ScreenText>{reservation.table_name
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
            ><ScreenText id="FloorPage.8d3f00a24cc68549">
              Close
            </ScreenText></button>
          </div>
        </div>
      )}

      {showSmartPanel && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <p className="eyebrow"><ScreenText id="FloorPage.0c90f34dd45cb5c2">SectionIQ</ScreenText></p>
            <h2><ScreenText id="FloorPage.a17e164e8984911a">Smart Section</ScreenText></h2>{smartLoading&&<p role="status"><ScreenText id="FloorPage.3cc5f5f9eee5793a">Checking history and assigned capacity…</ScreenText></p>}{smartNotice&&<p role="status">{smartNotice}</p>}

            <div
              style={{
                padding: '12px',
                borderRadius: '12px',
                background: '#ffffff',
                marginBottom: '14px',
              }}
            >
              <strong>
                {selectedTables
                  .map((table) => table.table_name)
                  .join(', ')}
              </strong>

              <div style={{ marginTop: '5px', opacity: 0.75 }}>
                {selectedSeatCount}<ScreenText id="FloorPage.1e21c88bc28cc5d3"> seats ·</ScreenText>{' '}
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
                  )}{' '}<ScreenText id="FloorPage.f0a2d26707228fe6">
                upcoming reserved covers
              </ScreenText></div>
            </div>

            <div style={{ display: 'grid', gap: '10px' }}>
              {smartRecommendations.map(
                (recommendation, index) => (
                  <div
                    key={recommendation.employeeId}
                    style={{
                      padding: '14px',
                      borderRadius: '14px',
                      border: '1px solid var(--app-border)',
                      background:
                        index === 0 ? '#172033' : '#ffffff',
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
                        ? `${recommendation.historicalUses} closeouts · $${recommendation.avgNetSales.toFixed(
                            0,
                          )}/closeout avg`
                        : 'No historical sales data yet'}
                      {recommendation.avgSalesPerHour!==null && <div>${recommendation.avgSalesPerHour.toFixed(0)}<ScreenText id="FloorPage.f99c8033c61d6f17">/hr average · </ScreenText>{recommendation.timedUses}<ScreenText id="FloorPage.24a6edb170727de9"> timed closeouts</ScreenText></div>}
                    </div>

                    <div
                      style={{
                        marginTop: '4px',
                        fontSize: '13px',
                        opacity: 0.8,
                      }}
                    ><ScreenText id="FloorPage.14863dce1469a07a">
                      Current assigned capacity:</ScreenText>{' '}
                      {recommendation.currentSeats}<ScreenText id="FloorPage.2c216c77f3f8764e"> seats
                    </ScreenText></div>

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
                    ><ScreenText id="FloorPage.2e430a58775b49a6">
                      Use This Server
                    </ScreenText></button>
                  </div>
                ),
              )}

              {smartRecommendations.length === 0 && (
                <div className="empty-state"><ScreenText id="FloorPage.eda10a0961fcbc53">
                  No eligible employees were found.
                </ScreenText></div>
              )}
            </div>

            <button
              style={{
                width: '100%',
                marginTop: '14px',
                padding: '12px',
              }}
              onClick={() => setShowSmartPanel(false)}
            ><ScreenText id="FloorPage.80e029a009b73576">
              Close
            </ScreenText></button>
          </div>
        </div>
      )}



      {showRotationPanel && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <p className="eyebrow"><ScreenText id="FloorPage.36533d646910fe8a">Quick Rotation</ScreenText></p>
            <h2><ScreenText id="FloorPage.4bbc2c8e9674777f">Cover Counter</ScreenText></h2>

            {rotationServers.length === 0 ? (
              <>
                <label><ScreenText id="FloorPage.e90fea599ed4cb12">
                  Number of servers
                  </ScreenText><input
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
                          background: '#ffffff',
                          border: '1px solid var(--app-border)',
                        }}
                      >
                        <strong><ScreenText id="FloorPage.a4aeb5371f4daacc">Server </ScreenText>{index + 1}</strong>

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
                          <option value=""><ScreenText id="FloorPage.6348abf845e59969">
                            Choose from team
                          </ScreenText></option>

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
                        ><ScreenText id="FloorPage.a5c8af2403b757c3">
                          OR
                        </ScreenText></div>

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
                    background: '#ffffff',
                    border: '1px solid var(--app-border)',
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
                      <strong><ScreenText id="FloorPage.078ec7cd050cb122">Running Cover Count</ScreenText></strong>
                      <div
                        style={{
                          marginTop: '2px',
                          opacity: 0.7,
                          fontSize: '12px',
                        }}
                      ><ScreenText id="FloorPage.ea7da507308a74cf">
                        Select a table, enter covers, then record the seating.
                      </ScreenText></div>
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
                            background: '#ffffff',
                            border: nextUp
                              ? '2px solid #f4b860'
                              : '1px solid var(--app-border)',
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
                            ><ScreenText id="FloorPage.1ab02bc87a372fbf">
                              Next Up
                            </ScreenText></div>
                          )}

                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              gap: '12px',
                              alignItems: 'center',
                            }}
                          >
                            <strong style={{ fontSize: '17px' }}>
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

                          <label style={{ marginTop: '10px' }}><ScreenText id="FloorPage.dbce12e1285071b6">
                            Table
                            </ScreenText><select
                              value={
                                rotationTableByServer[server.id] ?? ''
                              }
                              onChange={(event) => {
                                const tableId = event.target.value
                                const selectedTable = tables.find(
                                  (table) => table.id === tableId,
                                )

                                setRotationTableByServer((current) => ({
                                  ...current,
                                  [server.id]: tableId,
                                }))

                                if (selectedTable) {
                                  setRotationCoversByServer((current) => ({
                                    ...current,
                                    [server.id]:
                                      selectedTable.seat_count,
                                  }))
                                }
                              }}
                            >
                              <option value=""><ScreenText id="FloorPage.62553bd52e34f7ed">
                                Choose table
                              </ScreenText></option>

                              {[...tables]
                                .sort((a, b) =>
                                  a.table_name.localeCompare(
                                    b.table_name,
                                    undefined,
                                    { numeric: true },
                                  ),
                                )
                                .map((table) => (
                                  <option
                                    key={table.id}
                                    value={table.id}
                                  >
                                    {table.table_name} · {table.seat_count}{' '}<ScreenText id="FloorPage.25f8ad0dd7eaaa08">
                                    seats
                                  </ScreenText></option>
                                ))}
                            </select>
                          </label>

                          <label style={{ marginTop: '10px' }}><ScreenText id="FloorPage.58ade1e6aa4b11b6">
                            Covers
                            </ScreenText><input
                              type="number"
                              min="1"
                              max="50"
                              value={
                                rotationCoversByServer[server.id] ?? 2
                              }
                              onChange={(event) =>
                                setRotationCoversByServer(
                                  (current) => ({
                                    ...current,
                                    [server.id]: Math.max(
                                      1,
                                      Number(event.target.value) || 1,
                                    ),
                                  }),
                                )
                              }
                            />
                          </label>

                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns:
                                'repeat(4, 1fr)',
                              gap: '6px',
                              marginTop: '8px',
                            }}
                          >
                            {[1, 2, 4, 6].map((covers) => (
                              <button
                                key={covers}
                                onClick={() =>
                                  setRotationCoversByServer(
                                    (current) => ({
                                      ...current,
                                      [server.id]: covers,
                                    }),
                                  )
                                }
                              >
                                {covers}
                              </button>
                            ))}
                          </div>

                          <button
                            className="primary-button"
                            style={{
                              width: '100%',
                              marginTop: '8px',
                            }}
                            onClick={() =>
                              submitRotationSeating(server.id)
                            }
                            disabled={
                              saving ||
                              !rotationTableByServer[server.id]
                            }
                          ><ScreenText id="FloorPage.b7a81351b2a65fc5">
                            Record Seating
                          </ScreenText></button>

                          <button
                            style={{
                              width: '100%',
                              marginTop: '6px',
                            }}
                            onClick={() =>
                              correctRotationCover(server.id)
                            }
                            disabled={saving}
                          ><ScreenText id="FloorPage.4be8115d05aa0496">
                            −1 Cover Correction
                          </ScreenText></button>
                        </div>
                      )
                    })}
                </div>

                <div className="modal-actions">
                  <button
                    onClick={async () => {
                      await loadRotationLog(activeShiftId)
                      setShowRotationLogPanel(true)
                    }}
                  ><ScreenText id="FloorPage.4926bb8bf7347b08">
                    View Log
                  </ScreenText></button>

                  <button onClick={resetRotation}><ScreenText id="FloorPage.ac6cec9ed256d135">
                    Reset Counts
                  </ScreenText></button>

                  <button onClick={clearRotation}><ScreenText id="FloorPage.0c59baac33d1d2d7">
                    Change Servers
                  </ScreenText></button>
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
            ><ScreenText id="FloorPage.0178fa9eedc6fab6">
              Close
            </ScreenText></button>
          </div>
        </div>
      )}

      {showRotationLogPanel && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <p className="eyebrow"><ScreenText id="FloorPage.2b12726504638ada">Rotation Log</ScreenText></p>
            <h2><ScreenText id="FloorPage.e53bc7ea45411714">Seating History</ScreenText></h2>

            <div
              style={{
                marginBottom: '12px',
                opacity: 0.75,
                fontSize: '13px',
              }}
            ><ScreenText id="FloorPage.8c3a59721fc2c5d0">
              Every recorded rotation seating for this shift.
            </ScreenText></div>

            <div
              style={{
                display: 'grid',
                gap: '8px',
                maxHeight: '60vh',
                overflowY: 'auto',
              }}
            >
              {rotationLog.map((entry) => (
                <div
                  key={entry.id}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '10px',
                    background: '#ffffff',
                    border: '1px solid var(--app-border)',
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr auto',
                    gap: '10px',
                    alignItems: 'center',
                  }}
                >
                  <div
                    style={{
                      fontSize: '12px',
                      opacity: 0.7,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {new Date(entry.created_at).toLocaleTimeString(
                      [],
                      {
                        hour: 'numeric',
                        minute: '2-digit',
                      },
                    )}
                  </div>

                  <div>
                    <strong>{entry.display_name}</strong>
                    <div
                      style={{
                        marginTop: '2px',
                        fontSize: '12px',
                        opacity: 0.75,
                      }}
                    >
                      {entry.action === 'correction'
                        ? 'Cover correction'
                        : entry.table_name || 'No table'}
                    </div>
                  </div>

                  <strong
                    style={{
                      color:
                        entry.covers_delta < 0
                          ? '#f87171'
                          : '#f4b860',
                    }}
                  >
                    {entry.covers_delta > 0 ? '+' : ''}
                    {entry.covers_delta}
                  </strong>
                </div>
              ))}

              {rotationLog.length === 0 && (
                <div className="empty-state"><ScreenText id="FloorPage.450555d426340623">
                  No rotation activity has been recorded yet.
                </ScreenText></div>
              )}
            </div>

            <button
              style={{
                width: '100%',
                marginTop: '12px',
                padding: '12px',
              }}
              onClick={() => setShowRotationLogPanel(false)}
            ><ScreenText id="FloorPage.b0a9402496a5997a">
              Close Log
            </ScreenText></button>
          </div>
        </div>
      )}

      {showTableEditor && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <p className="eyebrow"><ScreenText id="FloorPage.38a8cd80580a8ade">Floor Setup</ScreenText></p>
            <h2><ScreenText id="FloorPage.3400468575b918d6">Edit Table</ScreenText></h2>

            <label><ScreenText id="FloorPage.d5b819eda57f40e2">
              Table name
              </ScreenText><input
                value={editTableName}
                onChange={(event) =>
                  setEditTableName(event.target.value)
                }
                placeholder="B7"
              />
            </label>

            <label style={{ marginTop: '12px' }}><ScreenText id="FloorPage.dbde6abf70229975">
              Number of seats
              </ScreenText><input
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
              ><ScreenText id="FloorPage.7df20441dc99277c">
                − Seat
              </ScreenText></button>

              <button
                onClick={() =>
                  setEditSeatCount((current) => current + 1)
                }
              ><ScreenText id="FloorPage.56d4bb2b594a79fe">
                + Seat
              </ScreenText></button>
            </div>

            <div className="modal-actions">
              <button
                onClick={() => setShowTableEditor(false)}
              ><ScreenText id="FloorPage.1f6078b10fb33539">
                Cancel
              </ScreenText></button>

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
            <p className="eyebrow"><ScreenText id="FloorPage.346033551ea3dce7">Floor Setup</ScreenText></p>
            <h2><ScreenText id="FloorPage.562edf163d27ecd6">Add Table</ScreenText></h2>

            <div
              style={{
                marginBottom: '12px',
                opacity: 0.75,
              }}
            ><ScreenText id="FloorPage.6f6020f550b3c4fe">
              Adding to:</ScreenText>{' '}
              {rooms.find((room) => room.id === activeRoomId)
                ?.name || 'Current room'}
            </div>

            <label><ScreenText id="FloorPage.99f2b354b41dd831">
              Table name
              </ScreenText><input
                value={newTableName}
                onChange={(event) =>
                  setNewTableName(event.target.value)
                }
                placeholder="B7"
              />
            </label>

            <label style={{ marginTop: '12px' }}><ScreenText id="FloorPage.bbb3a9965c19a24a">
              Seats
              </ScreenText><input
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

            <label style={{ marginTop: '12px' }}><ScreenText id="FloorPage.dcfaa96bfcf2cec6">
              Shape
              </ScreenText><select
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
                <option value="round"><ScreenText id="FloorPage.8500ea567aa4bd25">Round</ScreenText></option>
                <option value="square"><ScreenText id="FloorPage.291495e00a793806">Square</ScreenText></option>
                <option value="rectangle"><ScreenText id="FloorPage.3af2249adffcf41a">
                  Rectangle
                </ScreenText></option>
              </select>
            </label>

            <div className="modal-actions">
              <button
                onClick={() => setShowAddTablePanel(false)}
              ><ScreenText id="FloorPage.91d61fc9637665bf">
                Cancel
              </ScreenText></button>

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
            <p className="eyebrow"><ScreenText id="FloorPage.4ec46a48d32a4de1">Table Details</ScreenText></p>

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
                <strong><ScreenText id="FloorPage.198e75feb878e9db">Seats</ScreenText></strong>
                <div>{selectedTable.seat_count}</div>
              </div>

              <div>
                <strong><ScreenText id="FloorPage.7a591ebeaee5ae1c">Server</ScreenText></strong>
                <div>
                  {tableServer(selectedTable.id) || 'Unassigned'}
                </div>
              </div>

              <div>
                <strong><ScreenText id="FloorPage.06501eeecca19ad5">Status</ScreenText></strong>
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
                    <strong><ScreenText id="FloorPage.a4d07ddfcdfe7d97">Party</ScreenText></strong>
                    <div>
                      {tableSession(selectedTable.id)
                        ?.guestName || 'Walk-in'}
                    </div>
                  </div>

                  <div>
                    <strong><ScreenText id="FloorPage.524c23465d32c375">Guests</ScreenText></strong>
                    <div>
                      {
                        tableSession(selectedTable.id)
                          ?.partySize
                      }
                    </div>
                  </div>

                  <div>
                    <strong><ScreenText id="FloorPage.1abd80f51855397e">Time Seated</ScreenText></strong>
                    <div>
                      {elapsedMinutes(
                        tableSession(selectedTable.id)!
                          .seatedAt,
                      )}{' '}<ScreenText id="FloorPage.7900dcf374573b5f">
                      min
                    </ScreenText></div>
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
                  openSeating()
                }}
              ><ScreenText id="FloorPage.a04a646c889f8fe4">
                Seat Guests
              </ScreenText></button>

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
                  ><ScreenText id="FloorPage.093ec970131d5b82">
                    🔵 Seated
                  </ScreenText></button>

                  <button
                    onClick={() =>
                      handleStatusChange(
                        tableSession(selectedTable.id)!.id,
                        'drinks',
                      )
                    }
                    disabled={saving}
                  ><ScreenText id="FloorPage.1d19103e786ec74f">
                    🟡 Drinks
                  </ScreenText></button>

                  <button
                    onClick={() =>
                      handleStatusChange(
                        tableSession(selectedTable.id)!.id,
                        'food',
                      )
                    }
                    disabled={saving}
                  ><ScreenText id="FloorPage.8353242e893ef598">
                    🟠 Food
                  </ScreenText></button>

                  <button
                    onClick={() =>
                      handleStatusChange(
                        tableSession(selectedTable.id)!.id,
                        'check',
                      )
                    }
                    disabled={saving}
                  ><ScreenText id="FloorPage.9b188c58096a18aa">
                    🟣 Check
                  </ScreenText></button>

                  <button
                    onClick={() =>
                      handleStatusChange(
                        tableSession(selectedTable.id)!.id,
                        'dirty',
                      )
                    }
                    disabled={saving}
                  ><ScreenText id="FloorPage.ceb815d3af266d20">
                    ⚫ Dirty / Needs Busser
                  </ScreenText></button>

                  <button
                    onClick={() =>
                      handleStatusChange(
                        tableSession(selectedTable.id)!.id,
                        'manager',
                      )
                    }
                    disabled={saving}
                  ><ScreenText id="FloorPage.26c57cd297d801b5">
                    🔴 Manager Assist
                  </ScreenText></button>

                  <button
                    className="primary-button"
                    onClick={() =>
                      handleStatusChange(
                        tableSession(selectedTable.id)!.id,
                        'ready',
                      )
                    }
                    disabled={saving}
                  ><ScreenText id="FloorPage.19c6834d7471e913">
                    🟢 Mark Ready / Close Table
                  </ScreenText></button>
                </>
              ) : (
                <button disabled><ScreenText id="FloorPage.51023ef8ef67b615">
                  No active table session
                </ScreenText></button>
              )}

              <button disabled><ScreenText id="FloorPage.a9fccabe13d95591">
                Transfer Table
              </ScreenText></button>

              <button
                onClick={() => {
                  setShowTablePanel(false)
                  openTableEditor(selectedTable)
                }}
              ><ScreenText id="FloorPage.281d6ce601d5bdda">
                Edit Table
              </ScreenText></button>

              <button
                onClick={() => setShowTablePanel(false)}
              ><ScreenText id="FloorPage.b26f7c26db4411a3">
                Close
              </ScreenText></button>
            </div>
          </div>
        </div>
      )}

      {showSeatPanel && selectedTableIds.length > 0 && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <p className="eyebrow"><ScreenText id="FloorPage.7699845ffa5f9e0f">Seat Guests</ScreenText></p>{error && <p role="alert">{error}</p>}

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

            <label><ScreenText id="FloorPage.e3fc8c139dc34fa7">Server</ScreenText><select value={seatServerId} onChange={e=>setSeatServerId(e.target.value)}><option value=""><ScreenText id="FloorPage.384d6bb051c367b8">Choose server</ScreenText></option>{team.map(m=><option key={m.user_id} value={m.user_id}>{memberName(m.user_id)}</option>)}</select></label>
            <p><ScreenText id="FloorPage.531998f4645e3d0d">One party will occupy all selected tables. Choose the server responsible for the party.</ScreenText></p>
            <label><ScreenText id="FloorPage.e44aeebd7e732765">
              Guest name
              </ScreenText><input
                value={guestName}
                onChange={(event) =>
                  setGuestName(event.target.value)
                }
                placeholder="Guest name"
              />
            </label>

            <label style={{ marginTop: '12px' }}><ScreenText id="FloorPage.e50cc9012f7e103e">
              Phone number
              </ScreenText><input
                value={guestPhone}
                onChange={(event) =>
                  setGuestPhone(event.target.value)
                }
                placeholder="504-555-1234"
              />
            </label>

            <label style={{ marginTop: '12px' }}><ScreenText id="FloorPage.f2dddedb7989ec42">
              Email
              </ScreenText><input
                type="email"
                value={guestEmail}
                onChange={(event) =>
                  setGuestEmail(event.target.value)
                }
                placeholder="guest@email.com"
              />
            </label>

            <label style={{ marginTop: '12px' }}><ScreenText id="FloorPage.6f52ad3b8af5273e">
              Party size
              </ScreenText><input
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
              ><ScreenText id="FloorPage.8017a93cf20f7eca">
                Cancel
              </ScreenText></button>

              <button
                className="primary-button"
                onClick={handleSeatGuests}
                disabled={saving}
              >
                {saving ? 'Seating…' : 'Seat selected tables'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

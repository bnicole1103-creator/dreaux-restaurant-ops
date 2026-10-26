import { CloseoutReceiptWallet, ReceiptSubmissionLog, useReceiptDraft } from '../components/CloseoutReceiptWallet'
import { summarizeCloseoutReceipts, type CloseoutReceipt } from '../lib/closeoutReceipts'
import {DesignSection} from '../components/DesignSection'
import {PastCloseoutControls} from '../components/PastCloseoutControls'
import {closeoutErrorMessage} from '../lib/closeoutError'
import { CloseoutStockQuestion } from '../components/CloseoutStockQuestion'
import { closeoutStockItems } from '../lib/stockItems'
// page-designer-instrumented
import { PageWord } from "../components/PageDesign"
import './QuickCloseout.css'
import { quickCloseoutIssues, roleFromSchedule, centralTime, type QuickShift } from '../lib/quickCloseout'
import { serviceDay } from '../lib/serviceDay'
import { ScreenText } from "../components/ScreenText"
import { ClockTime } from '../components/ClockTime'
import { closeoutHours } from '../lib/closeoutHours'
import './CloseoutMobile.css'
import { submissionLabel } from '../lib/submissionTime'
import { Link } from 'react-router-dom'
import { CloseoutQuestions, useCloseoutConfig, checkAnswers, questionLabel, questionActive } from '../components/CloseoutConfig'
import type { Answers } from '../components/CloseoutConfig'
import { useEffect, useMemo, useState , useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'

type EmployeeOption = {
  user_id: string
  full_name: string
  preferred_name: string | null
  role: string
}

type TableOption = {
  id: string
  table_name: string
  room_id: string | null
  room_name: string
}

type PointAdjustment = {
  code: string
  description: string
  points: number
}

type ShiftPointResult = {
  startingScore: number
  adjustments: PointAdjustment[]
  pointsDelta: number
  shiftScore: number
  minutesLate: number
  salesPercent: number
}

type JobRole =
  | 'server'
  | 'main_bartender'
  | 'back_bartender_1'
  | 'back_bar_service_bartender'
  | 'host'
  | 'busser'
  | 'manager'
  | 'assistant_manager'
  | 'general_manager'

const ROLE_LABELS: Record<JobRole, string> = {
  server: 'Server',
  main_bartender: 'Main Bartender',
  back_bartender_1: 'Back Bartender 1',
  back_bar_service_bartender: 'Back Bar Service Bartender',
  host: 'Host',
  busser: 'Busser',
  manager: 'Manager',
  assistant_manager: 'Assistant Manager',
  general_manager: 'Management',
}

const ROLE_DESCRIPTIONS: Record<JobRole, string> = {
  server:
    'Owns assigned tables and guest service. Responsible for sales, guest payments, and applicable support-team tip-outs.',

  main_bartender:
    'Works the primary bar, handles own guests and bar sales, makes service drinks, and receives applicable bartender tip-outs.',

  back_bartender_1:
    'Serves their own tables while also making drinks in the back bar. This role does not receive standard server bartender tip-outs.',

  back_bar_service_bartender:
    'Primarily makes drinks for servers working the back bar and courtyard rather than owning guest tables.',

  host:
    'Manages reservations, seating, guest flow, rotation, and front-door communication.',

  busser:
    'Supports clearing, resetting, table maintenance, water service, and dining-room readiness.',

  manager:
    'Supervises shift operations, cash handling, guest recovery, voids/comps, staffing, and closeout verification.',

  assistant_manager:
    'Assists with shift supervision, service standards, staffing, cash control, and manager responsibilities.',

  general_manager:
    'Oversees restaurant operations, staffing, service standards, cash controls, performance, and management systems.',
}

function numberValue(value: string) {
  const parsed = Number.parseFloat(value)

  return Number.isFinite(parsed)
    ? parsed
    : 0
}

function timeToMinutes(value: string) {
  if (!value) {
    return 0
  }

  const [hours, minutes] =
    value.split(':').map(Number)

  return hours * 60 + minutes
}

function employeeName(
  employee: EmployeeOption
) {
  return (
    employee.preferred_name?.trim() ||
    employee.full_name?.trim() ||
    'Team Member'
  )
}

function calculateShiftPoints({
  scheduledTime,
  clockInTime,
  netSales,
  salesTarget,
  voidCount,
  voidValue,
  discountValue,
}: {
  scheduledTime: string
  clockInTime: string
  netSales: number
  salesTarget: number
  voidCount: number
  voidValue: number
  discountValue: number
}): ShiftPointResult {
  const startingScore = 100

  const adjustments:
    PointAdjustment[] = []

  /*
   * =====================================
   * LATENESS
   * =====================================
   *
   * Highest tier only.
   */

  const scheduledMinutes =
    timeToMinutes(scheduledTime)

  const clockInMinutes =
    timeToMinutes(clockInTime)

  const minutesLate = Math.max(
    0,
    clockInMinutes -
      scheduledMinutes
  )

  if (minutesLate >= 30) {
    adjustments.push({
      code: 'LATE_30_PLUS',
      description:
        `Clocked in ${minutesLate} minutes late`,
      points: -40,
    })
  } else if (minutesLate >= 15) {
    adjustments.push({
      code: 'LATE_15_29',
      description:
        `Clocked in ${minutesLate} minutes late`,
      points: -25,
    })
  } else if (minutesLate >= 6) {
    adjustments.push({
      code: 'LATE_6_14',
      description:
        `Clocked in ${minutesLate} minutes late`,
      points: -10,
    })
  } else if (minutesLate >= 1) {
    adjustments.push({
      code: 'LATE_1_5',
      description:
        `Clocked in ${minutesLate} minutes late`,
      points: -5,
    })
  }

  /*
   * =====================================
   * SALES PERFORMANCE
   * =====================================
   *
   * Highest tier only.
   */

  const salesPercent =
    salesTarget > 0
      ? (netSales / salesTarget) *
        100
      : 0

  if (salesTarget > 0) {
    if (salesPercent >= 125) {
      adjustments.push({
        code: 'SALES_125',
        description:
          `Reached ${salesPercent.toFixed(
            1
          )}% of sales target`,
        points: 40,
      })
    } else if (
      salesPercent >= 110
    ) {
      adjustments.push({
        code: 'SALES_110',
        description:
          `Reached ${salesPercent.toFixed(
            1
          )}% of sales target`,
        points: 30,
      })
    } else if (
      salesPercent >= 100
    ) {
      adjustments.push({
        code: 'SALES_TARGET',
        description:
          `Reached ${salesPercent.toFixed(
            1
          )}% of sales target`,
        points: 20,
      })
    }
  }

  /*
   * =====================================
   * VOIDS
   * =====================================
   *
   * No voids = +5
   * Each void = -4
   *
   * If someone enters a void dollar
   * amount but forgets to enter a count,
   * count it as at least one void.
   */

  /*
   * ==============================
   * VOIDS + DISCOUNTS
   * ==============================
   *
   * No bonus for $0.
   * No penalty through $15.
   * Dollar values over $15 = -4.
   */

  if (voidValue > 15) {
    adjustments.push({
      code: 'VOID_OVER_15',
      description: `$${voidValue.toFixed(2)} in voids`,
      points: -4,
    })
  }

  if (discountValue > 15) {
    adjustments.push({
      code: 'DISCOUNT_OVER_15',
      description: `$${discountValue.toFixed(2)} in discounts`,
      points: -4,
    })
  }

  /*
   * =====================================
   * CLOSEOUT COMPLETION
   * =====================================
   */

  adjustments.push({
    code: 'CLOSEOUT_COMPLETE',
    description:
      'Completed daily closeout',
    points: 5,
  })

  const pointsDelta =
    adjustments.reduce(
      (
        total,
        adjustment
      ) =>
        total +
        adjustment.points,
      0
    )

  return {
    startingScore,

    adjustments,

    pointsDelta,

    shiftScore:
      startingScore +
      pointsDelta,

    minutesLate,

    salesPercent,
  }
}

export function CloseoutPage() {
  const [ownerId,setOwnerId]=useState('')
  const [shiftOpen,setShiftOpen]=useState(false),[reportOpen,setReportOpen]=useState(false)
  const [issues,setIssues]=useState<{field:string;message:string}[]>([]),[draftStatus,setDraftStatus]=useState('')
  const [draftReady,setDraftReady]=useState('')
  const draftSaved=useRef(false),draftContext=useRef(''),touched=useRef({shift:false,tables:false}),submitLock=useRef(false)
  const [quickShifts,setQuickShifts]=useState<QuickShift[]>([]),[quickShift,setQuickShift]=useState(''),[scheduleNotice,setScheduleNotice]=useState('')
  const [answers, setAnswers] = useState<Answers>({})

  const [loading, setLoading] =
    useState(true)

  const [saving, setSaving] =
    useState(false)

  const [organizationId, setOrganizationId] =
    useState('')

  const [locationId, setLocationId] =
    useState('')

  const [closeoutDay,setCloseoutDay] = useState(serviceDay)
  const [datePinned,setDatePinned]=useState(true),[pastPoints,setPastPoints]=useState<boolean|null>(null),[pastReason,setPastReason]=useState('')
  const pastPolicy=useCallback((apply:boolean|null,reason:string)=>{setPastPoints(apply);setPastReason(reason)},[])
  const receiptDraft=useReceiptDraft(locationId,closeoutDay)
  const closeoutRequest=useRef('')
  closeoutRequest.current=receiptDraft.key
  const [submittedReceiptKey,setSubmittedReceiptKey]=useState('')
  const [receiptPending,setReceiptPending]=useState<number|null>(null)
  const [receiptRows,setReceiptRows]=useState<CloseoutReceipt[]>([])
  const receiptTotals=summarizeCloseoutReceipts(receiptRows)
  const [floorShiftId,setFloorShiftId]=useState(''),[floorShifts,setFloorShifts]=useState<{id:string;shift_name:string;status:string}[]>([]),[floorTablesNotice,setFloorTablesNotice]=useState('')
  useEffect(()=>{if(!locationId)return;let live=true;void supabase.from('shifts').select('id,shift_name,status').eq('location_id',locationId).eq('shift_date',closeoutDay).in('status',['scheduled','open','closed']).then(r=>{if(live&&!r.error)setFloorShifts(r.data??[])});return()=>{live=false}},[locationId,closeoutDay])
  async function pullFloorTables(){setFloorTablesNotice('');try{const u=await supabase.auth.getUser();if(u.error)throw u.error;const r=await supabase.rpc('floor_sections_for_day',{p_location_id:locationId,p_date:closeoutDay,p_only_me:true});if(r.error)throw r.error;const rows=(r.data??[]) as {table_ids:string[];id:string;starts_at:string|null;ends_at:string|null}[];const ids=[...new Set(rows.filter(row=>row.starts_at!==null||!floorShiftId||row.id===floorShiftId).flatMap(row=>row.table_ids))];setSelectedTableIds(ids.filter(id=>tables.some(t=>t.id===id)));setFloorTablesNotice(ids.length?'Floor assignments loaded. Confirm every table you actually worked, including any changes during your shift.':'No assigned tables found. Select the tables you actually worked below.')}catch(e){setFloorTablesNotice(String((e as {message?:string}).message??e))}}

  const { config, error: configError } = useCloseoutConfig(locationId)
  const shown=(id:string)=>questionActive(config,id)
  const [stockItems,setStockItems]=useState('')
  const [hasStockItems,setHasStockItems]=useState<''|'yes'|'no'>('')
  function configuredShiftPoints(input: Parameters<typeof calculateShiftPoints>[0]) {
    const original = calculateShiftPoints(input)
    const adjustments = original.adjustments.filter(a=>{
      if(a.code.startsWith('LATE_'))return shown('staff_0')&&shown('staff_1')
      if(a.code.startsWith('SALES_'))return shown('staff_0')&&shown('staff_3')
      if(a.code==='VOID_OVER_15')return false
      if(a.code==='DISCOUNT_OVER_15')return false
      return true
    }).map(a => {
      const rule = config?.rules.find(r => r.id === a.code)
      return rule ? {...a, points: rule.active ? rule.points : 0, description: rule.reason} : a
    })
    if(receiptTotals.errors)adjustments.push({code:'RECEIPT_SERVER_ERRORS',description:receiptTotals.errors+' server-error entries (−5 each)',points:-5*receiptTotals.errors})
    const pointsDelta = adjustments.reduce((n, a) => n + a.points, 0)
    return {...original, adjustments, pointsDelta, shiftScore: original.startingScore + pointsDelta}
  }

  const [locationName, setLocationName] =
    useState('')

  const [employees, setEmployees] =
    useState<EmployeeOption[]>([])

  const [peerVoteEmployeeId, setPeerVoteEmployeeId] = useState('')
  const [peerVoteOtherReason, setPeerVoteOtherReason] = useState('')

  const [tables, setTables] =
    useState<TableOption[]>([])

  const [shiftType, setShiftType] = useState('');
  const [scheduledTime, setScheduledTime] =
    useState('')

  const [clockInTime, setClockInTime] =
    useState('')

  const [clockOutTime, setClockOutTime] = useState('')
  const [zeroSalesConfirmed, setZeroSalesConfirmed] = useState(false)
  const [zeroSalesReason, setZeroSalesReason] = useState('')
  const [netSales, setNetSales] =
    useState('')

  useEffect(() => { setZeroSalesConfirmed(false); setZeroSalesReason('') }, [netSales])

  const [salesTarget, setSalesTarget] = useState('0')
  const [targetState,setTargetState] = useState<{loading:boolean;ready:boolean;reason:string}>({loading:false,ready:false,reason:'Enter your scheduled start and role to load your target.'})
  const [targetRefresh,setTargetRefresh] = useState(0)


  const [cashDeposit, setCashDeposit] =
    useState('')

  const [voidCount, setVoidCount] =
    useState('')

  const [voidValue, setVoidValue] =
    useState('')

  const [
    discountValue,
    setDiscountValue,
  ] = useState('')

  const [jobRole, setJobRole] =
    useState<JobRole>('server')
const [registerCash, setRegisterCash] =
  useState('')

const [registerImbalanceReason, setRegisterImbalanceReason] =
  useState('')

const [registerVerifiedBy, setRegisterVerifiedBy] =
  useState('')
  const [
    selectedTableIds,
    setSelectedTableIds,
  ] = useState<string[]>([])

  const [
    moneyTurnedInTo,
    setMoneyTurnedInTo,
  ] = useState('')

  const [
    drinkMaker,
    setDrinkMaker,
  ] = useState('')

  const [notes, setNotes] =
    useState('')

  const [certified, setCertified] =
    useState(false)

  const [error, setError] =
    useState('')

  const [message, setMessage] =
    useState('')

  useEffect(() => {
    void initialize()
  }, [])

  async function initialize() {
    try {
      setLoading(true)
      setError('')

      const tenant =
        await loadTenantData()

      const location =
        tenant.locations?.[0]

      if (
        !tenant.organization?.id ||
        !location?.id
      ) {
        throw new Error(
          'Organization or location could not be loaded.'
        )
      }

      const auth=await supabase.auth.getUser();if(auth.error)throw auth.error;if(!auth.data.user)throw Error('Sign in to complete your closeout.');setOwnerId(auth.data.user.id)
      setOrganizationId(
        tenant.organization.id
      )

      setLocationId(
        location.id
      )

      setLocationName(
        location.name ?? ''
      )

      await Promise.all([
        loadEmployees(
          location.id
        ),

        loadTables(
          location.id
        ),
      ])
    } catch (caughtError) {
      console.error(
        caughtError
      )

      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to load closeout.'
      )
    } finally {
      setLoading(false)
    }
  }

  async function loadEmployees(
    targetLocationId: string
  ) {
    const {
      data: memberships,
      error: membershipError,
    } = await supabase
      .from(
        'location_memberships'
      )
      .select(
        'user_id, role, status'
      )
      .eq(
        'location_id',
        targetLocationId
      )
      .eq(
        'status',
        'active'
      )

    if (membershipError) {
      throw membershipError
    }

    const userIds =
      (memberships ?? [])
        .map(
          (membership) =>
            membership.user_id
        )
        .filter(Boolean)

    if (
      userIds.length === 0
    ) {
      setEmployees([])
      return
    }

    const {
      data: profiles,
      error: profileError,
    } = await supabase
      .from('profiles')
      .select(
        'id, full_name, preferred_name'
      )
      .in(
        'id',
        userIds
      )

    if (profileError) {
      throw profileError
    }

    const profileMap =
      new Map(
        (profiles ?? []).map(
          (profile) => [
            profile.id,
            profile,
          ]
        )
      )

    const rows:
      EmployeeOption[] =
        (memberships ?? []).map(
          (membership) => {
            const profile =
              profileMap.get(
                membership.user_id
              )

            return {
              user_id:
                membership.user_id,

              full_name:
                profile?.full_name ??
                membership.user_id,

              preferred_name:
                profile?.preferred_name ??
                null,

              role:
                membership.role ??
                '',
            }
          }
        )

    rows.sort(
      (a, b) =>
        employeeName(
          a
        ).localeCompare(
          employeeName(b)
        )
    )

    setEmployees(rows)
  }

  async function loadTables(
    targetLocationId: string
  ) {
    const {
      data: rooms,
      error: roomError,
    } = await supabase
      .from('rooms')
      .select(
        'id, name'
      )
      .eq(
        'location_id',
        targetLocationId
      )

    if (roomError) {
      throw roomError
    }

    const {
      data: floorTables,
      error: tableError,
    } = await supabase
      .from('floor_tables')
      .select(
        'id, table_name, room_id'
      )
      .eq(
        'location_id',
        targetLocationId
      )

    if (tableError) {
      throw tableError
    }

    const roomMap =
      new Map(
        (rooms ?? []).map(
          (room) => [
            room.id,
            room.name,
          ]
        )
      )

    const rows:
      TableOption[] =
        (floorTables ?? [])
          .map((table) => ({
            id:
              table.id,

            table_name:
              table.table_name ??
              'Unnamed Table',

            room_id:
              table.room_id ??
              null,

            room_name:
              (
                table.room_id
                  ? roomMap.get(
                      table.room_id
                    )
                  : null
              ) ??
              'Other',
          }))
          .sort(
            (a, b) => {
              const roomSort =
                a.room_name.localeCompare(
                  b.room_name
                )

              if (
                roomSort !== 0
              ) {
                return roomSort
              }

              return a.table_name.localeCompare(
                b.table_name,
                undefined,
                {
                  numeric: true,
                }
              )
            }
          )

    setTables(rows)
  }

  const groupedTables =
    useMemo(() => {
      const groups:
        Record<
          string,
          TableOption[]
        > = {}

      tables.forEach(
        (table) => {
          if (
            !groups[
              table.room_name
            ]
          ) {
            groups[
              table.room_name
            ] = []
          }

          groups[
            table.room_name
          ].push(table)
        }
      )

      return groups
    }, [tables])

  const selectedTables =
    useMemo(() => {
      return tables.filter(
        (table) =>
          selectedTableIds.includes(
            table.id
          )
      )
    }, [
      tables,
      selectedTableIds,
    ])

  const pointResult =
    useMemo(() => {
      if (
        !scheduledTime ||
        !clockInTime
      ) {
        return null
      }

      return configuredShiftPoints({
        scheduledTime,

        clockInTime,

        netSales:
          numberValue(
            netSales
          ),

        salesTarget:
          numberValue(
            salesTarget
          ),

        voidCount:
          Number(
            voidCount || 0
          ),

        voidValue:
          numberValue(
            voidValue
          ),

        discountValue:
          numberValue(
            discountValue
          ),
      })
    }, [
      scheduledTime,
      clockInTime,
      netSales,
      salesTarget,
      voidCount,
      voidValue,
      discountValue,
      config,
      receiptRows,
    ])

  useEffect(()=>{const timer=window.setInterval(()=>{if(!datePinned)setCloseoutDay(serviceDay())},30000);return()=>clearInterval(timer)},[datePinned])
  useEffect(()=>{
    let live=true;setSalesTarget('0')
    if(!locationId||!scheduledTime){setTargetState({loading:false,ready:false,reason:'Enter your scheduled start and role to load your target.'});return}
    setTargetState({loading:true,ready:false,reason:''})
    const timer=window.setTimeout(()=>{void(async()=>{
      const r=await supabase.rpc('closeout_automatic_target',{p_location_id:locationId,p_date:closeoutDay,p_start:scheduledTime,p_role:jobRole})
      if(r.error)throw r.error;if(!live)return
      setSalesTarget(r.data?.ready?String(r.data.target):'0')
      setTargetState({loading:false,ready:!!r.data?.ready,reason:r.data?.reason??''})
    })().catch(e=>{if(live)setTargetState({loading:false,ready:false,reason:(e as Error).message})})},300)
    return()=>{live=false;clearTimeout(timer)}
  },[locationId,scheduledTime,jobRole,closeoutDay,targetRefresh])

  function toggleTable(
    tableId: string
  ) {
    setSelectedTableIds(
      (current) =>
        current.includes(
          tableId
        )
          ? current.filter(
              (id) =>
                id !==
                tableId
            )
          : [
              ...current,
              tableId,
            ]
    )
  }

  function resetForm() {
    setScheduledTime('')
    setClockInTime('')
    setClockOutTime('')

    setNetSales('')
    setSalesTarget('0')

    setCashDeposit('')

    setVoidCount('')
    setVoidValue('')

    setDiscountValue('')

    setJobRole(
      'server'
    )

    setSelectedTableIds([])

    setMoneyTurnedInTo('')
    setDrinkMaker('')

    setNotes('')
    setCertified(false)
    setRegisterCash('');setRegisterImbalanceReason('');setRegisterVerifiedBy('')
  }

  async function submitCloseout() {
    if(submitLock.current)return;submitLock.current=true
    try {
      setSaving(true)
      setError('')
      setMessage('')
      const failures=currentIssues()
      setIssues(failures)
      if(failures.length){setShiftOpen(failures.some(x=>x.field==='shift'));setReportOpen(failures.some(x=>x.field==='report'));requestAnimationFrame(()=>document.getElementById('closeout-errors')?.focus());return}
      const reportedStockItems=closeoutStockItems(hasStockItems,stockItems)
      const customAnswers = checkAnswers(config, 'staff', answers)
      const {data:{user},error:userError}=await supabase.auth.getUser()
      if(userError)throw userError
      if(!user||user.id!==ownerId)throw Error('Your sign-in changed. Reopen closeout before submitting.')
      const finalPoints =
        configuredShiftPoints({
          scheduledTime,

          clockInTime,

          netSales:
            numberValue(
              netSales
            ),

          salesTarget:
            numberValue(
              salesTarget
            ),

          voidCount:
            receiptTotals.voidCount,

          voidValue:
            numberValue(
              voidValue
            ),

          discountValue:
            numberValue(
              discountValue
            ),
        })

      if (targetState.loading) throw new Error('Your automatic sales target is still loading. Try again shortly.')
      if (peerVoteEmployeeId === user.id) throw new Error('Choose a teammate other than yourself.')

      const {data:closeout,error:closeoutError}=await supabase.rpc('operations_closeout_submit',{p_payload:{
          stock_items: reportedStockItems,
          zero_sales_confirmed: Number(netSales)===0 && zeroSalesConfirmed,
          zero_sales_reason: Number(netSales)===0 ? zeroSalesReason.trim() : null,
          shift_type: shiftType || 'PM',
          custom_answers: customAnswers,
          organization_id:
            organizationId,

          location_id:
            locationId,

          user_id:
            user.id,

          closeout_date: closeoutDay,

          scheduled_start:
            scheduledTime || '00:00',

          clock_in:
            clockInTime || scheduledTime || '00:00',
          clock_out: shown('staff_1') ? clockOutTime : null,

          job_role:
            jobRole,

          net_sales:
            numberValue(
              netSales
            ),

          sales_target:
            numberValue(
              salesTarget
            ),

          cash_deposit:
            numberValue(
              cashDeposit
            ),

          void_count:
            receiptTotals.voidCount,

          void_value:
            numberValue(
              voidValue
            ),

          discount_value:
            numberValue(
              discountValue
            ),

          money_turned_in_to:
            moneyTurnedInTo.trim() || null,

          drinks_made_by:
            drinkMaker.trim() ||
            null,

          notes:
            [notes.trim(),jobRole==='main_bartender'&&shown('staff_8')?'Register cash left: $'+Number(registerCash).toFixed(2)+(Number(registerCash)!==200?' · Difference reason: '+registerImbalanceReason.trim()+' · Verified by: '+(employees.find(p=>p.user_id===registerVerifiedBy)?.full_name||registerVerifiedBy):' · Balanced at $200'):null].filter(Boolean).join('\n') || null,

          employee_certified:
            certified,

          status:
            'submitted',

          shift_score:
            finalPoints.shiftScore,

          points_delta:
            finalPoints.pointsDelta,

          points_summary:
            finalPoints.adjustments,
        },p_table_ids:selectedTables.map(t=>t.id),p_shift_id:floorShiftId||null,p_request_id:closeoutRequest.current,p_peer_user:shown('staff_11')?(peerVoteEmployeeId||null):null,p_peer_reason:peerVoteOtherReason.trim(),p_apply_points:pastPoints,p_reason:pastReason})

      if (closeoutError) {
        throw closeoutError
      }

      draftSaved.current=true
      try{sessionStorage.removeItem(draftContext.current)}catch{}
      setDraftStatus('Closeout submitted. Draft cleared.')
      setIssues([])
      setSubmittedReceiptKey(closeout.id)
      receiptDraft.rotate()
      setReceiptRows([])
      const warnings:
        string[] = []

      // Automatic closeout points are saved atomically by the database.

      const submittedScore =
        closeout.shift_score

      setStockItems('')
      setHasStockItems('')
      setAnswers({})
      resetForm()

      let confirmation =
        `✓ Closeout for ${closeout.closeout_date} submitted ${submissionLabel(closeout.submitted_at)}. ${closeout.operations_points_apply===false?"No point changes.":"Shift score: "+submittedScore+"."}`

      if (
        warnings.length > 0
      ) {
        confirmation +=
          ` Note: ${warnings.join(
            ' and '
          )}.`
      }

      setMessage(
        confirmation
      )

      window.scrollTo({
        top: 0,
        behavior:
          'smooth',
      })
    } catch (caughtError) {
      console.error(
        'Closeout submission error:',
        caughtError
      )

      setError(
        closeoutErrorMessage(caughtError)
      )

      window.scrollTo({
        top: 0,
        behavior:
          'smooth',
      })
    } finally {
      submitLock.current=false
      setSaving(false)
    }
  }

  function changeServiceDay(day:string){if(day===closeoutDay||saving)return;if(!window.confirm('Change the service date and clear this unsaved closeout?'))return;resetForm();setFloorShiftId('');setFloorTablesNotice('');setReceiptRows([]);setSubmittedReceiptKey('');setCloseoutDay(day);setDatePinned(true);setError('');setMessage('')}

  const draftKey=ownerId&&locationId&&receiptDraft.key?'justinis.quick-closeout.v1.'+ownerId+'.'+locationId+'.'+closeoutDay+'.'+receiptDraft.key:''
  useEffect(()=>{
    if(!draftKey)return
    draftContext.current=draftKey;draftSaved.current=false;touched.current={shift:false,tables:false};setDraftReady('')
    resetForm();setShiftType('');setFloorShiftId('');setQuickShift('');setAnswers({});setStockItems('');setHasStockItems('');setPeerVoteEmployeeId('');setPeerVoteOtherReason('');setIssues([])
    try{
      const raw=sessionStorage.getItem(draftKey),d=raw?JSON.parse(raw):null
      const str=(key:string,max=8000)=>typeof d?.[key]==='string'?d[key].slice(0,max):''
      if(d?.version===1&&typeof d.savedAt==='number'&&Date.now()-d.savedAt<86400000){
        setScheduledTime(str('scheduledTime',5));setClockInTime(str('clockInTime',5));setClockOutTime(str('clockOutTime',5));setShiftType(str('shiftType',20));setNetSales(str('netSales',30));setCashDeposit(str('cashDeposit',30));setVoidCount(str('voidCount',20));setVoidValue(str('voidValue',30));setDiscountValue(str('discountValue',30));if(Object.prototype.hasOwnProperty.call(ROLE_LABELS,str('jobRole')))setJobRole(str('jobRole') as JobRole)
        setFloorShiftId(str('floorShiftId',36));setQuickShift(str('quickShift',200));setSelectedTableIds(Array.isArray(d.selectedTableIds)?d.selectedTableIds.filter((x:unknown)=>typeof x==='string').slice(0,300):[])
        setMoneyTurnedInTo(str('moneyTurnedInTo',36));setDrinkMaker(str('drinkMaker',36));setNotes(str('notes'));setRegisterCash(str('registerCash',30));setRegisterImbalanceReason(str('registerImbalanceReason',2000));setRegisterVerifiedBy(str('registerVerifiedBy',36));setStockItems(str('stockItems'));if(['yes','no'].includes(str('hasStockItems')))setHasStockItems(str('hasStockItems') as 'yes'|'no');setPeerVoteEmployeeId(str('peerVoteEmployeeId',36));setPeerVoteOtherReason(str('peerVoteOtherReason',500));setZeroSalesReason(str('zeroSalesReason',2000))
        if(d.answers&&typeof d.answers==='object'&&!Array.isArray(d.answers))setAnswers(Object.fromEntries(Object.entries(d.answers).filter(([k,v])=>k.length<200&&typeof v==='string'&&v.length<=2000)) as Answers)
        touched.current={shift:true,tables:true};setDraftStatus('Draft restored in this tab. Check your amounts and confirm accuracy before submitting.')
      }else setDraftStatus('Progress saves in this tab while you work.')
    }catch{setDraftStatus('Draft storage is unavailable. Keep this page open until you submit.')}
    setDraftReady(draftKey)
  },[draftKey])
  useEffect(()=>{
    if(!draftKey||draftReady!==draftKey||draftSaved.current)return
    const value={version:1,savedAt:Date.now(),scheduledTime,clockInTime,clockOutTime,shiftType,jobRole,quickShift,floorShiftId,selectedTableIds,netSales,cashDeposit,voidCount,voidValue,discountValue,moneyTurnedInTo,drinkMaker,notes,registerCash,registerImbalanceReason,registerVerifiedBy,hasStockItems,stockItems,answers,peerVoteEmployeeId,peerVoteOtherReason,zeroSalesReason}
    try{sessionStorage.setItem(draftKey,JSON.stringify(value));setDraftStatus('Draft saved in this tab.')}catch{setDraftStatus('Could not save the draft in this tab. Keep this page open until you submit.')}
  },[draftKey,draftReady,scheduledTime,clockInTime,clockOutTime,shiftType,jobRole,quickShift,floorShiftId,selectedTableIds,netSales,cashDeposit,voidCount,voidValue,discountValue,moneyTurnedInTo,drinkMaker,notes,registerCash,registerImbalanceReason,registerVerifiedBy,hasStockItems,stockItems,answers,peerVoteEmployeeId,peerVoteOtherReason,zeroSalesReason])
  function chooseQuickShift(s:QuickShift){
    touched.current.shift=true;setQuickShift(s.key);setScheduledTime(centralTime(s.start));const role=roleFromSchedule(s.role);if(role)setJobRole(role as JobRole);setScheduleNotice(role?'Scheduled start and role loaded. Actual clock times still need your confirmation.':'Scheduled start loaded. Choose the role you actually worked.');setCertified(false)
  }
  useEffect(()=>{
    if(!locationId||!ownerId||draftReady!==draftKey||!draftKey)return
    let live=true;setQuickShifts([]);setScheduleNotice('Checking your confirmed schedule…')
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000)
    void Promise.resolve(supabase.rpc('quick_closeout_context',{p_location_id:locationId,p_day:closeoutDay}).abortSignal(controller.signal)).then(({data,error})=>{
      if(!live)return;if(error)throw error
      if(!Array.isArray(data?.shifts))throw Error('Schedule details were not returned.')
      const rows=data.shifts as QuickShift[];if(rows.some(s=>typeof s.key!=='string'||!centralTime(s.start)||typeof s.role!=='string'))throw Error('Schedule details were incomplete.')
      setQuickShifts(rows);setScheduleNotice(!data.confirmed?'Schedule is not confirmed. Enter your actual shift details below.':!rows.length?'No matching confirmed shift. Enter the shift you actually worked.':rows.length>1?'Choose the shift you are closing out.':'Using your confirmed schedule. Actual clock times remain separate.')
      if(rows.length===1&&!touched.current.shift){setQuickShift(rows[0].key);setScheduledTime(centralTime(rows[0].start));const role=roleFromSchedule(rows[0].role);if(role)setJobRole(role as JobRole)}
    }).catch(e=>{if(live)setScheduleNotice('Schedule unavailable. Enter your shift details. '+String((e as {message?:string})?.message??e))}).finally(()=>clearTimeout(timer))
    return()=>{live=false;controller.abort();clearTimeout(timer)}
  },[locationId,ownerId,closeoutDay,draftReady,draftKey])
  useEffect(()=>{
    if(!locationId||!tables.length||draftReady!==draftKey||!draftKey||touched.current.tables)return
    let live=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000)
    void Promise.resolve(supabase.rpc('floor_sections_for_day',{p_location_id:locationId,p_date:closeoutDay,p_only_me:true}).abortSignal(controller.signal)).then(({data,error})=>{
      if(!live||touched.current.tables)return;if(error)throw error;if(!Array.isArray(data))throw Error('Floor assignments were not returned.')
      const ids=[...new Set(data.flatMap((r:{table_ids?:string[]})=>Array.isArray(r.table_ids)?r.table_ids:[]))] as string[]
      setSelectedTableIds(ids.filter(id=>tables.some(t=>t.id===id)));setFloorTablesNotice(ids.length?'Published tables loaded. Change these if you worked different tables.':'No published tables found. Add the tables you worked if applicable.')
    }).catch(e=>{if(live)setFloorTablesNotice('Tables unavailable. Select the tables you worked. '+String((e as {message?:string})?.message??e))}).finally(()=>clearTimeout(timer))
    return()=>{live=false;controller.abort();clearTimeout(timer)}
  },[locationId,closeoutDay,tables,draftReady,draftKey])
  function currentIssues(){
    return quickCloseoutIssues({config,configError,shown,scheduledTime,clockInTime,clockOutTime,shiftType,jobRole,netSales,cashDeposit,voidCount,voidValue,discountValue,moneyTurnedInTo,certified,zeroSalesConfirmed,zeroSalesReason,hasStockItems,stockItems,registerCash,registerImbalanceReason,registerVerifiedBy,answers,receiptPending,receiptKey:receiptDraft.key,receiptRows,targetLoading:targetState.loading,ownerId,peerVoteEmployeeId,ready:!!organizationId&&!!locationId&&draftReady===draftKey})
  }
  const visibleIssues=issues.length?currentIssues():[]
  const fieldError=(field:string)=>visibleIssues.filter(x=>x.field===field).map(x=><p key={x.message} className="quick-field-error">{x.message}</p>)
  const money=(v:string)=>v.trim()===''?'Not entered':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(v)||0)
  const staffQuestions=config?.questions.filter(q=>q.active&&!q.builtin&&q.audience==='staff')??[]
  if(loading)return <section className="page closeout-mobile"><h1>Staff closeout</h1><p role="status">Loading your closeout…</p></section>
  return <DesignSection as="section" data-design-block="closeout.quick.page" className="page closeout-mobile quick-closeout">
    <header><p>{locationName} · {closeoutDay}</p><h1>Finish my shift</h1><p>Check your shift, enter your totals, and submit.</p><small role="status">{draftStatus}</small></header>
    {closeoutDay!==serviceDay()&&<p role="status">You are closing out {closeoutDay}. Today’s service date is {serviceDay()}.</p>}
    {message&&<p className="quick-success" role="status">{message}</p>}
    {error&&<p role="alert" className="quick-field-error">{error}</p>}
    {visibleIssues.length>0&&<section id="closeout-errors" tabIndex={-1} role="alert" className="quick-errors"><h2>Finish these before submitting</h2><ul>{visibleIssues.map(x=><li key={x.message}><a href={'#quick-'+x.field} onClick={()=>{if(x.field==='shift')setShiftOpen(true);if(x.field==='report')setReportOpen(true)}}>{x.message}</a></li>)}</ul></section>}
    <fieldset disabled={saving} className="quick-fields">
    <DesignSection as="section" data-design-block="closeout.quick.shift" className="card" id="quick-shift">
      <h2>1. Your shift</h2><p><strong>{ROLE_LABELS[jobRole]}</strong> · {shiftType||'Choose shift'} · {scheduledTime||'Start needed'}{clockOutTime?' – '+clockOutTime:''}</p>
      <p>{selectedTables.length?selectedTables.map(t=>t.table_name).join(', '):'Tables not selected'} · Target: {targetState.loading?'Loading…':targetState.ready?money(salesTarget):'Unavailable'}</p>
        {shown('staff_1')&&<div className="quick-grid"><label>Actual clock-in<ClockTime required label="Clock-in time" value={clockInTime} onChange={setClockInTime}/></label><label>Actual clock-out<ClockTime required label="Clock-out time" value={clockOutTime} onChange={setClockOutTime}/></label></div>}
      <details open={shiftOpen||(!scheduledTime&&!quickShifts.length)} onToggle={e=>setShiftOpen(e.currentTarget.open)}><summary>Check / change shift details</summary>
        <p role="status">{scheduleNotice}</p>
        {quickShifts.length>0&&<label>Confirmed shift<select value={quickShift} onChange={e=>{const s=quickShifts.find(s=>s.key===e.target.value);if(s)chooseQuickShift(s)}}><option value="">Select shift</option>{quickShifts.map(s=><option key={s.key} value={s.key}>{s.role} · {centralTime(s.start)} – {centralTime(s.end)}</option>)}</select></label>}
        <div className="quick-grid">
          {shown('staff_0')&&<label>{questionLabel(config,'staff_0','Scheduled start')}<ClockTime required label="Scheduled start" value={scheduledTime} onChange={v=>{touched.current.shift=true;setScheduledTime(v)}}/></label>}
          <label>Role worked<select value={jobRole} onChange={e=>{touched.current.shift=true;setJobRole(e.target.value as JobRole)}}>{Object.entries(ROLE_LABELS).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
          {shown('staff_2')&&<label>{questionLabel(config,'staff_2','Shift')}<select value={shiftType} onChange={e=>setShiftType(e.target.value)}><option value="">Choose shift</option><option value="AM">AM</option><option value="PM">PM</option><option value="TO_VOLUME">To Volume</option></select></label>}
        </div>
        {closeoutHours(clockInTime,clockOutTime)!==null&&<p>{closeoutHours(clockInTime,clockOutTime)!.toFixed(2)} hours · after-midnight end times count toward this shift.</p>}
        {!targetState.ready&&<p role="status">Target unavailable: {targetState.reason} No sales-target points are estimated without a target.</p>}<button type="button" disabled={targetState.loading} onClick={()=>setTargetRefresh(v=>v+1)}>Refresh target</button>
        <details><summary>Tables worked · {selectedTables.length}</summary><p>{floorTablesNotice}</p><label>Floor shift (optional)<select value={floorShiftId} onChange={e=>setFloorShiftId(e.target.value)}><option value="">All my assignments this day</option>{floorShifts.map(s=><option key={s.id} value={s.id}>{s.shift_name}</option>)}</select></label><button type="button" onClick={()=>{touched.current.tables=true;void pullFloorTables()}}>Reload my Floor tables</button>{Object.entries(groupedTables).map(([room,rows])=><div key={room}><h3>{room}</h3><div className="closeout-table-grid">{rows.map(t=><button type="button" key={t.id} aria-pressed={selectedTableIds.includes(t.id)} className={'table-select-button'+(selectedTableIds.includes(t.id)?' selected':'')} onClick={()=>{touched.current.tables=true;toggleTable(t.id)}}>{t.table_name}</button>)}</div></div>)}</details>
        <details><summary>Different service date / approved past closeout</summary><PastCloseoutControls location={locationId} day={closeoutDay} disabled={saving} onDay={changeServiceDay} onPolicy={pastPolicy}/></details>
      </details>{fieldError('shift')}
    </DesignSection>
    <DesignSection as="section" data-design-block="closeout.quick.totals" className="card" id="quick-totals">
      <h2>2. Sales &amp; cash</h2><div className="quick-grid">
        {shown('staff_3')&&<label>{questionLabel(config,'staff_3','Net sales')}<input aria-label="Net sales" type="number" inputMode="decimal" min="0" step="0.01" value={netSales} onChange={e=>setNetSales(e.target.value)}/></label>}
        {shown('staff_5')&&<label>{questionLabel(config,'staff_5','Cash deposit')}<input aria-label="Cash deposit" type="number" inputMode="decimal" min="0" step="0.01" value={cashDeposit} onChange={e=>setCashDeposit(e.target.value)}/></label>}
      </div>
      {shown('staff_14')&&Number(cashDeposit)>0&&<label>{questionLabel(config,'staff_14','Cash given to')}<select value={moneyTurnedInTo} onChange={e=>setMoneyTurnedInTo(e.target.value)}><option value="">Choose recipient</option>{employees.map(p=><option key={p.user_id} value={p.user_id}>{employeeName(p)}</option>)}</select></label>}
      {shown('staff_3')&&netSales.trim()!==''&&Number(netSales)===0&&<div className="quick-note"><label className="quick-check"><input type="checkbox" checked={zeroSalesConfirmed} onChange={e=>setZeroSalesConfirmed(e.target.checked)}/>I checked my report: $0 sales is correct.</label><label>Why were sales zero?<input value={zeroSalesReason} maxLength={2000} onChange={e=>setZeroSalesReason(e.target.value)} placeholder="For example, worked a non-selling role"/></label></div>}
      {fieldError('totals')}
      <div id="quick-receipts" className="quick-receipts"><p><strong>Receipts</strong> · {receiptPending===null?'Status unverified':receiptRows.length+' attached'+(receiptPending?' · '+receiptPending+' need details':'')}</p>
      {receiptDraft.key&&<CloseoutReceiptWallet closeoutOnly key={receiptDraft.key} location={locationId} day={closeoutDay} closeoutKey={receiptDraft.key} shiftId={floorShiftId||undefined} onPendingChange={setReceiptPending} onChange={rows=>setReceiptRows(rows)}/>}
      <p>Wallet drafts stay private and do not block this closeout. Attach all receipts supporting your POS void and comp totals.</p>
      <div className="quick-grid"><label>{questionLabel(config,'staff_6','POS void total')}<input aria-label="POS void total" type="number" min="0" step="0.01" inputMode="decimal" value={voidValue} onChange={e=>setVoidValue(e.target.value)}/><small>Attached receipts: {money(String(receiptTotals.voidTotal))}</small></label><label>{questionLabel(config,'staff_7','POS comps / discounts')}<input aria-label="POS comps / discounts" type="number" min="0" step="0.01" inputMode="decimal" value={discountValue} onChange={e=>setDiscountValue(e.target.value)}/><small>Attached receipts: {money(String(receiptTotals.compTotal))}</small></label></div>
      {receiptRows.length===0?<button type="button" disabled={receiptPending!==0} onClick={()=>{setVoidCount('0');setVoidValue('0');setDiscountValue('0')}}>No voids or comps</button>:<button type="button" disabled={receiptPending!==0} onClick={()=>{setVoidCount(String(receiptTotals.voidCount));setVoidValue(String(receiptTotals.voidTotal));setDiscountValue(String(receiptTotals.compTotal))}}>Use attached receipt totals</button>}
      <small>Use only after comparing with your POS report. Enter 0 explicitly when there were none.</small>{fieldError('receipts')}</div>
      {jobRole==='main_bartender'&&shown('staff_8')&&<div id="quick-register"><h3>Register</h3><label>{questionLabel(config,'staff_8','Cash left in register')}<input type="number" min="0" step="0.01" value={registerCash} onChange={e=>setRegisterCash(e.target.value)}/></label>{registerCash!==''&&Number(registerCash)!==200&&<><label>{questionLabel(config,'staff_9','Reason for difference')}<textarea value={registerImbalanceReason} onChange={e=>setRegisterImbalanceReason(e.target.value)}/></label><label>{questionLabel(config,'staff_10','Verified by')}<select value={registerVerifiedBy} onChange={e=>setRegisterVerifiedBy(e.target.value)}><option value="">Choose verifier</option>{employees.map(p=><option key={p.user_id} value={p.user_id}>{employeeName(p)}</option>)}</select></label></>}{fieldError('register')}</div>}
    </DesignSection>
    <DesignSection as="section" data-design-block="closeout.quick.report" className="card" id="quick-report">
      <h2>3. Anything to report?</h2><div className="quick-actions"><button type="button" aria-pressed={hasStockItems==='no'&&!notes.trim()} onClick={()=>{setHasStockItems('no');setStockItems('');setReportOpen(!!notes.trim())}}>No new stock shortages</button><button type="button" onClick={()=>setReportOpen(true)}>Add an issue / note</button></div>
      <details open={reportOpen||hasStockItems==='yes'} onToggle={e=>setReportOpen(e.currentTarget.open)}><summary>Stock shortages &amp; shift notes{notes.trim()?' · note added':''}</summary><CloseoutStockQuestion answer={hasStockItems} items={stockItems} disabled={saving} onAnswer={v=>{setHasStockItems(v);if(v!=='yes')setStockItems('')}} onItems={setStockItems}/><label>Guest issues, discrepancies or shift notes<textarea rows={3} value={notes} onChange={e=>setNotes(e.target.value)}/></label><small>Keep any applicable custom questions below complete.</small></details>
      {fieldError('report')}
      {staffQuestions.length>0&&<div id="quick-questions"><CloseoutQuestions config={config} audience="staff" answers={answers} onChange={setAnswers}/>{fieldError('questions')}</div>}
      {(shown('staff_11')||(shown('staff_15')&&jobRole==='server'))&&<details><summary>Optional recognition &amp; drink support</summary>{shown('staff_15')&&jobRole==='server'&&<label>{questionLabel(config,'staff_15','Who made your drinks?')}<select value={drinkMaker} onChange={e=>setDrinkMaker(e.target.value)}><option value="">Not applicable</option>{employees.map(p=><option key={p.user_id} value={p.user_id}>{employeeName(p)}</option>)}</select></label>}{shown('staff_11')&&<><label>Recognize a teammate<select value={peerVoteEmployeeId} onChange={e=>setPeerVoteEmployeeId(e.target.value)}><option value="">Skip recognition</option>{employees.filter(p=>p.user_id!==ownerId).map(p=><option key={p.user_id} value={p.user_id}>{employeeName(p)}</option>)}</select></label>{peerVoteEmployeeId&&<label>What did they do?<textarea maxLength={500} value={peerVoteOtherReason} onChange={e=>setPeerVoteOtherReason(e.target.value)}/></label>}</>}</details>}
    </DesignSection>
    <section className="card quick-submit" id="quick-submit"><h2>Review &amp; submit</h2><p>Sales <strong>{money(netSales)}</strong> · Deposit <strong>{money(cashDeposit)}</strong> · {receiptRows.length} attached receipts</p>
      <label className="quick-check"><input type="checkbox" checked={certified} onChange={e=>setCertified(e.target.checked)}/>I checked my POS report and confirm this closeout is accurate.</label>{fieldError('submit')}
      <button type="button" className="primary-button" disabled={saving} onClick={()=>void submitCloseout()}>{saving?'Submitting…':'Submit closeout'}</button>
      <details><summary>Points breakdown</summary>{closeoutDay<serviceDay()&&pastPoints===false?<p>No point changes for this approved past-date closeout.</p>:pointResult?<><p>Estimated shift score: {pointResult.shiftScore}. Final points are calculated by the server.</p>{pointResult.adjustments.map(a=><p key={a.code}>{a.description}: {a.points>0?'+':''}{a.points}</p>)}</>:<p>Enter actual clock times to estimate points.</p>}</details>
    </section></fieldset>
    {submittedReceiptKey&&<details><summary>Submitted receipt log</summary><ReceiptSubmissionLog location={locationId} day={closeoutDay} closeoutKey={submittedReceiptKey}/></details>}
    <Link to="/closeout">Back to closeouts</Link>
  </DesignSection>
}

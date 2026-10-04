import { ClockTime } from '../components/ClockTime'
import { closeoutHours } from '../lib/closeoutHours'
import './CloseoutMobile.css'
import { submissionLabel } from '../lib/submissionTime'
import { Link } from 'react-router-dom'
import { CloseoutQuestions, useCloseoutConfig, checkAnswers, questionLabel } from '../components/CloseoutConfig'
import type { Answers } from '../components/CloseoutConfig'
import { useEffect, useMemo, useState } from 'react'
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
  general_manager: 'General Manager',
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
  const [answers, setAnswers] = useState<Answers>({})

  const [loading, setLoading] =
    useState(true)

  const [saving, setSaving] =
    useState(false)

  const [organizationId, setOrganizationId] =
    useState('')

  const [locationId, setLocationId] =
    useState('')

  const { config, error: configError } = useCloseoutConfig(locationId)
  function configuredShiftPoints(input: Parameters<typeof calculateShiftPoints>[0]) {
    const original = calculateShiftPoints(input)
    const adjustments = original.adjustments.map(a => {
      const rule = config?.rules.find(r => r.id === a.code)
      return rule ? {...a, points: rule.active ? rule.points : 0, description: rule.reason} : a
    })
    const pointsDelta = adjustments.reduce((n, a) => n + a.points, 0)
    return {...original, adjustments, pointsDelta, shiftScore: original.startingScore + pointsDelta}
  }

  const [locationName, setLocationName] =
    useState('')

  const [employees, setEmployees] =
    useState<EmployeeOption[]>([])

  const [peerVoteEmployeeId, setPeerVoteEmployeeId] = useState('')
  const [peerVoteReason, setPeerVoteReason] = useState('')
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

  const [salesTarget, setSalesTarget] =
    useState('')

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
    ])

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
    setSalesTarget('')

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
  }

  async function submitCloseout() {
    try {
      setSaving(true)
      setError('')
      setMessage('')

      const {
        data: { user },
        error: userError,
      } =
        await supabase.auth.getUser()

      if (userError) {
        throw userError
      }

      if (!user) {
        throw new Error(
          'You must be signed in.'
        )
      }

      if (
        !organizationId ||
        !locationId
      ) {
        throw new Error(
          'Organization or location is missing.'
        )
      }

      if (!scheduledTime) {
        throw new Error(
          'Enter your scheduled time.'
        )
      }

      if (!clockInTime) {
        throw new Error(
          'Enter your actual clock-in time.'
        )
      }

      if (closeoutHours(clockInTime, clockOutTime) === null) throw new Error('Enter your clock-out time. Shift length must be greater than zero and no more than 18 hours. A clock-out earlier than clock-in means the next day.')

      if (!moneyTurnedInTo) {
        throw new Error(
          'Select who received your money.'
        )
      }

      if (!certified) {
        throw new Error(
          'Please confirm that the closeout information is accurate.'
        )
      }

      for (const [label, raw] of [['Net sales', netSales], ['Sales target', salesTarget], ['Cash deposit', cashDeposit], ['Voids', voidValue], ['Discounts', discountValue]]) {
        if (!raw.trim() || !/^\d+(\.\d{1,2})?$/.test(raw.trim()) || !Number.isFinite(Number(raw)) || Number(raw)>100000000) throw new Error(`Enter ${label.toLowerCase()} as a valid amount. Enter 0 only when it is accurate.`)
      }
      if (!shiftType) throw new Error('Select the shift you worked.')
      if (voidCount && (!/^\d+$/.test(voidCount) || Number(voidCount)>100000)) throw new Error('Void count must be a nonnegative whole number.')
      if (Number(netSales)===0 && (!zeroSalesConfirmed || zeroSalesReason.trim().length<3)) throw new Error('Confirm that $0 sales is accurate and explain why.')
      const customAnswers = checkAnswers(config, 'staff', answers)
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

      // Peer Recognition validation
      if (!peerVoteEmployeeId) {
        throw new Error(
          'Please choose a teammate for Peer Recognition.'
        )
      }

      if (peerVoteEmployeeId === user.id) {
        throw new Error(
          'You cannot select yourself for Peer Recognition.'
        )
      }

      if (!peerVoteReason) {
        throw new Error(
          'Please choose a Peer Recognition reason.'
        )
      }

      if (
        peerVoteReason === 'Other' &&
        !peerVoteOtherReason.trim()
      ) {
        throw new Error(
          'Please enter a reason for Peer Recognition.'
        )
      }

      const {
        data: closeout,
        error:
          closeoutError,
      } = await supabase
        .from(
          'daily_closeouts'
        )
        .insert({
          zero_sales_confirmed: Number(netSales)===0 && zeroSalesConfirmed,
          zero_sales_reason: Number(netSales)===0 ? zeroSalesReason.trim() : null,
          shift_type: shiftType,
          custom_answers: customAnswers,
          organization_id:
            organizationId,

          location_id:
            locationId,

          user_id:
            user.id,

          closeout_date:
            new Date()
              .toISOString()
              .slice(0, 10),

          scheduled_start:
            scheduledTime,

          clock_in:
            clockInTime,
          clock_out: clockOutTime,

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
            Number(
              voidCount || 0
            ),

          void_value:
            numberValue(
              voidValue
            ),

          discount_value:
            numberValue(
              discountValue
            ),

          money_turned_in_to:
            moneyTurnedInTo,

          drinks_made_by:
            drinkMaker ||
            null,

          notes:
            notes.trim() ||
            null,

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
        })
        .select('id,submitted_at,shift_score')
        .single()

      if (closeoutError) {
        throw closeoutError
      }

      const warnings:
        string[] = []

      /*
       * Save tables worked.
       */

      if (
        closeout?.id &&
        selectedTables.length >
          0
      ) {
        const tableRows =
          selectedTables.map(
            (table) => ({
              closeout_id:
                closeout.id,

              table_id:
                table.id,

              table_name:
                table.table_name,
            })
          )

        const {
          error:
            tableSaveError,
        } = await supabase
          .from(
            'daily_closeout_tables'
          )
          .insert(
            tableRows
          )

        if (
          tableSaveError
        ) {
          console.error(
            'Table save error:',
            tableSaveError
          )

          warnings.push(
            'table history needs review'
          )
        }
      }

      // Automatic closeout points are saved atomically by the database.

      // Save Peer Recognition award separately.
      // This awards +2 to the selected teammate without
      // changing the submitting employee's shift score.
      const peerRecognitionDescription =
        peerVoteReason === 'Other'
          ? peerVoteOtherReason.trim()
          : peerVoteReason

      const {
        error: peerRecognitionError,
      } = await supabase
        .from(
          'reward_point_transactions'
        )
        .insert({
          organization_id:
            organizationId,

          location_id:
            locationId,

          user_id:
            peerVoteEmployeeId,

          closeout_id:
            closeout.id,

          business_date:
            new Date()
              .toISOString()
              .slice(
                0,
                10
              ),

          action_code:
            'PEER_RECOGNITION',

          description:
            `Peer Recognition: ${peerRecognitionDescription}`,

          points:
            2,
        })

      if (
        peerRecognitionError
      ) {
        console.error(
          'Peer Recognition save error:',
          peerRecognitionError
        )

        warnings.push(
          'Peer Recognition points need review'
        )
      }

      const submittedScore =
        closeout.shift_score

      setAnswers({})
      resetForm()

      let confirmation =
        `✓ Daily closeout submitted ${submissionLabel(closeout.submitted_at)}. Shift score: ${submittedScore}.`

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
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to submit closeout.'
      )

      window.scrollTo({
        top: 0,
        behavior:
          'smooth',
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <section className="page closeout-mobile">
        <h1>
          Daily Closeout
        </h1>

        <p>
          Loading...
        </p>
      </section>
    )
  }

  return (
    <section className="page closeout-mobile">

      <div className="page-header">
        <p className="eyebrow">
          SHIFT ACCOUNTABILITY
        </p>

        <h1>
          Daily Closeout
        </h1>

        <p>
          {locationName}
        </p>
      </div>

      {error && (
        <div
          style={{
            marginBottom: 20,
            padding: 16,
            borderRadius: 12,
            border:
              '1px solid #ef4444',
            background:
              'rgba(239,68,68,.12)',
            fontWeight: 700,
          }}
        >
          {error}
        </div>
      )}

      {message && (
        <div
          style={{
            marginBottom: 20,
            padding: 16,
            borderRadius: 12,
            border:
              '1px solid #22c55e',
            background:
              'rgba(34,197,94,.14)',
            fontWeight: 700,
          }}
        >
          {message}
        </div>
      )}

      <p><Link to="/closeout">← Closeout</Link></p>
      {configError && <p role="alert">{configError}</p>}
      

      <div className="card">
        <h2>
          Shift Information
        </h2>

        <div className="form-grid">

          <label>
            {questionLabel(config, 'staff_0', "Scheduled Time")}

            <ClockTime required label="Scheduled time" value={scheduledTime} onChange={setScheduledTime} />
          </label>

          <label>
            {questionLabel(config, 'staff_1', "Actual Clock-In Time")}

            <ClockTime required label="Clock-in time" value={clockInTime} onChange={setClockInTime} />
          </label>

          <label>Actual Clock-Out Time
            <ClockTime required label="Clock-out time" value={clockOutTime} onChange={setClockOutTime} />
            <small>Use your actual end time. After-midnight clock-out is treated as the next day.</small>
          </label>
          {closeoutHours(clockInTime,clockOutTime)!==null && <p>Shift length: {closeoutHours(clockInTime,clockOutTime)!.toFixed(2)} hours</p>}

          <label>
            {questionLabel(config, 'staff_2', "Shift")}

            <select
              value={shiftType}
              onChange={(event) => setShiftType(event.target.value)}
            >
              <option value="">Select Shift</option>
              <option value="AM">AM</option>
              <option value="PM">PM</option>
              <option value="TO_VOLUME">To Volume</option>
            </select>
          </label>
        </div>
      </div>

      <div className="card">
        <h2>
          Sales
        </h2>

        <div className="form-grid">

          <label>
            {questionLabel(config, 'staff_3', "Total Net Sales")}

            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={
                netSales
              }
              onChange={(
                event
              ) =>
                setNetSales(
                  event.target
                    .value
                )
              }
            />
          </label>

          <label>
            {questionLabel(config, 'staff_4', "Individual Sales Target")}

            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={
                salesTarget
              }
              onChange={(
                event
              ) =>
                setSalesTarget(
                  event.target
                    .value
                )
              }
            />
          </label>

        </div>
      </div>

      {netSales.trim()!=='' && Number(netSales)===0 && <div className="closeout-warning"><h3>Check your sales</h3><p>You entered $0. Check your Toast report before continuing.</p><label className="closeout-check"><input type="checkbox" checked={zeroSalesConfirmed} onChange={e=>setZeroSalesConfirmed(e.target.checked)} /><span>I checked my report and $0 sales is accurate.</span></label><label>Why were sales zero?<textarea rows={2} maxLength={2000} value={zeroSalesReason} onChange={e=>setZeroSalesReason(e.target.value)} placeholder="Explain why this shift had no sales." /></label></div>}

      <div className="card">
        <h2>
          Cash & Adjustments
        </h2>

        <div className="form-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: '16px',
                alignItems: 'start',
                width: '100%',
              }}
            >

          <label>
            {questionLabel(config, 'staff_5', "Cash Deposit")}

            <input
              type="number"
              step="0.01"
              value={
                cashDeposit
              }
              onChange={(
                event
              ) =>
                setCashDeposit(
                  event.target
                    .value
                )
              }
            />
          </label>


          <label>
            {questionLabel(config, 'staff_6', "Total Value of Voids")}

            <input
              type="number"
              step="0.01"
              value={
                voidValue
              }
              onChange={(
                event
              ) =>
                setVoidValue(
                  event.target
                    .value
                )
              }
            />
          </label>

          <label>
            {questionLabel(config, 'staff_7', "Total Value of Discounts")}

            <input
              type="number"
              step="0.01"
              value={
                discountValue
              }
              onChange={(
                event
              ) =>
                setDiscountValue(
                  event.target
                    .value
                )
              }
            />
          </label>

        </div>
      </div>

      <div className="card">
        <h2>
          Role Worked
        </h2>

        <select
          value={
            jobRole
          }
          onChange={(
            event
          ) =>
            setJobRole(
              event.target
                .value as JobRole
            )
          }
        >
          {(
            Object.keys(
              ROLE_LABELS
            ) as JobRole[]
          ).map(
            (role) => (
              <option
                key={
                  role
                }
                value={
                  role
                }
              >
                {
                  ROLE_LABELS[
                    role
                  ]
                }
              </option>
            )
          )}
        </select>

        <div className="role-description">
          <strong>
            {
              ROLE_LABELS[
                jobRole
              ]
            }
          </strong>

          <p>
            {
              ROLE_DESCRIPTIONS[
                jobRole
              ]
            }
          </p>
        </div>
      </div>
{jobRole === 'main_bartender' && (
  <div className="card">
    <h2>Register Closeout</h2>

    <label>
      {questionLabel(config, 'staff_8', "Cash Left in Register")}
      <input
        type="number"
        step="0.01"
        min="0"
        value={registerCash}
        onChange={(event) =>
          setRegisterCash(event.target.value)
        }
        placeholder="200.00"
        required
      />
    </label>

    {registerCash !== '' &&
      Number(registerCash) !== 200 && (
        <>
          <label>
            {questionLabel(config, 'staff_9', "Why is the register not at $200?")}
            <textarea
              value={registerImbalanceReason}
              onChange={(event) =>
                setRegisterImbalanceReason(
                  event.target.value
                )
              }
              required
            />
          </label>

          <label>
            {questionLabel(config, 'staff_10', "Who verified the imbalance?")}
            <select
              value={registerVerifiedBy}
              onChange={(event) =>
                setRegisterVerifiedBy(
                  event.target.value
                )
              }
              required
            >
              <option value="">
                Select verifier
              </option>

              {employees.map((employee) => (
                <option
                  key={employee.user_id}
                  value={employee.user_id}
                >
                  {employee.full_name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
  </div>
      )}
      <div className="card">
        <h2>
          Tables Worked
        </h2>

        {Object.entries(
          groupedTables
        ).map(
          ([
            roomName,
            roomTables,
          ]) => (
            <div
              key={
                roomName
              }
              className="closeout-room-group"
            >
              <h3>
                {
                  roomName
                }
              </h3>

              <div className="closeout-table-grid">

                {roomTables.map(
                  (table) => {
                    const selected =
                      selectedTableIds.includes(
                        table.id
                      )

                    return (
                      <button
                        key={
                          table.id
                        }
                        type="button"

                        className={
                          selected
                            ? 'table-select-button selected'
                            : 'table-select-button'
                        }
                        style={
                          selected
                            ? {
                                backgroundColor: '#d9b45b',
                                color: '#ffffff',
                                borderColor: '#d9b45b',
                                boxShadow: '0 0 0 2px rgba(217, 180, 91, 0.35)',
                                fontWeight: 700,
                              }
                            : undefined
                        }

                        onClick={() =>
                          toggleTable(
                            table.id
                          )
                        }
                      >
                        {
                          table.table_name
                        }
                      </button>
                    )
                  }
                )}

              </div>
            </div>
          )
        )}

        <p>
          <strong>
            Selected:
          </strong>{' '}

          {selectedTables.length >
          0
            ? selectedTables
                .map(
                  (table) =>
                    table.table_name
                )
                .join(', ')
            : 'None'}
        </p>
      </div>


      <div className="card">
        <h2>⭐ Peer Recognition — +5 Points</h2>

        <div className="form-grid">
          <label>
            {questionLabel(config, 'staff_11', "Which team member contributed the most to a successful shift?")}

            <select
              value={peerVoteEmployeeId}
              onChange={(e) => setPeerVoteEmployeeId(e.target.value)}
            >
              <option value="">Select a teammate</option>

              {employees.map((employee) => (
                <option
                  key={employee.user_id}
                  value={employee.user_id}
                >
                  {employee.preferred_name ||
                    employee.full_name ||
                    employee.user_id}
                </option>
              ))}
            </select>
          </label>

          <label>
            {questionLabel(config, 'staff_12', "Why are you recognizing them?")}

            <select
              value={peerVoteReason}
              onChange={(e) => setPeerVoteReason(e.target.value)}
            >
              <option value="">Select a reason</option>
              <option value="Teamwork">Teamwork</option>
              <option value="Positive Attitude / Motivation">
                Positive Attitude / Motivation
              </option>
              <option value="Helped During a Rush">
                Helped During a Rush
              </option>
              <option value="Guest Support">Guest Support</option>
              <option value="Leadership">Leadership</option>
              <option value="Communication">Communication</option>
              <option value="Went Above & Beyond">
                Went Above &amp; Beyond
              </option>
              <option value="Other">Other</option>
            </select>
          </label>

          {peerVoteReason === 'Other' && (
            <label>
              {questionLabel(config, 'staff_13', "Tell us why you're recognizing them:")}

              <input
                type="text"
                value={peerVoteOtherReason}
                onChange={(e) =>
                  setPeerVoteOtherReason(e.target.value)
                }
                placeholder="Enter recognition reason"
              />
            </label>
          )}
        </div>
      </div>

      <div className="card">
        <h2>
          Shift Accountability
        </h2>

        <div className="form-grid">

          <label>
            {questionLabel(config, 'staff_14', "Who did you turn your money in to?")}

            <select
              value={
                moneyTurnedInTo
              }
              onChange={(
                event
              ) =>
                setMoneyTurnedInTo(
                  event.target
                    .value
                )
              }
            >
              <option value="">
                Select employee
              </option>

              {employees.map(
                (employee) => (
                  <option
                    key={
                      employee.user_id
                    }
                    value={
                      employee.user_id
                    }
                  >
                    {employeeName(
                      employee
                    )}
                  </option>
                )
              )}
            </select>
          </label>

          <label>
            {questionLabel(config, 'staff_15', "Who made your drinks?")}

            <select
              value={
                drinkMaker
              }
              onChange={(
                event
              ) =>
                setDrinkMaker(
                  event.target
                    .value
                )
              }
            >
              <option value="">
                Not applicable
              </option>

              {employees.map(
                (employee) => (
                  <option
                    key={
                      employee.user_id
                    }
                    value={
                      employee.user_id
                    }
                  >
                    {employeeName(
                      employee
                    )}
                  </option>
                )
              )}
            </select>
          </label>

        </div>
      </div>

      <div className="card">
        <h2>
          Notes
        </h2>

        <textarea
          rows={4}
          value={
            notes
          }
          onChange={(
            event
          ) =>
            setNotes(
              event.target
                .value
            )
          }
          placeholder="Shift notes, discrepancies, guest issues, etc."
        />
      </div>

      <div className="card">
        <h2>
          Shift Score
        </h2>

        {!pointResult ? (
          <p>
            Enter scheduled
            and actual
            clock-in times
            to calculate.
          </p>
        ) : (
          <>
            <div className="shift-score-number">
              {
                pointResult.shiftScore
              }
            </div>

            <p>
              Starting score:
              {' '}100
            </p>

            <div className="point-adjustment-list">

              {pointResult.adjustments.map(
                (item) => (
                  <div
                    key={
                      item.code
                    }
                    className="point-adjustment"
                  >
                    <span>
                      {
                        item.description
                      }
                    </span>

                    <strong>
                      {item.points >
                      0
                        ? `+${item.points}`
                        : item.points}
                    </strong>
                  </div>
                )
              )}

            </div>

            <div className="point-total">
              <span>
                Net Adjustment
              </span>

              <strong>
                {pointResult.pointsDelta >
                0
                  ? `+${pointResult.pointsDelta}`
                  : pointResult.pointsDelta}
              </strong>
            </div>
          </>
        )}
      </div>

      <fieldset disabled={saving}><CloseoutQuestions config={config} audience="staff" answers={answers} onChange={setAnswers} /></fieldset>

      <div className="card">
        <h2>
          Certification
        </h2>

        <label
          style={{
            display:
              'flex',

            gap: 12,

            alignItems:
              'flex-start',
          }}
        >
          <input
            type="checkbox"
            checked={
              certified
            }
            onChange={(
              event
            ) =>
              setCertified(
                event.target
                  .checked
              )
            }
          />

          <span>
            I confirm that
            the information
            in this closeout
            is accurate.
          </span>
        </label>
      </div>

      <div className="card">
        <h2>
          Review & Submit
        </h2>
        <div className="closeout-review"><p>Net sales: <strong>${netSales || 'Not entered'}</strong></p><p>Sales target: <strong>${salesTarget || 'Not entered'}</strong></p><p>Cash deposit: <strong>${cashDeposit || 'Not entered'}</strong></p><p>Review these amounts against your Toast report. An inaccurate submission does not earn the completion bonus.</p></div>

        {pointResult && (
          <p>
            <strong>
              Shift Score:
            </strong>{' '}

            {
              pointResult.shiftScore
            }
          </p>
        )}

        <button
          type="button"
          className="primary-button"
          onClick={
            submitCloseout
          }
          disabled={
            saving
          }
        >
          {saving
            ? 'Submitting...'
            : 'Submit Daily Closeout'}
        </button>
      </div>

      <div
        style={{
          height: 160,
        }}
      />

    </section>
  )
}


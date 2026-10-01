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

  const hasVoidActivity =
    voidCount > 0 ||
    voidValue > 0

  if (!hasVoidActivity) {
    adjustments.push({
      code: 'NO_VOIDS',
      description:
        'No voids',
      points: 5,
    })
  } else {
    const countForPenalty =
      voidCount > 0
        ? Math.round(voidCount)
        : 1

    adjustments.push({
      code: 'VOID_PENALTY',
      description:
        `${countForPenalty} ${
          countForPenalty === 1
            ? 'void'
            : 'voids'
        }`,
      points:
        countForPenalty * -4,
    })
  }

  /*
   * =====================================
   * DISCOUNTS
   * =====================================
   *
   * $0 = +5
   * $0.01 through $10 = 0
   * Over $10 = -4
   */

  if (discountValue <= 0) {
    adjustments.push({
      code: 'NO_DISCOUNTS',
      description:
        'No discounts',
      points: 5,
    })
  } else if (
    discountValue > 10
  ) {
    adjustments.push({
      code:
        'DISCOUNTS_OVER_10',

      description:
        `$${discountValue.toFixed(
          2
        )} in discounts`,

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
  const [loading, setLoading] =
    useState(true)

  const [saving, setSaving] =
    useState(false)

  const [organizationId, setOrganizationId] =
    useState('')

  const [locationId, setLocationId] =
    useState('')

  const [locationName, setLocationName] =
    useState('')

  const [employees, setEmployees] =
    useState<EmployeeOption[]>([])

  const [tables, setTables] =
    useState<TableOption[]>([])

  const [scheduledTime, setScheduledTime] =
    useState('')

  const [clockInTime, setClockInTime] =
    useState('')

  const [netSales, setNetSales] =
    useState('')

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

      return calculateShiftPoints({
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

      const finalPoints =
        calculateShiftPoints({
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

      const {
        data: closeout,
        error:
          closeoutError,
      } = await supabase
        .from(
          'daily_closeouts'
        )
        .insert({
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
        .select('id')
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

      /*
       * Save point transaction history.
       */

      if (
        closeout?.id &&
        finalPoints.adjustments
          .length > 0
      ) {
        const pointRows =
          finalPoints.adjustments.map(
            (adjustment) => ({
              organization_id:
                organizationId,

              location_id:
                locationId,

              user_id:
                user.id,

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
                adjustment.code,

              description:
                adjustment.description,

              points:
                adjustment.points,
            })
          )

        const {
          error:
            pointSaveError,
        } = await supabase
          .from(
            'reward_point_transactions'
          )
          .insert(
            pointRows
          )

        if (
          pointSaveError
        ) {
          console.error(
            'Point save error:',
            pointSaveError
          )

          warnings.push(
            'points history needs review'
          )
        }
      }

      const submittedScore =
        finalPoints.shiftScore

      resetForm()

      let confirmation =
        `✓ Daily closeout submitted successfully. Shift score: ${submittedScore}.`

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
      <section className="page">
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
    <section className="page">

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

      <div className="card">
        <h2>
          Shift Information
        </h2>

        <div className="form-grid">

          <label>
            Scheduled Time

            <input
              type="time"
              value={
                scheduledTime
              }
              onChange={(
                event
              ) =>
                setScheduledTime(
                  event.target
                    .value
                )
              }
            />
          </label>

          <label>
            Actual Clock-In Time

            <input
              type="time"
              value={
                clockInTime
              }
              onChange={(
                event
              ) =>
                setClockInTime(
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
          Sales
        </h2>

        <div className="form-grid">

          <label>
            Total Net Sales

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
            Individual Sales Target

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

      <div className="card">
        <h2>
          Cash & Adjustments
        </h2>

        <div className="form-grid">

          <label>
            Cash Deposit

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
            Number of Voids

            <input
              type="number"
              min="0"
              value={
                voidCount
              }
              onChange={(
                event
              ) =>
                setVoidCount(
                  event.target
                    .value
                )
              }
            />
          </label>

          <label>
            Total Value of Voids

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
            Total Value of Discounts

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
        <h2>
          Shift Accountability
        </h2>

        <div className="form-grid">

          <label>
            Who did you turn your money in to?

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
            Who made your drinks?

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
type FloorTable = {
  id?: string | null
  table_name?: string | null
  name?: string | null
  seat_count?: number | null
  seats?: number | null
}

type Assignment = {
  id?: string | null
  table_id?: string | null
  server_id?: string | null
  server_user_id?: string | null
  starts_at?: string | null
  ends_at?: string | null
  shift_start?: string | null
  shift_end?: string | null
  color?: string | null
}

type TeamMember = {
  user_id?: string | null
}

type Props = {
  tables?: FloorTable[] | null
  assignments?: Assignment[] | null
  teamMembers?: TeamMember[] | null
  memberName?: (userId: string) => string
  onServerPress?: (serverId: string) => void
}

function getSeats(table?: FloorTable | null) {
  return Number(
    table?.seat_count ??
      table?.seats ??
      0
  )
}

function getTableName(table?: FloorTable | null) {
  return (
    table?.table_name ||
    table?.name ||
    'Table'
  )
}

function formatTime(value?: string | null) {
  if (!value) return ''

  const timeOnly = String(value).match(
    /^(\d{1,2}):(\d{2})/
  )

  if (timeOnly) {
    let hour = Number(timeOnly[1])
    const minute = timeOnly[2]

    const suffix = hour >= 12 ? 'PM' : 'AM'
    hour = hour % 12 || 12

    return `${hour}:${minute} ${suffix}`
  }

  const date = new Date(value)

  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  return String(value)
}

export function TonightsFloorCards({
  tables,
  assignments,
  teamMembers,
  memberName,
  onServerPress,
}: Props) {
  const safeTables = Array.isArray(tables)
    ? tables
    : []

  const safeAssignments =
    Array.isArray(assignments)
      ? assignments
      : []

  const safeTeam = Array.isArray(teamMembers)
    ? teamMembers
    : []

  const getMemberName = (
    userId: string
  ) => {
    try {
      return memberName?.(userId) || 'Server'
    } catch {
      return 'Server'
    }
  }

  const serverIds = Array.from(
    new Set(
      safeAssignments
        .map((assignment) => {
          if (!assignment) return null

          return (
            assignment.server_id ||
            assignment.server_user_id ||
            null
          )
        })
        .filter(
          (value): value is string =>
            typeof value === 'string' &&
            value.length > 0
        )
    )
  )

  const validServerIds =
    safeTeam.length > 0
      ? serverIds.filter((serverId) =>
          safeTeam.some(
            (member) =>
              member?.user_id === serverId
          )
        )
      : serverIds

  if (validServerIds.length === 0) {
    return (
      <section className="tonights-floor-panel">
        <div className="tonights-floor-heading">
          <div>
            <p className="eyebrow">
              TONIGHT&apos;S FLOOR
            </p>

            <h2>Server Assignments</h2>
          </div>
        </div>

        <div className="tonights-floor-card">
          <span className="muted">
            No server assignments yet.
          </span>
        </div>
      </section>
    )
  }

  return (
    <section className="tonights-floor-panel">
      <div className="tonights-floor-heading">
        <div>
          <p className="eyebrow">
            TONIGHT&apos;S FLOOR
          </p>

          <h2>Server Assignments</h2>
        </div>
      </div>

      <div className="tonights-floor-grid">
        {validServerIds.map((serverId) => {
          const serverAssignments =
            safeAssignments.filter(
              (assignment) =>
                assignment &&
                (
                  assignment.server_id ||
                  assignment.server_user_id
                ) === serverId
            )

          const tableIds = Array.from(
            new Set(
              serverAssignments
                .map(
                  (assignment) =>
                    assignment.table_id
                )
                .filter(
                  (value): value is string =>
                    typeof value === 'string' &&
                    value.length > 0
                )
            )
          )

          const serverTables =
            safeTables.filter(
              (table) =>
                typeof table?.id === 'string' &&
                tableIds.includes(table.id)
            )

          const assignedCovers =
            serverTables.reduce(
              (total, table) =>
                total + getSeats(table),
              0
            )

          const start =
            serverAssignments
              .map(
                (assignment) =>
                  assignment.starts_at ||
                  assignment.shift_start
              )
              .find(Boolean) || null

          const end =
            serverAssignments
              .map(
                (assignment) =>
                  assignment.ends_at ||
                  assignment.shift_end
              )
              .find(Boolean) || null

          const color =
            serverAssignments
              .map(
                (assignment) =>
                  assignment.color
              )
              .find(Boolean) || undefined

          return (
            <button
              key={serverId}
              type="button"
              className="tonights-floor-card"
              onClick={() =>
                onServerPress?.(serverId)
              }
              style={
                color
                  ? {
                      borderColor: color,
                      boxShadow:
                        `inset 4px 0 0 ${color}`,
                    }
                  : undefined
              }
            >
              <div className="tonights-floor-card-top">
                <strong>
                  {getMemberName(serverId)}
                </strong>

                {(start || end) && (
                  <span>
                    {formatTime(start)}
                    {start && end ? '–' : ''}
                    {formatTime(end)}
                  </span>
                )}
              </div>

              <div className="tonights-floor-card-metrics">
                <div>
                  <span>
                    Assigned Covers
                  </span>

                  <strong>
                    {assignedCovers}
                  </strong>
                </div>

                <div>
                  <span>Tables</span>

                  <strong>
                    {serverTables.length}
                  </strong>
                </div>
              </div>

              <div className="tonights-floor-card-tables">
                {serverTables.length > 0 ? (
                  serverTables.map(
                    (table, index) => (
                      <span
                        key={
                          table.id ||
                          `${serverId}-${index}`
                        }
                      >
                        {getTableName(table)}
                      </span>
                    )
                  )
                ) : (
                  <span>
                    No tables assigned
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}

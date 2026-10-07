// page-designer-instrumented
import { PageWord } from "./PageDesign"
import { ScreenText } from "./ScreenText"
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
      <section data-design-block="copy.45ec43eb98bc70f6.1" className="tonights-floor-panel">
        <div data-design-block="copy.e97b0a6919f6f122.1" className="tonights-floor-heading">
          <div data-design-block="copy.e5a4fc73f4141b43.1">
            <p data-design-block="copy.221de76e6ff20003.1" className="eyebrow"><ScreenText id="TonightsFloorCards.6f61093d8beda6b9">
              TONIGHT&apos;S FLOOR
            </ScreenText></p>

            <h2 data-design-block="copy.07e26c0a9aa2b112.1"><ScreenText id="TonightsFloorCards.ea0bc2ad9e59292b">Server Assignments</ScreenText></h2>
          </div>
        </div>

        <div data-design-block="copy.d4a761ae577a5727.1" className="tonights-floor-card">
          <span className="muted"><ScreenText id="TonightsFloorCards.3a1e1f15cf911d13">
            No server assignments yet.
          </ScreenText></span>
        </div>
      </section>
    )
  }

  return (
    <section data-design-block="copy.45ec43eb98bc70f6.2" className="tonights-floor-panel">
      <div data-design-block="copy.e97b0a6919f6f122.2" className="tonights-floor-heading">
        <div data-design-block="copy.e5a4fc73f4141b43.2">
          <p data-design-block="copy.221de76e6ff20003.2" className="eyebrow"><ScreenText id="TonightsFloorCards.a9507a1ecffee18f">
            TONIGHT&apos;S FLOOR
          </ScreenText></p>

          <h2 data-design-block="copy.07e26c0a9aa2b112.2"><ScreenText id="TonightsFloorCards.3b714a37b8a31eac">Server Assignments</ScreenText></h2>
        </div>
      </div>

      <div data-design-block="copy.d2221cc40e8ab67b.1" className="tonights-floor-grid">
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
            <button data-design-block="copy.c6b80fd17ac3f247.1"
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
              <div data-design-block="copy.0e566bf1455fb504.1" className="tonights-floor-card-top">
                <strong>
                  {getMemberName(serverId)}
                </strong>

                {(start || end) && (
                  <span>
                    {formatTime(start)}
                    {start && end ? <PageWord id="copy.d0f4b9d50e0f990c.1">{"–"}</PageWord> : <PageWord id="copy.f1891022c2c7cb25.1">{""}</PageWord>}
                    {formatTime(end)}
                  </span>
                )}
              </div>

              <div data-design-block="copy.01506c398e732040.1" className="tonights-floor-card-metrics">
                <div data-design-block="copy.e5a4fc73f4141b43.3">
                  <span><ScreenText id="TonightsFloorCards.19cc9990a67a83f9">
                    Assigned Covers
                  </ScreenText></span>

                  <strong>
                    {assignedCovers}
                  </strong>
                </div>

                <div data-design-block="copy.e5a4fc73f4141b43.4">
                  <span><ScreenText id="TonightsFloorCards.cd89c0514744da7b">Tables</ScreenText></span>

                  <strong>
                    {serverTables.length}
                  </strong>
                </div>
              </div>

              <div data-design-block="copy.86319f4a138f60d8.1" className="tonights-floor-card-tables">
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
                  <span><ScreenText id="TonightsFloorCards.7eeb80ddf32f22ed">
                    No tables assigned
                  </ScreenText></span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}

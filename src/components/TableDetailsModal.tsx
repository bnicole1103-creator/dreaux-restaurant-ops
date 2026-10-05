import { ScreenText } from "./ScreenText"
type FloorTable = {
  id: string
  table_name?: string | null | null
  name?: string | null
  seat_count?: number
  seats?: number
}

type Assignment = {
  table_id?: string | null
  server_id?: string | null
  server_user_id?: string | null
}

type Reservation = {
  id: string
  guest_name?: string | null | null
  name?: string | null
  party_name?: string | null | null
  party_size?: number
  guest_count?: number
  covers?: number
  reservation_time?: string | null | null
  time?: string | null
  status?: string | null
  table_id?: string | null
  table_name?: string | null | null
  assigned_table?: string | null
  assigned_table_id?: string | null | null
}

type TeamMember = {
  user_id: string
}

type Props = {
  selectedTableIds: string[]
  tables: FloorTable[]
  assignments: Assignment[]
  reservations: Reservation[]
  teamMembers: TeamMember[]
  memberName: (userId: string) => string
  selectedServerId: string
  onServerChange: (serverId: string) => void
  onClose: () => void
  onSeat: () => void
}

function getTableName(table?: FloorTable) {
  return table?.table_name || table?.name || 'Table'
}

function getTableSeats(table?: FloorTable) {
  return Number(
    table?.seat_count ??
      table?.seats ??
      0
  )
}

function getReservationName(
  reservation: Reservation,
) {
  return (
    reservation.guest_name ||
    reservation.party_name ||
    reservation.name ||
    'Reservation'
  )
}

function getReservationCovers(
  reservation: Reservation,
) {
  return Number(
    reservation.party_size ??
      reservation.guest_count ??
      reservation.covers ??
      0
  )
}

function getReservationTime(
  reservation: Reservation,
) {
  return (
    reservation.reservation_time ||
    reservation.time ||
    ''
  )
}

function isUpcoming(
  reservation: Reservation,
) {
  const status = String(
    reservation.status || '',
  ).toLowerCase()

  return ![
    'seated',
    'completed',
    'cancelled',
    'canceled',
    'no_show',
    'no show',
  ].includes(status)
}

export function TableDetailsModal({
  selectedTableIds,
  tables,
  assignments,
  reservations,
  teamMembers,
  memberName,
  selectedServerId,
  onServerChange,
  onClose,
  onSeat,
}: Props) {
  const selectedTables = tables.filter(
    (table) =>
      selectedTableIds.includes(table.id),
  )

  const tableNames = selectedTables.map(
    getTableName,
  )

  const totalSeats = selectedTables.reduce(
    (total, table) =>
      total + getTableSeats(table),
    0,
  )

  const assignedServerIds = Array.from(
    new Set(
      assignments
        .filter(
          (assignment) =>
            assignment.table_id &&
            selectedTableIds.includes(
              assignment.table_id,
            ),
        )
        .map(
          (assignment) =>
            assignment.server_id ||
            assignment.server_user_id,
        )
        .filter(Boolean) as string[],
    ),
  )

  const matchingReservations =
    reservations.filter(
      (reservation) => {
        if (!isUpcoming(reservation)) {
          return false
        }

        const reservationTableId =
          reservation.table_id ||
          reservation.assigned_table_id

        if (
          reservationTableId &&
          selectedTableIds.includes(
            reservationTableId,
          )
        ) {
          return true
        }

        const reservationTableName =
          reservation.table_name ||
          reservation.assigned_table

        return Boolean(
          reservationTableName &&
            tableNames.includes(
              reservationTableName,
            ),
        )
      },
    )

  return (
    <div
      className="table-details-backdrop"
      onClick={(event) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose()
        }
      }}
    >
      <section className="table-details-modal">
        <header className="table-details-header">
          <div>
            <p className="eyebrow"><ScreenText id="TableDetailsModal.92b6ec5c49039726">
              TABLE DETAILS
            </ScreenText></p>

            <h2>
              {tableNames.join(' + ')}
            </h2>

            <p className="muted">
              {totalSeats}<ScreenText id="TableDetailsModal.5705dc7e0621a37c"> seats
            </ScreenText></p>
          </div>

          <button
            type="button"
            className="table-details-close"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="table-details-section">
          <span className="table-details-label"><ScreenText id="TableDetailsModal.8dc215a2e38b9732">
            ASSIGNED SERVER
          </ScreenText></span>

          {assignedServerIds.length ? (
            assignedServerIds.map(
              (serverId) => (
                <strong key={serverId}>
                  {memberName(serverId)}
                </strong>
              ),
            )
          ) : (
            <strong><ScreenText id="TableDetailsModal.7fa25123d80d4719">
              Not assigned
            </ScreenText></strong>
          )}

          <label><ScreenText id="TableDetailsModal.b867679892edbcd6">
            Change Server
            </ScreenText><select
              value={selectedServerId}
              onChange={(event) =>
                onServerChange(event.target.value)
              }
            >
              <option value=""><ScreenText id="TableDetailsModal.869045c7738be5f4">
                Select server
              </ScreenText></option>

              {teamMembers.map((member) => (
                <option
                  key={member.user_id}
                  value={member.user_id}
                >
                  {memberName(member.user_id)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="table-details-section">
          <span className="table-details-label"><ScreenText id="TableDetailsModal.5b079e9eda148a97">
            UPCOMING RESERVATIONS
          </ScreenText></span>

          {matchingReservations.length ===
          0 ? (
            <p className="muted"><ScreenText id="TableDetailsModal.75608b12bee704e1">
              No upcoming reservations
              assigned to this table.
            </ScreenText></p>
          ) : (
            matchingReservations.map(
              (reservation) => (
                <article
                  key={reservation.id}
                  className="table-details-reservation"
                >
                  <div>
                    <strong>
                      {getReservationName(
                        reservation,
                      )}
                    </strong>

                    <span>
                      {getReservationTime(
                        reservation,
                      )}
                    </span>
                  </div>

                  <strong>
                    {getReservationCovers(
                      reservation,
                    )}{' '}<ScreenText id="TableDetailsModal.3bed51a91b97f853">
                    covers
                  </ScreenText></strong>
                </article>
              ),
            )
          )}
        </div>

        <div className="table-details-actions">
          <button
            type="button"
            onClick={onClose}
          ><ScreenText id="TableDetailsModal.2d9eb989bfec08cd">
            Close
          </ScreenText></button>

          <button
            type="button"
            className="primary-button"
            onClick={onSeat}
          ><ScreenText id="TableDetailsModal.05e249339dd7924c">
            Seat Walk-In
          </ScreenText></button>
        </div>
      </section>
    </div>
  )
}

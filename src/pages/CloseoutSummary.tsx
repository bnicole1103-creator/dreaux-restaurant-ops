import { submissionLabel, clockLabel } from '../lib/submissionTime'
import { serviceDay, serviceDateLabel, nextServiceBoundary } from '../lib/serviceDay'
import { useEffect, useMemo, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'

type ProfileOption = {
  id: string
  full_name: string
  preferred_name: string | null
}

type PointSummaryItem = {
  code: string
  description: string
  points: number
}

type CloseoutRow = {
  id: string
  user_id: string
  closeout_date: string

  scheduled_start: string | null
  clock_in: string | null

  job_role: string

  net_sales: number
  sales_target: number

  cash_deposit: number

  void_count: number
  void_value: number

  discount_value: number

  money_turned_in_to: string | null
  drinks_made_by: string | null

  notes: string | null

  shift_score: number
  points_delta: number
  points_summary: PointSummaryItem[] | null

  status: string
  created_at: string
  submitted_at: string | null
}

type CloseoutTableRow = {
  closeout_id: string
  table_id: string
  table_name: string
}

type CardKey =
  | 'closeouts'
  | 'sales'
  | 'target'
  | 'targetPercent'
  | 'cash'
  | 'voids'
  | 'discounts'
  | 'score'

type CardSetting = {
  key: CardKey
  label: string
  visible: boolean
}

const DEFAULT_CARDS: CardSetting[] = [
  {
    key: 'closeouts',
    label: 'Closeouts Submitted',
    visible: true,
  },
  {
    key: 'sales',
    label: 'Net Sales',
    visible: true,
  },
  {
    key: 'target',
    label: 'Team Target',
    visible: true,
  },
  {
    key: 'targetPercent',
    label: 'Target %',
    visible: true,
  },
  {
    key: 'cash',
    label: 'Cash Deposits',
    visible: true,
  },
  {
    key: 'voids',
    label: 'Voids',
    visible: true,
  },
  {
    key: 'discounts',
    label: 'Discounts',
    visible: true,
  },
  {
    key: 'score',
    label: 'Average Shift Score',
    visible: true,
  },
]

function money(value: number | null | undefined) {
  return `$${Number(value ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function percent(value: number) {
  return `${value.toFixed(1)}%`
}

function displayName(
  profile: ProfileOption | undefined,
  fallback = 'Unknown Employee'
) {
  return (
    profile?.preferred_name?.trim() ||
    profile?.full_name?.trim() ||
    fallback
  )
}

function roleLabel(role: string) {
  const labels: Record<string, string> = {
    server: 'Server',
    main_bartender: 'Main Bartender',
    back_bartender_1: 'Back Bartender 1',
    back_bar_service_bartender:
      'Back Bar Service Bartender',
    host: 'Host',
    busser: 'Busser',
    manager: 'Manager',
    assistant_manager: 'Assistant Manager',
    general_manager: 'General Manager',
  }

  return (
    labels[role] ??
    role
      .split('_')
      .map(
        (part) =>
          part.charAt(0).toUpperCase() +
          part.slice(1)
      )
      .join(' ')
  )
}

function CloseoutDay({selectedDate,refresh,onDeleted,locationId,locationName,current}:{selectedDate:string;refresh:number;onDeleted:()=>void;locationId:string;locationName:string;current:boolean}) {
  const [isManager,setIsManager]=useState(false)
  const [deletingId,setDeletingId]=useState('')
  const request=useRef(0)
  const [loading, setLoading] =
    useState(true)

  const [error, setError] =
    useState('')

  const [closeouts, setCloseouts] =
    useState<CloseoutRow[]>([])

  const [profiles, setProfiles] =
    useState<ProfileOption[]>([])

  const [closeoutTables, setCloseoutTables] =
    useState<CloseoutTableRow[]>([])

  const [expandedId, setExpandedId] =
    useState<string | null>(null)

  const [showCustomize, setShowCustomize] =
    useState(false)

  const [cardSettings, setCardSettings] =
    useState<CardSetting[]>(DEFAULT_CARDS)

  useEffect(() => {
    const saved = localStorage.getItem(
      'closeout-summary-cards'
    )

    if (saved) {
      try {
        const parsed = JSON.parse(saved)

        if (Array.isArray(parsed)) {
          setCardSettings(parsed)
        }
      } catch {
        // Ignore invalid saved data.
      }
    }


  }, [])

  useEffect(()=>{void loadSummary(locationId,selectedDate);return()=>{request.current+=1}},[locationId,selectedDate,refresh])
  async function loadSummary(targetLocationId:string,businessDate:string) {
    const ticket=++request.current
    setLoading(true);setError('');setCloseouts([]);setProfiles([]);setCloseoutTables([]);setIsManager(false)
    try {
      const {data,error}=await supabase.rpc('closeout_summary_day',{p_location_id:targetLocationId,p_day:businessDate})
      if(error)throw error
      if(ticket!==request.current)return
      setIsManager(!!data.manager);setCloseouts(data.closeouts ?? []);setProfiles(data.profiles ?? []);setCloseoutTables(data.tables ?? [])
    } catch(e) {if(ticket===request.current)setError(String((e as {message?:string})?.message ?? e))}
    finally {if(ticket===request.current)setLoading(false)}
  }
  async function deleteCloseout(closeout:CloseoutRow) {
    const name=displayName(profileMap.get(closeout.user_id))
    if(!window.confirm('Delete '+name+'’s closeout from '+serviceDateLabel(selectedDate)+'? It will be removed from summaries and its linked points will no longer count.'))return
    setDeletingId(closeout.id);setError('')
    try {
      const {error}=await supabase.rpc('closeout_delete',{p_location_id:locationId,p_closeout_id:closeout.id})
      if(error)throw error
      setExpandedId(null);onDeleted()
    } catch(e) {setError(String((e as {message?:string})?.message ?? e))}
    finally {setDeletingId('')}
  }

  const profileMap =
    useMemo(() => {
      return new Map(
        profiles.map(
          (profile) => [
            profile.id,
            profile,
          ]
        )
      )
    }, [profiles])

  const totals =
    useMemo(() => {
      const totalSales =
        closeouts.reduce(
          (total, closeout) =>
            total +
            Number(
              closeout.net_sales ?? 0
            ),
          0
        )

      const totalTarget =
        closeouts.reduce(
          (total, closeout) =>
            total +
            Number(
              closeout.sales_target ?? 0
            ),
          0
        )

      const totalCash =
        closeouts.reduce(
          (total, closeout) =>
            total +
            Number(
              closeout.cash_deposit ?? 0
            ),
          0
        )

      const totalVoids =
        closeouts.reduce(
          (total, closeout) =>
            total +
            Number(
              closeout.void_value ?? 0
            ),
          0
        )

      const totalDiscounts =
        closeouts.reduce(
          (total, closeout) =>
            total +
            Number(
              closeout.discount_value ?? 0
            ),
          0
        )

      const totalVoidCount =
        closeouts.reduce(
          (total, closeout) =>
            total +
            Number(
              closeout.void_count ?? 0
            ),
          0
        )

      const averageScore =
        closeouts.length > 0
          ? closeouts.reduce(
              (total, closeout) =>
                total +
                Number(
                  closeout.shift_score ?? 100
                ),
              0
            ) /
            closeouts.length
          : 0

      const teamPercent =
        totalTarget > 0
          ? (
              totalSales /
              totalTarget
            ) *
            100
          : 0

      return {
        totalSales,
        totalTarget,
        totalCash,
        totalVoids,
        totalDiscounts,
        totalVoidCount,
        averageScore,
        teamPercent,
      }
    }, [closeouts])

  const recap =
    useMemo(() => {
      if (
        closeouts.length === 0
      ) {
        return `No closeouts have been submitted for ${selectedDate}.`
      }

      const overTarget =
        closeouts.filter(
          (closeout) =>
            Number(
              closeout.sales_target
            ) > 0 &&
            Number(
              closeout.net_sales
            ) >=
              Number(
                closeout.sales_target
              )
        ).length

      const underTarget =
        closeouts.filter(
          (closeout) =>
            Number(
              closeout.sales_target
            ) > 0 &&
            Number(
              closeout.net_sales
            ) <
              Number(
                closeout.sales_target
              )
        ).length

      return `${serviceDateLabel(selectedDate)}: ${closeouts.length} closeouts submitted (${closeouts.map(c=>displayName(profileMap.get(c.user_id))).join(', ')}). Team net sales were ${money(
        totals.totalSales
      )} against a combined target of ${money(
        totals.totalTarget
      )}, finishing at ${percent(
        totals.teamPercent
      )} of target. ${overTarget} employee${
        overTarget === 1
          ? ''
          : 's'
      } met or exceeded target and ${underTarget} finished below target. Cash deposits totaled ${money(
        totals.totalCash
      )}. There were ${totals.totalVoidCount} void${
        totals.totalVoidCount === 1
          ? ''
          : 's'
      } totaling ${money(
        totals.totalVoids
      )}, with ${money(
        totals.totalDiscounts
      )} in discounts. Average shift score was ${totals.averageScore.toFixed(
        1
      )}.`
    }, [
      closeouts,
      selectedDate,
      totals,
      profileMap,
    ])

  function tablesForCloseout(
    closeoutId: string
  ) {
    return closeoutTables
      .filter(
        (row) =>
          row.closeout_id ===
          closeoutId
      )
      .map(
        (row) =>
          row.table_name
      )
  }

  function cardVisible(
    key: CardKey
  ) {
    return (
      cardSettings.find(
        (card) =>
          card.key === key
      )?.visible ?? false
    )
  }

  function toggleCard(
    key: CardKey
  ) {
    setCardSettings(
      (current) => {
        const next =
          current.map(
            (card) =>
              card.key === key
                ? {
                    ...card,
                    visible:
                      !card.visible,
                  }
                : card
          )

        localStorage.setItem(
          'closeout-summary-cards',
          JSON.stringify(next)
        )

        return next
      }
    )
  }

  function resetCards() {
    setCardSettings(
      DEFAULT_CARDS
    )

    localStorage.setItem(
      'closeout-summary-cards',
      JSON.stringify(
        DEFAULT_CARDS
      )
    )
  }

  async function copyRecap() {
    try {
      await navigator.clipboard.writeText(
        recap
      )
    } catch {
      // Clipboard may be restricted.
    }
  }

  return (
    <section className="page">

      <div className="page-header">
        <p className="eyebrow">
          {isManager ? "MANAGEMENT" : "MY CLOSEOUTS"}
        </p>

        <h1>
          {current ? (isManager ? "Daily Closeout Summary" : "My Closeout Summary") : "Archived Closeouts"}
        </h1>

        <p>
          {locationName} · {serviceDateLabel(selectedDate)}
          {current && <> · Service day resets at 4 a.m. New Orleans time.</>}
        </p>
      </div>

      <div className="card">
        <div
          style={{
            display:
              'flex',
            gap: 12,
            alignItems:
              'end',
            flexWrap:
              'wrap',
          }}
        >
          <label
            style={{
              flex: 1,
              minWidth: 200,
            }}
          >
            {isManager ? "Business Date" : "Closeout Date"}

            <strong style={{display:'block'}}>{serviceDateLabel(selectedDate)}</strong>
          </label>

          <button
            type="button"
            onClick={() =>
              setShowCustomize(
                (current) =>
                  !current
              )
            }
          >
            Customize Summary
          </button>
        </div>

        {showCustomize && (
          <div
            style={{
              marginTop: 18,
              paddingTop: 18,
              borderTop:
                '1px solid rgba(255,255,255,.1)',
            }}
          >
            <h3>
              Summary Cards
            </h3>

            <p>
              Choose which numbers
              appear at the top of
              the daily summary.
            </p>

            <div
              style={{
                display:
                  'grid',
                gridTemplateColumns:
                  'repeat(2, minmax(0, 1fr))',
                gap: 10,
              }}
            >
              {cardSettings.map(
                (card) => (
                  <label
                    key={
                      card.key
                    }
                    style={{
                      display:
                        'flex',
                      alignItems:
                        'center',
                      gap: 10,
                      padding:
                        10,
                      border:
                        '1px solid rgba(255,255,255,.08)',
                      borderRadius:
                        10,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={
                        card.visible
                      }
                      onChange={() =>
                        toggleCard(
                          card.key
                        )
                      }
                    />

                    <span>
                      {
                        !isManager && card.key === "target" ? "My Target" : card.label
                      }
                    </span>
                  </label>
                )
              )}
            </div>

            <button
              type="button"
              style={{
                marginTop:
                  12,
              }}
              onClick={
                resetCards
              }
            >
              Reset Default Cards
            </button>
          </div>
        )}
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
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="card">
          Loading summary...
        </div>
      ) : (
        <>
          <div
            className="summary-card-grid"
          >

            {cardVisible(
              'closeouts'
            ) && (
              <div className="summary-stat-card">
                <span>
                  Closeouts
                </span>

                <strong>
                  {
                    closeouts.length
                  }
                </strong>
              </div>
            )}

            {cardVisible(
              'sales'
            ) && (
              <div className="summary-stat-card">
                <span>
                  {isManager ? "Business Net Sales" : "My Net Sales"}
                </span>

                <strong>
                  {money(
                    totals.totalSales
                  )}
                </strong>
              </div>
            )}

            {cardVisible(
              'target'
            ) && (
              <div className="summary-stat-card">
                <span>
                  {isManager ? "Team Target" : "My Target"}
                </span>

                <strong>
                  {money(
                    totals.totalTarget
                  )}
                </strong>
              </div>
            )}

            {cardVisible(
              'targetPercent'
            ) && (
              <div className="summary-stat-card">
                <span>
                  Target %
                </span>

                <strong>
                  {percent(
                    totals.teamPercent
                  )}
                </strong>
              </div>
            )}

            {cardVisible(
              'cash'
            ) && (
              <div className="summary-stat-card">
                <span>
                  {isManager ? "Business Cash Deposits" : "My Cash Deposits"}
                </span>

                <strong>
                  {money(
                    totals.totalCash
                  )}
                </strong>
              </div>
            )}

            {cardVisible(
              'voids'
            ) && (
              <div className="summary-stat-card">
                <span>
                  Voids
                </span>

                <strong>
                  {
                    totals.totalVoidCount
                  }{' '}
                  /{' '}
                  {money(
                    totals.totalVoids
                  )}
                </strong>
              </div>
            )}

            {cardVisible(
              'discounts'
            ) && (
              <div className="summary-stat-card">
                <span>
                  Discounts
                </span>

                <strong>
                  {money(
                    totals.totalDiscounts
                  )}
                </strong>
              </div>
            )}

            {cardVisible(
              'score'
            ) && (
              <div className="summary-stat-card">
                <span>
                  Avg Shift Score
                </span>

                <strong>
                  {totals.averageScore.toFixed(
                    1
                  )}
                </strong>
              </div>
            )}

          </div>

          {isManager && (
          <div className="card">
            <div
              style={{
                display:
                  'flex',
                alignItems:
                  'center',
                justifyContent:
                  'space-between',
                gap: 12,
                flexWrap:
                  'wrap',
              }}
            >
              <h2>
                {current ? "Today’s Manager Recap" : "Manager Recap"}
              </h2>

              <button
                type="button"
                onClick={
                  copyRecap
                }
              >
                Copy Recap
              </button>
            </div>

            <p
              style={{
                lineHeight:
                  1.7,
              }}
            >
              {recap}
            </p>
          </div>
          )}

          <div className="card">
            <h2>
              {isManager ? "Employee Closeouts" : "My Closeouts"}
            </h2>

            {closeouts.length ===
              0 && (
              <p>
                No closeouts
                submitted for this
                date.
              </p>
            )}

            <div
              style={{
                display:
                  'grid',
                gap: 12,
              }}
            >
              {closeouts.map(
                (closeout) => {
                  const profile =
                    profileMap.get(
                      closeout.user_id
                    )

                  const employee =
                    displayName(
                      profile
                    )

                  const target =
                    Number(
                      closeout.sales_target ??
                        0
                    )

                  const sales =
                    Number(
                      closeout.net_sales ??
                        0
                    )

                  const employeePercent =
                    target > 0
                      ? (
                          sales /
                          target
                        ) *
                        100
                      : 0

                  const isExpanded =
                    expandedId ===
                    closeout.id

                  const tables =
                    tablesForCloseout(
                      closeout.id
                    )

                  const managerName =
                    closeout.money_turned_in_to
                      ? displayName(
                          profileMap.get(
                            closeout.money_turned_in_to
                          ),
                          'Unknown'
                        )
                      : 'Not recorded'

                  const bartenderName =
                    closeout.drinks_made_by
                      ? displayName(
                          profileMap.get(
                            closeout.drinks_made_by
                          ),
                          'Unknown'
                        )
                      : 'Not applicable'

                  return (
                    <div
                      key={
                        closeout.id
                      }
                      className="closeout-summary-row"
                    >
                      <button
                        type="button"
                        className="closeout-summary-header"
                        onClick={() =>
                          setExpandedId(
                            isExpanded
                              ? null
                              : closeout.id
                          )
                        }
                      >
                        <div>
                          <strong>
                            {
                              employee
                            }
                          </strong>

                          <div>
                            {roleLabel(
                              closeout.job_role
                            )}
                          </div>
                        </div>

                        <div>
                          <strong>
                            {money(
                              sales
                            )}
                          </strong>

                          <div>
                            {percent(
                              employeePercent
                            )}
                          </div>
                        </div>

                        <div>
                          <strong>
                            Score{' '}
                            {
                              closeout.shift_score
                            }
                          </strong>

                          <div>
                            {isExpanded
                              ? 'Hide'
                              : 'View'}
                          </div>
                        </div>
                      </button>

                      <p>Submitted {submissionLabel(closeout.submitted_at ?? closeout.created_at)}</p>
                      {isManager && <button type="button" disabled={!!deletingId || loading} onClick={()=>void deleteCloseout(closeout)}>{deletingId===closeout.id?'Deleting…':'Delete closeout'}</button>}

                      {isExpanded && (
                        <div className="closeout-summary-details">

                          <div>
                            <span>
                              Scheduled
                            </span>

                            <strong>
                              {
                                clockLabel(closeout.scheduled_start)
                              }
                            </strong>
                          </div>

                          <div>
                            <span>
                              Clock In
                            </span>

                            <strong>
                              {
                                clockLabel(closeout.clock_in)
                              }
                            </strong>
                          </div>

                          <div>
                            <span>
                              Net Sales
                            </span>

                            <strong>
                              {money(
                                closeout.net_sales
                              )}
                            </strong>
                          </div>

                          <div>
                            <span>
                              Target
                            </span>

                            <strong>
                              {money(
                                closeout.sales_target
                              )}
                            </strong>
                          </div>

                          <div>
                            <span>
                              Cash Deposit
                            </span>

                            <strong>
                              {money(
                                closeout.cash_deposit
                              )}
                            </strong>
                          </div>

                          <div>
                            <span>
                              Voids
                            </span>

                            <strong>
                              {
                                closeout.void_count
                              }{' '}
                              /{' '}
                              {money(
                                closeout.void_value
                              )}
                            </strong>
                          </div>

                          <div>
                            <span>
                              Discounts
                            </span>

                            <strong>
                              {money(
                                closeout.discount_value
                              )}
                            </strong>
                          </div>

                          <div>
                            <span>
                              Tables
                            </span>

                            <strong>
                              {tables.length >
                              0
                                ? tables.join(
                                    ', '
                                  )
                                : 'None selected'}
                            </strong>
                          </div>

                          <div>
                            <span>
                              Money Turned In To
                            </span>

                            <strong>
                              {
                                managerName
                              }
                            </strong>
                          </div>

                          <div>
                            <span>
                              Drinks Made By
                            </span>

                            <strong>
                              {
                                bartenderName
                              }
                            </strong>
                          </div>

                          <div>
                            <span>
                              Point Adjustment
                            </span>

                            <strong>
                              {closeout.points_delta >
                              0
                                ? `+${closeout.points_delta}`
                                : closeout.points_delta}
                            </strong>
                          </div>

                          {closeout.points_summary &&
                            closeout.points_summary.length >
                              0 && (
                            <div
                              style={{
                                gridColumn:
                                  '1 / -1',
                              }}
                            >
                              <span>
                                Score Details
                              </span>

                              <div
                                style={{
                                  marginTop:
                                    8,
                                  display:
                                    'grid',
                                  gap: 6,
                                }}
                              >
                                {closeout.points_summary.map(
                                  (
                                    item
                                  ) => (
                                    <div
                                      key={
                                        item.code
                                      }
                                      style={{
                                        display:
                                          'flex',
                                        justifyContent:
                                          'space-between',
                                        gap: 12,
                                      }}
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
                            </div>
                          )}

                          {closeout.notes && (
                            <div
                              style={{
                                gridColumn:
                                  '1 / -1',
                              }}
                            >
                              <span>
                                Notes
                              </span>

                              <strong>
                                {
                                  closeout.notes
                                }
                              </strong>
                            </div>
                          )}

                        </div>
                      )}
                    </div>
                  )
                }
              )}
            </div>
          </div>
        </>
      )}

      <div
        style={{
          height: 150,
        }}
      />

    </section>
  )
}

type ArchiveDay={day:string;count:number}
export function CloseoutSummaryPage() {
 const [day,setDay]=useState(serviceDay)
 const [refresh,setRefresh]=useState(0)
 const [location,setLocation]=useState<{id:string;name:string}|null>(null)
 const [history,setHistory]=useState<ArchiveDay[]>([])
 const [archiveDate,setArchiveDate]=useState('')
 const [error,setError]=useState('')
 const [historyLoading,setHistoryLoading]=useState(false)
 useEffect(()=>{let live=true;void loadTenantData().then(t=>{if(!t.locations[0])throw new Error('No active location.');if(live)setLocation({id:t.locations[0].id,name:t.locations[0].name ?? ''})}).catch(e=>{if(live)setError(String((e as {message?:string})?.message ?? e))});return()=>{live=false}},[])
 useEffect(()=>{
  let timer:ReturnType<typeof setTimeout>
  function update(){setDay(serviceDay());setRefresh(v=>v+1);clearTimeout(timer);timer=setTimeout(update,Math.max(1,nextServiceBoundary()-Date.now()))}
  const onVisible=()=>{if(document.visibilityState==='visible')update()}
  update();window.addEventListener('focus',update);document.addEventListener('visibilitychange',onVisible)
  const poll=setInterval(()=>{if(document.visibilityState==='visible'){setDay(serviceDay());setRefresh(v=>v+1)}},60000)
  return()=>{clearTimeout(timer);clearInterval(poll);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',onVisible)}
 },[])
 useEffect(()=>{if(!location)return;let live=true;setHistoryLoading(true);setError('');void (async()=>{
  try{const {data,error}=await supabase.rpc('closeout_summary_archive',{p_location_id:location.id,p_before:day});if(error)throw error;if(live)setHistory(data ?? [])}
  catch(e){if(live){setError(String((e as {message?:string})?.message ?? e));setHistory([])}}finally{if(live)setHistoryLoading(false)}
 })();return()=>{live=false}},[location,day,refresh])
 const months=useMemo(()=>{
  const groups=new Map<string,ArchiveDay[]>()
  for(const entry of history){const key=entry.day.slice(0,7);groups.set(key,[...(groups.get(key) ?? []),entry])}
  return [...groups.entries()]
 },[history])
 function reload(){setDay(serviceDay());setRefresh(v=>v+1)}
 if(!location)return <section className="page"><p role={error?'alert':'status'}>{error || 'Loading summary…'}</p></section>
 return <>
  <div className="page"><button type="button" onClick={reload}>Refresh closeouts</button></div>
  <CloseoutDay selectedDate={day} current refresh={refresh} locationId={location.id} locationName={location.name} onDeleted={reload} />
  <section className="page"><article className="card"><h2>Previous closeouts</h2><p>Organized by month and service day, newest first.</p>
   {error && <p role="alert">{error}</p>}{historyLoading && history.length===0 && <p role="status">Loading history…</p>}
   {!error && !historyLoading && history.length===0 && <p>No previous closeouts.</p>}
   {months.map(([month,entries])=><details key={month}><summary>{serviceDateLabel(month,true)} · {entries.reduce((n,e)=>n+e.count,0)} closeouts</summary><div style={{display:'grid',gap:8,margin:'12px 0'}}>{entries.map(e=><button type="button" key={e.day} aria-pressed={archiveDate===e.day} onClick={()=>setArchiveDate(v=>v===e.day?'':e.day)}>{serviceDateLabel(e.day)} · {e.count} closeout{e.count===1?'':'s'} · {archiveDate===e.day?'Hide':'View'}</button>)}</div></details>)}
  </article></section>
  {archiveDate && archiveDate<day && <CloseoutDay key={archiveDate} selectedDate={archiveDate} current={false} refresh={refresh} locationId={location.id} locationName={location.name} onDeleted={reload} />}
 </>
}

// page-designer-instrumented
import { ManagerRecap } from "../components/ManagerRecap"
import { PageWord } from "../components/PageDesign"
import { StockBoard,CloseoutStockDetails } from '../components/StockBoard'
import { useSearchParams } from 'react-router-dom'
import { ScreenText } from "../components/ScreenText"
import './CloseoutMobile.css'
import { CloseoutCorrectionEditor } from '../components/CloseoutCorrectionEditor'
import type { Question } from '../components/CloseoutConfig'
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
  omitted_questions?: string[]
  edit_version?: number
  shift_type?: string | null
  custom_answers?: Record<string,string>
  question_snapshot?: Question[]
  zero_sales_confirmed?: boolean
  zero_sales_reason?: string | null
  completion_points_withheld?: boolean
  correction_note?: string | null
  corrected_at?: string | null
  id: string
  user_id: string
  closeout_date: string

  scheduled_start: string | null
  clock_out?: string | null
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

type ManagerCloseoutRow = {
  shift_id: string
  shift_name: string
  shift_date: string
  submitted_by: string
  submitted_by_name: string | null
  submitted_at: string
  updated_at: string
  cash_deposit: number | null
  cash_left_at: string | null
  register_balanced: boolean | null
  register_difference: number | null
  register_notes: string | null
  review_count: number
  average_rating: number | null
  shift_mvp: string | null
  shift_mvp_name: string | null
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

function CloseoutDay({selectedDate,refresh,onDeleted,locationId,locationName,current,focusId=''}:{selectedDate:string;refresh:number;onDeleted:()=>void;locationId:string;locationName:string;current:boolean;focusId?:string}) {
  const [isManager,setIsManager]=useState(false)
  const [deletingId,setDeletingId]=useState('')
  const [editingId,setEditingId]=useState('')
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

  const [managerCloseouts, setManagerCloseouts] =
    useState<ManagerCloseoutRow[]>([])

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
    setLoading(true);setError('');setCloseouts([]);setProfiles([]);setCloseoutTables([]);setManagerCloseouts([]);setIsManager(false)
    try {
      const {data,error}=await supabase.rpc('closeout_summary_day',{p_location_id:targetLocationId,p_day:businessDate})
      if(error)throw error
      if(ticket!==request.current)return
      setIsManager(!!data.manager);setCloseouts(data.closeouts ?? []);setProfiles(data.profiles ?? []);setCloseoutTables(data.tables ?? []);setManagerCloseouts(data.manager_closeouts ?? [])
    } catch(e) {if(ticket===request.current)setError(String((e as {message?:string})?.message ?? e))}
    finally {if(ticket===request.current)setLoading(false)}
  }
  useEffect(()=>{if(!focusId||loading||!closeouts.some(c=>c.id===focusId))return;setExpandedId(focusId);document.getElementById('closeout-'+focusId)?.scrollIntoView({block:'center'});},[focusId,loading,closeouts])
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

  const recap = useMemo(() => {
    const over = closeouts.filter(c=>Number(c.sales_target)>0 && Number(c.net_sales)>=Number(c.sales_target)).length
    const under = closeouts.filter(c=>Number(c.sales_target)>0 && Number(c.net_sales)<Number(c.sales_target)).length
    const managerCash = managerCloseouts.reduce((n,m)=>n+Number(m.cash_deposit??0),0)
    return [
      `Employee closeouts: ${closeouts.length}${closeouts.length ? ' — '+closeouts.map(c=>displayName(profileMap.get(c.user_id))).join(', ') : ''}.`,
      `Net sales: ${money(totals.totalSales)}. ${totals.totalTarget>0 ? `Target performance: ${percent(totals.teamPercent)}; ${over} met or exceeded target, ${under} below target.` : 'No sales target available.'}`,
      `Voids: ${totals.totalVoidCount}, totaling ${money(totals.totalVoids)}. Discounts: ${money(totals.totalDiscounts)}.`,
      `Average shift score: ${closeouts.length ? totals.averageScore.toFixed(1) : 'Not available'}.`,
      `Cash report — total deposited on manager closeouts: ${managerCloseouts.length ? money(managerCash) : 'No manager closeout submitted'}.`,
      ...managerCloseouts.map(m=>`${m.shift_name}: ${m.cash_deposit==null?'Deposit not recorded':money(m.cash_deposit)+' deposited'}; cash left: ${m.cash_left_at||'Not recorded'}. Submitted by ${m.submitted_by_name||'Manager'} at ${submissionLabel(m.submitted_at)}.`),
    ]
  },[closeouts,managerCloseouts,totals,profileMap])

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

  return (
    <section data-design-block="copy.b7855dad4d090df7.1" className="page closeout-summary-mobile">

      <div data-design-block="copy.12b48e3a46acaef2.1" className="page-header">
        <p data-design-block="copy.1b0c72492b2ceb94.1" className="eyebrow">
          {isManager ? <PageWord id="copy.38e8a0fb453653ed.1">{"MANAGEMENT"}</PageWord> : <PageWord id="copy.a0bdc683c7fc1acf.1">{"MY CLOSEOUTS"}</PageWord>}
        </p>

        <h1 data-design-block="copy.6c78aae43cf3e555.1">
          {current ? (isManager ? <PageWord id="copy.dcc4afcd0fe980d9.1">{"Daily Closeout Summary"}</PageWord> : <PageWord id="copy.3a4a222ceb90aeca.1">{"My Closeout Summary"}</PageWord>) : <PageWord id="copy.7f75249105b60128.1">{"Archived Closeouts"}</PageWord>}
        </h1>

        <p data-design-block="copy.1d73108071987a91.1">
          {locationName}<PageWord id="copy.f323e928bd4d3fcf.1">· </PageWord>{serviceDateLabel(selectedDate)}
          {current && <><ScreenText id="CloseoutSummary.b6126f0911b1fda7"> · Service day resets at 4 a.m. New Orleans time.</ScreenText></>}
        </p>
      </div>

      <div data-design-block="copy.df748de098f5387f.1" className="card">
        <div data-design-block="copy.4349fc3951b847e9.1"
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
          <label data-design-block="copy.99841755344d7cc4.1"
            style={{
              flex: 1,
              minWidth: 200,
            }}
          >
            {isManager ? <PageWord id="copy.b584b5ca1399ccd5.1">{"Business Date"}</PageWord> : <PageWord id="copy.7383049c789379e6.1">{"Closeout Date"}</PageWord>}

            <strong style={{display:'block'}}>{serviceDateLabel(selectedDate)}</strong>
          </label>

          <button data-design-block="copy.53fddec334773ab3.1"
            type="button"
            onClick={() =>
              setShowCustomize(
                (current) =>
                  !current
              )
            }
          ><ScreenText id="CloseoutSummary.e6794e03699dd0cb">
            Customize Summary
          </ScreenText></button>
        </div>

        {showCustomize && (
          <div data-design-block="copy.d51dda7d7ddbf391.1"
            style={{
              marginTop: 18,
              paddingTop: 18,
              borderTop:
                '1px solid rgba(255,255,255,.1)',
            }}
          >
            <h3 data-design-block="copy.a9a0b87cf3840330.1"><ScreenText id="CloseoutSummary.3834920b758c6faa">
              Summary Cards
            </ScreenText></h3>

            <p data-design-block="copy.1d73108071987a91.2"><ScreenText id="CloseoutSummary.0b8f21150f7751f4">
              Choose which numbers
              appear at the top of
              the daily summary.
            </ScreenText></p>

            <div data-design-block="copy.2abb10f3cc44beed.1"
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
                  <label data-design-block="copy.ca2d42adc61b241e.1"
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
                        !isManager && card.key === "target" ? <PageWord id="copy.4a47ac2591d7d4f4.1">{"My Target"}</PageWord> : card.label
                      }
                    </span>
                  </label>
                )
              )}
            </div>

            <button data-design-block="copy.b20c0fc6efe9faef.1"
              type="button"
              style={{
                marginTop:
                  12,
              }}
              onClick={
                resetCards
              }
            ><ScreenText id="CloseoutSummary.e8b5fa869724043d">
              Reset Default Cards
            </ScreenText></button>
          </div>
        )}
      </div>

      {locationId&&<StockBoard location={locationId} readOnly date={selectedDate}/>}
      {error && (
        <div data-design-block="copy.7928f50964d7a778.1"
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
        <div data-design-block="copy.df748de098f5387f.2" className="card"><ScreenText id="CloseoutSummary.1eed37a7be178e26">
          Loading summary...
        </ScreenText></div>
      ) : (
        <>
          <div data-design-block="copy.d4b2dedeef02487c.1"
            className="summary-card-grid"
          >

            {cardVisible(
              'closeouts'
            ) && (
              <div data-design-block="copy.8a0c80c48ccea263.1" className="summary-stat-card">
                <span><ScreenText id="CloseoutSummary.3cb32cb0ffde0ba5">
                  Closeouts
                </ScreenText></span>

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
              <div data-design-block="copy.8a0c80c48ccea263.2" className="summary-stat-card">
                <span>
                  {isManager ? <PageWord id="copy.c0cd80e79e923e88.1">{"Business Net Sales"}</PageWord> : <PageWord id="copy.b88049d10df021d7.1">{"My Net Sales"}</PageWord>}
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
              <div data-design-block="copy.8a0c80c48ccea263.3" className="summary-stat-card">
                <span>
                  {isManager ? <PageWord id="copy.0c2322e827b336c7.1">{"Team Target"}</PageWord> : <PageWord id="copy.4a47ac2591d7d4f4.2">{"My Target"}</PageWord>}
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
              <div data-design-block="copy.8a0c80c48ccea263.4" className="summary-stat-card">
                <span><ScreenText id="CloseoutSummary.275a794e224cc427">
                  Target %
                </ScreenText></span>

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
              <div data-design-block="copy.8a0c80c48ccea263.5" className="summary-stat-card">
                <span>
                  {isManager ? <PageWord id="copy.f8e6a56798b65da6.1">{"Business Cash Deposits"}</PageWord> : <PageWord id="copy.a3db89580e74bfc8.1">{"My Cash Deposits"}</PageWord>}
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
              <div data-design-block="copy.8a0c80c48ccea263.6" className="summary-stat-card">
                <span><ScreenText id="CloseoutSummary.c594bb9f996f7cf5">
                  Voids
                </ScreenText></span>

                <strong>
                  {
                    totals.totalVoidCount
                  }{' '}<PageWord id="copy.d191eb6bcf8eaba9.1">/</PageWord>{' '}
                  {money(
                    totals.totalVoids
                  )}
                </strong>
              </div>
            )}

            {cardVisible(
              'discounts'
            ) && (
              <div data-design-block="copy.8a0c80c48ccea263.7" className="summary-stat-card">
                <span><ScreenText id="CloseoutSummary.28384f41a3ad7d09">
                  Discounts
                </ScreenText></span>

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
              <div data-design-block="copy.8a0c80c48ccea263.8" className="summary-stat-card">
                <span><ScreenText id="CloseoutSummary.caea4383a2e56490">
                  Avg Shift Score
                </ScreenText></span>

                <strong>
                  {totals.averageScore.toFixed(
                    1
                  )}
                </strong>
              </div>
            )}

          </div>

          {isManager && (
          <div data-design-block="copy.manager-closeouts-summary.1" className="card">
            <h2 data-design-block="copy.manager-closeouts-summary.2">
              <ScreenText id="CloseoutSummary.managerCloseouts">Manager Closeouts</ScreenText>
            </h2>
            {managerCloseouts.length === 0 ? (
              <p data-design-block="copy.manager-closeouts-summary.3">
                <ScreenText id="CloseoutSummary.noManagerCloseouts">No manager closeout submitted for this date yet.</ScreenText>
              </p>
            ) : (
              <div data-design-block="copy.manager-closeouts-summary.4" style={{display:'grid',gap:12}}>
                {managerCloseouts.map(row => (
                  <article data-design-block="copy.manager-closeouts-summary.5" className="closeout-summary-row" key={row.shift_id}>
                    <div data-design-block="copy.manager-closeouts-summary.6" className="closeout-summary-header">
                      <div data-design-block="copy.manager-closeouts-summary.7">
                        <strong>{row.shift_name}</strong>
                        <div>{row.submitted_by_name || 'Manager'}</div>
                      </div>
                      <div data-design-block="copy.manager-closeouts-summary.8">
                        <strong>{money(row.cash_deposit)}</strong>
                        <div><ScreenText id="CloseoutSummary.managerCashDeposit">Cash deposit</ScreenText></div>
                      </div>
                      <div data-design-block="copy.manager-closeouts-summary.9">
                        <strong>{row.review_count}</strong>
                        <div><ScreenText id="CloseoutSummary.managerReviews">staff reviews</ScreenText></div>
                      </div>
                    </div>
                    <div data-design-block="copy.manager-closeouts-summary.10" className="closeout-summary-details">
                      <div data-design-block="copy.manager-closeouts-summary.11"><span><ScreenText id="CloseoutSummary.managerSubmitted">Submitted</ScreenText></span><strong>{submissionLabel(row.submitted_at)}</strong></div>
                      <div data-design-block="copy.manager-closeouts-summary.12"><span><ScreenText id="CloseoutSummary.managerRegister">Register</ScreenText></span><strong>{row.register_balanced == null ? 'Not recorded' : row.register_balanced ? 'Balanced' : `Off by ${money(row.register_difference)}`}</strong></div>
                      <div data-design-block="copy.manager-closeouts-summary.13"><span><ScreenText id="CloseoutSummary.managerCashLeft">Cash left at</ScreenText></span><strong>{row.cash_left_at || 'Not recorded'}</strong></div>
                      <div data-design-block="copy.manager-closeouts-summary.14"><span><ScreenText id="CloseoutSummary.managerAverageRating">Average rating</ScreenText></span><strong>{row.average_rating == null ? '—' : row.average_rating.toFixed(1)}</strong></div>
                      <div data-design-block="copy.manager-closeouts-summary.15"><span><ScreenText id="CloseoutSummary.managerMvp">Shift MVP</ScreenText></span><strong>{row.shift_mvp_name || 'Not selected'}</strong></div>
                      {row.register_notes && <div data-design-block="copy.manager-closeouts-summary.16" style={{gridColumn:'1 / -1'}}><span><ScreenText id="CloseoutSummary.managerRegisterNotes">Register notes</ScreenText></span><strong>{row.register_notes}</strong></div>}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
          )}

          {isManager && (
          <ManagerRecap location={locationId} day={selectedDate} refresh={refresh}
            title={current ? 'Today’s Manager Recap' : 'Manager Recap'} lines={recap}/>

          )}

          <div data-design-block="copy.df748de098f5387f.4" className="card">
            <h2 data-design-block="copy.f9ef78219c5e44bd.2">
              {isManager ? <PageWord id="copy.84585bad5e10094b.1">{"Employee Closeouts"}</PageWord> : <PageWord id="copy.5280ad3abc7aa480.1">{"My Closeouts"}</PageWord>}
            </h2>

            {closeouts.length ===
              0 && (
              <p data-design-block="copy.1d73108071987a91.3"><ScreenText id="CloseoutSummary.7fcd44933386a74f">
                No closeouts
                submitted for this
                date.
              </ScreenText></p>
            )}

            <div data-design-block="copy.d0c7a5dd85bf6338.1"
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
                    <div data-design-block="copy.96a025a0ebfeb3ff.1"
                      key={
                        closeout.id
                      }
                      id={'closeout-'+closeout.id}
                      className="closeout-summary-row"
                    >
                      <button data-design-block="copy.c0214d47108c2e71.1"
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
                        <div data-design-block="copy.504686d723f6f4b4.1">
                          <strong>
                            {
                              employee
                            }
                          </strong>

                          <div data-design-block="copy.504686d723f6f4b4.2">
                            {roleLabel(
                              closeout.job_role
                            )}
                          </div>
                        </div>

                        <div data-design-block="copy.504686d723f6f4b4.3">
                          <strong>
                            {money(
                              sales
                            )}
                          </strong>

                          <div data-design-block="copy.504686d723f6f4b4.4">
                            {percent(
                              employeePercent
                            )}
                          </div>
                        </div>

                        <div data-design-block="copy.504686d723f6f4b4.5">
                          <strong><ScreenText id="CloseoutSummary.9463f6d51eea3870">
                            Score</ScreenText>{' '}
                            {
                              closeout.shift_score
                            }
                          </strong>

                          <div data-design-block="copy.504686d723f6f4b4.6">
                            {isExpanded
                              ? <PageWord id="copy.f02fba44883ffcf3.1">{"Hide"}</PageWord>
                              : <PageWord id="copy.643535fe4b22d9c9.1">{"View"}</PageWord>}
                          </div>
                        </div>
                      </button>

                      <p data-design-block="copy.1d73108071987a91.4"><ScreenText id="CloseoutSummary.4a8b61e30f851cb7">Submitted </ScreenText>{submissionLabel(closeout.submitted_at ?? closeout.created_at)}</p>
                      {closeout.net_sales===0 && <p data-design-block="copy.83d683900e4d92b1.1" className="closeout-warning">{closeout.zero_sales_confirmed?'Zero sales confirmed: '+(closeout.zero_sales_reason ?? ''):<PageWord id="copy.e05ba21245a9a42f.1">{"$0 sales — needs manager verification."}</PageWord>}</p>}
                      {closeout.completion_points_withheld && <p data-design-block="copy.1d73108071987a91.5"><ScreenText id="CloseoutSummary.05797e4202820fc7">Completion bonus withheld: inaccurate original submission.</ScreenText></p>}
                      {closeout.corrected_at && <p data-design-block="copy.1d73108071987a91.6"><ScreenText id="CloseoutSummary.f16b17e629341098">Corrected </ScreenText>{submissionLabel(closeout.corrected_at)}<PageWord id="copy.f323e928bd4d3fcf.2">· </PageWord>{closeout.correction_note}</p>}
                      {isManager && <div data-design-block="copy.bff412c2d345fb93.1" className="closeout-actions"><button data-design-block="copy.5c1ae93814334c2b.1" type="button" disabled={!!deletingId || loading} onClick={()=>setEditingId(closeout.id)}><ScreenText id="CloseoutSummary.438a24486ad401e8">Edit / Review</ScreenText></button><button data-design-block="copy.61b8120a75b2cbfc.1" type="button" disabled={!!deletingId || loading} onClick={()=>void deleteCloseout(closeout)}>{deletingId===closeout.id?<PageWord id="copy.1bb3930565c6fbae.1">{"Deleting…"}</PageWord>:<PageWord id="copy.064ca5db4eb6303b.1">{"Delete closeout"}</PageWord>}</button></div>}
                      {isManager && editingId===closeout.id && <CloseoutCorrectionEditor key={closeout.id+':'+(closeout.edit_version ?? 1)} closeout={closeout} locationId={locationId} name={employee} onCancel={()=>setEditingId('')} onSaved={()=>{setEditingId('');onDeleted()}} />}

                      {isExpanded && (
                        <div data-design-block="copy.96d1dcff2706601a.1" className="closeout-summary-details">

                          <div data-design-block="copy.504686d723f6f4b4.7">
                            <span><ScreenText id="CloseoutSummary.2737ef54a26551da">
                              Scheduled
                            </ScreenText></span>

                            <strong>
                              {
                                clockLabel(closeout.scheduled_start)
                              }
                            </strong>
                          </div>

                          <div data-design-block="copy.504686d723f6f4b4.8">
                            <span><ScreenText id="CloseoutSummary.a4c12661a9aa458e">
                              Clock In
                            </ScreenText></span>

                            <strong>
                              {
                                clockLabel(closeout.clock_in)
                              }
                            </strong>
                          </div>
                          <div data-design-block="copy.504686d723f6f4b4.9"><strong><ScreenText id="CloseoutSummary.9fdd0492ef80753d">Clock-Out</ScreenText></strong><p data-design-block="copy.1d73108071987a91.7">{clockLabel(closeout.clock_out ?? null)}</p></div>

                          <div data-design-block="copy.504686d723f6f4b4.10">
                            <span><ScreenText id="CloseoutSummary.084dc9bf092dbb34">
                              Net Sales
                            </ScreenText></span>

                            <strong>
                              {money(
                                closeout.net_sales
                              )}
                            </strong>
                          </div>

                          <div data-design-block="copy.504686d723f6f4b4.11">
                            <span><ScreenText id="CloseoutSummary.0c7881f8acf1cb50">
                              Target
                            </ScreenText></span>

                            <strong>
                              {money(
                                closeout.sales_target
                              )}
                            </strong>
                          </div>

                          <div data-design-block="copy.504686d723f6f4b4.12">
                            <span><ScreenText id="CloseoutSummary.4f25e5f00f24fcf6">
                              Cash Deposit
                            </ScreenText></span>

                            <strong>
                              {money(
                                closeout.cash_deposit
                              )}
                            </strong>
                          </div>

                          <div data-design-block="copy.504686d723f6f4b4.13">
                            <span><ScreenText id="CloseoutSummary.4e5a3f70a4b1b467">
                              Voids
                            </ScreenText></span>

                            <strong>
                              {
                                closeout.void_count
                              }{' '}<PageWord id="copy.d191eb6bcf8eaba9.2">/</PageWord>{' '}
                              {money(
                                closeout.void_value
                              )}
                            </strong>
                          </div>

                          <div data-design-block="copy.504686d723f6f4b4.14">
                            <span><ScreenText id="CloseoutSummary.8119eb0a1f901753">
                              Discounts
                            </ScreenText></span>

                            <strong>
                              {money(
                                closeout.discount_value
                              )}
                            </strong>
                          </div>

                          <div data-design-block="copy.504686d723f6f4b4.15">
                            <span><ScreenText id="CloseoutSummary.f545e5be80b1ec21">
                              Tables
                            </ScreenText></span>

                            <strong>
                              {tables.length >
                              0
                                ? tables.join(
                                    ', '
                                  )
                                : <PageWord id="copy.073352449cd25897.1">{"None selected"}</PageWord>}
                            </strong>
                          </div>

                          <div data-design-block="copy.504686d723f6f4b4.16">
                            <span><ScreenText id="CloseoutSummary.36f1000b204c3520">
                              Money Turned In To
                            </ScreenText></span>

                            <strong>
                              {
                                managerName
                              }
                            </strong>
                          </div>

                          <div data-design-block="copy.504686d723f6f4b4.17">
                            <span><ScreenText id="CloseoutSummary.9a00296cedc3b600">
                              Drinks Made By
                            </ScreenText></span>

                            <strong>
                              {
                                bartenderName
                              }
                            </strong>
                          </div>

                          <div data-design-block="copy.504686d723f6f4b4.18">
                            <span><ScreenText id="CloseoutSummary.99cf3d781916602a">
                              Point Adjustment
                            </ScreenText></span>

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
                            <div data-design-block="copy.82fd4d29db15c7f6.1"
                              style={{
                                gridColumn:
                                  '1 / -1',
                              }}
                            >
                              <span><ScreenText id="CloseoutSummary.c1897c9d53914584">
                                Score Details
                              </ScreenText></span>

                              <div data-design-block="copy.ec4c142e44a3db7e.1"
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
                                    <div data-design-block="copy.d61a48db3f848796.1"
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

                          {!!closeout.omitted_questions?.length&&<p data-design-block="copy.8cb8926814305e94.1" role="status"><PageWord id="copy.d026ca712cc52526.1">Not collected on this form: </PageWord>{closeout.omitted_questions.map(id=>({'staff_0':'scheduled start','staff_1':'clock-in','staff_2':'shift','staff_3':'net sales','staff_4':'manual target','staff_5':'cash deposit','staff_6':'voids','staff_7':'discounts','staff_8':'register cash','staff_9':'imbalance reason','staff_10':'verifier','staff_11':'peer recognition','staff_12':'recognition reason','staff_13':'recognition explanation','staff_14':'money recipient','staff_15':'drink maker'} as Record<string,string>)[id]??id).join(', ')}<PageWord id="copy.30787e9cfdd1feed.1">. Removed sales and attendance questions do not produce performance adjustments.</PageWord></p>}
                          <CloseoutStockDetails location={locationId} id={closeout.id}/>
                          {closeout.notes && (
                            <div data-design-block="copy.82fd4d29db15c7f6.2"
                              style={{
                                gridColumn:
                                  '1 / -1',
                              }}
                            >
                              <span><ScreenText id="CloseoutSummary.17a81ded0d3fa833">
                                Notes
                              </ScreenText></span>

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
 const [params]=useSearchParams(),requested=params.get('date')??'',focusId=params.get('closeout')??''
 const linkedDate=/^\d{4}-\d{2}-\d{2}$/.test(requested)&&requested<=serviceDay()?requested:''
 const [day,setDay]=useState(serviceDay)
 const [refresh,setRefresh]=useState(0)
 const [location,setLocation]=useState<{id:string;name:string}|null>(null)
 const [history,setHistory]=useState<ArchiveDay[]>([])
 const [archiveDate,setArchiveDate]=useState(linkedDate)
 useEffect(()=>{if(linkedDate)setArchiveDate(linkedDate)},[linkedDate])
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
 if(!location)return <section data-design-block="copy.b7855dad4d090df7.2" className="page closeout-summary-mobile"><p data-design-block="copy.9883f35f00a514b5.1" role={error?'alert':'status'}>{error || 'Loading summary…'}</p></section>
 return <>
  <div data-design-block="copy.d392d3a76fa3a359.1" className="page"><button data-design-block="copy.bbbbe200cfd4ed8a.1" type="button" onClick={reload}><ScreenText id="CloseoutSummary.f4bbc18b0dbe1711">Refresh closeouts</ScreenText></button></div>
  <CloseoutDay focusId={linkedDate===day?focusId:''} selectedDate={day} current refresh={refresh} locationId={location.id} locationName={location.name} onDeleted={reload} />
  <section data-design-block="copy.b7855dad4d090df7.3" className="page closeout-summary-mobile"><article data-design-block="copy.640020cccc2ec727.1" className="card"><h2 data-design-block="copy.f9ef78219c5e44bd.3"><ScreenText id="CloseoutSummary.643cd94130e638aa">Previous closeouts</ScreenText></h2><p data-design-block="copy.1d73108071987a91.8"><ScreenText id="CloseoutSummary.cc09234f89870176">Organized by month and service day, newest first.</ScreenText></p>
   {error && <p data-design-block="copy.9004f87397a1f020.1" role="alert">{error}</p>}{historyLoading && history.length===0 && <p data-design-block="copy.8cb8926814305e94.2" role="status"><ScreenText id="CloseoutSummary.5c3f475acefcfa5d">Loading history…</ScreenText></p>}
   {!error && !historyLoading && history.length===0 && <p data-design-block="copy.1d73108071987a91.9"><ScreenText id="CloseoutSummary.acbc70394af59cae">No previous closeouts.</ScreenText></p>}
   {months.map(([month,entries])=><details key={month}><summary>{serviceDateLabel(month,true)}<PageWord id="copy.f323e928bd4d3fcf.3">· </PageWord>{entries.reduce((n,e)=>n+e.count,0)}<ScreenText id="CloseoutSummary.c5b235886695e308"> closeouts</ScreenText></summary><div data-design-block="copy.e684c0fac2070a8a.1" style={{display:'grid',gap:8,margin:'12px 0'}}>{entries.map(e=><button data-design-block="copy.a607a529308834b7.1" type="button" key={e.day} aria-pressed={archiveDate===e.day} onClick={()=>setArchiveDate(v=>v===e.day?'':e.day)}>{serviceDateLabel(e.day)}<PageWord id="copy.f323e928bd4d3fcf.4">· </PageWord>{e.count}<ScreenText id="CloseoutSummary.ce9ee2502f65fa17"> closeout</ScreenText>{e.count===1?<PageWord id="copy.f0c5aa23cb74409a.1">{""}</PageWord>:<PageWord id="copy.c90e9ff86d08cb7e.1">{"s"}</PageWord>}<PageWord id="copy.f323e928bd4d3fcf.5">· </PageWord>{archiveDate===e.day?<PageWord id="copy.f02fba44883ffcf3.2">{"Hide"}</PageWord>:<PageWord id="copy.643535fe4b22d9c9.2">{"View"}</PageWord>}</button>)}</div></details>)}
  </article></section>
  {archiveDate && archiveDate<day && <CloseoutDay focusId={linkedDate===archiveDate?focusId:''} key={archiveDate} selectedDate={archiveDate} current={false} refresh={refresh} locationId={location.id} locationName={location.name} onDeleted={reload} />}
 </>
}




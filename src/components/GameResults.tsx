import {useEffect,useState} from 'react'
import {supabase} from '../lib/supabase'
import {gameCatalog,type GameId} from '../lib/extraRestaurantGames'

type Summary={rounds:number;practice_days:number;average_percent:number;points_earned:number;best:{game_id:GameId;best_score:number;best_total:number;rounds:number}[]}
type ResultRow={id:string;user_id:string;name:string;business_date:string;game_id:GameId;source:string;score:number;total:number;correct_count:number;completed_at:string}
type Award={id:string;user_id:string;name:string;week_start:string;milestone:string;points:number;awarded_at:string}
type Payload={manager:boolean;summary:Summary;rows:ResultRow[];awards:Award[]}
const gameName=(id:GameId)=>gameCatalog.find(game=>game[0]===id)?.[2]??id
function thirtyDaysAgo(){const date=new Date();date.setDate(date.getDate()-29);return date.toISOString().slice(0,10)}
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())

export function GameResults({locationId,userId,profile=false,revision=0,from,to}:{locationId:string;userId?:string;profile?:boolean;revision?:number;from?:string;to?:string}){
 const [data,setData]=useState<Payload|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(true),[refresh,setRefresh]=useState(0)
 useEffect(()=>{let live=true;setBusy(true);setError('');void supabase.rpc('restaurant_game_results_load',{p_location_id:locationId,p_user_id:userId??null,p_from:from??thirtyDaysAgo(),p_to:to??today()}).then(({data,error})=>{if(!live)return;if(error)setError(error.message);else setData(data as Payload);setBusy(false)});return()=>{live=false}},[locationId,userId,from,to,refresh,revision])
 const summary=data?.summary
 return <details className={profile?'wt-card':'game-results'} open={profile}>
  <summary>{profile?'Restaurant games & Daily Challenges':'Saved results & weekly effort points'}</summary>
  <div className="game-results-heading"><p>Completed rounds are saved to the employee profile. Only one completed round per game per service day counts toward weekly effort milestones.</p><button type="button" disabled={busy} onClick={()=>setRefresh(v=>v+1)}>Refresh results</button></div>
  {busy&&<p role="status">Loading saved game results…</p>}{error&&<p role="alert">{error}</p>}
  {summary&&<><div className="game-result-stats"><span><strong>{summary.rounds}</strong> rounds</span><span><strong>{summary.practice_days}</strong> practice days</span><span><strong>{summary.average_percent}%</strong> average</span><span><strong>+{summary.points_earned}</strong> effort points</span></div>
  {!!summary.best?.length&&<div className="game-best-list">{summary.best.map(row=><span key={row.game_id}><strong>{gameName(row.game_id)}</strong> {row.best_score}/{row.best_total} best · {row.rounds} played</span>)}</div>}
  <div className="game-results-table"><table><thead><tr><th>Date</th>{data?.manager&&!userId&&<th>Employee</th>}<th>Game</th><th>Result</th><th>Started from</th></tr></thead><tbody>{data?.rows.map(row=><tr key={row.id}><td>{row.business_date}</td>{data.manager&&!userId&&<td>{row.name}</td>}<td>{gameName(row.game_id)}</td><td>{row.correct_count}/{row.total} · {row.total?Math.round(row.correct_count/row.total*100):0}%</td><td>{row.source==='daily_challenge'?'Daily Challenge':'Games page'}</td></tr>)}</tbody></table></div>
  {!data?.rows.length&&<p>No completed rounds saved in this date range.</p>}
  {!!data?.awards.length&&<div className="game-awards"><h3>Weekly effort rewards</h3>{data.awards.map(award=><p key={award.id}><strong>+{award.points}</strong> · {award.milestone==='THREE_DAYS'?'Practiced on three days':'Ten qualifying rounds across three games'} · week of {award.week_start}{data.manager&&!userId?' · '+award.name:''}</p>)}</div>}</>}
 </details>
}

import './HomeDailyChallenge.css'
import {useCallback,useEffect,useMemo,useState} from 'react'
import {TaskDialog} from './TaskDialog'
import {RestaurantGamesPage} from '../pages/RestaurantGamesPage'
import {gameCatalog,type GameId} from '../lib/extraRestaurantGames'
import {useAppAccess} from './AppAccess'
import {loadTenantData} from '../lib/tenant'
import {supabase} from '../lib/supabase'

type Challenge={id:string;game_id:GameId;starts_at:string;ends_at:string;focus:string;published_at:string}
type ChallengeState={manager:boolean;active:Challenge|null;next:Challenge|null}

const localInput=(iso?:string)=>{const date=iso?new Date(iso):new Date(),offset=date.getTimezoneOffset()*60000;return new Date(date.getTime()-offset).toISOString().slice(0,16)}
const labelTime=(iso:string)=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(iso))

export function HomeDailyChallenge({locationId}:{locationId?:string}){
 const access=useAppAccess(),[location,setLocation]=useState(''),[data,setData]=useState<ChallengeState|null>(null),[game,setGame]=useState<GameId|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[editing,setEditing]=useState(false),[choice,setChoice]=useState<GameId>('order'),[starts,setStarts]=useState(localInput()),[ends,setEnds]=useState(localInput(new Date(Date.now()+24*60*60*1000).toISOString())),[focus,setFocus]=useState('')
 const available=useMemo(()=>gameCatalog.filter(g=>g[3]==='floor'?access.can('floor','sections'):access.can('training',g[3])),[access])
 const load=useCallback(async(id:string)=>{const result=await supabase.rpc('restaurant_daily_challenge_load',{p_location_id:id});if(result.error)throw result.error;setData(result.data as ChallengeState)},[])
 useEffect(()=>{let live=true,timer:ReturnType<typeof setInterval>|undefined;void loadTenantData().then(async tenant=>{const id=locationId??tenant.locations[0]?.id;if(!id)throw Error('No active location.');if(!live)return;setLocation(id);await load(id);timer=setInterval(()=>{if(document.visibilityState==='visible')void load(id).catch(e=>setError((e as Error).message))},30000)}).catch(e=>{if(live)setError((e as Error).message)});return()=>{live=false;if(timer)clearInterval(timer)}},[load,locationId])
 useEffect(()=>{const row=data?.active??data?.next;if(!row||editing)return;setChoice(row.game_id);setStarts(localInput(row.starts_at));setEnds(localInput(row.ends_at));setFocus(row.focus??'')},[data,editing])
 const selected=data?.active??data?.next
 const selectedGame=selected&&available.some(g=>g[0]===selected.game_id)?selected:null
 async function stop(){
  if(!selected||!window.confirm('End this challenge now? Saved results stay in employee history.'))return
  setBusy(true);setError('')
  try{const r=await supabase.rpc('restaurant_daily_challenge_stop',{p_location_id:location,p_id:selected.id});if(r.error)throw r.error;setEditing(false);setNotice('Challenge ended. Saved results are retained.');await load(location)}catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 async function publish(){
  if(!location)return
  const startDate=new Date(starts),endDate=new Date(ends)
  if(!Number.isFinite(startDate.getTime())||!Number.isFinite(endDate.getTime())||endDate<=startDate){setError('Choose an end time after the start time.');return}
  if(endDate.getTime()-startDate.getTime()>31*24*60*60*1000){setError('Choose a challenge period of no more than 31 days.');return}
  setBusy(true);setError('');setNotice('')
  const result=await supabase.rpc('restaurant_daily_challenge_publish',{p_location_id:location,p_id:selected?.id??null,p_game_id:choice,p_starts_at:startDate.toISOString(),p_ends_at:endDate.toISOString(),p_focus:focus})
  if(result.error)setError(result.error.message);else{setNotice('Challenge published.');setEditing(false);await load(location).catch(e=>setError((e as Error).message))}
  setBusy(false)
 }
 return <section className="home-daily-challenge" aria-label="Daily challenge" data-editor-ignore="true">
  <div className="home-challenge-heading"><div><strong>⭐ Daily Challenge</strong><small>Management chooses the game and how long it runs. Completed results attach to each employee profile.</small></div>{data?.manager&&<button type="button" onClick={()=>setEditing(v=>!v)}>{editing?'Close setup':selected?'Edit challenge':'Choose challenge'}</button>}</div>
  {data?.manager&&selected&&<button type="button" disabled={busy} onClick={()=>void stop()}>End assigned challenge</button>}
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {!data&&!error&&<p role="status">Loading today’s challenge…</p>}
  {data&&selectedGame&&<div className="home-challenge-live"><span className="home-challenge-icon" aria-hidden="true">{gameCatalog.find(g=>g[0]===selectedGame.game_id)?.[1]}</span><div><strong>{gameCatalog.find(g=>g[0]===selectedGame.game_id)?.[2]}</strong><small>{data.active?'Open now':'Starts '+labelTime(selectedGame.starts_at)} · Ends {labelTime(selectedGame.ends_at)}</small>{selectedGame.focus&&<p><strong>Today’s focus:</strong> {selectedGame.focus}</p>}</div>{data.active&&<button type="button" onClick={()=>setGame(selectedGame.game_id)}>Play assigned challenge</button>}</div>}
  {data&&!selectedGame&&<p>{selected&&!available.some(g=>g[0]===selected.game_id)?'This assigned challenge is unavailable with your current training access.':'No challenge is published right now.'}</p>}
  {data?.manager&&editing&&<fieldset className="home-challenge-setup" disabled={busy}><legend>Publish the team challenge</legend><label>Game<select value={choice} onChange={e=>setChoice(e.target.value as GameId)}>{gameCatalog.map(g=><option key={g[0]} value={g[0]}>{g[1]} {g[2]}</option>)}</select></label><div><label>Starts<input type="datetime-local" value={starts} onChange={e=>setStarts(e.target.value)}/></label><label>Ends<input type="datetime-local" value={ends} onChange={e=>setEnds(e.target.value)}/></label></div><label>Service focus or goal<textarea maxLength={500} value={focus} onChange={e=>setFocus(e.target.value)} placeholder="Example: Practice recommending one food and drink pairing without sounding scripted."/></label><button type="button" onClick={()=>void publish()}>{busy?'Publishing…':'Publish challenge'}</button></fieldset>}
  {game&&<TaskDialog title="Daily Challenge" onClose={()=>{if(window.confirm('Close this challenge? Finish the round first if you want the result saved.'))setGame(null)}}><RestaurantGamesPage initialGame={game} embedded dailyChallenge/></TaskDialog>}
 </section>
}

import { ScreenText } from "./ScreenText"
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
export type DaySection={id:string;name:string;employee_id:string;employee:string;tables:string;starts_at:string|null;ends_at:string|null}
export const sectionTime=(value:string)=>new Date(value).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true})
export function MySections({location,date,refresh}:{location:string;date:string;refresh:number}){
 const [rows,setRows]=useState<DaySection[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true)
 useEffect(()=>{let live=true;setRows([]);setLoading(true);void supabase.rpc('floor_sections_for_day',{p_location_id:location,p_date:date,p_only_me:true}).then(r=>{if(!live)return;if(r.error)setError(r.error.message);else{setRows(r.data??[]);setError('')}setLoading(false)});return()=>{live=false}},[location,date,refresh])
 return <section className="home-section"><div className="home-section-heading"><h2><ScreenText id="MySections.95fa0af551b5f5f1">My Sections</ScreenText></h2><Link to="/floor"><ScreenText id="MySections.993f0bbfdc80c378">Open floor →</ScreenText></Link></div>{error&&<p role="alert">{error}</p>}{loading&&<p role="status"><ScreenText id="MySections.b5de2c6ad88b27f5">Loading sections…</ScreenText></p>}{!loading&&!error&&!rows.length&&<p><ScreenText id="MySections.906682ebbac27a3d">No section published for you for this service day.</ScreenText></p>}{rows.map((s,i)=><article className="card" key={s.id+':'+i}><h3>{s.name}</h3><p><strong><ScreenText id="MySections.58249e8dd9d43f25">Tables:</ScreenText></strong> {s.tables}</p><p>{s.starts_at&&s.ends_at?sectionTime(s.starts_at)+' – '+sectionTime(s.ends_at)+' CT':'Regular shift assignment'}</p></article>)}</section>
}

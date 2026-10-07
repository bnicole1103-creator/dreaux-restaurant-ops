// page-designer-instrumented
import { PageWord } from "./PageDesign"
import { ScreenText } from "./ScreenText"
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
export type DaySection={id:string;name:string;employee_id:string;employee:string;tables:string;starts_at:string|null;ends_at:string|null}
export const sectionTime=(value:string)=>new Date(value).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true})
export function MySections({location,date,refresh}:{location:string;date:string;refresh:number}){
 const [rows,setRows]=useState<DaySection[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true)
 useEffect(()=>{let live=true;setRows([]);setLoading(true);void supabase.rpc('floor_sections_for_day',{p_location_id:location,p_date:date,p_only_me:true}).then(r=>{if(!live)return;if(r.error)setError(r.error.message);else{setRows(r.data??[]);setError('')}setLoading(false)});return()=>{live=false}},[location,date,refresh])
 return <section data-design-block="copy.2df3ad4e27342c8d.1" className="home-section"><div data-design-block="copy.a40fedaad8b3d777.1" className="home-section-heading"><h2 data-design-block="copy.292b8db9160b9b9e.1"><ScreenText id="MySections.95fa0af551b5f5f1">My Sections</ScreenText></h2><Link to="/floor"><ScreenText id="MySections.993f0bbfdc80c378">Open floor →</ScreenText></Link></div>{error&&<p data-design-block="copy.8c5d59f8f0e4ca74.1" role="alert">{error}</p>}{loading&&<p data-design-block="copy.fa0f388405250926.1" role="status"><ScreenText id="MySections.b5de2c6ad88b27f5">Loading sections…</ScreenText></p>}{!loading&&!error&&!rows.length&&<p data-design-block="copy.5bcf31aa4b4979cd.1"><ScreenText id="MySections.906682ebbac27a3d">No section published for you for this service day.</ScreenText></p>}{rows.map((s,i)=><article data-design-block="copy.2e4cc256cfffd186.1" className="card" key={s.id+':'+i}><h3 data-design-block="copy.1fb3332618ff6fd1.1">{s.name}</h3><p data-design-block="copy.5bcf31aa4b4979cd.2"><strong><ScreenText id="MySections.58249e8dd9d43f25">Tables:</ScreenText></strong> {s.tables}</p><p data-design-block="copy.5bcf31aa4b4979cd.3">{s.starts_at&&s.ends_at?sectionTime(s.starts_at)+' – '+sectionTime(s.ends_at)+' CT':<PageWord id="copy.e74883aced523765.1">{"Regular shift assignment"}</PageWord>}</p></article>)}</section>
}

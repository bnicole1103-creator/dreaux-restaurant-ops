import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { taskPositionMatches } from '../lib/workingPositions'

type Pick = { id:string; version:number }
type Template = { id:string; items:string[]; position:string }

export function RosterTaskPicker({ location, position, options, value, onChange }: {
  location:string
  position:string
  options:{ id:string;title:string;version:number }[]
  value:Pick[]
  onChange:(value:Pick[])=>void
}) {
  const [query,setQuery]=useState('')
  const [templates,setTemplates]=useState<Record<string,Template>>({})
  const [showOther,setShowOther]=useState(false)
  const [error,setError]=useState('')
  useEffect(()=>{
    let live=true
    void Promise.resolve(supabase.rpc('staff_tasks_templates',{p_location_id:location})).then(result=>{
      if(!live)return
      if(result.error)throw result.error
      setTemplates(Object.fromEntries((result.data??[]).map((template:Template)=>[template.id,template])))
    }).catch(caught=>{if(live)setError('Task previews unavailable: '+String(caught.message??caught))})
    return()=>{live=false}
  },[location])

  const selected=new Set(value.map(item=>item.id))
  const visible=options.filter(option=>{
    const template=templates[option.id]
    return option.title.toLowerCase().includes(query.trim().toLowerCase())
      && (showOther||selected.has(option.id)||!template||taskPositionMatches(template.position,position))
  })
  return <details>
    <summary>Task lists · {value.length?value.length+' selected':'Choose lists (optional)'}</summary>
    <label>Find a task list<input value={query} onChange={event=>setQuery(event.target.value)}/></label>
    <label><input type="checkbox" checked={showOther} onChange={event=>setShowOther(event.target.checked)}/>Show lists for other positions</label>
    {error&&<p role="alert">{error}</p>}
    {!visible.length&&<p>No matching lists. Change the search or show other positions.</p>}
    <div style={{maxHeight:320,overflowY:'auto',display:'grid',gap:8}}>
      {visible.map(option=><div key={option.id}>
        <label style={{display:'flex',gap:8,alignItems:'start'}}>
          <input type="checkbox" checked={selected.has(option.id)}
            onChange={event=>onChange(event.target.checked?[...value,{id:option.id,version:option.version}]:value.filter(item=>item.id!==option.id))}/>
          {option.title}
        </label>
        <details><summary>Preview tasks</summary>
          {templates[option.id]?<ol>{templates[option.id].items.map((item,index)=><li key={index}>{item}</li>)}</ol>:<p>Preview unavailable.</p>}
        </details>
      </div>)}
    </div>
  </details>
}

import {useState,type ReactNode} from 'react'

/** Supporting reports load only when opened, so a day change cannot leave stale reports onscreen. */
export function SummaryDisclosure({title,children}:{title:string;children:ReactNode}){
 const [open,setOpen]=useState(false)
 return <details className="summary-disclosure" onToggle={e=>setOpen(e.currentTarget.open)}><summary>{title}</summary>{open&&<div className="summary-disclosure-body">{children}</div>}</details>
}

import type {ReactNode} from 'react'
import {usePreparedAction,usePrepareRelease} from './PrepareRelease'
import {usePrepareWorkStatus} from './PrepareWorkStatus'
export function PreparedTargetScope({id,name,fingerprint,dirty,busy,error,children}:{id:string;name:string;fingerprint:unknown;dirty:boolean;busy:boolean;error:string;children:ReactNode}){
 const release=usePrepareRelease(),entry=release?.entries.find(e=>e.id===id)
 const prepared=usePreparedAction(id,id,'Individual target: '+name,fingerprint)
 usePrepareWorkStatus({id,phase:'service',label:'Target: '+name,dirty,busy,error,detail:prepared.queued?'Queued for final release.':'Existing target loaded.'})
 return <div className="task-card">{prepared.queued&&<p role="status">{entry?.selected?'Queued · included in preview':'Queued · unchecked, excluded from preview'}</p>}{children}</div>
}

import type {ReactNode} from 'react'
import {usePreparedAction} from './PrepareRelease'
import {usePrepareWorkStatus} from './PrepareWorkStatus'
export function PreparedTargetScope({id,name,fingerprint,dirty,busy,error,children}:{id:string;name:string;fingerprint:unknown;dirty:boolean;busy:boolean;error:string;children:ReactNode}){
 const prepared=usePreparedAction(id,id,'Individual target: '+name,fingerprint)
 usePrepareWorkStatus({id,phase:'service',label:'Target: '+name,dirty,busy,error,detail:prepared.queued?'Queued for final release.':'Existing target loaded.'})
 return <div className="task-card">{prepared.queued&&<p role="status">Target change queued for release; not applied yet.</p>}{children}</div>
}

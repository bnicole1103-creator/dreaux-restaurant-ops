import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react'
export type PrepareWorkState={id:string;phase:'service'|'briefing'|'quizzes';label:string;dirty:boolean;busy:boolean;error:string;detail:string}
const Context=createContext<{rows:PrepareWorkState[];report:(row:PrepareWorkState)=>void}|null>(null)
export function PrepareWorkProvider({children}:{children:ReactNode}){
 const [rows,setRows]=useState<PrepareWorkState[]>([])
 const report=useCallback((row:PrepareWorkState)=>setRows(previous=>{const old=previous.find(r=>r.id===row.id);if(old&&JSON.stringify(old)===JSON.stringify(row))return previous;return [...previous.filter(r=>r.id!==row.id),row]}),[])
 return <Context.Provider value={{rows,report}}>{children}</Context.Provider>
}
export function usePrepareWork(){return useContext(Context)}
export function usePrepareWorkStatus(state:PrepareWorkState){
 const context=useContext(Context),report=context?.report,current=useRef(state);current.current=state
 useEffect(()=>{report?.(state)},[report,state.id,state.phase,state.label,state.dirty,state.busy,state.error,state.detail])
 useEffect(()=>()=>{const row=current.current;if(row.dirty||row.busy)report?.({...row,dirty:false,busy:false,error:'',detail:'Editor closed. Verify its saved record before release.'})},[report])
}
export function workBlockers(rows:PrepareWorkState[],phase?:string){return rows.filter(r=>(!phase||r.phase===phase)&&(r.dirty||r.busy))}

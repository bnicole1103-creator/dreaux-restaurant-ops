import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { closeoutDate } from './closeoutNavigation'

type Permission = { day:string; apply_points:boolean; reason?:string; active?:boolean; expires_at?:string|null }
type Access = { manager:boolean; permissions:Permission[]; staff:{id:string;name:string}[] }

export function usePastCloseoutAccess(location:string) {
 const [result,setResult]=useState<{location:string;access:Access|null;error:string}|null>(null)
 const current=result?.location===location?result:null
 useEffect(()=>{
  if(!location)return
  let active=true
  let sequence=0
  async function load(){
   const ticket=++sequence
   try{
    const response=await supabase.rpc('operations_closeout_access',{p_location_id:location})
     .abortSignal(AbortSignal.timeout(15000))
    if(response.error)throw response.error
    if(active&&ticket===sequence)setResult({location,access:response.data,error:''})
   }catch(caught){
    if(active&&ticket===sequence)setResult({location,access:null,error:String((caught as Error).message??caught)})
   }
  }
  const refresh=()=>void load()
  refresh()
  const onVisible=()=>{if(document.visibilityState==='visible')refresh()}
  document.addEventListener('visibilitychange',onVisible)
  window.addEventListener('focus',refresh)
  window.addEventListener('past-closeout-access-changed',refresh)
  return()=>{active=false;document.removeEventListener('visibilitychange',onVisible);window.removeEventListener('focus',refresh);window.removeEventListener('past-closeout-access-changed',refresh)}
 },[location])
 return {access:current?.access??null,error:current?.error??'',loading:!!location&&!current}
}

export function approvedCloseoutDays(access:Access|null, today:string) {
 const permissions=Array.isArray(access?.permissions)?access.permissions:[]
 return permissions.filter(permission=>closeoutDate(permission.day,today)&&permission.day<today&&permission.active!==false
  && (!permission.expires_at||Date.parse(permission.expires_at)>Date.now()))
  .sort((left,right)=>right.day.localeCompare(left.day))
}

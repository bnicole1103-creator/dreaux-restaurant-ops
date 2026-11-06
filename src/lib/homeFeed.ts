import {supabase} from './supabase'
// Share Home's overlapping feed requests, scoped to the authenticated session.
const pending=new Map<string,Promise<{data:any;error:any}>>()
let sessionToken=''
supabase.auth.onAuthStateChange((_event,session)=>{
 const token=session?.access_token??''
 if(token!==sessionToken){pending.clear();sessionToken=token}
})
export async function loadHomeFeed(location:string,cycle:number){
 const auth=await supabase.auth.getSession()
 const token=auth.data.session?.access_token??''
 if(!token)throw Error('Sign in again to load posts.')
 if(token!==sessionToken){pending.clear();sessionToken=token}
 const key=JSON.stringify([location,cycle])
 const existing=pending.get(key);if(existing)return existing
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000)
 const request=Promise.resolve(supabase.rpc('preshift_feed',{p_location_id:location,p_limit:1000}).abortSignal(controller.signal)).finally(()=>{
  clearTimeout(timer)
  // Let sibling Home components consume the same result, never a later refresh cycle.
  setTimeout(()=>{if(pending.get(key)===request)pending.delete(key)},1500)
 })
 pending.set(key,request)
 return request
}

import {supabase} from './supabase'
import type {InquiryReservationSource} from '../components/InquiryReservationDialog'
export type ManagementBooking={id:string;guest_name:string;reservation_date:string;reservation_time:string|null;party_size:number;phone:string|null;email:string|null;notes:string|null;status:string;edit_version:number;occasion:string;birthday:boolean;vip:boolean}
export type ManagementInquiry=InquiryReservationSource&{received:string;status:string}
export const inquiryStudio='https://justinis-inquiry-studio.h8w8547sfq.chatgpt.site'
export async function requestStudio(location:string,data?:unknown,signal?:AbortSignal){
 const {data:auth,error}=await supabase.auth.getSession();if(error||!auth.session)throw Error('Please sign in again.')
 const response=await fetch(`${inquiryStudio}/api/main-app?location=${encodeURIComponent(location)}`,{method:data?'POST':'GET',cache:'no-store',signal:signal??AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${auth.session.access_token}`,apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})})
 const body=await response.json().catch(()=>null);if(!response.ok||!body||(!data&&!Array.isArray(body.inquiries)))throw Error(body?.error??'Guest inquiry connection unavailable. Refresh to retry.')
 return body
}
export function studioInquiry(r:any):ManagementInquiry{let details:Record<string,unknown>={};try{details=typeof r.details==='string'?JSON.parse(r.details):r.details??{}}catch{details={Details:r.details}}return {id:r.id,source:'Guest form',name:r.name,phone:r.phone??'',email:r.email??'',guests:r.guests,date:r.event_date??'',notes:r.notes??'',status:r.status??'New',received:r.received,details:{...details,Package:r.package_name}}}
export function hostInquiry(r:any):ManagementInquiry{return {id:r.id,source:'Host',name:r.guest_name,phone:r.phone??'',email:r.email??'',guests:r.party_size,date:r.preferred_date??'',notes:r.internal_notes??'',status:r.status??'New',received:r.created_at,details:{'First time':r.preferred_time,'Second time':r.second_preferred_time,'Guest notes':r.guest_notes,Type:r.inquiry_type}}}
export const inquiryKey=(r:ManagementInquiry)=>r.source+':'+r.id
export function dayShift(day:string,offset:number){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10)}

import {supabase} from './supabase'
export type ReusableSection={title:string;category:string;body:string}
export async function saveReusablePreset(location:string,section:ReusableSection){
 const title=section.title.trim(),body=section.body.trim()
 if(!title||title.length>100||!body||body.length>4000)throw Error('Use a section title up to 100 characters and wording up to 4,000 characters.')
 const existing=await supabase.rpc('preshift_presets',{p_location_id:location})
 if(existing.error)throw existing.error
 // Reuse an identical private preset, including after a save whose response was interrupted.
 const match=(existing.data??[]).find((p:{id:string;title:string;body:string;category:string;weekday:number|null;visibility:string;can_edit:boolean})=>p.can_edit&&p.visibility==='private'&&p.weekday===null&&p.title===title&&p.body===body&&p.category===section.category)
 if(match)return {id:match.id,reused:true}
 const r=await supabase.rpc('preshift_preset_save',{p_location_id:location,p_id:null,p_version:null,p_title:title,p_category:section.category,p_weekday:null,p_body:body,p_visibility:'private'})
 if(r.error)throw r.error
 if(typeof r.data!=='string'||!r.data)throw Error('Save confirmation was unavailable. Try Save again; an identical saved preset will be reused.')
 return {id:r.data,reused:false}
}

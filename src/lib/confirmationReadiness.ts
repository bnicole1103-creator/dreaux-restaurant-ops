import {supabase} from './supabase'
export type ConfirmationGate={ready:boolean;reasons:string[];guestConfirmed:boolean;consent:boolean}
export function confirmationGate(policy:{ready?:boolean;version?:string}|null,audit:{valid?:boolean;responded_at?:string|null;booking_confirmed?:boolean;sms_opt_in?:boolean;email_opt_in?:boolean;policy_accepted?:boolean;evidence?:{version?:string}|null}|null,channel:'sms'|'email'):ConfirmationGate{
 const reasons:string[]=[]
 if(!policy?.ready)reasons.push('Public support contact or messaging setup is not ready.')
 if(policy?.version!=='2026-11-06-reservation-sms-v2')reasons.push('The versioned messaging-consent backend needs installation or upgrade.')
 if(!audit?.valid)reasons.push('No current valid guest link. Create a link or replace the expired/changed link.')
 if(!audit?.responded_at)reasons.push('The guest has not submitted their choices.')
 if(!audit?.booking_confirmed)reasons.push('The guest has not confirmed the booking details.')
 if(audit?.policy_accepted!==true)reasons.push('The guest has not accepted the required house rules.')
 const consent=channel==='sms'?audit?.sms_opt_in===true:audit?.email_opt_in===true
 if(!consent)reasons.push('Recorded guest permission for '+(channel==='sms'?'text messages':'email')+' is missing.')
 if(audit?.evidence?.version!=='2026-11-06-reservation-sms-v2')reasons.push('Current versioned consent evidence is missing.')
 return {ready:reasons.length===0,reasons,guestConfirmed:audit?.booking_confirmed===true&&audit?.policy_accepted===true,consent}
}
export async function loadConfirmationGate(id:string,channel:'sms'|'email'){
 const [p,a]=await Promise.all([supabase.rpc('reservation_policy_contact').abortSignal(AbortSignal.timeout(15000)),supabase.rpc('reservation_guest_link_status',{p_id:id}).abortSignal(AbortSignal.timeout(15000))]);if(p.error)throw p.error;if(a.error)throw a.error;return confirmationGate(p.data,a.data,channel)
}

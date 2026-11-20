export type ConfirmationState={confirmation_open?:boolean;link_id?:string|null;link_sent_at?:string|null;booking_confirmed?:boolean;confirmation_current?:boolean;valid?:boolean;responded_at?:string|null;expires_at?:string|null}
export function guestConfirmationLabel(state:ConfirmationState|null){
 return (state?.confirmation_current??(state?.booking_confirmed===true&&state.valid===true))?'Confirmed':'Not confirmed'
}
export function confirmationWorkflowLabel(state:ConfirmationState|null){
 if(guestConfirmationLabel(state)==='Confirmed')return 'Confirmed'
 if(state?.valid&&state.link_sent_at)return 'Confirmation link sent · Awaiting guest'
 if(state?.link_id&&state.link_sent_at)return 'Confirmation link sent · Link expired'
 if(state?.confirmation_open===false)return 'Confirmation window closed'
 return 'Needs confirmation link sent'
}
export const confirmationOrigin='https://justinis-nola.vercel.app'
export function confirmationInvitation(link:string,opening=false){
 return `JusTini’s New Orleans: ${opening?'A spot opened up for your party! ':''}Please review and confirm your reservation here:\n${link}`
}

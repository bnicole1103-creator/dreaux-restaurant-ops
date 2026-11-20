export type ConfirmationState={booking_confirmed?:boolean;confirmation_current?:boolean;valid?:boolean;responded_at?:string|null;expires_at?:string|null}
export function guestConfirmationLabel(state:ConfirmationState|null){
 return (state?.confirmation_current??(state?.booking_confirmed===true&&state.valid===true))?'Confirmed':'Not confirmed'
}
export const confirmationOrigin='https://justinis-nola.vercel.app'
export function confirmationInvitation(link:string,opening=false){
 return `JusTini’s New Orleans: ${opening?'A spot opened up for your party! ':''}Please review and confirm your reservation here:\n${link}`
}

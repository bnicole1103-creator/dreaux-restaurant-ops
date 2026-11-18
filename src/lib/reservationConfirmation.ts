export type ConfirmationState={booking_confirmed?:boolean;valid?:boolean;responded_at?:string|null;expires_at?:string|null}
export function guestConfirmationLabel(state:ConfirmationState|null){
 return state?.booking_confirmed===true&&state.valid===true?'Confirmed':'Not confirmed'
}
export const confirmationOrigin='https://justinis-nola.vercel.app'
export function confirmationInvitation(link:string){return `JusTini’s New Orleans: Please review your reservation and choose whether you want text or email confirmation. Messaging is optional. Submit your choices here:\n${link}\nPrivacy Policy & Messaging Terms: ${confirmationOrigin}/privacy`}

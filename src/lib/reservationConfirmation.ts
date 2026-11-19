export type ConfirmationState={booking_confirmed?:boolean;confirmation_current?:boolean;valid?:boolean;responded_at?:string|null;expires_at?:string|null}
export function guestConfirmationLabel(state:ConfirmationState|null){
 return (state?.confirmation_current??(state?.booking_confirmed===true&&state.valid===true))?'Confirmed':'Not confirmed'
}
export const confirmationOrigin='https://justinis-nola.vercel.app'
export function confirmationInvitation(link:string,seating?:string){return `JusTini’s New Orleans: ${seating ? 'Your reservation is for ' + seating + '. ' : ''}Please review your reservation and choose whether you want text or email confirmation. Messaging is optional. Submit your choices here:\n${link}\nPrivacy Policy & Messaging Terms: ${confirmationOrigin}/privacy`}

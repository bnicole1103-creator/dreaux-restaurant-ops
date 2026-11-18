export function messageRecipient(value:string){
 const clean=value.trim()
 if(!clean||!/^\+?[\d\s().-]+$/.test(clean))return null
 const digits=clean.replace(/\D/g,'')
 if(digits.length<7||digits.length>15)return null
 if(clean.startsWith('+'))return '+'+digits
 if(digits.length===10)return '+1'+digits
 if(digits.length===11&&digits.startsWith('1'))return '+'+digits
 return digits
}

export function messageComposerUrl(phone:string,message:string,appleDevice:boolean){
 const recipient=messageRecipient(phone)
 if(!recipient||!message.trim())return null
 return 'sms:'+recipient+(appleDevice?'&':'?')+'body='+encodeURIComponent(message)
}

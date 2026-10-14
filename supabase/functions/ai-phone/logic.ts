export const escapeXml=(v:string)=>v.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!))
export type State={stage:string;name:string;callback:string;message:string;confirmed?:boolean;silence?:number}
export function xml(speech:string,action?:string,keypad=false,number=false){return '<?xml version="1.0" encoding="UTF-8"?><Response>'+(action?`<Gather input="${number?'speech dtmf':keypad?'dtmf':'speech'}" ${number?'finishOnKey="#" speechTimeout="auto"':keypad?'numDigits="1"':'speechTimeout="auto"'} timeout="8" actionOnEmptyResult="true" action="${escapeXml(action)}" method="POST"><Say>${escapeXml(speech)}</Say></Gather>`:`<Say>${escapeXml(speech)}</Say><Hangup/>`)+'</Response>'}
export function advance(old:State,input:string,digits:string,caller:string):{state:State;speech:string;end?:boolean;askAI?:boolean;keypad?:boolean}{
 const state={...old};if(state.stage==='done')return{state,speech:'Thank you for calling JusTini’s. Goodbye.',end:true};
 if(!input&&!digits){state.silence=(state.silence??0)+1;if(state.silence>=2)return{state,speech:'I could not hear you. Please call again when you are ready. Goodbye.',end:true};return{state,speech:'I did not catch that. Please try again.',keypad:state.stage==='confirm'}}state.silence=0;
 switch(state.stage){
 case 'help':return{state,speech:'',askAI:true};
 case 'name':state.name=input.slice(0,160);state.stage='callback';return{state,speech:'What phone number should our team use to call you back? Say the digits including the area code, or enter the number on your keypad followed by the pound key.'};
 case 'callback':{const number=(digits||input).replace(/\D/g,'');if(number.length<10||number.length>15)return{state,speech:'Please say your full callback number as digits, including the area code.'};state.callback='+'+(number.length===10?'1':'')+number;state.stage='message';return{state,speech:'Please tell me your message. For a reservation or catering inquiry, include the requested date, time, and number of people.'};}
 case 'message':state.message=input.slice(0,4000);state.stage='confirm';return{state,speech:`Your name is ${state.name}. Your callback number is ${state.callback.split('').join(' ')}. Your message is: ${state.message}. Press 1 to send this message, or 2 to start it over. Reservation and catering requests are not confirmed bookings.`,keypad:true};
 case 'confirm':if(digits==='1'){state.confirmed=true;state.stage='done';return{state,speech:'Your message has been saved for our team to review. They can follow up using your callback number. Thank you for calling JusTini’s.',end:true}}if(digits==='2'){state.name='';state.callback='';state.message='';state.stage='name';return{state,speech:'Let’s start again. What is your name?'}}return{state,speech:'Press 1 to send your message, or 2 to start over.',keypad:true};
 default:state.stage='name';return{state,speech:'I can take a message for our team. What is your name?'};
 }
}

export function normalizeInquiryStatus(value:string){
 const labels:Record<string,string>={new:'New',ready_for_review:'Ready for review',awaiting_guest:'Awaiting guest',contacted:'Contacted',confirmed:'Confirmed',closed:'Closed'}
 return labels[value?.trim().toLowerCase().replace(/[ -]+/g,'_')]??value??'New'
}
export function inquiryDetailLabel(key:string){const labels:Record<string,string>={time:'First time',firstTime:'First time',preferred_time:'First time',secondTime:'Second time',second_preferred_time:'Second time',thirdTime:'Third time',third_preferred_time:'Third time'};return labels[key]??key}
export function inquiryDetailValue(key:string,value:unknown){
 const text=String(value??'');if(!/time/i.test(key))return text
 const match=text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);if(!match)return text
 const hour=Number(match[1]),minute=Number(match[2]);if(hour>23||minute>59)return text
 return `${hour%12||12}:${match[2]} ${hour>=12?'PM':'AM'}`
}

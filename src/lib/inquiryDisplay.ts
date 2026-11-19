import { time12 } from './time12'

export function normalizeInquiryStatus(value:string){
 const labels:Record<string,string>={new:'New',ready_for_review:'Ready for review',awaiting_guest:'Awaiting guest',contacted:'Contacted',booked:'Booked',confirmed:'Confirmed',closed:'Closed'}
 return labels[value?.trim().toLowerCase().replace(/[ -]+/g,'_')]??value??'New'
}
export function inquiryDetailLabel(key:string){const labels:Record<string,string>={time:'First time',firstTime:'First time',preferred_time:'First time',secondTime:'Second time',second_preferred_time:'Second time',thirdTime:'Third time',third_preferred_time:'Third time'};return labels[key]??key}
export function inquiryDetailValue(key:string,value:unknown){
 const text = String(value ?? '')
 return text && /time/i.test(key) ? time12(text) : text
}

// Older notifications store the guest form fields in a single summary string.
export function formatInquirySummary(notes: string | null | undefined) {
 return notes?.replace(
  /(^| · )((?:time|firstTime|secondTime|thirdTime|preferred_time|second_preferred_time|third_preferred_time): )([^·]*?)(?= · |$)/g,
  (_, separator: string, field: string, value: string) => separator + inquiryDetailLabel(field.slice(0, -2)) + ': ' + inquiryDetailValue(field, value),
 ) ?? ''
}

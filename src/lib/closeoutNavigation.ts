import {serviceDay} from './serviceDay'

export function closeoutDate(value:string|null,today=serviceDay()){
 if(!value||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value>today)return ''
 const parsed=new Date(value+'T12:00:00Z')
 return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value?value:''
}
export function closeoutShift(value:string|null){return value&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)?value:''}
export function managerSummaryLink(day:string,shift:string){return '/closeout-summary?'+new URLSearchParams({date:day,manager_shift:shift})}
export function managerCloseoutLink(day:string,shift:string){return '/closeout/manager?'+new URLSearchParams({date:day,shift})}

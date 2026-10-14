export const calendarToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
export const validDay=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s
export function addDays(day:string,n:number){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
export function weekDays(day:string){const offset=(new Date(day+'T12:00:00Z').getUTCDay()+6)%7;const monday=addDays(day,-offset);return Array.from({length:7},(_,i)=>addDays(monday,i))}
export function monthDays(month:string){const first=month+'-01',next=new Date(first+'T12:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);const last=addDays(next.toISOString().slice(0,10),-1);return {first,last,grid:Array.from({length:Math.ceil(((new Date(first+'T12:00:00Z').getUTCDay()+6)%7+Number(last.slice(-2)))/7)*7},(_,i)=>addDays(weekDays(first)[0],i))}}
export const dateLabel=(day:string,short=false)=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'short',month:short?'short':'long',day:'numeric',year:short?undefined:'numeric'}).format(new Date(day+'T12:00:00Z'))
export const shiftClock=(date:string)=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'}).format(new Date(date))

const formatter = new Intl.DateTimeFormat('en-US', {timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'})
export function serviceDay(at = new Date()) {
 const parts=formatter.formatToParts(at)
 const get=(type:string)=>parts.find(p=>p.type===type)?.value ?? ''
 const day=`${get('year')}-${get('month')}-${get('day')}`
 if(Number(get('hour'))>=4)return day
 const previous=new Date(`${day}T12:00:00Z`)
 previous.setUTCDate(previous.getUTCDate()-1)
 return previous.toISOString().slice(0,10)
}
export function serviceDateLabel(day:string,monthOnly=false) {
 return new Intl.DateTimeFormat('en-US',{timeZone:'UTC',year:'numeric',month:'long',...(monthOnly?{}:{day:'numeric'})}).format(new Date(`${day.length===7?day+'-01':day}T12:00:00Z`))
}
export function nextServiceBoundary(at = new Date()) {
 const next=new Date(`${serviceDay(at)}T04:00:00Z`)
 next.setUTCDate(next.getUTCDate()+1)
 const target=next.getTime()
 const f=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})
 let instant=target
 for(let i=0;i<3;i++){
  const parts=f.formatToParts(new Date(instant))
  const get=(type:string)=>Number(parts.find(p=>p.type===type)?.value)
  const local=Date.UTC(get('year'),get('month')-1,get('day'),get('hour'),get('minute'),get('second'))
  instant+=target-local
 }
 return instant
}

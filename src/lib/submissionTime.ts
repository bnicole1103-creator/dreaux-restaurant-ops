export function submissionLabel(value:string|null|undefined) {
 if(!value)return 'Not submitted'
 const at=new Date(value)
 if(Number.isNaN(at.getTime()))return 'Unavailable'
 return new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).format(at)
}
export function clockLabel(value:string|null|undefined) {
 if(!value)return '—'
 const match=/^(\d{1,2}):(\d{2})/.exec(value)
 if(!match)return value
 const hour=Number(match[1]);return `${hour%12||12}:${match[2]} ${hour>=12?'PM':'AM'}`
}

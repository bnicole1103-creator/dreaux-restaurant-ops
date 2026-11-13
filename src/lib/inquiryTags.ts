import {inquiryDetailValue} from './inquiryDisplay'
export const inquiryTags=['🎂 Birthday','🥂 Anniversary','👤 Employee','🤝 Friend of owner','⭐ VIP','🎉 Celebration']
const prefix='Guest tags: '
export function selectedInquiryTags(notes:string){const line=notes.split('\n').find(l=>l.startsWith(prefix));return line?line.slice(prefix.length).split(' • ').filter(t=>inquiryTags.includes(t)):[]}
export function setInquiryTags(notes:string,tags:string[]){const text=notes.split('\n').filter(l=>!l.startsWith(prefix)).join('\n').trim();return [tags.length?prefix+inquiryTags.filter(t=>tags.includes(t)).join(' • '):'',text].filter(Boolean).join('\n')}
export function inquiryReservationNotes(notes:string,details:Record<string,unknown>){const skip=new Set(['name','email','phone','eventDate','event_date','time','First time','Second time','Third time','preferred_time','category','Email delivery','Guest follow-up']);return [notes.trim(),...Object.entries(details).filter(([k,v])=>!skip.has(k)&&v!=null&&String(v).trim()).map(([k,v])=>k.replace(/_/g,' ')+': '+(typeof v==='object'?JSON.stringify(v):inquiryDetailValue(k,v)))].filter(Boolean).join('\n')}

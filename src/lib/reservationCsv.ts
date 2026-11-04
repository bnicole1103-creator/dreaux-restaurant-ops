import {validDay} from './calendarDates'
export function csvRows(text:string){const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;const input=text.replace(/^\uFEFF/,'');for(let i=0;i<input.length;i++){const c=input[i];if(c==='"'){if(quoted&&input[i+1]==='"'){cell+='"';i++}else quoted=!quoted}else if(c===','&&!quoted){row.push(cell.trim());cell=''}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&input[i+1]==='\n')i++;row.push(cell.trim());if(row.some(Boolean))rows.push(row);row=[];cell=''}else cell+=c}if(quoted)throw Error('CSV has an unclosed quote.');row.push(cell.trim());if(row.some(Boolean))rows.push(row);return rows}

const key=(v:string)=>v.toLowerCase().trim().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')
const names=['guest_name','guest','name','customer_name','reservation_name']
export function reservationFileDate(value:string):string{
 const iso=/\b(\d{4})-(\d{2})-(\d{2})\b/.exec(value)
 const us=/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/.exec(value)
 let day=iso?iso[0]:us?`${us[3]}-${us[1].padStart(2,'0')}-${us[2].padStart(2,'0')}`:''
 if(!day){const m=/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(\d{4})\b/i.exec(value);if(m){const month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[1].slice(0,3).toLowerCase())+1;day=`${m[3]}-${String(month).padStart(2,'0')}-${m[2].padStart(2,'0')}`}}
 return validDay(day)?day:''
}
export function reservationImport(text:string,_selectedDate:string,location:string,organization:string){
 const all=csvRows(text)
 const headerAt=all.findIndex(r=>r.some(c=>names.includes(key(c)))&&r.some(c=>['party_size','covers','guests','guest_count','size'].includes(key(c))))
 if(headerAt<0)throw Error('Could not find reservation column headings. Use a CSV with Guest name, Party size and Time columns.')
 const keys=all[headerAt].map(key),rows=all.slice(headerAt+1).filter(r=>r.some(Boolean))
 const headingDates=[...new Set(all.slice(0,headerAt).map(r=>reservationFileDate(r.join(' '))).filter(Boolean))]
 if(headingDates.length>1)throw Error('The file heading contains multiple dates. Add a Date column for each reservation or upload one service date at a time.')
 const headingDate=headingDates[0]??''
 const get=(r:string[],aliases:string[])=>{const i=keys.findIndex(k=>aliases.includes(k));return i<0?'':r[i]??''}
 if(!rows.length||rows.length>2000)throw Error('Import 1 to 2,000 reservations.')
 return rows.map((r,index)=>{
 const prefix=`CSV row ${headerAt+index+2}: `,name=get(r,names).trim()
 if(!name||name.length>200)throw Error(prefix+'guest name is required (up to 200 characters).')
 const rawDate=get(r,['reservation_date','date','booking_date','service_date']),day=rawDate?reservationFileDate(rawDate):headingDate
 if(!day)throw Error(prefix+'a complete reservation date is required in the row or file heading. Include the year.')
 const party=Number(get(r,['party_size','covers','guests','guest_count','size']))
 if(!Number.isInteger(party)||party<1||party>500)throw Error(prefix+'party size must be a whole number from 1 to 500.')
 const raw=get(r,['reservation_time','time','booking_time','start_time']).replace(/\./g,'').trim()
 const t=/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(AM|PM)?$/i.exec(raw)
 if(!t||(!t[2]&&!t[3])||Number(t[2]??0)>59||Number(t[1])>(t[3]?12:23)||Number(t[1])<(t[3]?1:0))throw Error(prefix+'a valid time is required, such as 6:30 PM or 18:30.')
 let h=Number(t[1]);if(t[3])h=h%12+(t[3].toUpperCase()==='PM'?12:0)
 const time=String(h).padStart(2,'0')+':'+(t[2]??'00')
 const occasion=get(r,['occasion','special_occasion']),notes=get(r,['notes','guest_notes','reservation_notes','special_requests'])
 return {location_id:location,organization_id:organization,reservation_date:day,reservation_time:time,guest_name:name,party_size:party,
 table_name:get(r,['table','table_name','tables'])||null,table_ids:[] as string[],table_id:null as string|null,occasion:occasion||null,notes:notes||null,
 phone:get(r,['phone','phone_number','mobile'])||null,email:get(r,['email','email_address'])||null,
 is_birthday:/^(true|yes|1)$/i.test(get(r,['birthday','is_birthday']))||/birthday/i.test(occasion+' '+notes),is_vip:/^(true|yes|1)$/i.test(get(r,['vip','is_vip','vip_status'])),
 status:get(r,['status','reservation_status'])||'booked',imported_source:'csv',external_reservation_id:get(r,['reservation_id','booking_id','confirmation_number'])||null,dining_area:get(r,['dining_area','area','room','section'])||null}
 })
}

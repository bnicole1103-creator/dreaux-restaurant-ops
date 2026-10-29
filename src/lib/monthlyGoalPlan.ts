export type ToastRow={key:string;weekday:number;hour:string;amount:number}
export type ToastReport={name:string;rows:ToastRow[];skipped:number}
export type GoalDay={date:string;target:number}
export function csvRows(text:string){
 const rows:string[][]=[];let row:string[]=[],cell='',quote=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quote&&text[i+1]==='"'){cell+='"';i++}else quote=!quote}else if(c===','&&!quote){row.push(cell);cell=''}else if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell=''}else cell+=c}
 if(quote)throw Error('CSV has an unfinished quoted field.');row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
 if(rows.length<2)throw Error('Choose a CSV with a header and sales rows.');if(rows.length>25001)throw Error('Use a report with at most 25,000 rows.');return rows;
}
export const weekdayNames=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
function sourceDay(raw:string){const text=raw.trim(),w=weekdayNames.findIndex(d=>d.toLowerCase()===text.toLowerCase()||d.slice(0,3).toLowerCase()===text.toLowerCase());if(w>=0)return {key:weekdayNames[w],weekday:w};let key=text;
 const m=text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(m)key=`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(key))return null;const d=new Date(key+'T12:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===key?{key,weekday:d.getUTCDay()}:null;
}
export function importToast(name:string,table:string[][],dateCol:number,salesCol:number,hourCol:number,expectedMonth:string):ToastReport{
 if(dateCol===salesCol||hourCol===salesCol||hourCol===dateCol)throw Error('Choose different columns for day, sales and hour.');const rows:ToastRow[]=[],seen=new Set<string>();let skipped=0,kind='';
 for(const r of table.slice(1)){const d=sourceDay(r[dateCol]??'');if(!d){skipped++;continue}const dated=/^\d{4}-/.test(d.key);if(dated&&!d.key.startsWith(expectedMonth))throw Error('Report includes '+d.key+'; expected '+expectedMonth+'. Export the requested month only.');const next=dated?'date':'weekday';if(kind&&kind!==next)throw Error('Use either dates or weekday averages, not both in one report.');kind=next;
 const raw=(r[salesCol]??'').trim();if(!raw)throw Error('Missing sales amount for '+d.key+'. Missing is not zero.');const clean=raw.replace(/[$,\s]/g,'').replace(/^\((.*)\)$/,'-$1');if(!/^-?\d+(?:\.\d{1,2})?$/.test(clean))throw Error('Invalid net sales amount for '+d.key+': '+raw);const amount=Number(clean);if(!Number.isFinite(amount)||Math.abs(amount)>100000000)throw Error('Sales amount is out of range.');
 const hour=hourCol<0?'daily':(r[hourCol]??'').trim();if(!hour)throw Error('Missing hour for '+d.key);if(hourCol>=0&&!/^(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*(?:am|pm)?(?:\s*[-–]\s*(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*(?:am|pm)?)?$/i.test(hour))throw Error('Hour must be an hour or time range, not a subtotal: '+hour);
 const id=d.key+'|'+hour.toLowerCase().replace(/\s/g,'');if(seen.has(id))throw Error('Duplicate day/hour '+id+'. Export one restaurant total per hour; do not mix subtotals or separate sales categories.');seen.add(id);rows.push({...d,hour,amount});
 }
 if(!rows.length)throw Error('No dated or weekday sales rows found. Check the selected columns.');return {name,rows,skipped};
}
export function weekdayAverages(report:ToastReport){const days=new Map<string,{weekday:number;total:number}>();for(const r of report.rows){const d=days.get(r.key)??{weekday:r.weekday,total:0};d.total+=Math.round(r.amount*100);days.set(r.key,d)}return weekdayNames.map((_,weekday)=>{const list=[...days.values()].filter(d=>d.weekday===weekday);return list.length?list.reduce((s,d)=>s+d.total,0)/list.length/100:null})}
export function monthDates(month:string){if(!/^\d{4}-\d{2}$/.test(month))throw Error('Choose a month.');const d=new Date(month+'-01T12:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,7)!==month)throw Error('Choose a valid month.');const dates:string[]=[];while(d.toISOString().startsWith(month)){dates.push(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()+1)}return dates}
export function planDays(month:string,a:ToastReport,b:ToastReport,priorPercent:number,growth:number,monthly:string,closed:number[]):GoalDay[]{
 const recent=weekdayAverages(a),prior=weekdayAverages(b);if(!Number.isFinite(priorPercent)||priorPercent<0||priorPercent>100||!Number.isFinite(growth)||growth< -100||growth>300)throw Error('Use a 0–100% prior-year weight and −100–300% growth.');
 const dates=monthDates(month),weights=dates.map(date=>{const w=new Date(date+'T12:00:00Z').getUTCDay();if(closed.includes(w))return 0;if((priorPercent<100&&recent[w]===null)||(priorPercent>0&&prior[w]===null))throw Error('Missing '+weekdayNames[w]+' data. Mark it closed or supply the missing report rows.');return Math.max(0,(recent[w]??0)*(1-priorPercent/100)+(prior[w]??0)*priorPercent/100)}),sum=weights.reduce((a,b)=>a+b,0);
 const total=monthly.trim()?Number(monthly):sum*(1+growth/100);if(!Number.isFinite(total)||total<=0||total>100000000||!sum)throw Error('Enter a positive monthly goal and provide positive sales weights for open days.');const cents=Math.round(total*100),raw=weights.map(w=>cents*w/sum),amounts=raw.map(Math.floor);let left=cents-amounts.reduce((a,b)=>a+b,0);for(const {i} of raw.map((v,i)=>({i,r:v-amounts[i]})).sort((a,b)=>b.r-a.r||a.i-b.i)){if(left--<=0)break;amounts[i]++}return dates.map((date,i)=>({date,target:amounts[i]/100}));
}

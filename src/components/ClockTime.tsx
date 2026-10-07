// page-designer-instrumented
import { PageOption } from "./PageDesign"
import { ScreenText } from "./ScreenText"
import { useEffect, useState } from 'react'
export function ClockTime({value,onChange,required=false,label}:{value:string;onChange:(value:string)=>void;required?:boolean;label:string}) {
  const [hour,setHour]=useState(''), [minute,setMinute]=useState(''), [period,setPeriod]=useState('')
  useEffect(()=>{
    if(!value){setHour('');setMinute('');setPeriod('');return}
    const [h,m]=value.split(':');const n=Number(h)
    setHour(String(n%12||12));setMinute(m);setPeriod(n>=12?'PM':'AM')
  },[value])
  function change(h:string,m:string,p:string){
    setHour(h);setMinute(m);setPeriod(p)
    if(h&&m&&p)onChange(`${String(Number(h)%12+(p==='PM'?12:0)).padStart(2,'0')}:${m}`)
    else if(value)onChange('')
  }
  return <span style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6}}>
    <select aria-label={`${label} hour`} required={required} value={hour} onChange={e=>change(e.target.value,minute,period)}><PageOption designId="copy.ba297e22eca08a54.1" value=""><ScreenText plain id="ClockTime.aef8a933c436ca7c">Hour</ScreenText></PageOption>{Array.from({length:12},(_,i)=>i+1).map(h=><option key={h} value={h}>{h}</option>)}</select>
    <select aria-label={`${label} minute`} required={required} value={minute} onChange={e=>change(hour,e.target.value,period)}><PageOption designId="copy.133bc51d4cdab2d2.1" value=""><ScreenText plain id="ClockTime.7de1f7835e9061b2">Min</ScreenText></PageOption>{Array.from({length:60},(_,i)=>String(i).padStart(2,'0')).map(m=><option key={m} value={m}>{m}</option>)}</select>
    <select aria-label={`${label} AM or PM`} required={required} value={period} onChange={e=>change(hour,minute,e.target.value)}><PageOption designId="copy.df0a26f3196e4fc4.1" value=""><ScreenText plain id="ClockTime.b242dbd86b8b96d2">AM/PM</ScreenText></PageOption><PageOption designId="copy.2dcbceb30b72dc86.1"><ScreenText plain id="ClockTime.1b8543599b2c4399">AM</ScreenText></PageOption><PageOption designId="copy.99615e56cb047ec7.1"><ScreenText plain id="ClockTime.5d300ece854f58cc">PM</ScreenText></PageOption></select>
  </span>
}

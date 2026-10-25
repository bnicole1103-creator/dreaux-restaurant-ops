import {useState} from 'react'
import {menuPlanScripts,type ScriptMoment,type ScriptTone} from '../lib/menuPlanScripts'
import type {PricedChoice,SalesMenuItem} from '../lib/menuCatalog'
export function MenuPlanScripts({choices,items}:{choices:PricedChoice[];items:SalesMenuItem[]}){
 const [moment,setMoment]=useState<ScriptMoment>('best'),[tone,setTone]=useState<ScriptTone>('warm'),[scripts,setScripts]=useState<ReturnType<typeof menuPlanScripts>>([]),[status,setStatus]=useState('')
 const generate=()=>{setScripts(menuPlanScripts(choices,items,moment,tone));setStatus('Scripts ready. Edit them to sound like you.')}
 const copy=async(text:string)=>{try{await navigator.clipboard.writeText(text);setStatus('Copied.')}catch{setStatus('Copy unavailable here. Select the script text to copy it.')}}
 return <details className="profile-plan-scripts"><summary>Recommendation scripts for my plan</summary>
 <p>Turn your selected items into guest-friendly recommendations.</p>
 <div className="profile-target-inputs"><label>When to use it<select aria-label="Script occasion" value={moment} onChange={e=>{setMoment(e.target.value as ScriptMoment);setScripts([]);setStatus('')}}><option value="best">Best fit for each item</option><option value="intro">Introduce an item</option><option value="addon">Suggest an add-on</option><option value="dessert">Offer dessert</option></select></label>
 <label>Style<select aria-label="Script style" value={tone} onChange={e=>{setTone(e.target.value as ScriptTone);setScripts([]);setStatus('')}}><option value="warm">Warm and descriptive</option><option value="brief">Quick and conversational</option></select></label></div>
 <button type="button" onClick={generate}>{scripts.length?'Regenerate scripts':'Generate scripts for my plan'}</button>
 {scripts.map((s,index)=><div key={s.key}><label>{s.label} · {s.name}<textarea aria-label={'Recommendation script '+(index+1)} rows={5} style={{width:'100%',boxSizing:'border-box',font:'inherit',resize:'vertical'}} value={s.text} onChange={e=>{setScripts(old=>old.map((row,i)=>i===index?{...row,text:e.target.value}:row));setStatus('')}}/></label><button type="button" onClick={()=>void copy(s.text)}>Copy script {index+1}</button></div>)}
 {scripts.length>1&&<button type="button" onClick={()=>void copy(scripts.map(s=>s.name+'\n'+s.text).join('\n\n'))}>Copy all scripts</button>}
 <p role="status">{status}</p>
 <small>Drafts use selected item names and saved descriptions. Check service hours, availability and ingredients with the kitchen when needed. Match your recommendation to the guest. Edits here are temporary; regenerating replaces them.</small>
 </details>
}

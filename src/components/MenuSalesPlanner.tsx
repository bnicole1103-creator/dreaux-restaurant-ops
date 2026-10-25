import {useState} from 'react'
import {menuServices,pricedMenuChoices,type SalesMenuItem,type MenuService} from '../lib/menuCatalog'
import {salesMoney} from '../lib/salesTargets'
type Row={id:number;key:string;quantity:string}
export function MenuSalesPlanner({items,service:initialService,remaining}:{items:SalesMenuItem[];service:MenuService;remaining:number}){
 const [service,setService]=useState(initialService),[rows,setRows]=useState<Row[]>([]),[next,setNext]=useState(1)
 const choices=pricedMenuChoices(items,service),remainingCents=Math.max(0,Math.round(remaining*100))
 const selected=rows.map(row=>{const item=choices.find(c=>c.key===row.key),quantity=Number(row.quantity),valid=!!item&&row.quantity.trim()!==''&&Number.isSafeInteger(quantity)&&quantity>=item.price.minimum&&quantity<=10000;return {row,item,quantity,valid,cents:valid?quantity*item!.price.cents!:0}})
 const total=selected.reduce((sum,r)=>sum+r.cents,0),valid=selected.every(r=>r.valid),covered=Math.min(total,remainingCents),left=Math.max(0,remainingCents-total),extra=Math.max(0,total-remainingCents)
 const suggested=choices.find(c=>/cheesecake/i.test(c.name))??choices.find(c=>/dessert/i.test(c.category))??choices[0]
 const suggestedCount=suggested?Math.max(5,suggested.price.minimum):0
 const add=(key=choices[0]?.key??'',quantity=String(choices[0]?.price.minimum??1))=>{setRows(old=>[...old,{id:next,key,quantity}]);setNext(v=>v+1)}
 const update=(id:number,patch:Partial<Row>)=>setRows(old=>old.map(r=>r.id===id?{...r,...patch}:r))
 return <div className="profile-menu-examples" aria-label="Extra sales planner">
 <strong>Plan a few extra sales</strong>
 <label>Use prices from<select aria-label="Use prices from" value={service} onChange={e=>{setService(e.target.value as MenuService);setRows([])}}>{Object.entries(menuServices).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
 {!choices.length?<p>No priced, available items in this menu.</p>:<>
 {suggested&&<div><p>Selling {suggestedCount} additional {suggested.name} at {salesMoney(suggested.price.cents!/100)} each adds <b>{salesMoney(suggestedCount*suggested.price.cents!/100)}</b> — covering {salesMoney(Math.min(remainingCents,suggestedCount*suggested.price.cents!)/100)} of your remaining goal.</p><button type="button" onClick={()=>add(suggested.key,String(suggestedCount))}>Add suggestion to my plan</button></div>}
 <p>Choose other menu items and quantities to build your own mix.</p>
 {selected.map(({row,item,valid,cents})=><div key={row.id}>
 <div className="profile-target-inputs"><label>Menu item<select aria-label={'Menu item '+row.id} value={row.key} onChange={e=>{const choice=choices.find(c=>c.key===e.target.value);update(row.id,{key:e.target.value,quantity:String(choice?.price.minimum??1)})}}>{choices.map(c=><option key={c.key} value={c.key}>{c.name} · {c.price.label} · {salesMoney(c.price.cents!/100)}</option>)}</select></label>
 <label>Additional quantity<input aria-label={'Additional quantity '+row.id} type="number" min={item?.price.minimum??1} max="10000" step="1" value={row.quantity} onChange={e=>update(row.id,{quantity:e.target.value})}/></label></div>
 {valid?<p>{row.quantity} × {salesMoney(item!.price.cents!/100)} = <b>{salesMoney(cents/100)}</b> added sales</p>:<p role="alert">Enter a whole quantity from {item?.price.minimum??1} to 10,000.</p>}
 <button type="button" onClick={()=>setRows(old=>old.filter(r=>r.id!==row.id))}>Remove item {row.id}</button>
 </div>)}
 <button type="button" onClick={()=>add()}>Add another menu item</button>
 {rows.length>0&&<div aria-live="polite">{valid?<><p>Planned extra sales: <b>{salesMoney(total/100)}</b></p><p>Covers <b>{salesMoney(covered/100)}</b>{remainingCents>0?' ('+(covered/remainingCents*100).toFixed(1)+'%)':''} of your remaining goal.</p><p>Still left after this plan: <b>{salesMoney(left/100)}</b></p>{extra>0&&<p>{salesMoney(extra/100)} above your goal if you sell this mix.</p>}</>:<p>Complete each quantity to calculate your plan.</p>}<button type="button" onClick={()=>setRows([])}>Clear my plan</button></div>}
 </>}
 <small>Planned sales are estimates and are not recorded as actual sales. Prices exclude tax, tips, discounts and comps. Catering quantities represent pans or trays. Changing the price menu clears this plan.</small>
 </div>
}

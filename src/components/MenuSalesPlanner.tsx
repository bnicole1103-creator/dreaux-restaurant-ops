import {MenuPlanScripts} from './MenuPlanScripts'
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
 return <div className="profile-menu-examples profile-menu-quick" aria-label="Extra sales planner">
 <label>Price menu<select aria-label="Use prices from" value={service} onChange={e=>{setService(e.target.value as MenuService);setRows([])}}>{Object.entries(menuServices).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
 {!choices.length?<p>No priced, available items in this menu.</p>:<>
 {rows.length>0&&<div className="profile-plan-total" aria-live="polite">{valid?<><div><span>Planned sales</span><strong>{salesMoney(total/100)}</strong></div><div><span>Left after plan</span><strong>{salesMoney(left/100)}</strong></div><p>Covers {salesMoney(covered/100)}{remainingCents>0?' · '+(covered/remainingCents*100).toFixed(1)+'% of remaining goal':''}{extra>0?' · '+salesMoney(extra/100)+' above goal':''}</p></>:<p>Complete each quantity to calculate your plan.</p>}</div>}
 {suggested&&<button className="profile-plan-suggestion" type="button" onClick={()=>add(suggested.key,String(suggestedCount))}>Quick add: {suggestedCount} {suggested.name} · +{salesMoney(suggestedCount*suggested.price.cents!/100)}</button>}
 {selected.map(({row,item,quantity,valid,cents})=><div className="profile-plan-row" key={row.id}>
 <label>Menu item<select aria-label={'Menu item '+row.id} value={row.key} onChange={e=>{const choice=choices.find(c=>c.key===e.target.value);update(row.id,{key:e.target.value,quantity:String(choice?.price.minimum??1)})}}>{choices.map(c=><option key={c.key} value={c.key}>{c.name} · {c.price.label} · {salesMoney(c.price.cents!/100)}</option>)}</select></label>
 <div className="profile-plan-row-bottom"><label>Quantity<div className="profile-plan-stepper"><button type="button" aria-label={'Decrease quantity '+row.id} disabled={!valid||quantity<=(item?.price.minimum??1)} onClick={()=>update(row.id,{quantity:String(quantity-1)})}>−</button><input aria-label={'Additional quantity '+row.id} type="number" inputMode="numeric" min={item?.price.minimum??1} max="10000" step="1" value={row.quantity} onChange={e=>update(row.id,{quantity:e.target.value})}/><button type="button" aria-label={'Increase quantity '+row.id} disabled={!valid||quantity>=10000} onClick={()=>update(row.id,{quantity:String(quantity+1)})}>+</button></div></label><div className="profile-plan-line-total">{valid?<><small>{salesMoney(item!.price.cents!/100)} each</small><strong>{salesMoney(cents/100)}</strong></>:<span>Check quantity</span>}</div><button type="button" aria-label={'Remove item '+row.id} onClick={()=>setRows(old=>old.filter(r=>r.id!==row.id))}>Remove</button></div>
 {!valid&&<p role="alert">{!item?'This item is no longer available at the selected prices. Choose another item.':'Enter a whole quantity from '+(item.price.minimum??1)+' to 10,000.'}</p>}
 </div>)}
 <div className="profile-plan-actions"><button type="button" onClick={()=>add()}>+ Add menu item</button>{rows.length>0&&<button type="button" onClick={()=>setRows([])}>Clear plan</button>}</div>
 {rows.length>0&&valid&&<MenuPlanScripts key={JSON.stringify({service,selected:selected.map(r=>[r.item?.key,r.quantity]),items})} choices={selected.flatMap(r=>r.item?[r.item]:[])} items={items}/>}
 </>}
 <details className="profile-plan-notes"><summary>Planning notes</summary><p>Planned sales are estimates, not recorded actual sales. Prices exclude tax, tips, discounts and comps. Catering quantities represent pans or trays. Changing the price menu clears this plan. Plans and scripts are temporary; leaving or changing the employee goal resets the item mix.</p></details>
 </div>
}

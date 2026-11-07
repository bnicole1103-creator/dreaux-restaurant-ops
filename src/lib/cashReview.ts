export function recordedMoney(value:unknown):number|null{
 if(value==null||typeof value==='boolean'||typeof value==='string'&&!value.trim())return null
 const n=typeof value==='number'?value:typeof value==='string'?Number(value):NaN
 return Number.isFinite(n)&&Number.isSafeInteger(Math.round(n*100))?Math.round(n*100)/100:null
}
export function cashReview(final:unknown,staffValue:unknown){
 const staff=recordedMoney(staffValue),deposit=recordedMoney((final as {final_cash_deposit?:unknown}|null)?.final_cash_deposit)
 if(final==null)return {state:'missing_final' as const,staff,deposit:null,difference:null}
 if(staff==null||deposit==null)return {state:'incomplete' as const,staff,deposit,difference:null}
 const difference=(Math.round(deposit*100)-Math.round(staff*100))/100
 return {state:difference===0?'matched' as const:'difference' as const,staff,deposit,difference}
}

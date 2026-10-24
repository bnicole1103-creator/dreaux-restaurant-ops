export type CashDay={staff_total:number;staff_count:number;missing_cash:number;roster_confirmed:boolean|null;missing_required_closeouts:number|null;manager_closeouts:{shift_id:string;shift_name:string;submitted_by_name?:string;cash_deposit:number|null;submitted_at:string}[];staff:{id:string;user_id:string;name:string;cash_deposit:number|null}[]}
export function compareCash(data:CashDay,shift:string){
 const closing=data.manager_closeouts.find(r=>r.shift_id===shift)
 if(!closing||closing.cash_deposit==null||!Number.isFinite(Number(closing.cash_deposit)))return {status:'Choose a closing manager closeout with a recorded deposit',difference:null,complete:false}
 const difference=(Math.round(Number(closing.cash_deposit)*100)-Math.round(Number(data.staff_total)*100))/100
 const complete=data.roster_confirmed===true&&data.missing_required_closeouts===0&&data.missing_cash===0
 return {difference,complete,status:difference!==0?'Cash difference needs review':complete?'Cash reconciles':'Amounts match · closeout completeness not verified'}
}

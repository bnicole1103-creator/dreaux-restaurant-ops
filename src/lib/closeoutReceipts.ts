export const voidReasons = {customer_changed_mind:'Customer changed mind',server_error:'Server error','86ed_item':'86ed item',testing_training:'Testing or training'}
export const compReasons = {guest_recovery:'Guest recovery',server_error:'Server error',kitchen_error:'Kitchen error',employee_discount:'Employee discount',spill_waste_server_error:'Spill/waste — server error',spill_waste_kitchen_error:'Spill/waste — kitchen error'}
export type CloseoutReceipt = {verified_by?:string|null;verifier_name?:string|null;details_saved_at?:string|null;added_at?:string|null;added_by?:string|null;legacy_linked?:boolean|null;has_file?:boolean;origin_bucket?:string;source_purchase_id?:string|null;id:string;user_id:string;business_date:string;closeout_key:string|null;shift_id:string|null;kind:'void'|'comp'|'discount';reason:string|null;amount:number|null;check_number:string;notes:string;file_path:string;file_mime:string;ready:boolean;version:number;employee:string;submitted:boolean;can_edit:boolean;points:number;closeout_deleted:boolean}
export function receiptReason(reason:string|null){return ({...voidReasons,...compReasons} as Record<string,string>)[reason??'']??'Reason needed'}
export function summarizeCloseoutReceipts(rows:CloseoutReceipt[]){const ready=rows.filter(r=>r.ready&&!r.closeout_deleted),voids=ready.filter(r=>r.kind==='void'),comps=ready.filter(r=>r.kind!=='void');return {voidCount:voids.length,voidTotal:voids.reduce((n,r)=>n+Math.round(Number(r.amount)*100),0)/100,compTotal:comps.reduce((n,r)=>n+Math.round(Number(r.amount)*100),0)/100,errors:ready.filter(r=>r.reason==='server_error'||r.reason==='spill_waste_server_error').length,posted:ready.reduce((n,r)=>n+r.points,0),incomplete:rows.filter(r=>!r.ready).length}}
export function closeoutReceiptCsv(rows:CloseoutReceipt[]){const cell=(v:unknown)=>{let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'};return '\ufeff'+[['Receipt ID','Date','Employee','Type','Reason','Amount','Check number','Closeout ID','Status','Posted points','Verified by','Added to closeout at','Notes'],...rows.map(r=>[r.id,r.business_date,r.employee,r.kind,receiptReason(r.reason),r.amount,r.check_number,r.closeout_key,receiptSubmissionLabel(r),r.points,r.verifier_name??'Not recorded',r.added_at??'',r.notes])].map(r=>r.map(cell).join(',')).join('\r\n')}

export function receiptDraftState(amount:string,reason:string){
 const value=amount.trim()===''?null:Number(amount)
 if(value!==null&&(!Number.isFinite(value)||value<=0))throw Error('Enter a positive amount or leave it blank to finish later.')
 return {amount:value,ready:value!==null&&reason.trim()!==''}
}

export function receiptIsAdded(row:CloseoutReceipt){return !!(row.added_at||row.legacy_linked)}
export function receiptSubmissionLabel(row:CloseoutReceipt){return row.closeout_deleted?'Closeout deleted':receiptIsAdded(row)?(row.submitted?'Submitted closeout':'Added to draft closeout'):'Unsubmitted'}

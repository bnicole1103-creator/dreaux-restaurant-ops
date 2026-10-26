import type {Answers,Config} from '../components/CloseoutConfig'
import type {CloseoutReceipt} from './closeoutReceipts'
import {summarizeCloseoutReceipts} from './closeoutReceipts'
import {closeoutHours} from './closeoutHours'
import {closeoutStockItems} from './stockItems'
export type QuickShift={key:string;start:string;end:string;role:string}
export function centralTime(value:string){if(!value||!Number.isFinite(Date.parse(value)))return '';return new Intl.DateTimeFormat('en-GB',{timeZone:'America/Chicago',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value))}
export function roleFromSchedule(raw:string){const key=raw.trim().toLowerCase().replace(/[ _-]+/g,' ');return ({server:'server',host:'host',busser:'busser','main bartender':'main_bartender','main bar bartender':'main_bartender','back bartender 1':'back_bartender_1','back bar service bartender':'back_bar_service_bartender',manager:'manager','assistant manager':'assistant_manager','general manager':'general_manager'} as Record<string,string>)[key]??null}
type Input={config:Config|null;configError:string;shown:(id:string)=>boolean;scheduledTime:string;clockInTime:string;clockOutTime:string;shiftType:string;jobRole:string;netSales:string;cashDeposit:string;voidCount:string;voidValue:string;discountValue:string;moneyTurnedInTo:string;certified:boolean;zeroSalesConfirmed:boolean;zeroSalesReason:string;hasStockItems:string;stockItems:string;registerCash:string;registerImbalanceReason:string;registerVerifiedBy:string;answers:Answers;receiptPending:number|null;receiptKey:string;receiptRows:CloseoutReceipt[];targetLoading:boolean;ownerId:string;peerVoteEmployeeId:string;ready:boolean}
export function quickCloseoutIssues(i:Input){
 const out:{field:string;message:string}[]=[],add=(field:string,message:string)=>out.push({field,message})
 const valid=(s:string)=>/^\d+(\.\d{1,2})?$/.test(s.trim())&&Number.isFinite(Number(s))&&Number(s)<=100000000
 const clock=(s:string)=>/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(s)
 if(!i.ready||!i.ownerId)add('submit','Your closeout is still loading. Wait or reload before submitting.')
 if(!i.config||i.configError)add('questions','Closeout settings are unavailable. Reload before submitting.')
 if(i.shown('staff_0')&&!clock(i.scheduledTime))add('shift','Enter a valid scheduled start.')
 if(i.shown('staff_1')&&!clock(i.clockInTime))add('shift','Enter your actual clock-in time.')
 if(i.shown('staff_1')&&closeoutHours(i.clockInTime,i.clockOutTime)===null)add('shift','Enter actual clock-in and clock-out times for a shift up to 18 hours.')
 if(i.shown('staff_2')&&!['AM','PM','TO_VOLUME'].includes(i.shiftType))add('shift','Choose the shift you worked.')
 for(const [id,label,value] of [['staff_3','net sales',i.netSales],['staff_5','cash deposit',i.cashDeposit],['staff_6','POS void total',i.voidValue],['staff_7','POS comps / discounts',i.discountValue]])if(i.shown(id)&&!valid(value))add(id==='staff_6'||id==='staff_7'?'receipts':'totals','Enter '+label+' as a valid amount. Enter 0 only when accurate.')
 if(i.shown('staff_14')&&Number(i.cashDeposit)>0&&!i.moneyTurnedInTo)add('totals','Choose who received your cash deposit.')
 if(i.shown('staff_3')&&i.netSales.trim()!==''&&Number(i.netSales)===0&&(!i.zeroSalesConfirmed||i.zeroSalesReason.trim().length<3))add('totals','Confirm $0 sales and explain why.')
 if(i.receiptPending===null||!i.receiptKey)add('receipts','Receipt status is unverified. Refresh receipts before submitting.')
 else if(i.receiptPending>0)add('receipts','Finish the attached receipts, or keep them in your wallet for later.')
 const t=summarizeCloseoutReceipts(i.receiptRows)
 if(i.receiptRows.some(r=>r.closeout_key!==i.receiptKey||!r.ready||r.business_date===''||!Number.isFinite(Number(r.amount))||Number(r.amount)<=0||!r.reason||!r.verifier_name?.trim()||r.has_file===false))add('receipts','An attached receipt has incomplete details or a missing photo.')
 if(i.receiptPending===0&&((i.shown('staff_6')&&valid(i.voidValue)&&Math.round(Number(i.voidValue)*100)!==Math.round(t.voidTotal*100))||(i.shown('staff_7')&&valid(i.discountValue)&&Math.round(Number(i.discountValue)*100)!==Math.round(t.compTotal*100))))add('receipts','Attached receipts must match your POS void and comp totals.')
 if(i.targetLoading)add('shift','Your automatic target is still loading.')
 try{closeoutStockItems(i.hasStockItems,i.stockItems)}catch(e){add('report',(e as Error).message)}
 if(i.jobRole==='main_bartender'&&i.shown('staff_8')){
   if(!valid(i.registerCash))add('register','Enter cash left in the register.')
   else if(Number(i.registerCash)!==200){if(i.shown('staff_9')&&i.registerImbalanceReason.trim().length<3)add('register','Explain the register difference.');if(i.shown('staff_10')&&!i.registerVerifiedBy)add('register','Choose who verified the register difference.')}
 }
 for(const q of i.config?.questions.filter(q=>q.active&&!q.builtin&&q.audience==='staff')??[]){const a=i.answers[q.id]??'';if(q.required&&!a.trim())add('questions','Answer required: '+q.label);else if(a.length>2000||(a&&q.type==='number'&&!/^-?\d+(\.\d+)?$/.test(a)))add('questions','Check your answer: '+q.label)}
 if(i.peerVoteEmployeeId===i.ownerId&&i.peerVoteEmployeeId)add('report','Choose a teammate other than yourself.')
 if(!i.certified)add('submit','Confirm the closeout information is accurate.')
 return out
}

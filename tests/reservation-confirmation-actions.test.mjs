import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
async function moduleAt(path,replace=source=>source){
 const source=replace(readFileSync(path,'utf8'))
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText
 return import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'))
}
const {guestConfirmationLabel,confirmationInvitation}=await moduleAt('src/lib/reservationConfirmation.ts')
assert.equal(guestConfirmationLabel(null),'Not confirmed')
assert.equal(guestConfirmationLabel({valid:true,booking_confirmed:false}),'Not confirmed')
assert.equal(guestConfirmationLabel({valid:true,booking_confirmed:true}),'Confirmed')
assert.equal(guestConfirmationLabel({valid:false,booking_confirmed:true}),'Not confirmed','stale reservation snapshot cannot confirm an edited booking')
assert.equal(guestConfirmationLabel({valid:true,responded_at:'2026-11-18'}),'Not confirmed','opt-in response alone is not booking confirmation')
const invitation=confirmationInvitation('https://example.test/confirmation#token=abc')
assert.ok(invitation.includes('https://example.test/confirmation#token=abc'))
assert.ok(invitation.includes('Messaging is optional'))
const {normalizeInquiryStatus}=await moduleAt('src/lib/inquiryDisplay.ts')
const {bookedInquiryRows,inquiryNeedsAction,inquiryQueue}=await moduleAt('src/lib/inquiryQueue.ts',s=>s.replace("import {normalizeInquiryStatus} from './inquiryDisplay'",normalizeInquiryStatus.toString()))
const row=(id,source,status='New')=>({id,source,status,name:'Guest',email:'',phone:'',notes:'',date:'2026-11-19',received:'2026-11-18T15:00:00Z'})
const original=[row('same','Host'),row('same','Guest form'),row('closed','Host','Closed')]
const reconciled=bookedInquiryRows(original,{'Host:same':'reservation-uuid'})
assert.equal(original[0].status,'New','do not mutate original source records')
assert.equal(reconciled[0].status,'Booked')
assert.equal(reconciled[1].status,'New','links are scoped to source as well as inquiry ID')
assert.equal(inquiryNeedsAction(reconciled[0]),false)
assert.equal(inquiryQueue(reconciled,'All','','open','all','2026-11-18').length,1)
assert.equal(inquiryQueue(reconciled,'All','','all','all','2026-11-18').length,3,'history is retained')
assert.equal(inquiryQueue(reconciled,'All','','Booked','all','2026-11-18')[0].id,'same')
console.log('Confirmation states, invitation, and converted inquiry queue checks passed.')

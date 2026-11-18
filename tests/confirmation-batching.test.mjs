import assert from 'node:assert/strict'
import ts from 'typescript'
import {readFileSync} from 'node:fs'
const calls=[];let deny=false,legacy=false,active=0,peak=0
const fake={rpc:(name,args)=>{calls.push({name,args});return {abortSignal:()=>new Promise(resolve=>{active++;peak=Math.max(peak,active);setTimeout(()=>{active--;resolve(deny?{error:{code:'42501',message:'Denied'}}:legacy&&name==='reservation_confirmation_summaries'?{error:{code:'PGRST202'}}:name==='reservation_confirmation_summaries'?{data:Object.fromEntries(args.p_ids.map(id=>[id,{valid:true,booking_confirmed:false}]))}:{data:null})},1)})}}}
globalThis.testConfirmationClient=fake
let src=readFileSync('src/lib/confirmationSummary.ts','utf8').replace("import {supabase} from './supabase'","const supabase=globalThis.testConfirmationClient")
const js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {readConfirmation}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'))
const first=readConfirmation('location','id-1');assert.equal(first,readConfirmation('location','id-1'),'simultaneous duplicate shares a promise')
await Promise.all([first,...Array.from({length:49},(_,i)=>readConfirmation('location','id-'+(i+2)))])
assert.equal(calls.length,1,'50 distinct rows use one batch call')
deny=true;calls.length=0;await assert.rejects(()=>readConfirmation('location','denied'),/Denied/)
assert.equal(calls.length,1,'permission denial must never trigger legacy fallback')
deny=false;legacy=true;calls.length=0;peak=0
await Promise.all(Array.from({length:9},(_,i)=>readConfirmation('old','old-'+i)))
assert.equal(calls.filter(c=>c.name==='reservation_guest_link_status').length,9)
assert.ok(peak<=4,'legacy fallback concurrency is bounded')
console.log('50-row batching, duplicate deduplication, access-denial isolation and bounded legacy fallback passed.')

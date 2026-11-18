import assert from 'node:assert/strict'
import ts from 'typescript'
import {readFileSync} from 'node:fs'
const src=readFileSync('supabase/functions/operations-assistant/logic.ts','utf8')
const compiled=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},reportDiagnostics:true})
assert.equal(compiled.diagnostics.filter(x=>x.category===ts.DiagnosticCategory.Error).length,0)
const {factsFrom,parseResult,requestBody}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputText).toString('base64'))
const facts=factsFrom('report',{total:123.45,employee_name:'Private',guest_name:'Private guest',email:'guest@example.test',token:'secret',source:'Unsaved report'})
assert.equal(facts.length,2)
assert.ok(!JSON.stringify(facts).includes('Private'))
assert.ok(JSON.stringify(facts).includes('123.45'))
assert.ok(factsFrom('report',Array.from({length:200},(_,i)=>({n:i}))).length<=100)
const response=value=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]})
const result={summary:'Review the recorded total.',recommendations:[{text:'Check the saved report total.',evidence_ids:['source_1']}],questions:[],reservation:null}
assert.deepEqual(parseResult(response(result),'report',facts,''),result)
assert.throws(()=>parseResult(response({...result,recommendations:[{text:'Unsupported',evidence_ids:['fake']}]}),'report',facts,''),/unsupported/)
assert.throws(()=>parseResult({status:'incomplete'},'report',facts,''),/did not finish/)
const draft={guest_name:'Guest',phone:null,email:null,reservation_date:'2026-11-21',reservation_time:'17:30',party_size:4,notes:null}
assert.equal(parseResult(response({...result,reservation:draft}),'reservation',facts,'Guest wants a table').reservation.party_size,4)
assert.throws(()=>parseResult(response({...result,reservation:{...draft,party_size:-1}}),'reservation',facts,'request'),/party size/)
assert.throws(()=>parseResult(response({...result,reservation:{...draft,reservation_time:'5 PM'}}),'reservation',facts,'request'),/time proposal/)
assert.throws(()=>parseResult(response({...result,reservation:draft}),'report',facts,''),/Unexpected reservation/)
assert.equal(requestBody('test','report','2026-11-18','',facts).store,false)
console.log('AI source minimization, evidence references, incomplete output, bounded fields and editable reservation proposal checks passed.')

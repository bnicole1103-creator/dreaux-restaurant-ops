import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const source=readFileSync(new URL('../src/lib/reservationSync.ts',import.meta.url),'utf8')
const fn=source.slice(source.indexOf('export function activeReservations'),source.indexOf('export function notifyReservationsChanged'))
const compiled=ts.transpileModule(fn,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText
const {activeReservations}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'))
const rows=['booked','confirmed','arrived','seated','cancelled','canceled','completed','no_show',' SeAtEd ',' CANCELED ',null].map((status,id)=>({id,status}))
assert.deepEqual(activeReservations(rows).map(r=>r.id),[0,1,2,10])
assert.equal(rows.length,11,'history records are retained')
const sql=readFileSync(new URL('../supabase/migrations/20261113_active_reservation_lists.sql',import.meta.url),'utf8')
assert.ok(sql.indexOf('coalesce(p_include_history,false)')<sql.indexOf('LIMIT 51 OFFSET'),'active filtering happens before pagination')
assert.match(sql,/public.closeout_is_member\(p_location\)/)
assert.match(sql,/public.app_access_allowed\(p_location,'floor','reservations'\)/)
console.log('Active reservation visibility and query guard checks passed.')

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db=new PGlite()
try {
 await db.exec(`
  create role anon; create role authenticated; create schema auth;
  create function auth.uid() returns uuid language sql as $$select gen_random_uuid()$$;
  create table public.test_permissions(person uuid, day date, apply boolean, reason text, active boolean);
  create function public.operations_closeout_access(uuid) returns jsonb language sql as $$
    select jsonb_build_object('manager',current_setting('test.manager',true)='on',
      'staff',jsonb_build_array(jsonb_build_object('id','11111111-1111-1111-1111-111111111111'),
                                jsonb_build_object('id','22222222-2222-2222-2222-222222222222')))
  $$;
  create function public.operations_closeout_permission(uuid,uuid,date,boolean,text,boolean)
  returns void language sql as $$insert into public.test_permissions values ($2,$3,$4,$5,$6)$$;
 `)
 await db.exec(readFileSync('supabase/migrations/20261111_date_wide_late_closeouts.sql','utf8'))
 const location='77777777-7777-7777-7777-777777777777'
 const apply=(reason,active)=>db.query("select public.operations_closeout_date_permission($1,date '2025-01-01',false,$2,$3) as outcome",[location,reason,active])
 await assert.rejects(()=>apply('Approved late submission',true),/Management closeout access/)
 await db.exec("SET test.manager='on'")
 await assert.rejects(()=>apply('',true),/approval reason/)
 const approved=(await apply('Approved late submission',true)).rows[0].outcome
 assert.equal(approved.staff_permissions_updated,2)
 assert.equal(approved.active,true)
 assert.equal((await apply('Close the approval window',false)).rows[0].outcome.active,false)
 const {rows}=await db.query('select count(*)::int as count from public.test_permissions where apply=false')
 assert.equal(rows[0].count,4)
} finally {
 await db.close()
}
console.log('Past-date approval, revocation, staff coverage and reason checks passed.')

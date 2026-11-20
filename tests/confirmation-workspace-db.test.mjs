import {PGlite} from '@electric-sql/pglite'
import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
try{
const db=new PGlite()
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('test.user',true),'')::uuid$$;
CREATE FUNCTION public.closeout_is_member(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT auth.uid() IS NOT NULL AND $1='11111111-1111-1111-1111-111111111111'::uuid$$;
CREATE FUNCTION public.app_access_allowed(uuid,text,text) RETURNS boolean LANGUAGE sql AS $$SELECT current_setting('test.deny',true) IS DISTINCT FROM 'yes'$$;
CREATE FUNCTION public.app_access_assert(uuid,text,text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF public.app_access_allowed($1,$2,$3) IS NOT TRUE THEN RAISE EXCEPTION 'Denied' USING errcode='42501';END IF;END$$;
CREATE FUNCTION public.mod_is_manager(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT current_setting('test.manager',true)='yes'$$;
CREATE TABLE public.reservations(id uuid PRIMARY KEY,location_id uuid,guest_name text,party_size integer,reservation_date date,reservation_time time,phone text,email text,status text,deleted_at timestamptz,dining_area text);
CREATE SCHEMA reservation_consent_private;
CREATE TABLE reservation_consent_private.settings(support_email text);
CREATE TABLE reservation_consent_private.links(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),token_hash text,reservation_id uuid,snapshot text,created_by uuid,created_at timestamptz DEFAULT clock_timestamp(),expires_at timestamptz,revoked_at timestamptz,responded_at timestamptz,booking_confirmed boolean DEFAULT false,consent_version text);
CREATE TABLE reservation_consent_private.house_acceptances(link_id uuid PRIMARY KEY,booking_snapshot text);
CREATE TABLE reservation_consent_private.house_policy_current(location_id uuid,policy_id uuid);
CREATE TABLE reservation_consent_private.link_house_policy(link_id uuid,policy_id uuid);
CREATE FUNCTION reservation_consent_private.house_snapshot(jsonb) RETURNS text LANGUAGE sql AS $$SELECT md5(($1->>'guest_name')||($1->>'party_size'))$$;
CREATE FUNCTION public.reservation_consent_snapshot(uuid) RETURNS text LANGUAGE sql AS $$SELECT reservation_consent_private.house_snapshot(to_jsonb(r)) FROM public.reservations r WHERE r.id=$1$$;
SET "test.user"='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
INSERT INTO public.reservations VALUES('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Guest',2,CURRENT_DATE+1,'17:00','5045551234',null,'booked',null,null);
INSERT INTO reservation_consent_private.settings VALUES('support@example.test');
INSERT INTO reservation_consent_private.house_policy_current VALUES('11111111-1111-1111-1111-111111111111',gen_random_uuid());`)
const migration=readFileSync('supabase/migrations/20261118_confirmation_workspace.sql','utf8')
await db.exec(migration);await db.exec(migration)
const loc='11111111-1111-1111-1111-111111111111',id='22222222-2222-2222-2222-222222222222'
const summary=async()=> (await db.query('SELECT public.reservation_confirmation_summaries($1,ARRAY[$2::uuid]) AS value',[loc,id])).rows[0].value[id]
assert.equal((await summary()).confirmation_current,false)
const linkSentMigration=readFileSync('supabase/migrations/20261120_confirmation_link_sent.sql','utf8')
await db.exec(linkSentMigration);await db.exec(linkSentMigration)
const currentSendMigration=readFileSync('supabase/migrations/20261120_record_current_confirmation_send.sql','utf8')
await db.exec(currentSendMigration);await db.exec(currentSendMigration)
const create=async()=>(await db.query('SELECT public.reservation_staff_link_create($1) AS value',[id])).rows[0].value.token
const mark=async(token,location=loc)=>(await db.query('SELECT public.reservation_staff_link_mark_sent($1,$2,$3) AS value',[location,id,token])).rows[0].value
const token=await create()
assert.equal((await summary()).valid,true)
assert.equal((await summary()).link_sent_at,null,'generating a link does not record a send')
await assert.rejects(()=>mark(token,'33333333-3333-3333-3333-333333333333'),/Active reservation access/)
const linkId=(await summary()).link_id
const markCurrent=async idOfLink=>(await db.query('SELECT public.reservation_staff_current_link_mark_sent($1,$2,$3) AS value',[loc,id,idOfLink])).rows[0].value
const recorded=await markCurrent(linkId)
const saved=await mark(token)
assert.deepEqual(recorded,saved)
assert.deepEqual(await mark(token),saved,'mark sent is idempotent')
assert.equal(new Date((await summary()).link_sent_at).getTime(),saved.getTime())
assert.equal((await summary()).confirmation_current,false)
await db.exec(`UPDATE reservation_consent_private.links SET responded_at=now(),booking_confirmed=true,expires_at=now()-interval '1 minute';INSERT INTO reservation_consent_private.house_acceptances SELECT id,public.reservation_consent_snapshot(reservation_id) FROM reservation_consent_private.links;`)
assert.equal((await summary()).valid,false)
assert.equal((await summary()).confirmation_current,true,'expiry does not erase accepted booking evidence')
await db.exec("UPDATE public.reservations SET status='arrived'")
assert.equal((await summary()).confirmation_current,true,'arrival status does not erase guest response')
await db.exec('UPDATE public.reservations SET party_size=5')
assert.equal((await summary()).confirmation_current,false,'changed guest details require reconfirmation')
await assert.rejects(()=>db.query('SELECT public.reservation_confirmation_summaries($1,ARRAY[$2::uuid])',['33333333-3333-3333-3333-333333333333',id]),/Active reservation access/)
await db.exec("SET test.deny='yes'")
await assert.rejects(()=>summary(),/Active reservation access/)
await db.exec("SET test.deny='no';UPDATE public.reservations SET status='booked'")
await db.query('SELECT public.reservation_staff_link_create($1)',[id])
assert.equal((await summary()).link_sent_at,null,'replacement requires a new send')
await assert.rejects(()=>mark(token),/expired or was replaced/)
assert.equal((await db.query('SELECT count(*)::int AS n FROM reservation_consent_private.links WHERE revoked_at IS NULL')).rows[0].n,1,'replacement revokes earlier link atomically')
await db.exec(readFileSync('supabase/migrations/20261118_operations_assistant.sql','utf8'))
await db.exec(readFileSync('supabase/migrations/20261118_operations_assistant.sql','utf8'))
await assert.rejects(()=>db.query('SELECT public.operations_assistant_claim($1,$2)',[loc,'report']),/Management access/)
for(let i=0;i<5;i++)await db.query('SELECT public.operations_assistant_claim($1,$2)',[loc,'reservation'])
await assert.rejects(()=>db.query('SELECT public.operations_assistant_claim($1,$2)',[loc,'reservation']),/limit reached/)
await db.close();console.log('Confirmation evidence, staff access, cross-location denial, replacement, repeatable migrations and AI rate limits passed.')

}catch(error){console.error(error.message);process.exitCode=1}

import {PGlite} from '@electric-sql/pglite'
import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'

const db=new PGlite()
try {
 const loc='11111111-1111-1111-1111-111111111111', id='22222222-2222-2222-2222-222222222222'
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;
 CREATE SCHEMA reservation_consent_private;
 CREATE SCHEMA reservation_flow_private;
 CREATE SCHEMA capacity_private;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('test.user',true),'')::uuid$$;
 CREATE FUNCTION public.closeout_is_member(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT $1='${loc}'::uuid$$;
 CREATE FUNCTION public.app_access_allowed(uuid,text,text) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
 CREATE FUNCTION reservation_flow_private.lock_edits(uuid) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN IF auth.uid() IS NULL OR NOT public.closeout_is_member($1) THEN RAISE EXCEPTION 'Denied';END IF;END$$;
 CREATE TABLE public.reservations(id uuid PRIMARY KEY,location_id uuid,guest_name text,reservation_date date,reservation_time time,party_size integer,phone text,email text,notes text,status text,edit_version integer);
 CREATE TABLE reservation_consent_private.links(id uuid DEFAULT gen_random_uuid(),reservation_id uuid,token_hash text,snapshot text,expires_at timestamptz,revoked_at timestamptz);
 CREATE TABLE public.floor_seating_history_v1(location_id uuid,reservation_id uuid,session_id uuid);
 CREATE TABLE public.table_sessions(id uuid,closed_at timestamptz);
 CREATE TABLE capacity_private.audit(location_id uuid,day date,actor uuid,action text,details jsonb);
 CREATE FUNCTION public.reservation_consent_snapshot(uuid) RETURNS text LANGUAGE sql AS $$SELECT status||':'||guest_name FROM public.reservations WHERE id=$1$$;
 CREATE FUNCTION public.reservation_guest_link_load(text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
 BEGIN IF EXISTS (SELECT 1 FROM reservation_consent_private.links
 WHERE token_hash=encode(sha256(convert_to($1,'UTF8')),'hex') AND snapshot=public.reservation_consent_snapshot(reservation_id))
 THEN RETURN '{"booking_confirmed":false}'::jsonb; END IF;
 RAISE EXCEPTION 'Link unavailable'; END$$;
 INSERT INTO public.reservations VALUES ('${id}','${loc}','Test Booking',CURRENT_DATE+2,'17:00',2,null,null,null,'booked',1);
 INSERT INTO reservation_consent_private.links(reservation_id,token_hash,snapshot,expires_at,revoked_at)
 SELECT '${id}',encode(sha256(convert_to(repeat(key,64),'UTF8')),'hex'),snapshot,expiry,revoked
 FROM (VALUES ('a','booked:Test Booking',now()+interval '1 day',null::timestamptz),
 ('b','booked:Stale Booking',now()+interval '1 day',null),('c','booked:Test Booking',now()-interval '1 day',null),
 ('d','booked:Test Booking',now()+interval '1 day',now())) cases(key,snapshot,expiry,revoked);`)
 const migration=readFileSync('supabase/migrations/20261126_guest_cancel_reservation.sql','utf8')
 await db.exec(migration)
 await db.exec(migration)
 const token='a'.repeat(64)
 const call=async(name,args)=> (await db.query(`SELECT public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) AS result`,args)).rows[0].result
 await db.exec('SET ROLE anon')
 for(const key of ['b','c','d','e']) await assert.rejects(()=>call('reservation_guest_link_cancel',[key.repeat(64)]),/link|canceled/i)
 assert.equal((await call('reservation_guest_link_view',[token])).booking_confirmed,false)
 assert.deepEqual(await call('reservation_guest_link_cancel',[token]),{canceled:true})
 assert.deepEqual(await call('reservation_guest_link_cancel',[token]),{canceled:true})
 assert.deepEqual(await call('reservation_guest_link_view',[token]),{canceled:true})
 await assert.rejects(()=>call('reservation_guest_link_load',[token]),/Link unavailable/)
 await assert.rejects(()=>call('reservation_clear_cancellation',[loc,id,2]),/permission denied/)
 await db.exec(`RESET ROLE;SET "test.user"='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';SET ROLE authenticated`)
 const search=history=>call('reservation_management_search_v2',[loc,null,'',0,history])
 assert.equal((await search(false)).reservations[0].status,'cancelled')
 await assert.rejects(()=>call('reservation_clear_cancellation',[loc,id,1]),/changed/)
 await call('reservation_clear_cancellation',[loc,id,2])
 assert.equal((await search(false)).reservations.length,0)
 assert.equal((await search(true)).reservations[0].status,'cancelled')
 assert.ok((await search(true)).reservations[0].cancellation_cleared_at)
 console.log('Guest token validation, cancellation retries, staff clear, and cancellation history checks passed.')
} finally { await db.close() }

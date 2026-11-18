import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {readFileSync} from 'node:fs'
const db=new PGlite()
const loc='11111111-1111-1111-1111-111111111111'
const user='22222222-2222-2222-2222-222222222222'
const future='33333333-3333-3333-3333-333333333333'
const a='44444444-4444-4444-4444-444444444444'
const b='55555555-5555-5555-5555-555555555555'
const sid='66666666-6666-6666-6666-666666666666'
const shift='77777777-7777-7777-7777-777777777777'
const request='88888888-8888-8888-8888-888888888888'
try {
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE SCHEMA capacity_private;CREATE SCHEMA reservation_flow_private;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${user}'::uuid $$;
 CREATE FUNCTION public.closeout_is_member(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT coalesce(current_setting('test.member',true),'yes')='yes'$$;
 CREATE FUNCTION public.app_access_allowed(uuid,text,text) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
 CREATE FUNCTION public.walkin_can_manage(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
 CREATE TABLE public.reservations(id uuid PRIMARY KEY,location_id uuid,table_id uuid,table_ids uuid[],name text,party integer,starts integer,ending integer);
 CREATE TABLE public.table_sessions(id uuid PRIMARY KEY,table_id uuid);
 CREATE TABLE public.table_session_tables(table_session_id uuid,table_id uuid);
 CREATE TABLE public.floor_tables(id uuid);CREATE TABLE public.rooms(id uuid);
 CREATE TABLE public.shifts(id uuid,location_id uuid,shift_date date,status text);
 CREATE TABLE capacity_private.days(id uuid);
 CREATE TABLE capacity_private.audit(location_id uuid,day date,actor uuid,action text,details jsonb);
 CREATE TABLE capacity_private.lengths(reservation_id uuid PRIMARY KEY,minutes integer);
 CREATE TABLE reservation_flow_private.requests(location_id uuid,request_id uuid,input jsonb,result jsonb,PRIMARY KEY(location_id,request_id));
 INSERT INTO public.reservations VALUES('${future}','${loc}','${a}',ARRAY['${a}'::uuid],'Future party',2,200,290);
 INSERT INTO public.shifts VALUES('${shift}','${loc}','2030-01-01','open');
 CREATE FUNCTION public.reservation_capacity_load(uuid,date) RETURNS jsonb LANGUAGE sql AS $$
 WITH bookings AS (
 SELECT jsonb_build_object('id',id,'name',name,'party',party,'start',starts,'end',ending,'tableIds',to_jsonb(table_ids),'room','','version',0,'live',false) AS row FROM public.reservations WHERE location_id=$1
 UNION ALL SELECT jsonb_build_object('id','live:'||id::text,'name','Seated party','party',2,'start',100,'end',1000,'tableIds',jsonb_build_array(table_id),'room','','version',0,'live',true) FROM public.table_sessions
 ), payload AS (SELECT jsonb_build_object('bookings',coalesce(jsonb_agg(row),'[]'::jsonb)) AS data FROM bookings)
 SELECT data||jsonb_build_object('day',$2,'now',100,'open',100,'close',1000,'configured',true,'fingerprint',md5(data::text),'blocks','[]'::jsonb,'config',jsonb_build_object('duration',90,'buffer',15,'closed',false,'blockedTables','[]'::jsonb,'joinGroups','[]'::jsonb),'tables',jsonb_build_array(jsonb_build_object('id','${a}','seats',4,'room','main','roomName','Main'),jsonb_build_object('id','${b}','seats',4,'room','main','roomName','Main'))) FROM payload $$;
 CREATE FUNCTION public.floor_seat_and_rotate_v1(uuid,uuid,uuid[],uuid,text,text,text,integer,uuid,text,uuid,uuid,integer) RETURNS uuid LANGUAGE plpgsql AS $$BEGIN
 IF current_setting('test.fail',true)='yes' THEN RAISE EXCEPTION 'injected seating failure';END IF;
 INSERT INTO public.table_sessions VALUES('${sid}',$3[1]);RETURN '${sid}';END$$;
 CREATE FUNCTION public.reservation_save_verified(uuid,uuid,jsonb,text,jsonb,integer,text,text) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE answer jsonb;BEGIN
 IF current_setting('test.fail',true)='yes' THEN RAISE EXCEPTION 'injected booking failure';END IF;
 IF current_setting('test.linked',true)<>'yes' OR current_setting('test.linked',true) IS NULL THEN PERFORM public.reservation_capacity_apply($1,($3->>'reservation_date')::date,$4,$5-'candidate',NULL);END IF;
 answer:=jsonb_build_object('reservation_id','new-booking','already_linked',coalesce(current_setting('test.linked',true),'no')='yes');
 INSERT INTO reservation_flow_private.requests VALUES($1,$2,jsonb_build_object('values',$3,'duration',$6,'source',$7,'inquiry',$8),answer);RETURN answer;END$$;
 `)
 const base=readFileSync('supabase/migrations/20261105_reservation_capacity_planner.sql','utf8')
 const apply=base.slice(base.indexOf('CREATE OR REPLACE FUNCTION public.reservation_capacity_apply('),base.indexOf('REVOKE ALL ON FUNCTION public.reservation_capacity_load'))
 await db.exec(apply)
 await db.exec(readFileSync('supabase/migrations/20261118_reservation_replanning.sql','utf8'))
 const fingerprint=async()=> (await db.query(`SELECT public.reservation_capacity_load($1,'2030-01-01')->>'fingerprint' AS fp`,[loc])).rows[0].fp
 const tables=async()=> (await db.query('SELECT table_ids FROM reservations WHERE id=$1',[future])).rows[0].table_ids
 const values={guest_name:'New party',phone:'555',party_size:2,reservation_date:'2030-01-01',reservation_time:'12:00'}
 const plan={[future]:[b],candidate:[a]}
 const book=async(fp,req=request)=>db.query('SELECT public.reservation_save_replanned($1,$2,$3::jsonb,$4,$5::jsonb,90,NULL,NULL) AS result',[loc,req,JSON.stringify(values),fp??await fingerprint(),JSON.stringify(plan)])
 await db.exec(`SET test.fail='yes'`)
 await assert.rejects(book(),/injected booking failure/)
 assert.deepEqual(await tables(),[a],'failed booking rolls back released assignments')
 await db.exec(`SET test.fail='no'`)
 await db.exec(`SET test.linked='yes'`)
 const linked=await book(undefined,'99999999-9999-9999-9999-999999999999')
 assert.deepEqual(linked.rows[0].result.table_changes,[])
 assert.deepEqual(await tables(),[a],'an already-linked inquiry does not move unrelated reservations')
 await db.exec(`SET test.linked='no'`)
 const saved=await book()
 assert.deepEqual(await tables(),[b],'verified replacement assigned')
 assert.equal(saved.rows[0].result.table_changes[0].name,'Future party')
 assert.equal((await book('stale')).rows[0].result.reservation_id,'new-booking','retry returns original saved result')
 await assert.rejects(book('stale','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),/Availability changed/)
 await db.exec(`UPDATE reservations SET table_id='${a}',table_ids=ARRAY['${a}'::uuid];SET test.member='no'`)
 await assert.rejects(book(),/Reservation access required/)
 await db.exec(`SET test.member='yes'`)
 const payload={p_location_id:loc,p_request_id:request,p_shift_id:shift,p_table_ids:[a],p_server_id:user,p_guest_name:'Walk-in',p_guest_phone:'555',p_guest_email:'',p_party_size:2,p_source:'walk_in',p_reservation_id:null,p_walkin_id:null,p_walkin_version:null}
 const seatPlan={[future]:[b],'seating-candidate':[a]}
 const seat=async(assignments=seatPlan,fp)=>db.query('SELECT public.floor_seat_replanned($1::jsonb,$2,$3,$4::jsonb) AS result',[JSON.stringify(payload),'2030-01-01',fp??await fingerprint(),assignments===null?null:JSON.stringify(assignments)])
 await db.exec(`SET test.fail='yes'`)
 await assert.rejects(seat(),/injected seating failure/)
 assert.deepEqual(await tables(),[a],'failed seating rolls back future table releases')
 await db.exec(`SET test.fail='no'`)
 await assert.rejects(seat({[future]:[a],'seating-candidate':[a]}),/Overlapping parties/)
 assert.deepEqual(await tables(),[a],'invalid replacement plan rolls back all table changes')
 assert.equal((await db.query('SELECT count(*)::integer AS n FROM table_sessions')).rows[0].n,0,'invalid plan rolls back seating')
 const seated=await seat()
 assert.equal(seated.rows[0].result.session_id,sid)
 assert.deepEqual(await tables(),[b],'seating automatically moves upcoming reservation')
 assert.equal((await seat(seatPlan,'stale')).rows[0].result.session_id,sid,'retry does not seat again')
 assert.equal((await db.query('SELECT count(*)::integer AS n FROM table_sessions')).rows[0].n,1)
 // No complete plan keeps the reservation and releases only its conflicting tables.
 await db.exec(`TRUNCATE table_sessions,reservation_flow_private.planning_requests;UPDATE reservations SET table_id='${a}',table_ids=ARRAY['${a}'::uuid]`)
 const pending=await seat(null)
 assert.equal(pending.rows[0].result.tables_pending,true)
 assert.deepEqual(await tables(),[])
 assert.equal((await db.query('SELECT count(*)::integer AS n FROM reservations')).rows[0].n,1)
 console.log('Database replanning checks passed: atomic moves, rollback, stale plans, permissions, retries and pending tables.')
} finally {await db.close()}

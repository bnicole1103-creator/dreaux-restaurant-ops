import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'

const db = new PGlite()
const id = n => '00000000-0000-0000-0000-'+String(n).padStart(12,'0')
const [location, booking, oldTable, destination, occupied] = [1,2,3,4,5].map(id)
try {
 const snapshot = {
  open:0, close:600, configured:true, fingerprint:'day',
  config:{closed:false,buffer:15,blockedTables:{},joinGroups:[]},
  tables:[oldTable,destination,occupied].map((table,index)=>({id:table,seats:3,room:index===0?'main':'brut',roomName:index===0?'Main':'Brut Bar'})),
  bookings:[
   {id:booking,start:550,end:640,party:3,room:'Main',tableIds:[oldTable]},
   {id:'live:old',start:530,end:650,tableIds:[oldTable],live:true},
   {id:'live:occupied',start:530,end:650,tableIds:[occupied],live:true},
   {id:'unassigned',start:550,end:650,tableIds:[]},
  ],
 }
 await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated;
  CREATE SCHEMA auth; CREATE SCHEMA capacity_private; CREATE SCHEMA reservation_flow_private;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${id(9)}'::uuid $$;
  CREATE FUNCTION public.closeout_is_member(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT $1='${location}'::uuid $$;
  CREATE FUNCTION public.app_access_allowed(uuid,text,text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
  CREATE FUNCTION public.reservation_capacity_load(uuid,date) RETURNS jsonb LANGUAGE sql AS $$ SELECT '${JSON.stringify(snapshot)}'::jsonb $$;
  CREATE TABLE public.reservations(id uuid,location_id uuid,reservation_date date,status text,edit_version integer,table_ids uuid[],table_id uuid,dining_area text);
  CREATE TABLE public.table_sessions(id uuid);
  CREATE TABLE public.table_session_tables(id uuid);
  CREATE TABLE public.floor_tables(id uuid);
  CREATE TABLE public.rooms(id uuid);
  CREATE TABLE capacity_private.days(id uuid);
  CREATE TABLE capacity_private.audit(location_id uuid,day date,actor uuid,action text,details jsonb);
  INSERT INTO public.reservations VALUES ('${booking}','${location}',(now() AT TIME ZONE 'America/Chicago')::date,'booked',1,ARRAY['${oldTable}'::uuid],'${oldTable}','Main');
 `)
 await db.exec(readFileSync('supabase/migrations/20261128_floor_reservation_table_move.sql','utf8'))
 const move = (table,version=1) => db.query('SELECT public.floor_reservation_move_tables($1,$2,$3,$4)',[location,booking,version,[table]])
 await db.exec('SET ROLE authenticated')
 await assert.rejects(()=>move(occupied),/overlapping reservation or seated party/)
 await move(destination)
 await assert.rejects(()=>move(oldTable),/Reservation changed/)
 await db.exec('RESET ROLE')
 const row = (await db.query('SELECT table_ids,table_id,dining_area,edit_version FROM public.reservations')).rows[0]
 assert.deepEqual(row,{table_ids:[destination],table_id:destination,dining_area:'Brut Bar',edit_version:2})
 await assert.rejects(()=>db.query('SELECT public.reservation_table_map_save($1,$2,2,$3,$4)',[location,booking,'day',[destination]]),/must fit inside service hours/)
 console.log('Floor move replaces old tables, ignores unrelated bookings, and checks the destination.')
} finally {
 await db.close()
}

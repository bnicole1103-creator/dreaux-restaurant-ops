import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const { outputFiles } = await build({
  entryPoints: ['src/lib/inquiryArrivalOptions.ts'], bundle: true, format: 'esm', write: false,
})
const { nextInquiryArrivals } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].contents).toString('base64'))
const minute = hour => Date.parse('2026-11-19T' + hour + ':00-06:00') / 60000
const slots = ['17:00', '17:30', '18:00', '18:30', '19:00'].map(clock => ({ value: minute(clock), label: clock }))
const data = {
  day: '2026-11-19', configured: true, now: minute('16:00'), close: minute('21:00'),
  config: { duration: 60, buffer: 15, joinGroups: [], blockedTables: [] },
  tables: [{ id: 't', seats: 4, room: 'r', roomName: 'Dining room' }],
  bookings: [{ id: 'existing', party: 4, tableIds: ['t'], start: minute('17:00'), end: minute('18:00'), room: '', version: 1 }],
  slots,
}
assert.deepEqual(nextInquiryArrivals(data, {
  guests: 4, details: { time: '5:00 PM', secondTime: '19:00:00' },
}), [minute('18:30')], 'skips conflicts including reset time and excludes the guest’s earlier requests')
assert.deepEqual(nextInquiryArrivals(data, { guests: 6, details: {} }), [])

const db = new PGlite()
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth; CREATE SCHEMA inquiry_booking_private; CREATE SCHEMA capacity_private;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.user',true),'')::uuid $$;
    CREATE FUNCTION public.reservation_staff_confirmation_access(uuid) RETURNS void LANGUAGE plpgsql AS $$
    BEGIN IF auth.uid() IS NULL OR $1 <> '11111111-1111-1111-1111-111111111111'::uuid THEN RAISE EXCEPTION 'Denied'; END IF; END $$;
    CREATE FUNCTION public.app_access_allowed(uuid,text,text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
    CREATE TABLE public.locations(id uuid PRIMARY KEY);
    CREATE TABLE public.reservation_inquiries(id uuid, location_id uuid);
    CREATE TABLE public.reservations(id uuid, location_id uuid, reservation_date date, status text, guest_name text);
    CREATE TABLE public.table_sessions(id uuid, shift_id uuid, closed_at timestamptz);
    CREATE TABLE public.shifts(id uuid, location_id uuid);
    CREATE TABLE public.table_session_tables(table_session_id uuid, table_id uuid);
    CREATE TABLE public.floor_tables(id uuid, location_id uuid);
    CREATE TABLE public.rooms(id uuid, location_id uuid);
    CREATE TABLE capacity_private.lengths(reservation_id uuid, minutes int);
    CREATE TABLE inquiry_booking_private.links(location_id uuid, source text, inquiry_id text);
    CREATE FUNCTION capacity_private.block_config(uuid,date) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"closed":false}'::jsonb $$;
    CREATE FUNCTION capacity_private.block_rows(uuid,timestamptz,timestamptz) RETURNS jsonb LANGUAGE sql AS $$ SELECT '[]'::jsonb $$;
    CREATE FUNCTION public.reservation_capacity_load(uuid,date) RETURNS jsonb LANGUAGE sql AS $$
    SELECT jsonb_build_object('configured',true,'config','{"closed":false}'::jsonb,'fingerprint','current',
      'close',extract(epoch from (($2+time '22:00') AT TIME ZONE 'America/Chicago'))/60,
      'slots',jsonb_build_array(jsonb_build_object('value',extract(epoch from (($2+time '18:00') AT TIME ZONE 'America/Chicago'))/60)))
    $$;
    INSERT INTO public.locations VALUES ('11111111-1111-1111-1111-111111111111');
    SET "test.user"='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  `)
  const migration = readFileSync('supabase/migrations/20261119_guest_arrival_options.sql','utf8')
  await db.exec(migration)
  await db.exec(migration)
  const loc = '11111111-1111-1111-1111-111111111111'
  const one = async (sql, parameters = []) => (await db.query(sql, parameters)).rows[0].value
  const day = "(now() AT TIME ZONE 'America/Chicago')::date+1"
  const create = (id, fingerprint = 'current') => one(`
    SELECT public.inquiry_arrival_offer_create($1,'Guest form',$2,${day},4,
      ARRAY[(extract(epoch from (((${day})+time '18:00') AT TIME ZONE 'America/Chicago'))/60)::bigint],$3) AS value`,
    [loc,id,fingerprint])
  await assert.rejects(() => create('changed','stale'), /Availability changed/)
  const first = await create('guest-1')
  const token = await create('guest-1')
  assert.notEqual(token,first)
  await db.exec('SET ROLE anon')
  const guest = (link, arrival = null) => one('SELECT public.inquiry_arrival_offer_guest($1,$2) AS value',[link,arrival])
  await assert.rejects(() => guest(first), /unavailable/)
  await assert.rejects(() => db.query('SELECT public.inquiry_arrival_offer_selection($1,$2,$3)',[loc,'Guest form','guest-1']), /permission denied/)
  const offer = await guest(token)
  assert.deepEqual(Object.keys(offer).sort(), ['booked','day','options','party','selected'])
  await assert.rejects(() => guest(token, '2000-01-01T00:00:00Z'), /no longer available/)
  assert.equal((await guest(token,offer.options[0])).selected,offer.options[0])
  assert.equal((await guest(token,offer.options[0])).selected,offer.options[0])
  await db.exec('RESET ROLE')
  assert.equal((await one('SELECT public.inquiry_arrival_offer_selection($1,$2,$3) AS value',[loc,'Guest form','guest-1'])).arrival,offer.options[0])
  assert.equal(await one('SELECT count(*)::int AS value FROM public.reservations'),0)
  await assert.rejects(() => create('guest-1'), /already selected/)
  const changed = await create('guest-2')
  const choice = (await guest(changed)).options[0]
  await db.query("INSERT INTO public.reservations VALUES(gen_random_uuid(),$1,"+day+",'booked','Private guest')",[loc])
  assert.deepEqual((await guest(changed)).options,[])
  await assert.rejects(() => guest(changed,choice), /no longer available/)
  console.log('Arrival order, table capacity, link replacement, public data scope, selection and stale availability checks passed.')
} finally {
  await db.close()
}

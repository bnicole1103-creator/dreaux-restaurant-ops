begin;

-- Private source records. Browser roles cannot read or write these tables.
create table if not exists public.mod_closeouts (
  shift_id uuid primary key references public.shifts(id),
  location_id uuid not null references public.locations(id),
  submitted_by uuid not null references auth.users(id),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.mod_staff_reviews (
  shift_id uuid not null references public.mod_closeouts(shift_id),
  user_id uuid not null references auth.users(id),
  rating integer not null check (rating between 1 and 10),
  reason text not null check (length(btrim(reason)) between 1 and 2000),
  primary key (shift_id, user_id)
);
create table if not exists public.mod_closeout_audit (
  id bigint generated always as identity primary key,
  shift_id uuid not null references public.shifts(id),
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now(),
  previous_reviews jsonb not null,
  next_reviews jsonb not null
);
-- No ratings, reasons, or manager identities in the points ledger.
create table if not exists public.mod_rating_points (
  location_id uuid not null references public.locations(id),
  user_id uuid not null references auth.users(id),
  source_key text not null,
  business_date date not null,
  points integer not null,
  primary key (location_id, user_id, source_key)
);
alter table public.mod_closeouts enable row level security;
alter table public.mod_staff_reviews enable row level security;
alter table public.mod_closeout_audit enable row level security;
alter table public.mod_rating_points enable row level security;
revoke all on public.mod_closeouts, public.mod_staff_reviews,
  public.mod_closeout_audit, public.mod_rating_points from public, anon, authenticated;

create or replace function public.mod_is_manager(p_location_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.location_memberships m
    join public.locations l on l.id = m.location_id
    join public.organization_memberships o on o.organization_id = l.organization_id
      and o.user_id = m.user_id and o.status = 'active'
    where m.location_id = p_location_id and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner','general_manager','manager','assistant_manager')
  );
$$;

create or replace function public.mod_week_start(p_date date)
returns date language sql immutable set search_path = '' as $$
  select p_date - ((extract(dow from p_date)::integer + 5) % 7);
$$;

create or replace function public.mod_get_closeout(p_shift_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare loc uuid; result jsonb;
begin
  select location_id into loc from public.shifts where id = p_shift_id;
  if loc is null or not public.mod_is_manager(loc) then
    raise exception 'Manager access required.' using errcode = '42501';
  end if;
  select jsonb_build_object('submitted_by', c.submitted_by, 'updated_at', c.updated_at,
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('user_id', r.user_id,
      'rating', r.rating, 'reason', r.reason)) from public.mod_staff_reviews r
      where r.shift_id = c.shift_id), '[]'::jsonb)) into result
    from public.mod_closeouts c where c.shift_id = p_shift_id;
  return result;
end;
$$;

-- A single atomic operation saves the whole roster and recalculates points.
-- Location lock serializes submissions/edits, including different MODs.
create or replace function public.mod_submit_closeout(
  p_shift_id uuid, p_reviews jsonb, p_roster_confirmed boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.shifts%rowtype; actor uuid := auth.uid(); owner_id uuid;
  old_reviews jsonb; affected uuid[]; employee uuid; week_start date;
  low_date date; high_date date; row_data record; elevated boolean;
begin
  select * into s from public.shifts where id = p_shift_id;
  if s.id is null or not public.mod_is_manager(s.location_id) then
    raise exception 'Manager access required.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mod:' || s.location_id::text, 0));
  if s.status = 'cancelled' or s.shift_date > (now() at time zone 'America/Chicago')::date then
    raise exception 'Select a worked shift, not a future or cancelled shift.';
  end if;
  if p_roster_confirmed is distinct from true or p_reviews is null
    or jsonb_typeof(p_reviews) <> 'array' then
    raise exception 'Confirm the complete staff roster.';
  end if;
  if jsonb_array_length(p_reviews) = 0 or jsonb_array_length(p_reviews) > 200 then
    raise exception 'Select everyone who worked this shift.';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_reviews)
      as r(user_id uuid, rating integer, reason text)
      where r.user_id is null or r.user_id = actor or r.rating is null
        or r.rating not between 1 and 10 or r.reason is null
        or length(btrim(r.reason)) not between 1 and 2000
        or not exists (select 1 from public.location_memberships m
          where m.location_id = s.location_id and m.user_id = r.user_id and m.status = 'active')) then
    raise exception 'Each staff member needs a valid rating and reason. You cannot rate yourself.';
  end if;
  if (select count(*) from jsonb_to_recordset(p_reviews) as r(user_id uuid)) <>
     (select count(distinct user_id) from jsonb_to_recordset(p_reviews) as r(user_id uuid)) then
    raise exception 'Each employee can appear only once per shift.';
  end if;
  select submitted_by into owner_id from public.mod_closeouts where shift_id = s.id;
  select exists (select 1 from public.location_memberships m where m.location_id = s.location_id
    and m.user_id = actor and m.status = 'active' and m.role in ('owner','general_manager')) into elevated;
  if owner_id is not null and owner_id <> actor and not elevated then
    raise exception 'Only the submitting MOD, owner, or GM may edit this closeout.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'rating', rating,
    'reason', reason)), '[]'::jsonb) into old_reviews
    from public.mod_staff_reviews where shift_id = s.id;
  select array_agg(distinct x.user_id) into affected from (
    select user_id from public.mod_staff_reviews where shift_id = s.id
    union select user_id from jsonb_to_recordset(p_reviews) as r(user_id uuid)
  ) x;
  insert into public.mod_closeouts(shift_id, location_id, submitted_by)
    values(s.id, s.location_id, actor)
    on conflict (shift_id) do update set updated_at = now();
  delete from public.mod_staff_reviews where shift_id = s.id;
  insert into public.mod_staff_reviews(shift_id, user_id, rating, reason)
    select s.id, r.user_id, r.rating, btrim(r.reason)
    from jsonb_to_recordset(p_reviews) as r(user_id uuid, rating integer, reason text);
  insert into public.mod_closeout_audit(shift_id, changed_by, previous_reviews, next_reviews)
    values(s.id, actor, old_reviews, p_reviews);
  week_start := public.mod_week_start(s.shift_date);
  foreach employee in array affected loop
    -- Neutralized entries retain their keys, making edits/retries idempotent.
    insert into public.mod_rating_points(location_id, user_id, source_key, business_date, points)
      select s.location_id, employee, 'shift:' || s.id::text, s.shift_date,
        coalesce((select case when rating <= 2 then -25 when rating >= 9 then 25 else 0 end
          from public.mod_staff_reviews where shift_id = s.id and user_id = employee), 0)
      on conflict (location_id, user_id, source_key) do update set points = excluded.points;
    -- Tuesday through Sunday only. Monday gets per-shift points but cannot count
    -- toward the weekly two-rating threshold.
    select sh.shift_date into low_date from public.mod_staff_reviews r
      join public.shifts sh on sh.id = r.shift_id
      where sh.location_id = s.location_id and r.user_id = employee and r.rating between 3 and 4
        and sh.shift_date >= week_start and sh.shift_date < week_start + 6
      order by sh.shift_date, sh.id offset 1 limit 1;
    select sh.shift_date into high_date from public.mod_staff_reviews r
      join public.shifts sh on sh.id = r.shift_id
      where sh.location_id = s.location_id and r.user_id = employee and r.rating = 8
        and sh.shift_date >= week_start and sh.shift_date < week_start + 6
      order by sh.shift_date, sh.id offset 1 limit 1;
    for row_data in select * from (values
      ('week-low:' || week_start::text, coalesce(low_date, week_start), case when low_date is null then 0 else -20 end),
      ('week-high:' || week_start::text, coalesce(high_date, week_start), case when high_date is null then 0 else 20 end)
    ) as v(source_key, business_date, points) loop
      insert into public.mod_rating_points(location_id, user_id, source_key, business_date, points)
        values(s.location_id, employee, row_data.source_key, row_data.business_date, row_data.points)
        on conflict (location_id, user_id, source_key) do update
          set points = excluded.points, business_date = excluded.business_date;
    end loop;
  end loop;
end;
$$;

-- Staff can receive aggregate standings and their own sanitized history only.
create or replace function public.mod_points_dashboard(p_location_id uuid, p_month date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare month_start date := date_trunc('month', p_month)::date; result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.location_memberships m join public.locations l on l.id = m.location_id
    join public.organization_memberships o on o.organization_id = l.organization_id
      and o.user_id = m.user_id and o.status = 'active'
    where m.location_id = p_location_id and m.user_id = auth.uid() and m.status = 'active'
  ) then raise exception 'Location access required.' using errcode = '42501'; end if;
  if month_start is null then raise exception 'Select a month.'; end if;
  with events as (
    select t.user_id, t.business_date::date as business_date, t.points, t.description
    from public.reward_point_transactions t where t.location_id = p_location_id
    union all
    select t.user_id, t.business_date, t.points, 'Manager performance adjustment'::text
    from public.mod_rating_points t where t.location_id = p_location_id and t.points <> 0
  ), totals as (
    select m.user_id, coalesce(nullif(p.preferred_name,''), nullif(p.full_name,''), 'Team Member') as name,
      100 + coalesce(sum(e.points), 0) as total
    from public.location_memberships m left join public.profiles p on p.id = m.user_id
    left join events e on e.user_id = m.user_id and e.business_date >= month_start
      and e.business_date < month_start + interval '1 month'
    where m.location_id = p_location_id and m.status = 'active'
    group by m.user_id, p.preferred_name, p.full_name
  ), standings as (select *, dense_rank() over (order by total desc) as rank from totals)
  select jsonb_build_object('standings', coalesce((select jsonb_agg(to_jsonb(s) order by rank, name)
    from standings s), '[]'::jsonb), 'history', coalesce((
      select jsonb_agg(to_jsonb(h) order by business_date desc) from (
        select business_date, points, description from events where user_id = auth.uid()
          and business_date >= month_start and business_date < month_start + interval '1 month'
      ) h), '[]'::jsonb)) into result;
  return result;
end;
$$;

revoke all on function public.mod_is_manager(uuid), public.mod_week_start(date),
 public.mod_get_closeout(uuid), public.mod_submit_closeout(uuid,jsonb,boolean),
 public.mod_points_dashboard(uuid,date) from public, anon, authenticated;
grant execute on function public.mod_is_manager(uuid), public.mod_get_closeout(uuid),
 public.mod_submit_closeout(uuid,jsonb,boolean), public.mod_points_dashboard(uuid,date) to authenticated;
notify pgrst, 'reload schema';
commit;

begin;
create table if not exists public.walkin_settings (
 location_id uuid primary key references public.locations(id),
 public_key uuid not null unique default gen_random_uuid(),
 enabled boolean not null default true
);
create table if not exists public.walkin_entries (
 id uuid primary key default gen_random_uuid(),
 location_id uuid not null references public.locations(id),
 request_id uuid not null,
 guest_name text not null,
 email text not null,
 phone text not null default '',
 party_size integer not null check(party_size between 1 and 100),
 mailing_opt_in boolean not null default false,
 consent_at timestamptz,
 created_at timestamptz not null default now(),
 business_date date not null default ((now() at time zone 'America/Chicago')-interval '4 hours')::date,
 status text not null default 'waiting' check(status in ('waiting','seated','left')),
 version integer not null default 1,
 changed_by uuid,
 changed_at timestamptz,
 table_session_id uuid,
 unique(location_id,request_id)
);
create index if not exists walkins_day on public.walkin_entries(location_id,business_date,created_at);
create table if not exists public.team_schedule_links (
 location_id uuid not null references public.locations(id),
 user_id uuid not null references public.profiles(id),
 employee_key text not null,
 primary key(location_id,user_id),unique(location_id,employee_key)
);
alter table public.walkin_settings enable row level security;
alter table public.walkin_entries enable row level security;
alter table public.team_schedule_links enable row level security;
revoke all on public.walkin_settings,public.walkin_entries,public.team_schedule_links from public,anon,authenticated;

create or replace function public.walkin_can_manage(p_location_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.closeout_is_member(p_location_id) is true and (
 public.mod_is_manager(p_location_id) is true or exists(select 1 from public.location_memberships where location_id=p_location_id and user_id=auth.uid() and status='active' and (role='host' or can_edit_floor)));
$$;
create or replace function public.walkin_config(p_key uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('name',l.name,'enabled',s.enabled) from public.walkin_settings s join public.locations l on l.id=s.location_id where s.public_key=p_key and l.is_active;
$$;
create or replace function public.walkin_submit(p_key uuid,p_request_id uuid,p_name text,p_email text,p_phone text,p_party integer,p_opt_in boolean,p_website text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare loc uuid; prior public.walkin_entries; result uuid; em text:=lower(btrim(p_email)); nm text:=btrim(p_name); ph text:=btrim(coalesce(p_phone,''));
begin
 select s.location_id into loc from public.walkin_settings s join public.locations l on l.id=s.location_id where s.public_key=p_key and s.enabled and l.is_active;
 if loc is null then raise exception 'Walk-in check-in is unavailable. Please see the host.';end if;
 if coalesce(p_website,'')<>'' or p_request_id is null or p_opt_in is null or coalesce(length(nm),0) not between 1 and 120 or coalesce(length(em),0) not between 3 and 320 or em !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(ph)>40 or nm~'[[:cntrl:]]' or ph~'[[:cntrl:]]' or p_party is null or p_party not between 1 and 100 then raise exception 'Enter your name, email and a party size from 1 to 100.';end if;
 perform pg_advisory_xact_lock(hashtextextended('walkin:'||loc::text,0));
 select * into prior from public.walkin_entries where location_id=loc and request_id=p_request_id;
 if found then
  if (prior.guest_name,prior.email,prior.phone,prior.party_size,prior.mailing_opt_in) is distinct from (nm,em,ph,p_party,p_opt_in) then raise exception 'This check-in was already sent. Please see the host to change it.';end if;
  return prior.id;
 end if;
 if (select count(*) from public.walkin_entries where location_id=loc and created_at>now()-interval '1 hour' and email=em)>=5 or (select count(*) from public.walkin_entries where location_id=loc and created_at>now()-interval '1 hour')>=500 then raise exception 'Please see the host to complete your check-in.';end if;
 insert into public.walkin_entries(location_id,request_id,guest_name,email,phone,party_size,mailing_opt_in,consent_at)
 values(loc,p_request_id,nm,em,ph,p_party,p_opt_in,case when p_opt_in then now() end) returning id into result;
 return result;
end;$$;
create or replace function public.walkin_list(p_location_id uuid,p_day date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare config public.walkin_settings;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Location access required.' using errcode='42501';end if;
 if p_day is null then raise exception 'Choose a day.';end if;
 if public.walkin_can_manage(p_location_id) then insert into public.walkin_settings(location_id) values(p_location_id) on conflict do nothing;end if;
 select * into config from public.walkin_settings where location_id=p_location_id;
 return jsonb_build_object('key',config.public_key,'enabled',config.enabled,'can_manage',public.walkin_can_manage(p_location_id),'can_export',public.mod_is_manager(p_location_id),'rows',coalesce((select jsonb_agg(to_jsonb(e) order by created_at,id) from public.walkin_entries e where location_id=p_location_id and business_date=p_day),'[]'::jsonb));
end;$$;
create or replace function public.walkin_status(p_location_id uuid,p_id uuid,p_version integer,p_status text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if public.walkin_can_manage(p_location_id) is not true then raise exception 'Host or floor management access required.' using errcode='42501';end if;
 if p_status is null or p_status not in ('waiting','seated','left') then raise exception 'Choose a valid status.';end if;
 update public.walkin_entries set status=p_status,version=version+1,changed_by=auth.uid(),changed_at=now()
 where id=p_id and location_id=p_location_id and version=p_version;
 if not found then raise exception 'This guest changed. Refresh the list.';end if;
end;$$;
create or replace function public.floor_seat_walkin(p_location_id uuid,p_walkin_id uuid,p_version integer,p_shift_id uuid,p_table_ids uuid[],p_server_id uuid,p_guest_name text,p_guest_phone text,p_guest_email text,p_party_size integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare entry public.walkin_entries; sid uuid;
begin
 if public.walkin_can_manage(p_location_id) is not true then raise exception 'Seating access required.' using errcode='42501';end if;
 select * into entry from public.walkin_entries where id=p_walkin_id and location_id=p_location_id for update;
 if not found then raise exception 'Walk-in not found.';end if;
 if entry.status='seated' and entry.table_session_id is not null then return entry.table_session_id;end if;
 if entry.version is distinct from p_version or entry.status<>'waiting' then raise exception 'This guest changed. Refresh the list.';end if;
 sid:=public.floor_seat_party(p_location_id,p_shift_id,p_table_ids,p_server_id,p_guest_name,p_guest_phone,p_guest_email,p_party_size);
 update public.walkin_entries set status='seated',table_session_id=sid,version=version+1,changed_by=auth.uid(),changed_at=now() where id=entry.id;
 return sid;
end;$$;
create or replace function public.team_schedule_link(p_location_id uuid,p_user_id uuid,p_key text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.closeout_is_gm(p_location_id) is not true then raise exception 'Owner or general manager access required.' using errcode='42501';end if;
 if not exists(select 1 from public.location_memberships where location_id=p_location_id and user_id=p_user_id) then raise exception 'Employee not found.';end if;
 if coalesce(btrim(p_key),'')='' then delete from public.team_schedule_links where location_id=p_location_id and user_id=p_user_id;return;end if;
 if length(p_key)>100 or p_key !~ '^[0-9]+$' then raise exception 'Choose a 7shifts employee.';end if;
 insert into public.team_schedule_links(location_id,user_id,employee_key) values(p_location_id,p_user_id,btrim(p_key)) on conflict(location_id,user_id) do update set employee_key=excluded.employee_key;
end;$$;
create or replace function public.team_employee_profile(p_location_id uuid,p_user_id uuid,p_start date,p_end date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare manager boolean; result jsonb; rows jsonb; points jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Location access required.' using errcode='42501';end if;
 manager:=public.mod_is_manager(p_location_id) is true;
 if not manager and p_user_id is distinct from auth.uid() then raise exception 'You can view only your own employee records.' using errcode='42501';end if;
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>366 then raise exception 'Choose a date range of up to one year.';end if;
 select jsonb_build_object('user_id',m.user_id,'name',coalesce(nullif(p.preferred_name,''),p.full_name,'Team member'),'role',m.role,'status',m.status,'phone',to_jsonb(p)->'phone','employee_number',to_jsonb(m)->'employee_number','manager_view',manager,'gm',public.closeout_is_gm(p_location_id),'start',p_start,'end',p_end,'schedule_key',(select employee_key from public.team_schedule_links where location_id=p_location_id and user_id=p_user_id)) into result
 from public.location_memberships m join public.profiles p on p.id=m.user_id where m.location_id=p_location_id and m.user_id=p_user_id;
 if result is null then raise exception 'Employee not found.';end if;
 if to_regclass('auth.users') is not null then result:=result||jsonb_build_object('email',(select email from auth.users where id=p_user_id));end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'date',c.closeout_date,'sales',c.net_sales,'target',c.sales_target,'role',c.job_role,'clock_in',c.clock_in,'clock_out',to_jsonb(c)->>'clock_out','submitted_at',to_jsonb(c)->>'submitted_at','tables',(select coalesce(jsonb_agg(t.table_name order by t.table_name),'[]'::jsonb) from public.daily_closeout_tables ct join public.floor_tables t on t.id=ct.table_id where ct.closeout_id=c.id and t.location_id=p_location_id)) order by c.closeout_date desc,c.id),'[]'::jsonb) into rows from public.daily_closeouts c where c.location_id=p_location_id and c.user_id=p_user_id and c.status='submitted' and to_jsonb(c)->>'deleted_at' is null and c.closeout_date between p_start and p_end;
 result:=result||jsonb_build_object('closeouts',rows);
 if to_regclass('public.daily_quiz_attempts') is not null then
 select coalesce(jsonb_agg(jsonb_build_object('date',q.quiz_date,'title',q.title,'score',a.result->'score','total',a.result->'total','percent',a.result->'percent','reward_points',to_jsonb(a)->'reward_points') order by q.quiz_date desc,a.submitted_at desc),'[]'::jsonb) into rows from public.daily_quiz_attempts a join public.daily_quizzes q on q.id=a.quiz_id where q.location_id=p_location_id and a.user_id=p_user_id and q.quiz_date between p_start and p_end;
 result:=result||jsonb_build_object('quizzes',rows);end if;
 if to_regclass('public.staff_task_runs') is not null then
 select coalesce(jsonb_agg(jsonb_build_object('date',r.business_date,'title',r.title,'total',jsonb_array_length(r.items),'completed',(select count(*) from public.staff_task_checks c where c.run_id=r.id and c.user_id=p_user_id),'active',a.active) order by r.business_date desc,r.id),'[]'::jsonb) into rows from public.staff_task_runs r join public.staff_task_assignees a on a.run_id=r.id where r.location_id=p_location_id and a.user_id=p_user_id and r.cancelled_at is null and r.business_date between p_start and p_end;
 result:=result||jsonb_build_object('tasks',rows);end if;
 if to_regclass('public.floor_section_plans') is not null then
 select coalesce(jsonb_agg(jsonb_build_object('name',p.name,'start',p.starts_at,'end',p.ends_at,'published',p.published_at is not null,'tables',(select coalesce(jsonb_agg(t.table_name order by t.table_name),'[]'::jsonb) from public.floor_tables t where t.id=any(p.table_ids) and t.location_id=p_location_id)) order by p.starts_at desc),'[]'::jsonb) into rows from public.floor_section_plans p where p.location_id=p_location_id and p.employee_id=p_user_id and p.cancelled_at is null and (manager or p.published_at is not null) and (p.starts_at at time zone 'America/Chicago')::date between p_start and p_end;
 result:=result||jsonb_build_object('scheduled_sections',rows);end if;
 if to_regclass('public.shift_sections') is not null then
 select coalesce(jsonb_agg(jsonb_build_object('date',s.shift_date,'shift',s.shift_name,'name',c.name,'tables',(select coalesce(jsonb_agg(t.table_name order by t.table_name),'[]'::jsonb) from public.shift_section_tables st join public.floor_tables t on t.id=st.table_id where st.shift_section_id=ss.id and t.location_id=p_location_id)) order by s.shift_date desc,ss.id),'[]'::jsonb) into rows from public.shift_sections ss join public.shifts s on s.id=ss.shift_id join public.section_configurations c on c.id=ss.section_configuration_id where s.location_id=p_location_id and ss.employee_id=p_user_id and ss.assignment_status<>'cancelled' and s.shift_date between p_start and p_end;
 result:=result||jsonb_build_object('sections',rows);end if;
 if to_regprocedure('public.points_source_entries(uuid)') is not null then
 select coalesce(jsonb_agg(jsonb_build_object('date',s.business_date,'points',coalesce(o.points,s.points),'description',s.description) order by s.business_date desc,s.entry_key),'[]'::jsonb) into points from public.points_source_entries(p_location_id) s left join public.point_entry_overrides o on o.location_id=p_location_id and o.entry_key=s.entry_key where s.user_id=p_user_id and s.business_date between p_start and p_end;
 result:=result||jsonb_build_object('points',points);end if;
 if to_regclass('public.inventory_disposal_sheets') is not null then
 select coalesce(jsonb_agg(jsonb_build_object('submitted_at',d.submitted_at,'lines',d.lines) order by d.submitted_at desc),'[]'::jsonb) into rows from public.inventory_disposal_sheets d where d.location_id=p_location_id and d.user_id=p_user_id and ((d.submitted_at at time zone 'America/Chicago')-interval '4 hours')::date between p_start and p_end;
 result:=result||jsonb_build_object('disposals',rows);end if;
 if manager then
 select coalesce(jsonb_agg(jsonb_build_object('date',s.shift_date,'shift',s.shift_name,'rating',r.rating,'reason',r.reason,'submitted_at',c.submitted_at) order by s.shift_date desc,c.submitted_at desc),'[]'::jsonb) into rows from public.mod_staff_reviews r join public.mod_closeouts c on c.shift_id=r.shift_id join public.shifts s on s.id=r.shift_id where c.location_id=p_location_id and s.location_id=p_location_id and r.user_id=p_user_id and s.shift_date between p_start and p_end;
 result:=result||jsonb_build_object('ratings',rows);end if;
 return result;
end;$$;
revoke all on function public.walkin_can_manage(uuid),public.walkin_config(uuid),public.walkin_submit(uuid,uuid,text,text,text,integer,boolean,text),public.walkin_list(uuid,date),public.walkin_status(uuid,uuid,integer,text),public.floor_seat_walkin(uuid,uuid,integer,uuid,uuid[],uuid,text,text,text,integer),public.team_schedule_link(uuid,uuid,text),public.team_employee_profile(uuid,uuid,date,date) from public,anon,authenticated;
grant execute on function public.walkin_config(uuid),public.walkin_submit(uuid,uuid,text,text,text,integer,boolean,text) to anon,authenticated;
grant execute on function public.walkin_list(uuid,date),public.walkin_status(uuid,uuid,integer,text),public.floor_seat_walkin(uuid,uuid,integer,uuid,uuid[],uuid,text,text,text,integer),public.team_schedule_link(uuid,uuid,text),public.team_employee_profile(uuid,uuid,date,date) to authenticated;
create or replace function public.walkin_add_guest(
 p_location_id uuid,p_request_id uuid,p_name text,p_email text,
 p_phone text,p_party integer,p_opt_in boolean
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare
 prior public.walkin_entries;
 result uuid;
 nm text:=btrim(p_name);
 em text:=lower(btrim(coalesce(p_email,'')));
 ph text:=btrim(coalesce(p_phone,''));
begin
 if public.walkin_can_manage(p_location_id) is not true then
  raise exception 'Host or floor management access required.' using errcode='42501';
 end if;
 if p_request_id is null or p_opt_in is null
  or coalesce(length(nm),0) not between 1 and 120
  or length(em)>320 or length(ph)>40
  or nm~'[[:cntrl:]]' or ph~'[[:cntrl:]]'
  or (em<>'' and em !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
  or (p_opt_in and em='')
  or p_party is null or p_party not between 1 and 100 then
  raise exception 'Enter a name and valid party size. Mailing opt-in requires an email.';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('walkin:'||p_location_id::text,0));
 select * into prior from public.walkin_entries
 where location_id=p_location_id and request_id=p_request_id;
 if found then
  if (prior.guest_name,prior.email,prior.phone,prior.party_size,prior.mailing_opt_in)
   is distinct from (nm,em,ph,p_party,p_opt_in) then
   raise exception 'This guest was already added. Refresh the list.';
  end if;
  return prior.id;
 end if;
 insert into public.walkin_entries(
  location_id,request_id,guest_name,email,phone,party_size,
  mailing_opt_in,consent_at,changed_by,changed_at
 ) values(
  p_location_id,p_request_id,nm,em,ph,p_party,p_opt_in,
  case when p_opt_in then now() end,auth.uid(),now()
 ) returning id into result;
 return result;
end;
$$;
revoke all on function public.walkin_add_guest(uuid,uuid,text,text,text,integer,boolean)
from public,anon,authenticated;
grant execute on function public.walkin_add_guest(uuid,uuid,text,text,text,integer,boolean)
to authenticated;
notify pgrst,'reload schema';
commit;

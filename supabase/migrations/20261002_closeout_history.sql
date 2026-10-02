begin;

alter table public.daily_closeouts
 add column if not exists deleted_at timestamptz,
 add column if not exists deleted_by uuid,
 add column if not exists deleted_record jsonb;

create index if not exists closeout_summary_service_day
 on public.daily_closeouts(location_id,created_at) where deleted_at is null;

create or replace function public.closeout_service_day(p_at timestamptz)
returns date language sql immutable set search_path='' as $$
 select ((p_at at time zone 'America/Chicago')-interval '4 hours')::date;
$$;
revoke all on function public.closeout_service_day(timestamptz) from public,anon,authenticated;

create or replace function public.closeout_guard_deletion()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (tg_op='INSERT' and (new.deleted_at is not null or new.deleted_by is not null or new.deleted_record is not null))
 or (tg_op='UPDATE' and (new.deleted_at is distinct from old.deleted_at or new.deleted_by is distinct from old.deleted_by or new.deleted_record is distinct from old.deleted_record)) then
  if public.mod_is_manager(new.location_id) is not true then
   raise exception 'Manager access required to delete closeouts.' using errcode='42501';
  end if;
 end if;
 return new;
end; $$;
revoke all on function public.closeout_guard_deletion() from public,anon,authenticated;
drop trigger if exists closeout_guard_deletion on public.daily_closeouts;
create trigger closeout_guard_deletion before insert or update on public.daily_closeouts
 for each row execute function public.closeout_guard_deletion();

alter table public.daily_closeouts enable row level security;
drop policy if exists closeout_hide_deleted on public.daily_closeouts;
create policy closeout_hide_deleted on public.daily_closeouts as restrictive for select to authenticated
 using(deleted_at is null);
drop policy if exists closeout_no_direct_delete on public.daily_closeouts;
create policy closeout_no_direct_delete on public.daily_closeouts as restrictive for delete to authenticated
 using(false);

create or replace function public.closeout_delete(p_location_id uuid,p_closeout_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare c public.daily_closeouts%rowtype;
begin
 if public.mod_is_manager(p_location_id) is not true then
  raise exception 'Manager access required.' using errcode='42501';
 end if;
 select * into c from public.daily_closeouts where id=p_closeout_id and location_id=p_location_id for update;
 if c.id is null then raise exception 'Closeout not found at this location.'; end if;
 if c.deleted_at is not null then return; end if;
 update public.daily_closeouts set deleted_at=now(),deleted_by=auth.uid(),deleted_record=to_jsonb(c) where id=c.id;
end; $$;

create or replace function public.closeout_summary_day(p_location_id uuid,p_day date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare manager boolean; rows jsonb; ids uuid[]; users uuid[];
begin
 if public.closeout_is_member(p_location_id) is not true then
  raise exception 'Active location membership required.' using errcode='42501';
 end if;
 if p_day is null then raise exception 'Select a service day.'; end if;
 manager:=public.mod_is_manager(p_location_id) is true;
 select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc,c.id),'[]'::jsonb),array_agg(c.id)
 into rows,ids from public.daily_closeouts c
 where c.location_id=p_location_id and c.deleted_at is null and c.status='submitted'
  and c.created_at >= ((p_day+time '04:00') at time zone 'America/Chicago')
  and c.created_at < (((p_day+1)+time '04:00') at time zone 'America/Chicago')
  and (manager or c.user_id=auth.uid());
 select array_agg(distinct u) into users from public.daily_closeouts c
 cross join lateral unnest(array[c.user_id,c.money_turned_in_to,c.drinks_made_by]) u
 where c.id=any(ids) and u is not null;
 return jsonb_build_object('manager',manager,'closeouts',rows,
  'profiles',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name,'preferred_name',p.preferred_name))
   from public.profiles p where p.id=any(users) and exists(select 1 from public.location_memberships m where m.location_id=p_location_id and m.user_id=p.id)),'[]'::jsonb),
  'tables',coalesce((select jsonb_agg(jsonb_build_object('closeout_id',t.closeout_id,'table_id',t.table_id,'table_name',t.table_name))
   from public.daily_closeout_tables t where t.closeout_id=any(ids)),'[]'::jsonb));
end; $$;

create or replace function public.closeout_summary_archive(p_location_id uuid,p_before date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare manager boolean;
begin
 if public.closeout_is_member(p_location_id) is not true then
  raise exception 'Active location membership required.' using errcode='42501';
 end if;
 if p_before is null then raise exception 'Select a service day.'; end if;
 manager:=public.mod_is_manager(p_location_id) is true;
 return coalesce((select jsonb_agg(to_jsonb(d) order by d.day desc) from (
  select public.closeout_service_day(c.created_at) as day,count(*) as count
  from public.daily_closeouts c where c.location_id=p_location_id and c.deleted_at is null and c.status='submitted'
   and c.created_at < ((p_before+time '04:00') at time zone 'America/Chicago')
   and (manager or c.user_id=auth.uid())
  group by public.closeout_service_day(c.created_at)
 ) d),'[]'::jsonb);
end; $$;

-- Preserve the existing rewards logic, excluding only deleted-closeout transactions.
do $$
declare definition text; marker text:='from public.reward_point_transactions t where t.location_id = p_location_id';
begin
 definition:=pg_get_functiondef('public.mod_points_dashboard(uuid,date)'::regprocedure);
 if position('closeout_history_deleted_filter' in definition)=0 then
  if position(marker in definition)=0 then
   raise exception 'Points dashboard changed. Share its function definition before applying this migration.';
  end if;
  definition:=replace(definition,marker,marker||' and not exists (select 1 from public.daily_closeouts closeout_history_deleted_filter where closeout_history_deleted_filter.id=t.closeout_id and closeout_history_deleted_filter.deleted_at is not null)');
  execute definition;
 end if;
end; $$;

revoke all on function public.closeout_delete(uuid,uuid),public.closeout_summary_day(uuid,date),public.closeout_summary_archive(uuid,date) from public,anon,authenticated;
grant execute on function public.closeout_delete(uuid,uuid),public.closeout_summary_day(uuid,date),public.closeout_summary_archive(uuid,date) to authenticated;
notify pgrst,'reload schema';
commit;

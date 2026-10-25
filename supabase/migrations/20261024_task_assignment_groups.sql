begin;
do $$ begin
 if to_regprocedure('public.staff_tasks_assign_scheduled(uuid,jsonb,date,text,uuid[],uuid,boolean,time without time zone,time without time zone)') is null or to_regprocedure('public.crew_schedule_tools_load(uuid,date)') is null then
  raise exception 'Install the existing Operations Workflow and shared schedule updates first.';
 end if;
end $$;
create schema if not exists task_assignment_private;
revoke all on schema task_assignment_private from public,anon,authenticated;
create table if not exists task_assignment_private.saved_groups(
 id uuid primary key default gen_random_uuid(),
 location_id uuid not null references public.locations(id),
 name text not null check(length(btrim(name)) between 1 and 100),
 definition jsonb not null,
 version integer not null default 1,
 updated_at timestamptz not null default now(),
 updated_by uuid not null references public.profiles(id)
);
create unique index if not exists saved_task_assignment_group_name on task_assignment_private.saved_groups(location_id,lower(btrim(name)));
alter table task_assignment_private.saved_groups enable row level security;
revoke all on all tables in schema task_assignment_private from public,anon,authenticated;
create or replace function task_assignment_private.assert_manager(p_location uuid)
returns void language plpgsql stable security definer set search_path='' as $$
begin
 perform public.app_access_assert(p_location,'tasks','assign');
 if auth.uid() is null or public.closeout_is_member(p_location) is not true or public.staff_tasks_can_manage(p_location) is not true then
  raise exception 'Task assignment access required.' using errcode='42501';
 end if;
end $$;
create or replace function public.staff_task_assignment_groups(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform task_assignment_private.assert_manager(p_location_id);
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'definition',definition,'version',version,'updated_at',updated_at) order by name,id) from task_assignment_private.saved_groups where location_id=p_location_id),'[]'::jsonb);
end $$;
create or replace function public.staff_task_assignment_group_save(p_location_id uuid,p_id uuid,p_version integer,p_name text,p_definition jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare row task_assignment_private.saved_groups;t jsonb;u jsonb;tid uuid;uid uuid;seen uuid[]:='{}';people uuid[]:='{}';
begin
 perform task_assignment_private.assert_manager(p_location_id);
 if p_name is null or length(btrim(p_name)) not between 1 and 100 or p_definition is null or pg_column_size(p_definition)>50000 then raise exception 'Enter a group name of 1–100 characters and a valid selection.';end if;
 if jsonb_typeof(p_definition) is distinct from 'object' or
 (p_definition-array['templates','users','shift','use_preset_due','due','available'])<>'{}'::jsonb or
 jsonb_typeof(p_definition->'templates') is distinct from 'array' or
 jsonb_typeof(p_definition->'users') is distinct from 'array' or
 jsonb_typeof(p_definition->'shift') is distinct from 'string' or
 jsonb_typeof(p_definition->'use_preset_due') is distinct from 'boolean' then raise exception 'Invalid saved assignment selection.';end if;
 if jsonb_array_length(p_definition->'templates') not between 1 and 30 or jsonb_array_length(p_definition->'users')>100 or length(p_definition->>'shift')>100 then raise exception 'Choose 1–30 checklists and up to 100 employees.';end if;
 for t in select value from jsonb_array_elements(p_definition->'templates') loop
  if jsonb_typeof(t) is distinct from 'object' or (t-array['id','version'])<>'{}'::jsonb or jsonb_typeof(t->'id') is distinct from 'string' or jsonb_typeof(t->'version') is distinct from 'number' or coalesce(t->>'version','') !~ '^[0-9]+$' then raise exception 'Invalid checklist reference.';end if;
  tid:=(t->>'id')::uuid;
  if tid=any(seen) then raise exception 'Choose each checklist only once.';end if;
  seen:=array_append(seen,tid);
  perform 1 from public.staff_task_templates where id=tid and location_id=p_location_id and active and reviewed and version=(t->>'version')::integer and jsonb_array_length(items) between 1 and 8 for share;
  if not found then raise exception 'A checklist changed or is unavailable. Refresh and review the current checklists before saving.';end if;
 end loop;
 for u in select value from jsonb_array_elements(p_definition->'users') loop
  if jsonb_typeof(u) is distinct from 'string' then raise exception 'Invalid employee reference.';end if;
  uid:=(u#>>'{}')::uuid;
  if uid=any(people) or public.closeout_is_member_for_tasks(p_location_id,uid) is not true then raise exception 'Choose distinct active employees from this location.';end if;
  people:=array_append(people,uid);
 end loop;
 for t in select p_definition->'due' union all select p_definition->'available' loop
  if t is null or jsonb_typeof(t) not in ('null','string') then raise exception 'Use a time or null for release and due time.';end if;
  if jsonb_typeof(t)='string' and (t#>>'{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Use HH:MM for release and due time.';end if;
 end loop;
 if p_id is null then
  if p_version is not null then raise exception 'New groups cannot have a prior version.';end if;
  insert into task_assignment_private.saved_groups(location_id,name,definition,updated_by) values(p_location_id,btrim(p_name),p_definition,auth.uid()) returning * into row;
 else
  update task_assignment_private.saved_groups set name=btrim(p_name),definition=p_definition,version=version+1,updated_at=now(),updated_by=auth.uid()
  where id=p_id and location_id=p_location_id and version=p_version returning * into row;
  if not found then raise exception 'This saved group changed or was deleted. Reload saved groups before updating.';end if;
 end if;
 return jsonb_build_object('id',row.id,'name',row.name,'definition',row.definition,'version',row.version,'updated_at',row.updated_at);
exception when unique_violation then raise exception 'A saved assignment group already uses that name. Update it or choose another name.';
end $$;
create or replace function public.staff_task_assignment_group_delete(p_location_id uuid,p_id uuid,p_version integer)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform task_assignment_private.assert_manager(p_location_id);
 delete from task_assignment_private.saved_groups where id=p_id and location_id=p_location_id and version=p_version;
 if not found then raise exception 'This saved group changed or was deleted. Reload saved groups before deleting.';end if;
 return true;
end $$;
revoke all on all functions in schema task_assignment_private from public,anon,authenticated;
revoke all on function public.staff_task_assignment_groups(uuid),public.staff_task_assignment_group_save(uuid,uuid,integer,text,jsonb),public.staff_task_assignment_group_delete(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.staff_task_assignment_groups(uuid),public.staff_task_assignment_group_save(uuid,uuid,integer,text,jsonb),public.staff_task_assignment_group_delete(uuid,uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;

begin;

-- Add Morning as a phase while retaining older presets and assignments.
do $phase$
declare c record; definition text;
begin
 for c in select conname from pg_constraint
  where conrelid='public.staff_task_templates'::regclass and contype='c'
  and conkey=array[(select attnum from pg_attribute
   where attrelid='public.staff_task_templates'::regclass and attname='phase')]::smallint[] loop
  execute format('alter table public.staff_task_templates drop constraint %I',c.conname);
 end loop;
 alter table public.staff_task_templates add constraint staff_task_templates_workflow_phase
 check(phase in ('Morning','Opening','Running','Closing','Weekly','Other'));
 definition:=pg_get_functiondef('public.staff_tasks_save_template(uuid,uuid,integer,text,text,text,jsonb,boolean)'::regprocedure);
 definition:=replace(definition,
  '(''Opening'',''Running'',''Closing'',''Weekly'',''Other'')',
  '(''Morning'',''Opening'',''Running'',''Closing'',''Weekly'',''Other'')');
 execute definition;
end;
$phase$;

-- Preserve position filters on groups recovered by the older migration.
update public.staff_task_templates g
set position=t.position,version=g.version+1,updated_at=now()
from public.staff_task_templates t
where g.location_id=t.location_id and g.position='General'
 and g.source_key like 'task-group:'||t.id::text||':%'
 and g.version=1
 and t.position<>'General';

-- Loading the library no longer rewrites or recategorizes saved presets.
create or replace function public.staff_tasks_templates(p_location_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if public.staff_tasks_can_manage(p_location_id) is not true then
  raise exception 'Task management access required.' using errcode='42501';end if;
 perform public.staff_tasks_seed(p_location_id);
 select coalesce(jsonb_agg(to_jsonb(t) order by phase,position,title),'[]'::jsonb)
 into result from public.staff_task_templates t
 where location_id=p_location_id and active;
 return result;
end;$$;

create or replace function public.staff_tasks_seed_closing(p_location_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare inserted integer;
begin
 if public.staff_tasks_can_manage(p_location_id) is not true then
  raise exception 'Task management access required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('closing-presets:'||p_location_id::text,0));
 insert into public.staff_task_templates(location_id,title,position,phase,items,source_key,source_note,reviewed)
 select p_location_id,x->>'title',x->>'position','Closing',x->'items',x->>'key',
 'Imported from the October 14 closing checklist screenshots. Review for current operations before assigning.',false
 from jsonb_array_elements($closing$[{"title": "Server / Bartender — Closing · Dining & reset", "position": "Server", "items": ["Break down the main dining room", "Give menus to the host / hostess", "Put flowers away; discard old flowers", "Wipe all tables", "Wipe the bar down completely", "Refill non-alcoholic beverages", "Discard old fruit", "Put sugar bowls and gold ramekins back where they belong"], "key": "task-group:20261014-closing-1"}, {"title": "Server / Bartender — Closing · Glassware & tools", "position": "Server", "items": ["Clean out sinks", "Put away the fruit garnish tray", "Empty and wash the coffee pot", "Clean and polish all glasses", "Put extra glasses in the back bar", "Wipe down the well and bottles", "Blow out all candles", "Wash and dry all shakers and gold ramekins"], "key": "task-group:20261014-closing-2"}, {"title": "Server / Bartender — Closing · Stock & shutdown", "position": "Server", "items": ["Put all garnishes away", "Wipe bottles down", "Pick up and wash mats", "Refill all mixers and juices", "Refill beer and wine coolers", "Turn off the main dining room lights", "Turn off TVs and receiver", "Turn off hallway lights"], "key": "task-group:20261014-closing-3"}, {"title": "Server / Bartender — Closing · Final closeout", "position": "Server", "items": ["Turn off bathroom lights", "Set the air to 75", "Turn off the dishwasher", "Turn off daiquiri machines", "Reset all tables", "Complete the End of Day form"], "key": "task-group:20261014-closing-4"}, {"title": "Host — Closing · Cleaning & reset", "position": "Host", "items": ["Sweep, empty trash bins, and wipe mirrors in both bathrooms", "Ask the dishwasher to wash all silverware pieces", "Check for rolling linen", "Send Jessica any messages that have not been sent", "Wipe tables down", "Pick up flowers and place them in the back bar", "Reset all tables", "Restock glassware on the back bar shelves"], "key": "task-group:20261014-closing-5"}, {"title": "Host — Closing · Service supplies", "position": "Host", "items": ["Put chairs down after the floor has been mopped", "Blow out candles if lit", "Put phones on their chargers", "Wipe down and organize menus", "Put menus in the designated folder in the file box", "Make sure chairs are neatly placed by tables", "Roll silverware", "Empty water dispensers on top of the back bar"], "key": "task-group:20261014-closing-6"}, {"title": "Host — Closing · Final shutdown", "position": "Host", "items": ["Turn off music in the Brut Bar", "Turn off Brut Bar lights", "Turn off lights in the Brut Bar bathroom", "Wipe down and organize the host stand", "Unplug courtyard lights", "Pay for any employee meals", "Clock out"], "key": "task-group:20261014-closing-7"}]$closing$::jsonb) x
 on conflict(location_id,source_key) do nothing;
 get diagnostics inserted=row_count;
 return inserted;
end;$$;

-- Split an older long list atomically; preserve assigned snapshots/check-offs.
create or replace function public.staff_tasks_split_preset(p_location_id uuid,p_id uuid,p_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.staff_task_templates; part integer; parts integer; tid uuid;
 group_items jsonb; result jsonb:='[]'::jsonb;
begin
 if public.staff_tasks_can_manage(p_location_id) is not true then
  raise exception 'Task management access required.' using errcode='42501';end if;
 select * into t from public.staff_task_templates
 where id=p_id and location_id=p_location_id and active for update;
 if t.id is null or t.version is distinct from p_version then
  raise exception 'Preset changed. Reload first.';end if;
 if jsonb_array_length(t.items)<=8 then raise exception 'This preset already has 8 items or fewer.';end if;
 parts:=(jsonb_array_length(t.items)+7)/8;
 for part in 1..parts loop
  select jsonb_agg(value order by ord) into group_items
  from jsonb_array_elements(t.items) with ordinality x(value,ord)
  where ord>(part-1)*8 and ord<=part*8;
  insert into public.staff_task_templates(location_id,title,position,phase,items,
   source_key,source_note,reviewed,weekday,due_time)
  values(p_location_id,left(t.title,170)||' · Part '||part||' of '||parts,
   t.position,t.phase,group_items,'task-group:workflow:'||t.id||':'||t.version||':'||part,
   t.source_note||' Split from '||t.title||'.',t.reviewed,t.weekday,t.due_time)
  returning id into tid;
  result:=result||jsonb_build_array(tid);
 end loop;
 update public.staff_task_templates set active=false,version=version+1,updated_at=now() where id=t.id;
 return result;
end;$$;

-- Assign several eight-item groups together in one transaction.
create or replace function public.staff_tasks_assign_batch(
 p_location_id uuid,p_templates jsonb,p_day date,p_shift text,
 p_users uuid[],p_request_id uuid,p_use_preset_due boolean,p_due time
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; t public.staff_task_templates; tid uuid; rid uuid; child_request uuid;
 result jsonb:='[]'::jsonb; seen uuid[]:=array[]::uuid[];
begin
 if public.staff_tasks_can_manage(p_location_id) is not true then
  raise exception 'Task management access required.' using errcode='42501';end if;
 if p_request_id is null or p_day is null or p_use_preset_due is null
 or p_users is null or cardinality(p_users) not between 1 and 100
 or p_shift is null or length(p_shift)>100
 or jsonb_typeof(p_templates) is distinct from 'array' then
  raise exception 'Choose valid groups, a date and active employees.';end if;
 if jsonb_array_length(p_templates) not between 1 and 30 then
  raise exception 'Choose 1–30 task groups.';end if;
 perform pg_advisory_xact_lock(hashtextextended('task-batch:'||p_location_id::text||':'||p_request_id::text,0));
 for item in select value from jsonb_array_elements(p_templates) loop
  if jsonb_typeof(item)<>'object' then raise exception 'Invalid group.';end if;
  if (item-array['id','version'])<>'{}'::jsonb
   or jsonb_typeof(item->'id') is distinct from 'string'
   or jsonb_typeof(item->'version') is distinct from 'number'
   or coalesce(item->>'version','') !~ '^[0-9]+$' then raise exception 'Invalid group.';end if;
  tid:=(item->>'id')::uuid;
  if tid=any(seen) then raise exception 'Choose each group once.';end if;
  seen:=array_append(seen,tid);
  child_request:=md5(p_request_id::text||':'||tid::text)::uuid;
  select id into rid from public.staff_task_runs
  where location_id=p_location_id and request_id=child_request;
  if rid is null then
   select * into t from public.staff_task_templates
   where id=tid and location_id=p_location_id and active for share;
   if t.id is null or not t.reviewed or t.version is distinct from (item->>'version')::integer
    or jsonb_array_length(t.items) not between 1 and 8 then
    raise exception 'Review current groups of 8 tasks or fewer before assigning.';end if;
   rid:=public.staff_tasks_assign_due(p_location_id,tid,t.version,p_day,p_shift,p_users,
    child_request,case when p_use_preset_due then t.due_time else p_due end);
  end if;
  result:=result||jsonb_build_array(rid);
 end loop;
 return result;
end;$$;

revoke all on function public.staff_tasks_templates(uuid),
 public.staff_tasks_seed_closing(uuid),public.staff_tasks_split_preset(uuid,uuid,integer),
 public.staff_tasks_assign_batch(uuid,jsonb,date,text,uuid[],uuid,boolean,time)
from public,anon,authenticated;
grant execute on function public.staff_tasks_templates(uuid),
 public.staff_tasks_seed_closing(uuid),public.staff_tasks_split_preset(uuid,uuid,integer),
 public.staff_tasks_assign_batch(uuid,jsonb,date,text,uuid[],uuid,boolean,time)
to authenticated;
notify pgrst,'reload schema';
commit;

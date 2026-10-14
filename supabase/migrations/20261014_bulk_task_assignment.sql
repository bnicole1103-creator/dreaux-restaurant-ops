begin;

-- Requires the existing task groups and staff_tasks_assign_due migration.
create table if not exists public.staff_task_bulk_requests (
  location_id uuid not null references public.locations(id) on delete cascade,
  request_id uuid not null,
  requested_by uuid not null references public.profiles(id),
  payload jsonb not null,
  run_ids uuid[] not null,
  created_at timestamptz not null default now(),
  primary key (location_id, request_id)
);
alter table public.staff_task_bulk_requests enable row level security;
revoke all on public.staff_task_bulk_requests from public, anon, authenticated;

create or replace function public.staff_tasks_assign_many(
  p_location_id uuid,
  p_employee uuid,
  p_templates jsonb,
  p_day date,
  p_shift text,
  p_due time,
  p_request_id uuid
) returns uuid[]
language plpgsql security definer set search_path = '' as $$
declare
  canonical jsonb;
  saved public.staff_task_bulk_requests;
  entry jsonb;
  preset public.staff_task_templates;
  results uuid[] := array[]::uuid[];
  request_payload jsonb;
begin
  if auth.uid() is null or public.staff_tasks_can_manage(p_location_id) is not true then
    raise exception 'Task management access required.' using errcode = '42501';
  end if;
  if p_request_id is null or p_day is null or p_shift is null or length(p_shift) > 100 then
    raise exception 'Choose a service date and a valid shift label.';
  end if;
  if p_employee is null or public.closeout_is_member_for_tasks(p_location_id, p_employee) is not true then
    raise exception 'Choose an active employee at this location.';
  end if;
  if p_templates is null or jsonb_typeof(p_templates) <> 'array' then
    raise exception 'Choose task groups.';
  end if;
  if jsonb_array_length(p_templates) not between 1 and 40 then
    raise exception 'Choose between 1 and 40 task groups.';
  end if;
  for entry in select value from jsonb_array_elements(p_templates) loop
    if jsonb_typeof(entry) <> 'object' or entry->>'id' is null or entry->>'version' is null then
      raise exception 'Each task group needs an ID and version.';
    end if;
    -- Cast and normalize; malformed IDs or versions abort the whole request.
    perform (entry->>'id')::uuid, (entry->>'version')::integer;
  end loop;
  select jsonb_agg(jsonb_build_object('id', (x->>'id')::uuid, 'version', (x->>'version')::integer)
                   order by (x->>'id')::uuid)
    into canonical from jsonb_array_elements(p_templates) x;
  if (select count(distinct (x->>'id')::uuid) from jsonb_array_elements(canonical) x)
       <> jsonb_array_length(canonical) then
    raise exception 'Choose each task group only once.';
  end if;
  request_payload := jsonb_build_object('employee', p_employee, 'templates', canonical,
    'day', p_day, 'shift', btrim(p_shift), 'due', p_due);
  perform pg_advisory_xact_lock(hashtextextended('task-bulk:' || p_location_id::text || p_request_id::text, 0));
  select * into saved from public.staff_task_bulk_requests
    where location_id = p_location_id and request_id = p_request_id;
  if found then
    if saved.requested_by is distinct from auth.uid() or saved.payload is distinct from request_payload then
      raise exception 'This request was already used for a different assignment.';
    end if;
    return saved.run_ids;
  end if;
  -- Stable lock order prevents concurrent preset edits during the batch.
  for entry in select value from jsonb_array_elements(canonical) loop
    select * into preset from public.staff_task_templates
      where id = (entry->>'id')::uuid and location_id = p_location_id and active for share;
    if not found or preset.reviewed is not true or preset.version is distinct from (entry->>'version')::integer then
      raise exception 'A selected group changed or needs review. Refresh and review it before assigning.';
    end if;
    results := array_append(results, public.staff_tasks_assign_due(
      p_location_id, preset.id, preset.version, p_day, btrim(p_shift),
      array[p_employee], gen_random_uuid(), coalesce(p_due, preset.due_time)));
  end loop;
  insert into public.staff_task_bulk_requests(location_id, request_id, requested_by, payload, run_ids)
    values (p_location_id, p_request_id, auth.uid(), request_payload, results);
  return results;
end;
$$;
revoke all on function public.staff_tasks_assign_many(uuid, uuid, jsonb, date, text, time, uuid)
  from public, anon;
grant execute on function public.staff_tasks_assign_many(uuid, uuid, jsonb, date, text, time, uuid)
  to authenticated;
notify pgrst, 'reload schema';
commit;

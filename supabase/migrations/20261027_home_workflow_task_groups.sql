begin;

do $$
begin
 if to_regclass('task_reuse_private.groups') is null
 or to_regprocedure('task_reuse_private.authorize(uuid,text)') is null then
  raise exception 'Install 20261025_task_group_reuse.sql first. No update applied.';
 end if;
 if to_regclass('task_assignment_private.saved_groups') is null
 or to_regprocedure('public.staff_task_assignment_groups(uuid)') is null then
  raise exception 'Install 20261024_task_assignment_groups.sql first. No update applied.';
 end if;
end
$$;

-- The assignment page now displays both saved formats:
-- 1. checklist selections saved by the current assignment form
-- 2. editable list groups copied from an earlier employee/service day
-- Keep the editable-group loader available in PostgREST and return only the
-- fields the assignment screen needs.
create or replace function public.staff_tasks_saved_bundles(
 p_location_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
begin
 perform task_reuse_private.authorize(p_location_id,'assign');
 return coalesce((
  select jsonb_agg(
   jsonb_build_object(
    'id',g.id,
    'name',g.name,
    'lists',g.lists,
    'version',g.version
   )
   order by g.name,g.id
  )
  from task_reuse_private.groups g
  where g.location_id=p_location_id
 ),'[]'::jsonb);
end
$$;

revoke all on function public.staff_tasks_saved_bundles(uuid)
 from public,anon,authenticated;
grant execute on function public.staff_tasks_saved_bundles(uuid)
 to authenticated;

notify pgrst,'reload schema';
commit;

select
 true as assignment_page_saved_groups_installed,
 false as production_behavior_verified;

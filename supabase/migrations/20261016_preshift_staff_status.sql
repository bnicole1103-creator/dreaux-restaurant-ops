begin;
create schema if not exists preshift_points_private;
revoke all on schema preshift_points_private from public,anon,authenticated;
-- Staff point labels describe completion without exposing management timing rules.
do $$begin
 if to_regprocedure('public.points_source_entries(uuid)') is null then
  raise exception 'Install the existing points module first.';
 end if;
 if to_regprocedure('preshift_points_private.source_before_staff_labels(uuid)') is null then
  alter function public.points_source_entries(uuid) set schema preshift_points_private;
  alter function preshift_points_private.points_source_entries(uuid) rename to source_before_staff_labels;
 end if;
end;$$;
create or replace function public.points_source_entries(p_location_id uuid)
returns table(user_id uuid,business_date date,entry_key text,points integer,description text)
language sql stable security definer set search_path='' as $$
 select s.user_id,s.business_date,s.entry_key,s.points,
  case when s.entry_key like 'missed-preshift-minute:%' then 'Pre-shift not read'::text else s.description end
 from preshift_points_private.source_before_staff_labels(p_location_id) s;
$$;
revoke all on function preshift_points_private.source_before_staff_labels(uuid),public.points_source_entries(uuid) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;

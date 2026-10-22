begin;
create table if not exists public.team_name_edit_audit (
 id bigint generated always as identity primary key,
 location_id uuid not null references public.locations(id),
 user_id uuid not null references public.profiles(id),
 changed_by uuid not null references public.profiles(id),
 changed_at timestamptz not null default clock_timestamp(),
 before_name jsonb not null,
 after_name jsonb not null
);
alter table public.team_name_edit_audit enable row level security;
revoke all on public.team_name_edit_audit from public,anon,authenticated;
revoke all on sequence public.team_name_edit_audit_id_seq from public,anon,authenticated;

create or replace function public.team_name_editor_load(
 p_location_id uuid,p_user_id uuid default null,p_request_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target uuid; result jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true
 or public.closeout_is_gm(p_location_id) is not true then
  raise exception 'General manager access required.' using errcode='42501';
 end if;
 if (p_user_id is null)=(p_request_id is null) then raise exception 'Choose one employee or registration request.';end if;
 if p_request_id is not null then
  select user_id into target from public.staff_signup_requests where id=p_request_id and location_id=p_location_id;
 else target:=p_user_id;end if;
 if target is null or not (
  exists(select 1 from public.location_memberships where location_id=p_location_id and user_id=target)
  or exists(select 1 from public.staff_signup_requests where location_id=p_location_id and user_id=target)
 ) then raise exception 'Employee is not linked to this location.' using errcode='42501';end if;
 select jsonb_build_object('user_id',id,'full_name',full_name,'preferred_name',preferred_name,
 'name',coalesce(nullif(btrim(preferred_name),''),full_name)) into result from public.profiles where id=target;
 if result is null then raise exception 'Employee profile not found.';end if;
 return result;
end;$$;

create or replace function public.team_name_editor_save(
 p_location_id uuid,p_user_id uuid,p_full_name text,p_preferred_name text,
 p_expected_full_name text,p_expected_preferred_name text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.profiles%rowtype; full_value text; preferred_value text;
begin
 perform public.team_name_editor_load(p_location_id,p_user_id,null);
 full_value:=regexp_replace(btrim(p_full_name),'[[:space:]]+',' ','g');
 preferred_value:=nullif(regexp_replace(btrim(p_preferred_name),'[[:space:]]+',' ','g'),'');
 if full_value is null or length(full_value) not between 1 and 200
 or coalesce(length(preferred_value),0)>100 then raise exception 'Enter a full name up to 200 characters and an optional display name up to 100 characters.';end if;
 select * into prior from public.profiles where id=p_user_id for update;
 if prior.full_name is distinct from p_expected_full_name or prior.preferred_name is distinct from p_expected_preferred_name then
  raise exception 'This name changed in another window. Reload before saving.';
 end if;
 if prior.full_name is not distinct from full_value and prior.preferred_name is not distinct from preferred_value then
  return public.team_name_editor_load(p_location_id,p_user_id,null);
 end if;
 update public.profiles set full_name=full_value,preferred_name=preferred_value where id=p_user_id;
 insert into public.team_name_edit_audit(location_id,user_id,changed_by,before_name,after_name)
 values(p_location_id,p_user_id,auth.uid(),
 jsonb_build_object('full_name',prior.full_name,'preferred_name',prior.preferred_name),
 jsonb_build_object('full_name',full_value,'preferred_name',preferred_value));
 return public.team_name_editor_load(p_location_id,p_user_id,null);
end;$$;
revoke all on function public.team_name_editor_load(uuid,uuid,uuid),public.team_name_editor_save(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.team_name_editor_load(uuid,uuid,uuid),public.team_name_editor_save(uuid,uuid,text,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;

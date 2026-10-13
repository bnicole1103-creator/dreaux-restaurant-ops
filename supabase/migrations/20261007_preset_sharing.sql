begin;
alter table public.preshift_preset_chunks
 add column if not exists owner_id uuid,
 add column if not exists visibility text not null default 'shared';
do $$begin
 if not exists(select 1 from pg_constraint where conrelid='public.preshift_preset_chunks'::regclass and conname='preshift_preset_visibility') then
  alter table public.preshift_preset_chunks add constraint preshift_preset_visibility check(visibility in ('private','shared'));
 end if;
end;$$;
create schema if not exists preshift_private;
revoke all on schema preshift_private from public,anon,authenticated;
-- Preserve the existing starter-preset seeding code without exposing its unfiltered list.
do $$begin
 if to_regprocedure('preshift_private.preshift_presets(uuid)') is null then
  alter function public.preshift_presets(uuid) set schema preshift_private;
 end if;
end;$$;
revoke all on function preshift_private.preshift_presets(uuid) from public,anon,authenticated;
create or replace function public.preshift_presets(p_location_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then
  raise exception 'Manager access required.' using errcode='42501';
 end if;
 perform preshift_private.preshift_presets(p_location_id);
 return coalesce((select jsonb_agg(jsonb_build_object(
  'id',id,'title',title,'category',category,'weekday',weekday,
  'body',body,'version',version,'visibility',visibility,'owner_id',owner_id,
  'can_edit',coalesce(owner_id=auth.uid(),false) or (visibility='shared' and public.closeout_is_gm(p_location_id))
 ) order by category,weekday,title,id)
 from public.preshift_preset_chunks where location_id=p_location_id and deleted_at is null
 and (visibility='shared' or owner_id=auth.uid())),'[]'::jsonb);
end;$$;
create or replace function public.preshift_preset_save(
 p_location_id uuid,p_id uuid,p_version integer,p_title text,
 p_category text,p_weekday integer,p_body text,p_visibility text
)
returns uuid language plpgsql security definer set search_path='' as $$
declare item public.preshift_preset_chunks%rowtype;result uuid;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then
  raise exception 'Manager access required.' using errcode='42501';
 end if;
 if p_title is null or length(btrim(p_title)) not between 1 and 100
 or p_body is null or length(btrim(p_body)) not between 1 and 4000
 or p_category is null or p_category not in ('hours','specials','service','sales','uniform')
 or (p_weekday is not null and p_weekday not between 0 and 6)
 or p_visibility is null or p_visibility not in ('private','shared') then
  raise exception 'Enter a title, category, preset text, visibility and valid day.';
 end if;
 if p_id is null then
  insert into public.preshift_preset_chunks(location_id,title,category,weekday,body,owner_id,visibility)
  values(p_location_id,btrim(p_title),p_category,p_weekday,btrim(p_body),auth.uid(),p_visibility)
  returning id into result;
 else
  select * into item from public.preshift_preset_chunks
  where id=p_id and location_id=p_location_id and deleted_at is null for update;
  if not found or not(coalesce(item.owner_id=auth.uid(),false) or (item.visibility='shared' and public.closeout_is_gm(p_location_id))) then
   raise exception 'This preset is unavailable or belongs to another manager. Make your own copy.' using errcode='42501';
  end if;
  if item.version is distinct from p_version then raise exception 'This preset changed. Reload before saving.';end if;
  if p_visibility='private' and item.owner_id is not null and item.owner_id<>auth.uid() then
   raise exception 'Only the owner can make this preset private.' using errcode='42501';
  end if;
  update public.preshift_preset_chunks set title=btrim(p_title),category=p_category,weekday=p_weekday,
  body=btrim(p_body),visibility=p_visibility,owner_id=coalesce(owner_id,auth.uid()),version=version+1,updated_at=now()
  where id=item.id returning id into result;
 end if;
 return result;
end;$$;
-- Older app versions cannot bypass ownership checks.
create or replace function public.preshift_preset_save(
 p_location_id uuid,p_id uuid,p_version integer,p_title text,
 p_category text,p_weekday integer,p_body text
)
returns uuid language plpgsql security definer set search_path='' as $$
declare scope text;
begin
 if p_id is null then scope:='private';else
  select visibility into scope from public.preshift_preset_chunks where id=p_id and location_id=p_location_id;
 end if;
 return public.preshift_preset_save(p_location_id,p_id,p_version,p_title,p_category,p_weekday,p_body,coalesce(scope,'private'));
end;$$;
create or replace function public.preshift_preset_remove(p_location_id uuid,p_id uuid,p_version integer)
returns void language plpgsql security definer set search_path='' as $$
declare item public.preshift_preset_chunks%rowtype;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then
  raise exception 'Manager access required.' using errcode='42501';
 end if;
 select * into item from public.preshift_preset_chunks where id=p_id and location_id=p_location_id and deleted_at is null for update;
 if not found or not(coalesce(item.owner_id=auth.uid(),false) or (item.visibility='shared' and public.closeout_is_gm(p_location_id))) then
  raise exception 'This preset is unavailable or belongs to another manager.' using errcode='42501';
 end if;
 if item.version is distinct from p_version then raise exception 'This preset changed. Reload before removing.';end if;
 update public.preshift_preset_chunks set deleted_at=now(),version=version+1,updated_at=now() where id=item.id;
end;$$;
revoke all on public.preshift_preset_chunks from public,anon,authenticated;
revoke all on function public.preshift_presets(uuid),public.preshift_preset_save(uuid,uuid,integer,text,text,integer,text),public.preshift_preset_save(uuid,uuid,integer,text,text,integer,text,text),public.preshift_preset_remove(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.preshift_presets(uuid),public.preshift_preset_save(uuid,uuid,integer,text,text,integer,text),public.preshift_preset_save(uuid,uuid,integer,text,text,integer,text,text),public.preshift_preset_remove(uuid,uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;

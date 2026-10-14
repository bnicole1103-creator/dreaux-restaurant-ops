begin;
alter table public.training_study_guides add column if not exists version integer not null default 1;
alter table public.training_study_guides add column if not exists updated_at timestamptz not null default now();
alter table public.training_study_guides add column if not exists updated_by uuid references public.profiles(id);

create or replace function public.training_guide_update(
 p_location_id uuid,p_id uuid,p_version integer,p_title text,p_recipes jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 guide public.training_study_guides; item jsonb; original jsonb;
 d jsonb; k text; rid uuid; seen uuid[]:=array[]::uuid[]; result jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true
 or public.closeout_is_gm(p_location_id) is not true then
  raise exception 'Management access required.' using errcode='42501';end if;
 if p_title is null or length(btrim(p_title)) not between 1 and 160
 or jsonb_typeof(p_recipes) is distinct from 'array' then raise exception 'Enter a title and recipe sections.';end if;
 if jsonb_array_length(p_recipes) not between 1 and 30 or octet_length(p_recipes::text)>2000000 then
  raise exception 'Keep 1–30 recipe sections within the guide size limit.';end if;
 select * into guide from public.training_study_guides
 where id=p_id and location_id=p_location_id for update;
 if guide.id is null then raise exception 'Study guide is unavailable.';end if;
 if guide.version is distinct from p_version then
  raise exception 'This study guide changed. Close and reopen the latest guide before editing.' using errcode='40001';end if;
 for item in select value from jsonb_array_elements(p_recipes) loop
  if jsonb_typeof(item) is distinct from 'object' then raise exception 'Invalid recipe section.';end if;
  if (item-array['id','version','data'])<>'{}'::jsonb
  or jsonb_typeof(item->'id') is distinct from 'string'
  or jsonb_typeof(item->'version') is distinct from 'number' then raise exception 'Invalid recipe section.';end if;
  rid:=(item->>'id')::uuid;
  if rid=any(seen) then raise exception 'Each recipe section may appear once.';end if;
  seen:=array_append(seen,rid);
  select value into original from jsonb_array_elements(guide.recipes) where value->>'id'=rid::text;
  if original is null or original->'version' is distinct from item->'version' then
   raise exception 'Source references cannot be changed. Generate a new guide to use different recipes.';end if;
  d:=item->'data';
  if jsonb_typeof(d) is distinct from 'object' then raise exception 'Invalid section text.';end if;
  if (d-array['name','category','build','method','finish','notes'])<>'{}'::jsonb then raise exception 'Unsupported section field.';end if;
  foreach k in array array['name','category','build','method','finish','notes'] loop
   if jsonb_typeof(d->k) is distinct from 'string' or length(d->>k)>12000 then raise exception 'Invalid section text: %',k;end if;
  end loop;
  if length(btrim(d->>'name')) not between 1 and 160 or length(btrim(d->>'category')) not between 1 and 80 then
   raise exception 'Enter each recipe heading and category.';end if;
 end loop;
 update public.training_study_guides set title=btrim(p_title),recipes=p_recipes,
 version=version+1,updated_at=now(),updated_by=auth.uid() where id=p_id;
 select to_jsonb(g) into result from public.training_study_guides g where id=p_id;
 return result;
end;$$;
revoke all on function public.training_guide_update(uuid,uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.training_guide_update(uuid,uuid,integer,text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;

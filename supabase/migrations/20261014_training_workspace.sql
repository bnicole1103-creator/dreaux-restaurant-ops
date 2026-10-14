begin;
create or replace function public.training_cocktails_save(p_location_id uuid,p_recipes jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare item jsonb; d jsonb; k text; rid uuid; expected integer;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.closeout_is_gm(p_location_id) is not true then
  raise exception 'Management access required.' using errcode='42501';
 end if;
 if jsonb_typeof(p_recipes) is distinct from 'array' then raise exception 'Enter recipes.'; end if;
 if jsonb_array_length(p_recipes) not between 1 and 50 or length(p_recipes::text)>12000000 then raise exception 'Save 1 to 50 recipes at a time.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('training-cocktails:'||p_location_id::text,0));
 for item in select value from jsonb_array_elements(p_recipes) loop
  d:=item->'data';
  if jsonb_typeof(d) is distinct from 'object' then raise exception 'Invalid recipe.'; end if;
  if exists(select 1 from jsonb_object_keys(d) x where x not in ('name','category','build','method','finish','notes','photo')) then raise exception 'Unsupported recipe field.'; end if;
  foreach k in array array['name','category','build','method','finish','notes'] loop
   if jsonb_typeof(d->k) is distinct from 'string' or length(d->>k)>12000 then raise exception 'Invalid or oversized recipe field: %',k; end if;
  end loop;
  if length(btrim(d->>'name')) not between 1 and 160 or length(btrim(d->>'category')) not between 1 and 80 then raise exception 'Enter a cocktail name and category.'; end if;
  if d ? 'photo' and (jsonb_typeof(d->'photo') is distinct from 'string' or length(d->>'photo')>800000 or ((d->>'photo')<>'' and (d->>'photo')!~'^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$')) then raise exception 'Choose a valid recipe photo.';end if;
  d:=jsonb_set(jsonb_set(d,'{name}',to_jsonb(btrim(d->>'name'))),'{category}',to_jsonb(btrim(d->>'category')));
  rid:=nullif(item->>'id','')::uuid;
  if rid is null then
   if exists(select 1 from public.training_cocktails where location_id=p_location_id and name_key=lower(regexp_replace(btrim(d->>'name'),'[[:space:]]+',' ','g'))) then
    raise exception 'Cocktail already exists: %. Open it and choose Edit.',d->>'name';
   end if;
   insert into public.training_cocktails(location_id,data,updated_by) values(p_location_id,d,auth.uid());
  else
   expected:=(item->>'version')::integer;
   update public.training_cocktails set data=d,version=version+1,updated_at=now(),updated_by=auth.uid()
   where id=rid and location_id=p_location_id and version=expected;
   if not found then raise exception 'Recipe changed or is unavailable. Refresh before editing.'; end if;
  end if;
 end loop;
end; $$;

create table if not exists public.training_food
 (like public.training_cocktails including all);
alter table public.training_food enable row level security;
revoke all on public.training_food from public,anon,authenticated;
do $food$
declare definition text;
begin
 if not exists(select 1 from pg_constraint where conrelid='public.training_food'::regclass and conname='training_food_location_fk') then
  alter table public.training_food add constraint training_food_location_fk foreign key(location_id) references public.locations(id);
 end if;
 definition:=pg_get_functiondef('public.training_cocktails_save(uuid,jsonb)'::regprocedure);
 definition:=replace(definition,'public.training_cocktails','public.training_food');
 definition:=replace(definition,'training-cocktails:','training-food:');
 definition:=replace(replace(definition,'Cocktail already exists:','Recipe already exists:'),'Enter a cocktail name and category.','Enter a recipe name and category.');
 execute definition;
end;$food$;
create or replace function public.training_food_load(p_location_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then
  raise exception 'Active location access required.' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(to_jsonb(c) order by c.data->>'name'),'[]'::jsonb)
 from public.training_food c where location_id=p_location_id);
end;$$;
create table if not exists public.training_study_guides(
 id uuid primary key default gen_random_uuid(),
 location_id uuid not null references public.locations(id),
 kind text not null check(kind in ('cocktails','food')),
 title text not null,recipes jsonb not null,
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now()
);
alter table public.training_study_guides enable row level security;
revoke all on public.training_study_guides from public,anon,authenticated;
create or replace function public.training_guides_load(p_location_id uuid,p_kind text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then
  raise exception 'Location access required.' using errcode='42501';end if;
 if p_kind not in ('cocktails','food') or p_kind is null then raise exception 'Choose food or cocktails.';end if;
 return (select coalesce(jsonb_agg(to_jsonb(g) order by g.created_at desc),'[]'::jsonb)
 from public.training_study_guides g where location_id=p_location_id and kind=p_kind);
end;$$;
create or replace function public.training_guide_create(p_location_id uuid,p_kind text,p_title text,p_recipe_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare snapshots jsonb; result jsonb; gid uuid;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true
 or public.closeout_is_gm(p_location_id) is not true then
  raise exception 'Management access required.' using errcode='42501';end if;
 if p_kind is null or p_kind not in ('cocktails','food')
 or p_title is null or length(btrim(p_title)) not between 1 and 160
 or p_recipe_ids is null or cardinality(p_recipe_ids) not between 1 and 30
 or exists(select 1 from unnest(p_recipe_ids) id where id is null)
 or (select count(distinct id) from unnest(p_recipe_ids) id)<>cardinality(p_recipe_ids) then
  raise exception 'Choose a title and 1–30 distinct recipes.';end if;
 if p_kind='cocktails' then
  select jsonb_agg(jsonb_build_object('id',id,'version',version,'data',data-'photo') order by array_position(p_recipe_ids,id)) into snapshots
  from public.training_cocktails where location_id=p_location_id and id=any(p_recipe_ids);
 else
  select jsonb_agg(jsonb_build_object('id',id,'version',version,'data',data-'photo') order by array_position(p_recipe_ids,id)) into snapshots
  from public.training_food where location_id=p_location_id and id=any(p_recipe_ids);
 end if;
 if snapshots is null or jsonb_array_length(snapshots)<>cardinality(p_recipe_ids) then
  raise exception 'A selected recipe is unavailable. Refresh recipes.';end if;
 insert into public.training_study_guides(location_id,kind,title,recipes,created_by)
 values(p_location_id,p_kind,btrim(p_title),snapshots,auth.uid()) returning id into gid;
 select to_jsonb(g) into result from public.training_study_guides g where id=gid;
 return result;
end;$$;
revoke all on function public.training_cocktails_save(uuid,jsonb),public.training_food_save(uuid,jsonb),public.training_food_load(uuid),public.training_guides_load(uuid,text),public.training_guide_create(uuid,text,text,uuid[]) from public,anon,authenticated;
grant execute on function public.training_cocktails_save(uuid,jsonb),public.training_food_save(uuid,jsonb),public.training_food_load(uuid),public.training_guides_load(uuid,text),public.training_guide_create(uuid,text,text,uuid[]) to authenticated;
notify pgrst,'reload schema';
commit;

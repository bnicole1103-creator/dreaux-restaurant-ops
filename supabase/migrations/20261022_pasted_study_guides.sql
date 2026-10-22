begin;

do $check$
begin
 if to_regprocedure('public.training_guide_update(uuid,uuid,integer,text,jsonb)') is null then
  raise exception 'Install the existing study guide editor before this update.';
 end if;
end;
$check$;

alter table public.training_study_guides
 add column if not exists source_text text;

create table if not exists public.training_guide_generation_limits (
 location_id uuid not null references public.locations(id),
 user_id uuid not null references public.profiles(id),
 last_at timestamptz not null default now(),
 primary key(location_id,user_id)
);
alter table public.training_guide_generation_limits enable row level security;
revoke all on public.training_guide_generation_limits from public,anon,authenticated;

create or replace function public.training_guide_generation_claim(p_location_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null
 or public.closeout_is_member(p_location_id) is not true
 or public.closeout_is_gm(p_location_id) is not true then
  raise exception 'Management access required.' using errcode='42501';
 end if;
 insert into public.training_guide_generation_limits(location_id,user_id,last_at)
 values(p_location_id,auth.uid(),now())
 on conflict(location_id,user_id) do update set last_at=excluded.last_at
 where public.training_guide_generation_limits.last_at <= now()-interval '30 seconds';
 if not found then
  raise exception 'Wait 30 seconds between study guide generation requests.';
 end if;
 return true;
end;
$$;

create or replace function public.training_guide_create_text(
 p_location_id uuid,p_kind text,p_title text,p_source text,p_sections jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 d jsonb; k text; snapshots jsonb:='[]'::jsonb; result jsonb; gid uuid;
begin
 if auth.uid() is null
 or public.closeout_is_member(p_location_id) is not true
 or public.closeout_is_gm(p_location_id) is not true then
  raise exception 'Management access required.' using errcode='42501';
 end if;
 if p_kind is null or p_kind not in ('cocktails','food')
 or p_title is null or length(btrim(p_title)) not between 1 and 160
 or p_source is null or length(btrim(p_source))<30 or length(p_source)>12000
 or jsonb_typeof(p_sections) is distinct from 'array' then
  raise exception 'Enter a title, training source and study sections.';
 end if;
 if jsonb_array_length(p_sections) not between 1 and 12
 or octet_length(p_sections::text)>160000 then
  raise exception 'Keep 1–12 study sections within the guide size limit.';
 end if;
 for d in select value from jsonb_array_elements(p_sections) loop
  if jsonb_typeof(d) is distinct from 'object'
  or (d-array['name','category','build','method','finish','notes'])<>'{}'::jsonb then
   raise exception 'Invalid study section.';
  end if;
  foreach k in array array['name','category','build','method','finish','notes'] loop
   if jsonb_typeof(d->k) is distinct from 'string' or length(d->>k)>12000 then
    raise exception 'Invalid study section text: %',k;
   end if;
  end loop;
  if length(btrim(d->>'name')) not between 1 and 160
  or length(btrim(d->>'category')) not between 1 and 80 then
   raise exception 'Enter each section heading and category.';
  end if;
  snapshots:=snapshots||jsonb_build_array(jsonb_build_object(
   'id',gen_random_uuid(),'version',1,'data',d
  ));
 end loop;
 insert into public.training_study_guides(location_id,kind,title,recipes,source_text,created_by)
 values(p_location_id,p_kind,btrim(p_title),snapshots,p_source,auth.uid()) returning id into gid;
 select to_jsonb(g) into result from public.training_study_guides g where id=gid;
 return result;
end;
$$;

revoke all on function public.training_guide_generation_claim(uuid),
 public.training_guide_create_text(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.training_guide_generation_claim(uuid),
 public.training_guide_create_text(uuid,text,text,text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;

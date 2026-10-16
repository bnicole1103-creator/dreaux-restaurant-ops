begin;
create or replace function public.personal_space_valid(p jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare s jsonb;begin
 if jsonb_typeof(p) is distinct from 'object' then return false;end if;
 if (select count(*) from jsonb_object_keys(p))<>4
 or coalesce(p->>'theme' not in ('vanilla','rose','garden','sky','mardi','autumn'),true)
 or coalesce(p->>'pattern' not in ('plain','dots','stripes','glow','confetti'),true)
 or coalesce(p->>'decal' not in ('none','sparkles','botanical','ribbon','film'),true)
 or jsonb_typeof(p->'stickers') is distinct from 'array' then return false;end if;
 if jsonb_array_length(p->'stickers')>6 then return false;end if;
 for s in select jsonb_array_elements(p->'stickers') loop
  if jsonb_typeof(s) is distinct from 'object' then return false;end if;
  if (select count(*) from jsonb_object_keys(s))<>4
  or coalesce(s->>'id' not in ('pumpkin','ghost','bat','web','candy','maple','leaves','sunflower','pie','tree','snow','snowman','gift','bow','heart','rose','kiss','hearts','mask','crown','fleur','confetti','flower','tulip','butterfly','rainbow','sun','lemon','palm','watermelon','sparkle','cocktail','cheers','star','music','party'),true)
  or coalesce(s->>'spot' not in ('left','center','right'),true)
  or jsonb_typeof(s->'size') is distinct from 'number'
  or jsonb_typeof(s->'rotation') is distinct from 'number' then return false;end if;
  if (s->>'size')::numeric not between 24 and 64 or (s->>'rotation')::numeric not between -25 and 25 then return false;end if;
 end loop;
 return true;
end;$$;
create table if not exists public.personal_spaces(
 location_id uuid not null references public.locations(id),
 user_id uuid not null references public.profiles(id),
 config jsonb not null default '{"theme":"vanilla","pattern":"plain","decal":"none","stickers":[]}'::jsonb check(public.personal_space_valid(config)),
 version integer not null default 0 check(version>=0),
 updated_at timestamptz not null default now(),
 primary key(location_id,user_id)
);
alter table public.personal_spaces enable row level security;
revoke all on public.personal_spaces from public,anon,authenticated;
create or replace function public.personal_space_load(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active location access required.' using errcode='42501';end if;
 return jsonb_build_object('user_id',auth.uid(),
 'name',(select full_name from public.profiles where id=auth.uid()),
 'photo',coalesce((select photo from public.crew_photos where user_id=auth.uid()),(select photo_url from public.profiles where id=auth.uid())),
 'config',coalesce((select config from public.personal_spaces where location_id=p_location_id and user_id=auth.uid()),'{"theme":"vanilla","pattern":"plain","decal":"none","stickers":[]}'::jsonb),
 'version',coalesce((select version from public.personal_spaces where location_id=p_location_id and user_id=auth.uid()),0));
end;$$;
create or replace function public.personal_space_save(p_location_id uuid,p_config jsonb,p_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_version integer;begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active location access required.' using errcode='42501';end if;
 if public.personal_space_valid(p_config) is not true then raise exception 'Choose supported themes, decals and up to six stickers.';end if;
 insert into public.personal_spaces(location_id,user_id) values(p_location_id,auth.uid()) on conflict do nothing;
 select version into current_version from public.personal_spaces where location_id=p_location_id and user_id=auth.uid() for update;
 if p_version is distinct from current_version then raise exception 'Your theme changed in another window. Reload your theme before saving.';end if;
 update public.personal_spaces set config=p_config,version=version+1,updated_at=clock_timestamp() where location_id=p_location_id and user_id=auth.uid();
 return public.personal_space_load(p_location_id);
end;$$;
create or replace function public.crew_room_load(p_location_id uuid,p_date date,p_before bigint default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;messages jsonb;crew jsonb;my_name text;begin
 result:=public.crew_room_load_before_styles(p_location_id,p_date,p_before);
 if coalesce((result->>'can_crew')::boolean,false) then
  select coalesce(jsonb_agg(m||jsonb_build_object('name',case when p.id is null then m->>'name' when btrim(coalesce(p.full_name,''))~'\S+\s+\S+' then btrim(p.full_name) else 'Profile name needs updating' end,'wall_style',coalesce(s.style,public.crew_chat_style_default()),'personal_space',d.config) order by ord),'[]'::jsonb)
  into crew from jsonb_array_elements(result->'crew') with ordinality x(m,ord)
  left join public.profiles p on p.id=(m->>'user_id')::uuid
  left join public.crew_chat_styles s on s.location_id=p_location_id and s.user_id=p.id
  left join public.personal_spaces d on d.location_id=p_location_id and d.user_id=p.id;
  result:=result||jsonb_build_object('crew',crew);
 end if;

 if coalesce((result->>'can_chat')::boolean,false) then
  select btrim(full_name) into my_name from public.profiles where id=auth.uid();
  select coalesce(jsonb_agg(m||jsonb_build_object('name',case when btrim(coalesce(p.full_name,''))~'\S+\s+\S+' then btrim(p.full_name) else 'Profile name needs updating' end,'wall_style',coalesce(s.style,public.crew_chat_style_default()),'personal_space',d.config) order by ord),'[]'::jsonb)
  into messages from jsonb_array_elements(result->'messages') with ordinality x(m,ord)
  left join public.profiles p on p.id=(m->>'user_id')::uuid
  left join public.crew_chat_styles s on s.location_id=p_location_id and s.user_id=p.id
  left join public.personal_spaces d on d.location_id=p_location_id and d.user_id=p.id;
  result:=result||jsonb_build_object('messages',messages,'my_personal_space',(select config from public.personal_spaces where location_id=p_location_id and user_id=auth.uid()),'my_wall_style',coalesce((select style from public.crew_chat_styles where location_id=p_location_id and user_id=auth.uid()),public.crew_chat_style_default()),'chat_full_name',my_name,'chat_name_ready',coalesce(my_name~'\S+\s+\S+',false));
 end if;
 return result;
end;$$;
revoke all on function public.personal_space_load(uuid),public.personal_space_save(uuid,jsonb,integer),public.crew_room_load(uuid,date,bigint) from public,anon,authenticated;
grant execute on function public.personal_space_load(uuid),public.personal_space_save(uuid,jsonb,integer),public.crew_room_load(uuid,date,bigint) to authenticated;
notify pgrst,'reload schema';
commit;

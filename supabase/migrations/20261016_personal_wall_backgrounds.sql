begin;
create or replace function public.crew_chat_style_valid(p_style jsonb) returns boolean language sql immutable set search_path='' as $$
 select case when jsonb_typeof(p_style)='object' then coalesce(true
 and (select count(*) from jsonb_object_keys(p_style - array['profile_color','profile_pattern','chat_pattern']))=5
 and p_style->>'name_font' in ('system','serif','rounded','mono','script','editorial','condensed','friendly','modern','allura','greatvibes','parisienne','sacramento','dancing')
 and p_style->>'message_font' in ('system','serif','rounded','mono','script','editorial','condensed','friendly','modern','allura','greatvibes','parisienne','sacramento','dancing')
 and p_style->>'name_color' in ('espresso','berry','plum','navy','teal','rust','forest','black')
 and p_style->>'message_color' in ('espresso','berry','plum','navy','teal','rust','forest','black')
 and p_style->>'bubble_color' in ('cream','rose','lavender','sky','mint','gold')
 and (not (p_style ? 'profile_color') or p_style->>'profile_color' in ('cream','rose','lavender','sky','mint','gold'))
 and (not (p_style ? 'profile_pattern') or p_style->>'profile_pattern' in ('plain','dots','stripes','glow','confetti'))
 and (not (p_style ? 'chat_pattern') or p_style->>'chat_pattern' in ('plain','dots','stripes','glow','confetti')),false) else false end;
$$;
create or replace function public.crew_room_load(p_location_id uuid,p_date date,p_before bigint default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;messages jsonb;crew jsonb;my_name text;begin
 result:=public.crew_room_load_before_styles(p_location_id,p_date,p_before);
 if coalesce((result->>'can_crew')::boolean,false) then
  select coalesce(jsonb_agg(m||jsonb_build_object('name',case when p.id is null then m->>'name' when btrim(coalesce(p.full_name,''))~'\S+\s+\S+' then btrim(p.full_name) else 'Profile name needs updating' end,'wall_style',coalesce(s.style,public.crew_chat_style_default())) order by ord),'[]'::jsonb)
  into crew from jsonb_array_elements(result->'crew') with ordinality x(m,ord)
  left join public.profiles p on p.id=(m->>'user_id')::uuid
  left join public.crew_chat_styles s on s.location_id=p_location_id and s.user_id=p.id;
  result:=result||jsonb_build_object('crew',crew);
 end if;

 if coalesce((result->>'can_chat')::boolean,false) then
  select btrim(full_name) into my_name from public.profiles where id=auth.uid();
  select coalesce(jsonb_agg(m||jsonb_build_object('name',case when btrim(coalesce(p.full_name,''))~'\S+\s+\S+' then btrim(p.full_name) else 'Profile name needs updating' end,'wall_style',coalesce(s.style,public.crew_chat_style_default())) order by ord),'[]'::jsonb)
  into messages from jsonb_array_elements(result->'messages') with ordinality x(m,ord)
  left join public.profiles p on p.id=(m->>'user_id')::uuid
  left join public.crew_chat_styles s on s.location_id=p_location_id and s.user_id=p.id;
  result:=result||jsonb_build_object('messages',messages,'my_wall_style',coalesce((select style from public.crew_chat_styles where location_id=p_location_id and user_id=auth.uid()),public.crew_chat_style_default()),'chat_full_name',my_name,'chat_name_ready',coalesce(my_name~'\S+\s+\S+',false));
 end if;
 return result;
end;$$;
revoke all on function public.crew_room_load(uuid,date,bigint) from public,anon,authenticated;
grant execute on function public.crew_room_load(uuid,date,bigint) to authenticated;
notify pgrst,'reload schema';
commit;

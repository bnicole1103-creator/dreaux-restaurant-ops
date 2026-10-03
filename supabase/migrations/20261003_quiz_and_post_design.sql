begin;
alter table public.preshift_posts add column if not exists presentation jsonb not null default '{"title":"brown","text":"brown","accent":"tan"}'::jsonb;
create or replace function public.preshift_feed(p_location_id uuid,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.closeout_is_member(p_location_id) then raise exception 'Location access required.' using errcode='42501'; end if;
 select jsonb_build_object('posts',coalesce((select jsonb_agg(to_jsonb(q) order by q.pinned desc,q.created_at desc,q.id desc) from (
  select t.id,t.presentation,t.title,t.body,t.shift_date,t.pinned,t.version,t.created_at,t.updated_at,
   coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''),'Manager') as author
  from public.preshift_posts t left join public.profiles p on p.id=t.author_id
  where t.location_id=p_location_id and t.deleted_at is null
  order by t.pinned desc,t.created_at desc,t.id desc limit greatest(1,least(coalesce(p_limit,50),1000))
 ) q),'[]'::jsonb),'total',(select count(*) from public.preshift_posts where location_id=p_location_id and deleted_at is null)) into result;
 return result;
end; $$;

create or replace function public.preshift_post_save_styled(
 p_location_id uuid,p_id uuid,p_version integer,p_title text,p_body text,
 p_shift_date date,p_pinned boolean,p_presentation jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare post_id uuid; key text; value text;
begin
 if auth.uid() is null or not public.closeout_is_member(p_location_id) or not public.mod_is_manager(p_location_id) then
  raise exception 'Manager access required.' using errcode='42501';
 end if;
 if p_presentation is null or jsonb_typeof(p_presentation)<>'object' then raise exception 'Choose valid post colors.'; end if;
 if (select count(*) from jsonb_object_keys(p_presentation))<>3 then raise exception 'Choose title, text and accent colors.'; end if;
 for key,value in select * from jsonb_each_text(p_presentation) loop
  if key not in ('title','text','accent') or value is null or value not in ('brown','tan','rose','plum','green','orange') then
   raise exception 'Choose valid post colors.';
  end if;
 end loop;
 post_id:=public.preshift_post_save(p_location_id,p_id,p_version,p_title,p_body,p_shift_date,p_pinned);
 update public.preshift_posts set presentation=p_presentation where id=post_id and location_id=p_location_id;
 return post_id;
end; $$;
revoke all on function public.preshift_post_save_styled(uuid,uuid,integer,text,text,date,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.preshift_post_save_styled(uuid,uuid,integer,text,text,date,boolean,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;

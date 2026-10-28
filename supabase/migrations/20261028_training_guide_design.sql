begin;
alter table public.training_content_library
 add column if not exists category text not null default '',
 add column if not exists tags text[] not null default '{}',
 add column if not exists presentation jsonb not null default '{}',
 add column if not exists video_path text not null default '',
 add column if not exists video_url text not null default '';

create or replace function public.training_guide_media_access_v1(p_name text,p_write boolean)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare loc uuid;
begin
 if p_name !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(mp4|mov|webm)$' then return false;end if;
 loc:=split_part(p_name,'/',1)::uuid;
 if auth.uid() is null or public.closeout_is_member(loc) is not true then return false;end if;
 perform public.app_access_assert(loc,'training','service');
 if p_write then
  return public.closeout_is_gm(loc) is true and split_part(p_name,'/',2)=auth.uid()::text;
 end if;
 return true;
exception when others then return false;
end;$$;
revoke all on function public.training_guide_media_access_v1(text,boolean) from public,anon;
grant execute on function public.training_guide_media_access_v1(text,boolean) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('training-guide-videos','training-guide-videos',false,52428800,array['video/mp4','video/quicktime','video/webm'])
on conflict(id) do nothing;

drop policy if exists training_guide_video_read_v1 on storage.objects;
create policy training_guide_video_read_v1 on storage.objects for select to authenticated
using(bucket_id='training-guide-videos' and public.training_guide_media_access_v1(name,false));
drop policy if exists training_guide_video_insert_v1 on storage.objects;
create policy training_guide_video_insert_v1 on storage.objects for insert to authenticated
with check(bucket_id='training-guide-videos' and public.training_guide_media_access_v1(name,true));

-- Cleanup only unreferenced uploads; saved guides cannot lose their video through this policy.
create or replace function public.training_guide_video_unused_v1(p_name text)
returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.training_content_library where video_path=p_name);
$$;
revoke all on function public.training_guide_video_unused_v1(text) from public,anon;
grant execute on function public.training_guide_video_unused_v1(text) to authenticated;
drop policy if exists training_guide_video_delete_v1 on storage.objects;
create policy training_guide_video_delete_v1 on storage.objects for delete to authenticated
using(bucket_id='training-guide-videos' and public.training_guide_media_access_v1(name,true) and public.training_guide_video_unused_v1(name));

create or replace function public.training_content_save_styled_v1(
 p_location_id uuid,p_id uuid,p_version integer,p_shelf text,p_title text,p_body text,
 p_filename text,p_asset text,p_category text,p_tags text[],p_presentation jsonb,
 p_video_path text,p_video_url text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; doc_id uuid; style jsonb;
begin
 perform public.training_content_assert(p_location_id,p_shelf,true);
 if p_category is null or length(p_category)>80 or p_tags is null or cardinality(p_tags)>20
 or exists(select 1 from unnest(p_tags) t where t is null or length(t)>50) then
  raise exception 'Use a category up to 80 characters and up to 20 tags of 50 characters.';
 end if;
 if p_presentation is null or jsonb_typeof(p_presentation)<>'object' then raise exception 'Choose a document style.';end if;
 if coalesce(p_presentation->>'theme','') not in ('cream','midnight','sage','white')
 or coalesce(p_presentation->>'font','') not in ('system','classic','clean','mono')
 or coalesce(p_presentation->>'layout','') not in ('reading','cards','checklist')
 or coalesce(p_presentation->>'size','') !~ '^(1[4-9]|2[0-8])$'
 or coalesce(p_presentation->>'background','') !~ '^#[a-fA-F0-9]{6}$'
 or coalesce(p_presentation->>'color','') !~ '^#[a-fA-F0-9]{6}$'
 or coalesce(p_presentation->>'accent','') !~ '^#[a-fA-F0-9]{6}$'
 or length(coalesce(p_presentation->>'icon',''))>12 then raise exception 'Invalid font, layout, color, size or icon.';end if;
 style:=jsonb_build_object('theme',p_presentation->>'theme','font',p_presentation->>'font',
  'layout',p_presentation->>'layout','size',(p_presentation->>'size')::integer,
  'background',p_presentation->>'background','color',p_presentation->>'color',
  'accent',p_presentation->>'accent','icon',coalesce(p_presentation->>'icon',''));
 if p_video_path is null or p_video_url is null or length(p_video_url)>2000
 or (p_video_path<>'' and p_video_url<>'')
 or (p_video_url<>'' and p_video_url !~ '^https://[^[:space:]]+$') then
  raise exception 'Choose one uploaded video or a valid HTTPS video link.';
 end if;
 if p_video_path<>'' then
  if split_part(p_video_path,'/',1)<>p_location_id::text
  or public.training_guide_media_access_v1(p_video_path,false) is not true
  or not exists(select 1 from storage.objects where bucket_id='training-guide-videos' and name=p_video_path) then
   raise exception 'Video unavailable. Upload it again before saving.';
  end if;
 end if;
 result:=public.training_content_save(p_location_id,p_id,p_version,p_shelf,p_title,p_body,p_filename,p_asset);
 doc_id:=(result->>'id')::uuid;
 update public.training_content_library set category=btrim(p_category),tags=p_tags,presentation=style,
  video_path=p_video_path,video_url=p_video_url where id=doc_id;
 return public.training_content_get(p_location_id,doc_id);
end;$$;
revoke all on function public.training_content_save_styled_v1(uuid,uuid,integer,text,text,text,text,text,text,text[],jsonb,text,text) from public,anon,authenticated;
grant execute on function public.training_content_save_styled_v1(uuid,uuid,integer,text,text,text,text,text,text,text[],jsonb,text,text) to authenticated;
notify pgrst,'reload schema';
commit;

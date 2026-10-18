begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('crew-chat-media','crew-chat-media',false,52428800,
 array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create table if not exists public.crew_message_media(
 message_id bigint not null references public.crew_messages(id) on delete cascade,
 position integer not null check(position between 0 and 5),
 path text not null unique,kind text not null check(kind in ('image','video')),
 name text not null check(length(name) between 1 and 180),
 size bigint not null check(size between 1 and 52428800),mime text not null,
 primary key(message_id,position)
);
alter table public.crew_message_media enable row level security;
revoke all on public.crew_message_media from public,anon,authenticated;
create or replace function public.crew_media_write_allowed(p_path text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare loc uuid;
begin
 if auth.uid() is null or p_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|gif|mp4|webm|mov)$' then return false;end if;
 begin loc:=split_part(p_path,'/',1)::uuid;exception when invalid_text_representation then return false;end;
 return split_part(p_path,'/',2)=auth.uid()::text
  and public.closeout_is_member(loc) is true
  and public.app_access_allowed(loc,'schedule','chat') is true
  and not exists(select 1 from public.crew_message_media a join public.crew_messages m on m.id=a.message_id where a.path=p_path and m.deleted_at is null);
end $$;
create or replace function public.crew_media_read_allowed(p_path text)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (exists(
  select 1 from public.crew_message_media a join public.crew_messages m on m.id=a.message_id
  where a.path=p_path and m.deleted_at is null
   and public.closeout_is_member(m.location_id) is true
   and public.app_access_allowed(m.location_id,'schedule','chat') is true
 ) or (public.crew_media_write_allowed(p_path) and not exists(select 1 from public.crew_message_media where path=p_path)));
$$;
drop policy if exists crew_media_insert on storage.objects;
create policy crew_media_insert on storage.objects for insert to authenticated
 with check(bucket_id='crew-chat-media' and public.crew_media_write_allowed(name));
drop policy if exists crew_media_select on storage.objects;
create policy crew_media_select on storage.objects for select to authenticated
 using(bucket_id='crew-chat-media' and public.crew_media_read_allowed(name));
drop policy if exists crew_media_delete on storage.objects;
create policy crew_media_delete on storage.objects for delete to authenticated
 using(bucket_id='crew-chat-media' and public.crew_media_write_allowed(name));
-- Restrictive guards also protect this bucket from broader existing storage policies.
drop policy if exists crew_media_insert_guard on storage.objects;
create policy crew_media_insert_guard on storage.objects as restrictive for insert to authenticated
 with check(bucket_id<>'crew-chat-media' or public.crew_media_write_allowed(name));
drop policy if exists crew_media_select_guard on storage.objects;
create policy crew_media_select_guard on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'crew-chat-media' or public.crew_media_read_allowed(name));
drop policy if exists crew_media_delete_guard on storage.objects;
create policy crew_media_delete_guard on storage.objects as restrictive for delete to authenticated
 using(bucket_id<>'crew-chat-media' or public.crew_media_write_allowed(name));
drop policy if exists crew_media_update_guard on storage.objects;
create policy crew_media_update_guard on storage.objects as restrictive for update to authenticated
 using(bucket_id<>'crew-chat-media') with check(bucket_id<>'crew-chat-media');
create or replace function public.crew_message_send_media(
 p_location_id uuid,p_date date,p_request uuid,p_body text,p_media jsonb
) returns text language plpgsql security definer set search_path='' as $$
declare mid bigint;asset jsonb;obj storage.objects%rowtype;items jsonb:='[]';existing jsonb;
 prior boolean;idx integer:=0;clean text:=btrim(coalesce(p_body,''));kind text;mime text;size bigint;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true
  or public.app_access_allowed(p_location_id,'schedule','chat') is not true then
  raise exception 'Chat access required.' using errcode='42501';end if;
 if p_request is null or jsonb_typeof(p_media) is distinct from 'array' then raise exception 'Choose valid attachments.';end if;
 if jsonb_array_length(p_media)>6 then raise exception 'Choose up to six attachments.';end if;
 if clean='' and jsonb_array_length(p_media)=0 then raise exception 'Add a message, photo or video.';end if;
 if clean='' then clean:='Shared photos or videos.';end if;
 perform pg_advisory_xact_lock(hashtextextended('crew-media:'||auth.uid()::text||p_request::text,0));
 -- Reuses the existing name, membership, date, text and idempotency checks.
 select exists(select 1 from public.crew_messages where user_id=auth.uid() and request_id=p_request) into prior;
 mid:=public.crew_message_send(p_location_id,p_date,p_request,clean)::bigint;
 if exists(select 1 from public.crew_messages where id=mid and deleted_at is not null) then raise exception 'This message was removed. Start a new message.';end if;
 for asset in select value from jsonb_array_elements(p_media) loop
  if jsonb_typeof(asset) is distinct from 'object'
   or coalesce(length(asset->>'name'),0) not between 1 and 180
   or left(asset->>'path',length(p_location_id::text||'/'||auth.uid()::text||'/'||p_request::text||'/'))
    is distinct from p_location_id::text||'/'||auth.uid()::text||'/'||p_request::text||'/'
   or asset->>'path' !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|gif|mp4|webm|mov)$'
  then raise exception 'Invalid attachment path or name.';end if;
  select * into obj from storage.objects where bucket_id='crew-chat-media' and name=asset->>'path';
  if not found then raise exception 'An attachment has not finished uploading. Retry sending.';end if;
  mime:=obj.metadata->>'mimetype';size:=(obj.metadata->>'size')::bigint;
  if size is null or size not between 1 and 52428800 or mime is null
   or mime not in ('image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime')
  then raise exception 'Unsupported attachment or file size.';end if;
  kind:=case when mime like 'image/%' then 'image' else 'video' end;
  if exists(select 1 from jsonb_array_elements(items) i where i->>'path'=asset->>'path') then raise exception 'Duplicate attachment.';end if;
  items:=items||jsonb_build_array(jsonb_build_object('path',asset->>'path','name',asset->>'name','kind',kind,'mime',mime,'size',size));
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('path',a.path,'name',a.name,'kind',a.kind,'mime',a.mime,'size',a.size) order by a.position),'[]'::jsonb)
 into existing from public.crew_message_media a where a.message_id=mid;
 if existing<>'[]'::jsonb then
  if existing is distinct from items then raise exception 'Message attachments changed. Start a new message.';end if;
  return mid::text;
 end if;
 -- A pre-existing text-only message cannot be changed by retrying with attachments.
 if prior and items<>'[]'::jsonb then
  raise exception 'This request belongs to an older message. Start a new message.';end if;
 for asset in select value from jsonb_array_elements(items) loop
  insert into public.crew_message_media(message_id,position,path,kind,name,size,mime)
  values(mid,idx,asset->>'path',asset->>'kind',asset->>'name',(asset->>'size')::bigint,asset->>'mime');idx:=idx+1;
 end loop;
 return mid::text;
end $$;
do $$ begin
 if to_regprocedure('public.crew_room_before_media(uuid,date,bigint)') is null then
  alter function public.crew_room_load(uuid,date,bigint) rename to crew_room_before_media;
 end if;
end $$;
create or replace function public.crew_room_load(p_location_id uuid,p_date date,p_before bigint default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;messages jsonb;
begin
 result:=public.crew_room_before_media(p_location_id,p_date,p_before);
 if coalesce((result->>'can_chat')::boolean,false) then
  select coalesce(jsonb_agg(m||jsonb_build_object('media',coalesce((
   select jsonb_agg(jsonb_build_object('path',a.path,'kind',a.kind,'name',a.name) order by a.position)
   from public.crew_message_media a join public.crew_messages c on c.id=a.message_id
   where c.id=(m->>'id')::bigint and c.location_id=p_location_id and c.room_date=p_date and c.deleted_at is null
  ),'[]'::jsonb)) order by ord),'[]'::jsonb) into messages
  from jsonb_array_elements(result->'messages') with ordinality x(m,ord);
  result:=result||jsonb_build_object('messages',messages);
 end if;
 return result;
end $$;
revoke all on function public.crew_room_before_media(uuid,date,bigint) from public,anon,authenticated;
revoke all on function public.crew_media_write_allowed(text),public.crew_media_read_allowed(text),public.crew_message_send_media(uuid,date,uuid,text,jsonb),public.crew_room_load(uuid,date,bigint) from public,anon,authenticated;
grant execute on function public.crew_media_write_allowed(text),public.crew_media_read_allowed(text),public.crew_message_send_media(uuid,date,uuid,text,jsonb),public.crew_room_load(uuid,date,bigint) to authenticated;
notify pgrst,'reload schema';
commit;

-- Calendar media update. Existing audience and storage-access checks are preserved.
begin;
 do $$ begin
  if to_regprocedure('public.calendar_event_save_rich(uuid,uuid,integer,uuid,date,text,text,time without time zone,text,jsonb,jsonb)') is null
     or to_regprocedure('public.calendar_event_save(uuid,uuid,integer,uuid,date,text,text,time without time zone,text)') is null
     or not exists(select 1 from storage.buckets where id='calendar-media') then
   raise exception 'Calendar Studio is not installed. No changes applied.';
  end if;
 end $$;
 update storage.buckets set file_size_limit=52428800,
 allowed_mime_types=array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm']
 where id='calendar-media';
create or replace function public.calendar_event_save_rich(p_location_id uuid,p_id uuid,p_version integer,p_request uuid,p_date date,p_title text,p_body text,p_time time,p_category text,p_media jsonb,p_style jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;m jsonb;path text;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then raise exception 'Manager access required.' using errcode='42501';end if;
 if public.calendar_style_valid(p_style) is not true or jsonb_typeof(p_media) is distinct from 'array' then raise exception 'Choose a valid event style and attachments.';end if;
 if jsonb_array_length(p_media)>4 then raise exception 'Attach up to four photos, GIFs or videos.';end if;
 for m in select value from jsonb_array_elements(p_media) loop
  path:=m->>'path';
  if jsonb_typeof(m) is distinct from 'object' or path is null or split_part(path,'/',1)<>p_location_id::text or length(coalesce(m->>'name','')) not between 1 and 255 or length(coalesce(m->>'caption',''))>500 then raise exception 'Invalid attachment.';end if;
  if m ? 'kind' and coalesce(m->>'kind','') not in ('image','video') then raise exception 'Invalid attachment type.';end if;
  if split_part(path,'/',2)<>auth.uid()::text and not exists(select 1 from public.calendar_events e cross join lateral jsonb_array_elements(e.media) a where e.id=p_id and e.location_id=p_location_id and a->>'path'=path) then raise exception 'Attachment belongs to another upload.';end if;
  if not exists(select 1 from storage.objects where bucket_id='calendar-media' and name=path and metadata->>'mimetype' in ('image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm')) then raise exception 'Upload the attachment before saving.';end if;
  if m ? 'kind' and not exists(select 1 from storage.objects where bucket_id='calendar-media' and name=path and case when m->>'kind'='video' then metadata->>'mimetype' like 'video/%' else metadata->>'mimetype' like 'image/%' end) then raise exception 'Attachment type does not match the uploaded file.';end if;
 end loop;
 if (select count(distinct value->>'path') from jsonb_array_elements(p_media))<>jsonb_array_length(p_media) then raise exception 'Duplicate attachment.';end if;
 if p_id is null then
  if p_request is null then raise exception 'Request required.';end if;
  perform pg_advisory_xact_lock(hashtextextended('calendar-event:'||auth.uid()::text||p_request::text,0));
  select id into result from public.calendar_events where created_by=auth.uid() and request_id=p_request and location_id=p_location_id;
  if result is not null then return result;end if;
 end if;
 result:=public.calendar_event_save(p_location_id,p_id,p_version,p_request,p_date,p_title,p_body,p_time,p_category);
 update public.calendar_events set media=p_media,style=p_style where id=result and location_id=p_location_id;
 return result;
end;$$;
revoke all on function public.calendar_event_save_rich(uuid,uuid,integer,uuid,date,text,text,time,text,jsonb,jsonb) from public,anon;
 grant execute on function public.calendar_event_save_rich(uuid,uuid,integer,uuid,date,text,text,time,text,jsonb,jsonb) to authenticated;
 commit;

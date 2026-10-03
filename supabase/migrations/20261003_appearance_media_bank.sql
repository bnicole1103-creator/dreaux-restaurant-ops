begin;
create table if not exists public.app_appearance (
 location_id uuid primary key references public.locations(id) on delete cascade,
 config jsonb not null,version integer not null default 1,updated_by uuid references public.profiles(id),updated_at timestamptz not null default now()
);
alter table public.app_appearance enable row level security;
revoke all on public.app_appearance from public,anon,authenticated;
create or replace function public.app_appearance_get(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Location access required.' using errcode='42501'; end if;
 select jsonb_build_object('config',config,'version',version) into r from public.app_appearance where location_id=p_location_id;
 return coalesce(r,jsonb_build_object('config','{}'::jsonb,'version',0));
end; $$;
create or replace function public.app_appearance_save(p_location_id uuid,p_config jsonb,p_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare k text;v text;r public.app_appearance%rowtype;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.closeout_is_gm(p_location_id) is not true then raise exception 'General manager access required.' using errcode='42501'; end if;
 if jsonb_typeof(p_config) is distinct from 'object' then raise exception 'Choose a valid theme.'; end if;
 if (select count(*) from jsonb_object_keys(p_config))<>8 then raise exception 'Choose all theme colors and a font.'; end if;
 for k,v in select * from jsonb_each_text(p_config) loop
  if k='font' then
   if v is null or v not in ('system','serif','rounded','mono') then raise exception 'Choose a supported font.'; end if;
  elsif k not in ('background','card','text','muted','accent','accentText','border') or v is null or v !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Choose valid theme colors.';
  end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('appearance:'||p_location_id::text,0));
 select * into r from public.app_appearance where location_id=p_location_id for update;
 if coalesce(r.version,0) is distinct from p_version then raise exception 'Appearance changed. Reload before saving.'; end if;
 insert into public.app_appearance(location_id,config,updated_by) values(p_location_id,p_config,auth.uid())
 on conflict(location_id) do update set config=excluded.config,version=app_appearance.version+1,updated_by=auth.uid(),updated_at=clock_timestamp() returning * into r;
 return jsonb_build_object('config',r.config,'version',r.version);
end; $$;

create table if not exists public.quiz_bank_sets (
 id uuid primary key default gen_random_uuid(),location_id uuid not null references public.locations(id),quiz_date date not null,title text not null,questions jsonb not null,created_by uuid references public.profiles(id),created_at timestamptz not null default now(),unique(location_id,quiz_date,title)
);
alter table public.quiz_bank_sets enable row level security;
revoke all on public.quiz_bank_sets from public,anon,authenticated;
create or replace function public.quiz_bank_import(p_location_id uuid,p_date date,p_title text,p_questions jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare item jsonb;opt jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then raise exception 'Manager access required.' using errcode='42501'; end if;
 if p_date is null or p_title is null or length(btrim(p_title)) not between 1 and 200 then raise exception 'Enter the quiz date and title.'; end if;
 if jsonb_typeof(p_questions) is distinct from 'array' then raise exception 'Questions must be a list.'; end if;
 if jsonb_array_length(p_questions) not between 1 and 50 then raise exception 'Import 1 to 50 questions.'; end if;
 for item in select value from jsonb_array_elements(p_questions) loop
  if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'prompt') is distinct from 'string' or nullif(btrim(item->>'prompt'),'') is null or length(item->>'prompt')>2000 then raise exception 'Each question needs text.'; end if;
  if jsonb_typeof(item->'category') is distinct from 'string' or length(item->>'category')>100 or jsonb_typeof(item->'explanation') is distinct from 'string' or length(item->>'explanation')>2000 then raise exception 'Enter a category and explanation.'; end if;
  if jsonb_typeof(item->'options') is distinct from 'array' then raise exception 'Each question needs choices.'; end if;
  if jsonb_array_length(item->'options') not between 2 and 6 then raise exception 'Each question needs 2 to 6 choices.'; end if;
  for opt in select value from jsonb_array_elements(item->'options') loop
   if jsonb_typeof(opt) is distinct from 'string' or nullif(btrim(opt#>>'{}'),'') is null or length(opt#>>'{}')>1000 then raise exception 'Fill in every choice.'; end if;
  end loop;
  if (select count(distinct lower(btrim(value))) from jsonb_array_elements_text(item->'options'))<>jsonb_array_length(item->'options') then raise exception 'Choices must differ.'; end if;
  if jsonb_typeof(item->'correct') is distinct from 'number' or (item->>'correct') !~ '^[0-5]$' or (item->>'correct')::integer>=jsonb_array_length(item->'options') then raise exception 'Select a valid correct answer.'; end if;
 end loop;
 insert into public.quiz_bank_sets(location_id,quiz_date,title,questions,created_by) values(p_location_id,p_date,btrim(p_title),p_questions,auth.uid())
 on conflict(location_id,quiz_date,title) do update set questions=excluded.questions;
end; $$;
create or replace function public.quiz_question_bank_by_day(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then raise exception 'Manager access required.' using errcode='42501'; end if;
 with entries as (
  select 'app:'||q.id::text||':'||x.n::text id,q.title source,q.quiz_date,false review,x.value question
  from public.daily_quizzes q cross join lateral jsonb_array_elements(q.questions) with ordinality x(value,n) where q.location_id=p_location_id
  union all
  select 'import:'||q.id::text||':'||x.n::text,q.title,q.quiz_date,true,x.value
  from public.quiz_bank_sets q cross join lateral jsonb_array_elements(q.questions) with ordinality x(value,n) where q.location_id=p_location_id
  union all
  select x->>'id',x->>'source',case when x->>'source' ~ '[A-Za-z]+ [0-9]{1,2}, [0-9]{4}' then to_date(substring(x->>'source' from '[A-Za-z]+ [0-9]{1,2}, [0-9]{4}'),'Month DD, YYYY') else null end,coalesce((x->>'review')::boolean,false),x->'question'
  from jsonb_array_elements(public.quiz_question_bank(p_location_id)) x
 ) select coalesce(jsonb_agg(to_jsonb(e) order by quiz_date desc nulls last,source,id),'[]'::jsonb) into result from entries e;
 return result;
end; $$;

alter table public.preshift_posts add column if not exists media jsonb not null default '[]'::jsonb;
create or replace function public.preshift_post_save_full(
 p_location_id uuid,p_id uuid,p_version integer,p_title text,p_body text,p_shift_date date,p_pinned boolean,p_presentation jsonb,p_media jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare pid uuid;m jsonb;path text;title_font text;text_font text;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then raise exception 'Manager access required.' using errcode='42501'; end if;
 title_font:=p_presentation->>'titleFont';text_font:=p_presentation->>'textFont';
 if title_font is null or title_font not in ('system','serif','rounded','mono') or text_font is null or text_font not in ('system','serif','rounded','mono') then raise exception 'Choose supported post fonts.'; end if;
 if jsonb_typeof(p_media) is distinct from 'array' then raise exception 'Attachments must be a list.'; end if;
 if jsonb_array_length(p_media)>6 then raise exception 'Use up to 6 photos or videos.'; end if;
 for m in select value from jsonb_array_elements(p_media) loop
  path:=m->>'path';
  if jsonb_typeof(m) is distinct from 'object' or path is null or split_part(path,'/',1)<>p_location_id::text or m->>'kind' is null or m->>'kind' not in ('image','video') or length(coalesce(m->>'name',''))>255 or length(coalesce(m->>'caption',''))>500 then raise exception 'Invalid attachment.'; end if;
  if not exists(select 1 from storage.objects where bucket_id='preshift-media' and name=path and (case when m->>'kind'='image' then metadata->>'mimetype' like 'image/%' else metadata->>'mimetype' like 'video/%' end)) then raise exception 'Upload the attachment before publishing.'; end if;
  if split_part(path,'/',2)<>auth.uid()::text and not exists(select 1 from public.preshift_posts p cross join lateral jsonb_array_elements(p.media) a where p.id=p_id and p.location_id=p_location_id and a->>'path'=path) then raise exception 'Use your own uploads or keep existing attachments.'; end if;
 end loop;
 pid:=public.preshift_post_save_styled(p_location_id,p_id,p_version,p_title,p_body,p_shift_date,p_pinned,jsonb_build_object('title',p_presentation->>'title','text',p_presentation->>'text','accent',p_presentation->>'accent'));
 update public.preshift_posts set presentation=presentation||jsonb_build_object('titleFont',title_font,'textFont',text_font),media=p_media where id=pid;
 return pid;
end; $$;
create or replace function public.preshift_feed(p_location_id uuid,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Location access required.' using errcode='42501'; end if;
 select jsonb_build_object('posts',coalesce((select jsonb_agg(to_jsonb(q) order by q.pinned desc,q.created_at desc,q.id desc) from (
 select t.id,t.presentation,t.media,t.title,t.body,t.shift_date,t.pinned,t.version,t.created_at,t.updated_at,coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''),'Manager') as author
 from public.preshift_posts t left join public.profiles p on p.id=t.author_id where t.location_id=p_location_id and t.deleted_at is null order by t.pinned desc,t.created_at desc,t.id desc limit greatest(1,least(coalesce(p_limit,50),1000))
 ) q),'[]'::jsonb),'total',(select count(*) from public.preshift_posts where location_id=p_location_id and deleted_at is null)) into result;
 return result;
end; $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('preshift-media','preshift-media',false,52428800,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create or replace function public.preshift_media_access(p_path text,p_action text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare loc uuid;attached boolean;
begin
 if auth.uid() is null or split_part(p_path,'/',1) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
 loc:=split_part(p_path,'/',1)::uuid;
 if public.closeout_is_member(loc) is not true then return false; end if;
 select exists(select 1 from public.preshift_posts p cross join lateral jsonb_array_elements(p.media) m where p.location_id=loc and m->>'path'=p_path and (p_action='delete' or p.deleted_at is null)) into attached;
 if p_action='read' then return attached or (public.mod_is_manager(loc) is true and split_part(p_path,'/',2)=auth.uid()::text); end if;
 if p_action='upload' then return public.mod_is_manager(loc) is true and split_part(p_path,'/',2)=auth.uid()::text; end if;
 if p_action='delete' then return not attached and public.mod_is_manager(loc) is true and split_part(p_path,'/',2)=auth.uid()::text; end if;
 return false;
end; $$;
drop policy if exists "preshift media read" on storage.objects;
create policy "preshift media read" on storage.objects for select to authenticated using(bucket_id='preshift-media' and public.preshift_media_access(name,'read'));
drop policy if exists "preshift media upload" on storage.objects;
create policy "preshift media upload" on storage.objects for insert to authenticated with check(bucket_id='preshift-media' and public.preshift_media_access(name,'upload'));
drop policy if exists "preshift media delete" on storage.objects;
create policy "preshift media delete" on storage.objects for delete to authenticated using(bucket_id='preshift-media' and public.preshift_media_access(name,'delete'));
revoke all on function public.app_appearance_get(uuid),public.app_appearance_save(uuid,jsonb,integer),public.quiz_bank_import(uuid,date,text,jsonb),public.quiz_question_bank_by_day(uuid),public.preshift_post_save_full(uuid,uuid,integer,text,text,date,boolean,jsonb,jsonb),public.preshift_media_access(text,text) from public,anon,authenticated;
grant execute on function public.app_appearance_get(uuid),public.app_appearance_save(uuid,jsonb,integer),public.quiz_bank_import(uuid,date,text,jsonb),public.quiz_question_bank_by_day(uuid),public.preshift_post_save_full(uuid,uuid,integer,text,text,date,boolean,jsonb,jsonb),public.preshift_media_access(text,text) to authenticated;
notify pgrst,'reload schema';
commit;

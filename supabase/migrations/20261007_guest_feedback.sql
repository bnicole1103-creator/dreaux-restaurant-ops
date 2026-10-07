begin;
create table if not exists public.guest_feedback_settings (
 location_id uuid primary key references public.locations(id),
 public_key uuid not null unique default gen_random_uuid(), enabled boolean not null default true
);
create table if not exists public.guest_feedback (
 id uuid primary key default gen_random_uuid(), location_id uuid not null references public.locations(id),
 request_id uuid not null, category text not null check(category in ('comment','concern','suggestion','compliment')),
 message text not null check(length(message) between 1 and 5000), visit_date date,
 guest_name text not null default '', email text not null default '', phone text not null default '',
 wants_reply boolean not null default false, created_at timestamptz not null default now(),
 status text not null default 'new' check(status in ('new','reviewed','resolved')),
 version integer not null default 1, changed_at timestamptz, changed_by uuid references public.profiles(id),
 unique(location_id,request_id)
);
create index if not exists guest_feedback_location_date on public.guest_feedback(location_id,created_at desc);
alter table public.guest_feedback_settings enable row level security;
alter table public.guest_feedback enable row level security;
revoke all on public.guest_feedback_settings,public.guest_feedback from public,anon,authenticated;
create or replace function public.guest_feedback_config(p_key uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('name',l.name,'enabled',s.enabled) from public.guest_feedback_settings s
 join public.locations l on l.id=s.location_id where s.public_key=p_key and l.is_active;
$$;
create or replace function public.guest_feedback_submit(p_key uuid,p_request_id uuid,p_content jsonb,p_website text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare loc uuid;pid uuid;prior public.guest_feedback%rowtype;cat text;msg text;nm text;em text;ph text;vd date;reply boolean;
begin
 select s.location_id into loc from public.guest_feedback_settings s join public.locations l on l.id=s.location_id
 where s.public_key=p_key and s.enabled and l.is_active;
 if loc is null then raise exception 'This feedback form is unavailable. Please speak with a manager.';end if;
 if p_request_id is null or coalesce(p_website,'')<>'' or jsonb_typeof(p_content) is distinct from 'object' or octet_length(p_content::text)>30000 then raise exception 'Please complete the feedback form.';end if;
 cat:=p_content->>'category';msg:=btrim(p_content->>'message');nm:=btrim(coalesce(p_content->>'name',''));
 em:=lower(btrim(coalesce(p_content->>'email','')));ph:=btrim(coalesce(p_content->>'phone',''));
 vd:=nullif(p_content->>'visit_date','')::date;reply:=coalesce((p_content->>'wants_reply')::boolean,false);
 if cat is null or cat not in ('comment','concern','suggestion','compliment') or coalesce(length(msg),0) not between 1 and 5000
 or length(nm)>120 or length(em)>320 or length(ph)>40 or nm~'[[:cntrl:]]' or ph~'[[:cntrl:]]'
 or (em<>'' and em !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') or (reply and em='' and ph='')
 then raise exception 'Enter your feedback and valid contact details if you want a reply.';end if;
 perform pg_advisory_xact_lock(hashtextextended('guest-feedback:'||loc::text,0));
 select * into prior from public.guest_feedback where location_id=loc and request_id=p_request_id;
 if found then
  if (prior.category,prior.message,prior.visit_date,prior.guest_name,prior.email,prior.phone,prior.wants_reply)
  is distinct from (cat,msg,vd,nm,em,ph,reply) then raise exception 'This feedback was already submitted.';end if;
  return prior.id;
 end if;
 if (select count(*) from public.guest_feedback where location_id=loc and created_at>now()-interval '1 hour')>=500 then raise exception 'Please speak with a manager to share your feedback.';end if;
 insert into public.guest_feedback(location_id,request_id,category,message,visit_date,guest_name,email,phone,wants_reply)
 values(loc,p_request_id,cat,msg,vd,nm,em,ph,reply) returning id into pid;return pid;
end;$$;
create or replace function public.guest_feedback_inbox(p_location_id uuid,p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.guest_feedback_settings%rowtype;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then raise exception 'Manager access required.' using errcode='42501';end if;
 insert into public.guest_feedback_settings(location_id) values(p_location_id) on conflict do nothing;
 select * into cfg from public.guest_feedback_settings where location_id=p_location_id;
 return jsonb_build_object('key',cfg.public_key,'enabled',cfg.enabled,'rows',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id) from
 (select * from public.guest_feedback where location_id=p_location_id and (p_before is null or created_at<p_before or (created_at=p_before and id>p_before_id)) order by created_at desc,id limit 100) q),'[]'::jsonb));
end;$$;
create or replace function public.guest_feedback_status(p_location_id uuid,p_id uuid,p_version integer,p_status text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then raise exception 'Manager access required.' using errcode='42501';end if;
 if p_status is null or p_status not in ('new','reviewed','resolved') then raise exception 'Choose a valid status.';end if;
 update public.guest_feedback set status=p_status,version=version+1,changed_at=now(),changed_by=auth.uid()
 where id=p_id and location_id=p_location_id and version=p_version;
 if not found then raise exception 'Feedback changed. Refresh the inbox.';end if;
end;$$;
revoke all on function public.guest_feedback_config(uuid),public.guest_feedback_submit(uuid,uuid,jsonb,text),public.guest_feedback_inbox(uuid,timestamptz,uuid),public.guest_feedback_status(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.guest_feedback_config(uuid),public.guest_feedback_submit(uuid,uuid,jsonb,text) to anon,authenticated;
grant execute on function public.guest_feedback_inbox(uuid,timestamptz,uuid),public.guest_feedback_status(uuid,uuid,integer,text) to authenticated;
notify pgrst,'reload schema';
commit;

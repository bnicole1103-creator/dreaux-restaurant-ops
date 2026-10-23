begin;
do $$ begin
 if to_regprocedure('public.app_access_allowed(uuid,text,text)') is null
 or to_regprocedure('public.closeout_is_member_for_tasks(uuid,uuid)') is null then
  raise exception 'Existing app access and membership helpers are required.';
 end if;
end;$$;
create schema if not exists dm_private;
revoke all on schema dm_private from public,anon,authenticated;
create table if not exists public.direct_messages (
 id uuid primary key default gen_random_uuid(),
 seq bigint generated always as identity unique,
 location_id uuid not null references public.locations(id),
 sender_id uuid not null references public.profiles(id),
 recipient_id uuid not null references public.profiles(id),
 request_id uuid not null,body text not null,
 created_at timestamptz not null default clock_timestamp(),
 check(sender_id<>recipient_id),check(length(btrim(body)) between 1 and 4000),
 unique(location_id,sender_id,request_id)
);
create index if not exists direct_messages_sender on public.direct_messages(location_id,sender_id,recipient_id,seq desc);
create index if not exists direct_messages_recipient on public.direct_messages(location_id,recipient_id,sender_id,seq desc);
create table if not exists public.direct_message_reads (
 location_id uuid not null references public.locations(id),
 user_id uuid not null references public.profiles(id),
 peer_id uuid not null references public.profiles(id),
 last_seq bigint not null default 0,
 updated_at timestamptz not null default now(),
 primary key(location_id,user_id,peer_id),check(last_seq>=0)
);
alter table public.direct_messages enable row level security;
alter table public.direct_message_reads enable row level security;
revoke all on public.direct_messages,public.direct_message_reads from public,anon,authenticated;
revoke all on sequence public.direct_messages_seq_seq from public,anon,authenticated;
create or replace function dm_private.require_access(l uuid)
returns void language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member_for_tasks(l,auth.uid()) is not true
 or public.app_access_allowed(l,'schedule','chat') is not true then
  raise exception 'Active employee chat access required.' using errcode='42501';
 end if;
end;$$;
create or replace function public.direct_messages_inbox(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid();people jsonb;threads jsonb;total bigint;
begin
 perform dm_private.require_access(p_location_id);
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',coalesce(nullif(p.preferred_name,''),p.full_name),'role',m.role) order by coalesce(nullif(p.preferred_name,''),p.full_name),p.id),'[]') into people
 from public.location_memberships m join public.profiles p on p.id=m.user_id
 where m.location_id=p_location_id and m.user_id<>u and m.status='active'
 and public.closeout_is_member_for_tasks(p_location_id,m.user_id);
 with pairs as (
  select distinct case when sender_id=u then recipient_id else sender_id end peer
  from public.direct_messages where location_id=p_location_id and u in(sender_id,recipient_id)
 ), latest as (
  select x.*,p.peer from pairs p cross join lateral (
   select * from public.direct_messages d where d.location_id=p_location_id
   and ((d.sender_id=u and d.recipient_id=p.peer) or (d.recipient_id=u and d.sender_id=p.peer))
   order by d.seq desc limit 1
  ) x
 ) select coalesce(jsonb_agg(to_jsonb(t) order by t.seq desc),'[]') into threads from (
  select x.peer,coalesce(nullif(p.preferred_name,''),p.full_name) name,x.seq,x.body,x.created_at,
   public.closeout_is_member_for_tasks(p_location_id,x.peer) active,
   (select count(*) from public.direct_messages d where d.location_id=p_location_id and d.recipient_id=u and d.sender_id=x.peer and d.seq>coalesce(r.last_seq,0)) unread
  from latest x join public.profiles p on p.id=x.peer
  left join public.direct_message_reads r on r.location_id=p_location_id and r.user_id=u and r.peer_id=x.peer
  order by x.seq desc limit 200
 ) t;
 select count(*) into total from public.direct_messages d
 left join public.direct_message_reads r on r.location_id=d.location_id and r.user_id=u and r.peer_id=d.sender_id
 where d.location_id=p_location_id and d.recipient_id=u and d.seq>coalesce(r.last_seq,0);
 return jsonb_build_object('me',u,'people',people,'threads',threads,'unread',total);
end;$$;
create or replace function public.direct_messages_thread(p_location_id uuid,p_peer_id uuid,p_before bigint default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid();rows jsonb;oldest bigint;active boolean;person text;
begin
 perform dm_private.require_access(p_location_id);
 active:=public.closeout_is_member_for_tasks(p_location_id,p_peer_id) is true;
 if p_peer_id is null or p_peer_id=u or (not active and not exists(
  select 1 from public.direct_messages where location_id=p_location_id
  and ((sender_id=u and recipient_id=p_peer_id) or (recipient_id=u and sender_id=p_peer_id))
 )) then raise exception 'Choose an employee at this location.' using errcode='42501';end if;
 select coalesce(nullif(preferred_name,''),full_name) into person from public.profiles where id=p_peer_id;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.seq),'[]'),min(x.seq) into rows,oldest
 from (select id,seq,sender_id,body,created_at from public.direct_messages
 where location_id=p_location_id and ((sender_id=u and recipient_id=p_peer_id) or (recipient_id=u and sender_id=p_peer_id))
 and (p_before is null or seq<p_before) order by seq desc limit 50) x;
 return jsonb_build_object('messages',rows,'name',person,'active',active,'has_older',exists(
  select 1 from public.direct_messages where location_id=p_location_id and seq<oldest
  and ((sender_id=u and recipient_id=p_peer_id) or (recipient_id=u and sender_id=p_peer_id))
 ));
end;$$;
create or replace function public.direct_message_send(p_location_id uuid,p_peer_id uuid,p_request_id uuid,p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.direct_messages;u uuid:=auth.uid();
begin
 perform dm_private.require_access(p_location_id);
 if p_peer_id is null or p_peer_id=u or public.closeout_is_member_for_tasks(p_location_id,p_peer_id) is not true then
  raise exception 'Choose an active employee at this location.' using errcode='42501';end if;
 if p_request_id is null or length(btrim(coalesce(p_body,''))) not between 1 and 4000 or octet_length(p_body)>16000 then raise exception 'Enter a message of 1–4,000 characters.';end if;
 perform pg_advisory_xact_lock(hashtextextended('dm-send:'||u::text||p_request_id::text,0));
 select * into r from public.direct_messages where location_id=p_location_id and sender_id=u and request_id=p_request_id;
 if found then
  if r.recipient_id<>p_peer_id or r.body<>btrim(p_body) then raise exception 'Retry ID belongs to a different message.';end if;
  return to_jsonb(r);
 end if;
 insert into public.direct_messages(location_id,sender_id,recipient_id,request_id,body)
 values(p_location_id,u,p_peer_id,p_request_id,btrim(p_body)) returning * into r;
 return to_jsonb(r);
end;$$;
create or replace function public.direct_messages_read(p_location_id uuid,p_peer_id uuid,p_last_seq bigint)
returns void language plpgsql security definer set search_path='' as $$
declare upto bigint;u uuid:=auth.uid();
begin
 perform dm_private.require_access(p_location_id);
 select max(seq) into upto from public.direct_messages where location_id=p_location_id and seq<=p_last_seq
 and ((sender_id=u and recipient_id=p_peer_id) or (recipient_id=u and sender_id=p_peer_id));
 if upto is null then return;end if;
 insert into public.direct_message_reads(location_id,user_id,peer_id,last_seq) values(p_location_id,u,p_peer_id,upto)
 on conflict(location_id,user_id,peer_id) do update set last_seq=greatest(direct_message_reads.last_seq,excluded.last_seq),updated_at=clock_timestamp();
end;$$;
revoke all on function dm_private.require_access(uuid) from public,anon,authenticated;
revoke all on function public.direct_messages_inbox(uuid),public.direct_messages_thread(uuid,uuid,bigint),public.direct_message_send(uuid,uuid,uuid,text),public.direct_messages_read(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.direct_messages_inbox(uuid),public.direct_messages_thread(uuid,uuid,bigint),public.direct_message_send(uuid,uuid,uuid,text),public.direct_messages_read(uuid,uuid,bigint) to authenticated;
notify pgrst,'reload schema';
commit;

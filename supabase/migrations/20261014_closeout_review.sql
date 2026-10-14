begin;
-- Existing closeout submission and automatic target migrations are prerequisites.
create table if not exists public.closeout_peer_votes (
 closeout_id uuid primary key references public.daily_closeouts(id) on delete cascade,
 location_id uuid not null, voter_id uuid not null, recipient_id uuid not null,
 business_date date not null, reason text not null default '' check(length(reason)<=500),
 created_at timestamptz not null default now(), check(voter_id<>recipient_id)
);
alter table public.closeout_peer_votes enable row level security;
revoke all on public.closeout_peer_votes from public,anon,authenticated;
create or replace function public.closeout_submit_reviewed(p_payload jsonb,p_table_ids uuid[],p_shift_id uuid,p_request_id uuid,p_peer_user uuid,p_peer_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare loc uuid:=(p_payload->>'location_id')::uuid; result jsonb; prior public.closeout_peer_votes%rowtype; existed boolean;
begin
 if auth.uid() is null or public.closeout_is_member(loc) is not true or (p_payload->>'user_id')::uuid is distinct from auth.uid() then raise exception 'Active location membership required.' using errcode='42501';end if;
 if length(coalesce(p_peer_reason,''))>500 then raise exception 'Recognition note must be 500 characters or fewer.';end if;
 if p_peer_user is not null and (p_peer_user=auth.uid() or not exists(select 1 from public.location_memberships where location_id=loc and user_id=p_peer_user and status='active')) then raise exception 'Choose another active teammate at this location.';end if;
 perform pg_advisory_xact_lock(hashtextextended('closeout-submit:'||auth.uid()::text||p_request_id::text,0));
 select exists(select 1 from public.daily_closeouts where id=p_request_id) into existed;
 select * into prior from public.closeout_peer_votes where closeout_id=p_request_id;
 if existed and (prior.recipient_id is distinct from p_peer_user or (p_peer_user is not null and prior.reason is distinct from btrim(coalesce(p_peer_reason,'')))) then raise exception 'This closeout was already submitted with a different recognition vote.';end if;
 result:=public.closeout_submit_with_tables(p_payload,p_table_ids,p_shift_id,p_request_id);
 if p_peer_user is not null and not existed then
 insert into public.closeout_peer_votes(closeout_id,location_id,voter_id,recipient_id,business_date,reason)
 select id,location_id,user_id,p_peer_user,closeout_date,btrim(coalesce(p_peer_reason,'')) from public.daily_closeouts where id=p_request_id and user_id=auth.uid() and location_id=loc;
 if not found then raise exception 'Closeout was not saved; recognition vote was not recorded.';end if;
 end if;
 return result;
end;$$;
revoke all on function public.closeout_submit_reviewed(jsonb,uuid[],uuid,uuid,uuid,text) from public,anon;
grant execute on function public.closeout_submit_reviewed(jsonb,uuid[],uuid,uuid,uuid,text) to authenticated;
create or replace function public.closeout_peer_recognition(p_location_id uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare manager boolean; result jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active location membership required.' using errcode='42501';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'Choose a date range of at most one year.';end if;
 manager:=public.mod_is_manager(p_location_id) is true;
 select coalesce(jsonb_agg(jsonb_build_object('id',v.closeout_id,'day',v.business_date,'recipient',coalesce(nullif(r.preferred_name,''),nullif(r.full_name,''),'Teammate'),'voter',case when manager or v.voter_id=auth.uid() then coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''),'Teammate') else null end,'reason',v.reason) order by v.created_at desc),'[]'::jsonb) into result
 from public.closeout_peer_votes v join public.daily_closeouts c on c.id=v.closeout_id
 left join public.profiles r on r.id=v.recipient_id left join public.profiles p on p.id=v.voter_id
 where v.location_id=p_location_id and v.business_date between p_from and p_to and c.deleted_at is null and c.status='submitted' and (manager or v.voter_id=auth.uid() or v.recipient_id=auth.uid());
 return result;
end;$$;
revoke all on function public.closeout_peer_recognition(uuid,date,date) from public,anon;
grant execute on function public.closeout_peer_recognition(uuid,date,date) to authenticated;
create or replace function shift_context_private.target_for(p_location uuid,p_user uuid,p_date date,p_start time,p_role text,p_day jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare employee text;grp text;rows jsonb;amount numeric;
begin
 if (p_day->>'ready')::boolean is not true then return p_day-'rows';end if;
 select employee_key into employee from public.team_schedule_links where location_id=p_location and user_id=p_user;
 if employee is null then return jsonb_build_object('ready',false,'reason','A manager needs to link your team profile to your 7shifts employee.');end if;
 if p_role='server' then grp:='floor';elsif p_role in ('main_bartender','back_bartender_1','back_bar_service_bartender') then grp:='bar';else
 return jsonb_build_object('ready',false,'reason','This role does not have a sales target.');end if;
 select jsonb_agg(r),sum((r->>'target')::numeric) into rows,amount from jsonb_array_elements(p_day->'rows') r
 where r->>'employee_key'=employee and r->>'group'=grp and ((r->>'start')::timestamptz at time zone 'America/Chicago')::time=p_start;
 if rows is null then return jsonb_build_object('ready',false,'reason','No matching sales shift was found. Check your scheduled start and role, or ask a manager to review your 7shifts link and allocation.');end if;
 return jsonb_build_object('ready',true,'date',p_date,'through_date',p_day->'through_date','settings_version',p_day->'settings_version','schedule_synced_at',p_day->'schedule_synced_at','target',amount,'employee_key',employee,'shifts',rows);
end;$$;

commit;

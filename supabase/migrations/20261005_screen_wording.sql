begin;
create table if not exists public.screen_wording (
 location_id uuid not null references public.locations(id),
 wording_key text not null check(wording_key ~ '^[A-Za-z][A-Za-z0-9]*[.][a-f0-9]{16}$'),
 wording text not null check(length(btrim(wording)) between 1 and 2000),
 updated_by uuid references auth.users(id),
 updated_at timestamptz not null default now(),
 primary key(location_id,wording_key)
);
alter table public.screen_wording enable row level security;
revoke all on public.screen_wording from public,anon,authenticated;
create or replace function public.screen_wording_get(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.closeout_is_member(p_location_id) then raise exception 'Active staff access required.' using errcode='42501';end if;
 return coalesce((select jsonb_object_agg(wording_key,wording) from public.screen_wording where location_id=p_location_id),'{}'::jsonb);
end;$$;
create or replace function public.screen_wording_public(p_key uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_object_agg(w.wording_key,w.wording),'{}'::jsonb)
 from public.screen_wording w join public.walkin_settings s on s.location_id=w.location_id
 where s.public_key=p_key and s.enabled and w.wording_key like 'WalkInPage.%';
$$;
create or replace function public.screen_wording_save(p_location_id uuid,p_key text,p_text text,p_expected text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous text;
begin
 if auth.uid() is null or not public.closeout_is_gm(p_location_id) then raise exception 'Owner or general manager access required.' using errcode='42501';end if;
 if p_key is null or p_key !~ '^[A-Za-z][A-Za-z0-9]*[.][a-f0-9]{16}$' or (p_text is not null and length(btrim(p_text)) not between 1 and 2000) then raise exception 'Enter valid screen wording.';end if;
 perform pg_advisory_xact_lock(hashtextextended('screen-wording:'||p_location_id::text||':'||p_key,0));
 select wording into previous from public.screen_wording where location_id=p_location_id and wording_key=p_key;
 if previous is distinct from p_expected then raise exception 'This wording changed. Reload the editor before saving.';end if;
 if p_text is null then delete from public.screen_wording where location_id=p_location_id and wording_key=p_key;
 else insert into public.screen_wording(location_id,wording_key,wording,updated_by) values(p_location_id,p_key,p_text,auth.uid()) on conflict(location_id,wording_key) do update set wording=excluded.wording,updated_by=excluded.updated_by,updated_at=now();end if;
 return public.screen_wording_get(p_location_id);
end;$$;
revoke all on function public.screen_wording_get(uuid),public.screen_wording_save(uuid,text,text,text),public.screen_wording_public(uuid) from public,anon,authenticated;
grant execute on function public.screen_wording_get(uuid),public.screen_wording_save(uuid,text,text,text) to authenticated;
grant execute on function public.screen_wording_public(uuid) to anon,authenticated;
notify pgrst,'reload schema';
commit;

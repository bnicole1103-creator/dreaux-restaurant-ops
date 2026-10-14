begin;
create table if not exists public.ai_phone_settings(
 location_id uuid primary key references public.locations(id),
 enabled boolean not null default false,
 knowledge text not null default '' check(length(knowledge)<=12000),
 updated_at timestamptz not null default now()
);
create table if not exists public.ai_phone_calls(
 id uuid primary key default gen_random_uuid(),
 location_id uuid not null references public.locations(id),
 call_sid text not null unique,
 caller text not null default '',
 state jsonb not null default '{"stage":"help","name":"","callback":"","message":""}',
 version integer not null default 0,
 status text not null default 'new' check(status in('new','in_progress','resolved')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.ai_phone_turns(
 call_id uuid not null references public.ai_phone_calls(id),
 turn integer not null,
 input_hash text not null,
 utterance text not null,
 reply_xml text not null,
 created_at timestamptz not null default now(),
 primary key(call_id,turn)
);
alter table public.ai_phone_settings enable row level security;
alter table public.ai_phone_calls enable row level security;
alter table public.ai_phone_turns enable row level security;
revoke all on public.ai_phone_settings,public.ai_phone_calls,public.ai_phone_turns from public,anon,authenticated;
grant all on public.ai_phone_settings,public.ai_phone_calls,public.ai_phone_turns to service_role;

create or replace function public.ai_phone_manage(p_location_id uuid,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then raise exception 'Management access required.' using errcode='42501';end if;
 if p_action='settings' then
  if jsonb_typeof(p_data->'enabled') is distinct from 'boolean' or jsonb_typeof(p_data->'knowledge') is distinct from 'string' or length(p_data->>'knowledge')>12000 then raise exception 'Check phone settings.';end if;
  insert into public.ai_phone_settings(location_id,enabled,knowledge) values(p_location_id,(p_data->>'enabled')::boolean,p_data->>'knowledge') on conflict(location_id) do update set enabled=excluded.enabled,knowledge=excluded.knowledge,updated_at=now();
 elsif p_action='status' then
  if coalesce(p_data->>'status','') not in('new','in_progress','resolved') then raise exception 'Invalid status.';end if;
  update public.ai_phone_calls set status=p_data->>'status',updated_at=now() where id=(p_data->>'id')::uuid and location_id=p_location_id;
  if not found then raise exception 'Call not found.';end if;
 elsif p_action='details' then
  if not exists(select 1 from public.ai_phone_calls where id=(p_data->>'id')::uuid and location_id=p_location_id) then raise exception 'Call not found.';end if;
  return coalesce((select jsonb_agg(jsonb_build_object('turn',turn,'utterance',utterance) order by turn) from public.ai_phone_turns where call_id=(p_data->>'id')::uuid),'[]'::jsonb);
 elsif p_action<>'load' then raise exception 'Unsupported phone action.';
 end if;
 select jsonb_build_object('settings',coalesce((select to_jsonb(s) from public.ai_phone_settings s where location_id=p_location_id),jsonb_build_object('enabled',false,'knowledge','')),'calls',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc) from (select * from public.ai_phone_calls where location_id=p_location_id order by created_at desc limit 100)c),'[]'::jsonb)) into result;
 return result;
end;$$;

create or replace function public.ai_phone_call_begin(p_location_id uuid,p_sid text,p_caller text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.ai_phone_calls;
begin
 if p_sid!~'^CA[0-9a-fA-F]{32}$' or length(p_caller)>80 then raise exception 'Invalid call.';end if;
 insert into public.ai_phone_calls(location_id,call_sid,caller) values(p_location_id,p_sid,p_caller) on conflict(call_sid) do nothing;
 select * into c from public.ai_phone_calls where call_sid=p_sid;
 if c.location_id<>p_location_id then raise exception 'Call location mismatch.';end if;
 return to_jsonb(c);
end;$$;

create or replace function public.ai_phone_turn_save(p_call_id uuid,p_turn integer,p_hash text,p_utterance text,p_state jsonb,p_xml text)
returns text language plpgsql security definer set search_path='' as $$
declare c public.ai_phone_calls;t public.ai_phone_turns;
begin
 select * into c from public.ai_phone_calls where id=p_call_id for update;
 if not found then raise exception 'Call missing.';end if;
 select * into t from public.ai_phone_turns where call_id=p_call_id and turn=p_turn;
 if found then
  if t.input_hash<>p_hash then raise exception 'Conflicting call retry.';end if;
  return t.reply_xml;
 end if;
 if c.version<>p_turn or p_turn not between 0 and 25 then raise exception 'Call turn changed.';end if;
 if jsonb_typeof(p_state) is distinct from 'object' or length(p_state::text)>18000 or length(p_utterance)>4000 or length(p_xml)>12000 then raise exception 'Call data too large.';end if;
 insert into public.ai_phone_turns(call_id,turn,input_hash,utterance,reply_xml) values(p_call_id,p_turn,p_hash,p_utterance,p_xml);
 update public.ai_phone_calls set state=p_state,version=version+1,updated_at=now() where id=p_call_id;
 return p_xml;
end;$$;
revoke all on function public.ai_phone_manage(uuid,text,jsonb),public.ai_phone_call_begin(uuid,text,text),public.ai_phone_turn_save(uuid,integer,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.ai_phone_manage(uuid,text,jsonb) to authenticated;
grant execute on function public.ai_phone_call_begin(uuid,text,text),public.ai_phone_turn_save(uuid,integer,text,text,jsonb,text) to service_role;
notify pgrst,'reload schema';
commit;

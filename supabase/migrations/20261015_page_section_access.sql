begin;
create table if not exists public.app_page_access (
 location_id uuid not null references public.locations(id),
 target_kind text not null check(target_kind in ('user','role')),
 target text not null, version integer not null default 1,
 rules jsonb not null default '[]', updated_by uuid, updated_at timestamptz not null default now(),
 primary key(location_id,target_kind,target)
);
create table if not exists public.app_page_access_audit (
 id bigint generated always as identity primary key, location_id uuid not null,
 changed_by uuid not null,target_kind text not null,target text not null,
 before_rules jsonb not null,after_rules jsonb not null,created_at timestamptz not null default now()
);
alter table public.app_page_access enable row level security;
alter table public.app_page_access_audit enable row level security;
revoke all on public.app_page_access,public.app_page_access_audit from public,anon,authenticated;
create or replace function public.app_access_catalog() returns jsonb
language sql immutable set search_path='' as $catalog$ select '{"home":["*","notifications","calendar","schedule","posts","quiz","sections","tasks","stock"],"floor":["*","schedule","reservations","sections"],"posts":["*","feed","builder","receipts","discussion"],"calendar":["*","events","reservations","posts","styling"],"quizzes":["*","published","builder","scores"],"training":["*","cocktails","food","guides","quizzes"],"tasks":["*","mine","assign","presets","team"],"inventory":["*","disposal","incoming","history"],"team":["*","roster"],"points":["*","mine","leaderboard"],"summary":["*","closeouts","cash","reviews"],"closeout":["*","staff","manager"],"guests":["*","host","inbox","feedback","forms","studio"],"settings":["*","styling","forms","points","sales","permissions"]}'::jsonb $catalog$;
create or replace function public.app_access_allowed(p_location_id uuid,p_page text,p_section text default '*')
returns boolean language plpgsql stable security definer set search_path='' as $$
declare job text;whole boolean;part boolean;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then return false;end if;
 if p_page='settings' and p_section in ('*','permissions') and public.closeout_is_gm(p_location_id) is true then return true;end if;
 select role into job from public.location_memberships where location_id=p_location_id and user_id=auth.uid() and status='active';
 select (v->>'allowed')::boolean into whole from public.app_page_access a cross join lateral jsonb_array_elements(a.rules) v
 where a.location_id=p_location_id and ((a.target_kind='user' and a.target=auth.uid()::text) or (a.target_kind='role' and a.target=job))
 and v->>'page'=p_page and v->>'section'='*' order by (a.target_kind='user') desc limit 1;
 if whole is false then return false;end if;
 select (v->>'allowed')::boolean into part from public.app_page_access a cross join lateral jsonb_array_elements(a.rules) v
 where a.location_id=p_location_id and ((a.target_kind='user' and a.target=auth.uid()::text) or (a.target_kind='role' and a.target=job))
 and v->>'page'=p_page and v->>'section'=p_section order by (a.target_kind='user') desc limit 1;
 return coalesce(part,true);
end;$$;
-- A shared data resource remains readable when an allowed page still uses it.
create or replace function public.app_access_resource_allowed(p_location_id uuid,p_page text,p_section text)
returns boolean language sql stable security definer set search_path='' as $$
 select public.app_access_allowed(p_location_id,p_page,p_section) or case
 when p_page='floor' and p_section='reservations' then public.app_access_allowed(p_location_id,'calendar','reservations')
 when p_page='floor' and p_section='schedule' then public.app_access_allowed(p_location_id,'home','schedule')
 when p_page='floor' and p_section='sections' then public.app_access_allowed(p_location_id,'home','sections')
 when p_page='posts' and p_section='feed' then public.app_access_allowed(p_location_id,'home','posts') or public.app_access_allowed(p_location_id,'calendar','posts')
 when p_page='quizzes' and p_section='published' then public.app_access_allowed(p_location_id,'home','quiz')
 when p_page='tasks' and p_section='mine' then public.app_access_allowed(p_location_id,'home','tasks')
 when p_page='summary' and p_section='closeouts' then public.app_access_allowed(p_location_id,'closeout','staff')
 else false end;
$$;
create or replace function public.app_access_assert(p_location_id uuid,p_page text,p_section text default '*') returns void
language plpgsql stable security definer set search_path='' as $$ begin
 if public.app_access_resource_allowed(p_location_id,p_page,p_section) is not true then raise exception 'This page or section is restricted by management.' using errcode='42501';end if;
end;$$;
create or replace function public.app_access_rules(p_location_id uuid,p_kind text,p_target text) returns jsonb
language plpgsql stable security definer set search_path='' as $$ begin
 if public.closeout_is_gm(p_location_id) is not true then raise exception 'Management access required.' using errcode='42501';end if;
 return coalesce((select jsonb_build_object('version',version,'rules',rules) from public.app_page_access where location_id=p_location_id and target_kind=p_kind and target=p_target),jsonb_build_object('version',0,'rules','[]'::jsonb));
end;$$;
create or replace function public.app_access_save(p_location_id uuid,p_kind text,p_target text,p_version integer,p_rules jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior jsonb; rule jsonb;catalog jsonb:=public.app_access_catalog();
begin
 if public.closeout_is_gm(p_location_id) is not true then raise exception 'Management access required.' using errcode='42501';end if;
 if p_kind is null or p_kind not in ('user','role') or p_target is null then raise exception 'Choose an employee or position.';end if;
 if p_kind='user' and not exists(select 1 from public.location_memberships where location_id=p_location_id and user_id::text=p_target and status='active') then raise exception 'Employee is not active at this location.';end if;
 if p_kind='role' and p_target not in ('owner','general_manager','manager','assistant_manager','host','server','bartender','busser','kitchen','employee') then raise exception 'Invalid position.';end if;
 if jsonb_typeof(p_rules) is distinct from 'array' or octet_length(p_rules::text)>100000 then raise exception 'Invalid page rules.';end if;
 if jsonb_array_length(p_rules)>200 then raise exception 'Too many page rules.';end if;
 for rule in select value from jsonb_array_elements(p_rules) loop
  if jsonb_typeof(rule) is distinct from 'object' or (select count(*) from jsonb_object_keys(rule))<>3 or not(rule ?& array['page','section','allowed'])
   or not (catalog ? (rule->>'page')) or not ((catalog->(rule->>'page')) ? (rule->>'section'))
   or jsonb_typeof(rule->'allowed') is distinct from 'boolean' then raise exception 'Invalid page or section rule.';end if;
 end loop;
 if (select count(*) from jsonb_array_elements(p_rules))<>(select count(distinct (v->>'page',v->>'section')) from jsonb_array_elements(p_rules) v) then raise exception 'Duplicate page rules.';end if;
 perform pg_advisory_xact_lock(hashtextextended('app-access:'||p_location_id::text||p_kind||p_target,0));
 prior:=public.app_access_rules(p_location_id,p_kind,p_target);
 if (prior->>'version')::integer is distinct from p_version then raise exception 'Permissions changed. Reload before saving.' using errcode='40001';end if;
 insert into public.app_page_access(location_id,target_kind,target,version,rules,updated_by) values(p_location_id,p_kind,p_target,p_version+1,p_rules,auth.uid())
 on conflict(location_id,target_kind,target) do update set version=excluded.version,rules=excluded.rules,updated_by=auth.uid(),updated_at=now();
 insert into public.app_page_access_audit(location_id,changed_by,target_kind,target,before_rules,after_rules) values(p_location_id,auth.uid(),p_kind,p_target,prior->'rules',p_rules);
 return public.app_access_rules(p_location_id,p_kind,p_target);
end;$$;
create or replace function public.app_access_load(p_location_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$ declare rules jsonb;begin
 if public.closeout_is_member(p_location_id) is not true then raise exception 'Active membership required.' using errcode='42501';end if;
 select jsonb_agg(jsonb_build_object('page',page.key,'section',part.value,'allowed',public.app_access_allowed(p_location_id,page.key,part.value))) into rules
 from jsonb_each(public.app_access_catalog()) page cross join lateral jsonb_array_elements_text(page.value) part;
 return jsonb_build_object('rules',rules,'admin',public.closeout_is_gm(p_location_id),'manager',public.mod_is_manager(p_location_id));
end;$$;
create or replace function public.app_guest_links(p_location_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$ declare feedback uuid;walkin uuid;begin
 perform public.app_access_assert(p_location_id,'guests','forms');
 if public.mod_is_manager(p_location_id) is not true then raise exception 'Management access required.' using errcode='42501';end if;
 select public_key into feedback from public.guest_feedback_settings where location_id=p_location_id and enabled;
 select public_key into walkin from public.walkin_settings where location_id=p_location_id and enabled;
 return jsonb_build_object('feedback',feedback,'walkin',walkin);
end;$$;
create or replace function public.app_guest_authorize(p_location_id uuid,p_section text) returns boolean
language sql stable security definer set search_path='' as $$
 select p_section in ('studio','inbox') and public.inquiry_studio_authorize(p_location_id)
 and public.app_access_allowed(p_location_id,'guests',p_section);
$$;
revoke all on function public.app_guest_authorize(uuid,text) from public,anon,authenticated;
grant execute on function public.app_guest_authorize(uuid,text) to authenticated;
-- Add a restriction to existing API functions while retaining their existing
-- membership, row ownership, role checks and optimistic version handling.
create or replace function public.app_access_resource(p_name text) returns text[]
language sql immutable set search_path='' as $$ select case
 when p_name like 'guest_feedback_%' and p_name not in ('guest_feedback_config','guest_feedback_submit') then array['guests','feedback']
 when p_name like 'reservation_inquiry_%' then array['guests','host']
 when p_name like 'inquiry_combined_%' then array['guests','inbox']
 when p_name like 'calendar_month_style_%' then array['calendar','styling']
 when p_name in ('calendar_reservations','reservation_merge') then array['floor','reservations']
 when p_name like 'calendar_day_posts%' then array['posts','feed']
 when p_name like 'calendar_%' and p_name not in ('calendar_style_valid','calendar_media_access') then array['calendar','events']
 when p_name like 'floor_%section%' or p_name like 'section_%' then array['floor','sections']
 when p_name like 'floor_%' or p_name like 'home_schedule_%' then array['floor','schedule']
 when p_name like 'preshift_%receipt%' or p_name like 'preshift_%view%' then array['posts','receipts']
 when p_name like 'preshift_%comment%' or p_name like 'preshift_%reaction%' or p_name='preshift_post_social' then array['posts','discussion']
 when p_name like 'preshift_%draft%' or p_name like 'preshift_%preset%' or p_name like 'preshift_post_%' then array['posts','builder']
 when p_name like 'preshift_%' then array['posts','feed']
 when p_name like 'training_cocktail%' then array['training','cocktails']
 when p_name like 'training_food%' then array['training','food']
 when p_name like 'training_guide%' then array['training','guides']
 when p_name in ('quiz_manager_roster','quiz_team_scores') then array['quizzes','scores']
 when p_name like 'manager_recap_%' then array['summary','reviews']
 when p_name like 'team_%' then array['team','roster']
 when p_name like 'mod_points_%' or p_name like 'points_%' then array['points','mine']
 when p_name like 'closeout_summary_%' then array['summary','closeouts']
 when p_name like 'quiz_%' and p_name not like 'quiz_staff_%' then array['quizzes','builder']
 when p_name like 'quiz_staff_%' then array['quizzes','published']
 when p_name like 'staff_tasks_%template%' or p_name like 'staff_tasks_%preset%' then array['tasks','presets']
 when p_name like 'staff_tasks_assign%' then array['tasks','assign']
 when p_name like 'staff_tasks_%report%' or p_name like 'staff_tasks_%team%' then array['tasks','team']
 when p_name like 'staff_tasks_%' and p_name<>'staff_tasks_can_manage' then array['tasks','mine']
 when p_name like 'inventory_receipt_%' then array['inventory','incoming']
 when p_name like 'inventory_%' and p_name not like '%access%' then array['inventory','disposal']
 else null end $$;
do $guards$
declare f record; resource text[];body text;definition text;guard text;
begin
 for f in select p.oid,p.proname,p.prosrc,p.proretset,p.prorettype,l.lanname from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
 where n.nspname='public' and 'p_location_id'=any(p.proargnames) and p.prokind='f' loop
  resource:=public.app_access_resource(f.proname);
  if resource is null or strpos(f.prosrc,'-- app-page-access-v1')>0 then continue;end if;
  guard:=format(E'
 -- app-page-access-v1
 perform public.app_access_assert(p_location_id,%L,%L);
',resource[1],resource[2]);
  definition:=pg_get_functiondef(f.oid);
  if f.lanname='plpgsql' then
   body:=regexp_replace(f.prosrc,'\mBEGIN\M',E'BEGIN'||guard,'i');
   if body=f.prosrc then raise exception 'Cannot add access guard to %',f.proname;end if;
  elsif f.lanname='sql' then
   definition:=regexp_replace(definition,'LANGUAGE sql','LANGUAGE plpgsql','i');
   body:=E'BEGIN'||guard||case when f.proretset then ' RETURN QUERY ' when f.prorettype='void'::regtype then ' PERFORM ' else ' RETURN (' end||regexp_replace(f.prosrc,'[;[:space:]]+$','')||case when not f.proretset and f.prorettype<>'void'::regtype then '); END;' else '; END;' end;
  else continue;
  end if;
  -- Replace the final dollar-quoted body, rather than rewriting function options.
  definition:=regexp_replace(definition,'AS \$function\$[\s\S]*\$function\$', 'AS $function$'||replace(body,'\','\\')||'$function$');
  execute definition;
 end loop;
end;$guards$;
do $team_guard$
declare target regprocedure;def text;
begin
 for target in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='staff_tasks_day' and 'p_team'=any(p.proargnames) loop
  def:=pg_get_functiondef(target);
  if strpos(def,'-- app-team-access-v1')=0 then
   def:=replace(def,'-- app-page-access-v1',E'-- app-team-access-v1\n if p_team then perform public.app_access_assert(p_location_id,''tasks'',''team'');end if;\n -- app-page-access-v1');
   execute def;
  end if;
 end loop;
end;$team_guard$;
-- Restrict direct Data API reads without widening any existing RLS policies.
do $policies$
declare t record;resource text[];
begin
 for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity
 and exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='location_id' and not a.attisdropped) loop
  resource:=case when t.relname='daily_closeouts' then array['summary','closeouts'] when t.relname='reservations' then array['floor','reservations'] else public.app_access_resource(t.relname) end;
  if resource is null then continue;end if;
  execute format('drop policy if exists app_page_access_restriction on public.%I',t.relname);
  execute format('create policy app_page_access_restriction on public.%I as restrictive for select to authenticated using(public.app_access_resource_allowed(location_id,%L,%L))',t.relname,resource[1],resource[2]);
 end loop;
end;$policies$;
revoke all on function public.app_access_rules(uuid,text,text),public.app_access_save(uuid,text,text,integer,jsonb),public.app_access_load(uuid),public.app_access_allowed(uuid,text,text),public.app_access_assert(uuid,text,text),public.app_guest_links(uuid) from public,anon,authenticated;
grant execute on function public.app_access_rules(uuid,text,text),public.app_access_save(uuid,text,text,integer,jsonb),public.app_access_load(uuid),public.app_access_allowed(uuid,text,text),public.app_access_assert(uuid,text,text),public.app_guest_links(uuid) to authenticated;
-- Update saved screen wording and page-editor text without changing role keys.
create or replace function public.app_management_wording(p_text text)
returns text language sql immutable set search_path='' as $wording$
 select replace(replace(regexp_replace(regexp_replace(p_text,
 'general[[:space:]]+manager','Management','gi'),
 '\mGM\M','Management','g'),'The Management','Management'),'the Management','management');
$wording$;
revoke all on function public.app_management_wording(text) from public,anon,authenticated;
do $labels$
begin
 if to_regclass('public.screen_wording') is not null then
  update public.screen_wording set wording=public.app_management_wording(wording),updated_at=now()
  where wording is distinct from public.app_management_wording(wording);
 end if;
 if to_regclass('public.page_designs') is not null then
  update public.page_designs d set changes=x.changes,version=d.version+1,updated_at=now()
  from (select location_id,page,jsonb_object_agg(key,
   case when jsonb_typeof(value->'text')='string'
   then jsonb_set(value,'{text}',to_jsonb(public.app_management_wording(value->>'text')))
   else value end) as changes
   from public.page_designs cross join lateral jsonb_each(changes)
   group by location_id,page) x
  where d.location_id=x.location_id and d.page=x.page and d.changes is distinct from x.changes;
 end if;
end;$labels$;

-- Change user-facing exception wording, while preserving machine role keys.
do $messages$
declare f record;updated text;
begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prokind='f' and p.prosrc ~* 'general[[:space:]]+manager|\\mGM\\M' loop
  updated:=pg_get_functiondef(f.oid);
  updated:=regexp_replace(updated,'(raise[[:space:]]+exception[[:space:]]+''[^'']*)general[[:space:]]+manager','\1Management','gi');
  updated:=regexp_replace(updated,'(raise[[:space:]]+exception[[:space:]]+''[^'']*)\mGM\M','\1Management','g');
  if updated<>pg_get_functiondef(f.oid) then execute updated;end if;
 end loop;
end;$messages$;
notify pgrst,'reload schema';
commit;

begin;
create schema if not exists board_private;
revoke all on schema board_private from public,anon,authenticated;
alter table public.daily_closeouts add column if not exists stock_items jsonb not null default '[]', add column if not exists omitted_questions jsonb;
create table if not exists public.stock_board_items(
 id uuid primary key default gen_random_uuid(),location_id uuid not null references public.locations(id),
 name text not null,key text not null,version integer not null default 1,
 added_by uuid not null,added_by_name text not null,added_at timestamptz not null default now(),
 restocked_by uuid,restocked_by_name text,restocked_at timestamptz
);
create unique index if not exists stock_board_active_key on public.stock_board_items(location_id,key) where restocked_at is null;
create table if not exists public.stock_board_events(
 id bigint generated always as identity primary key,location_id uuid not null references public.locations(id),
 item_id uuid not null references public.stock_board_items(id),item_name text not null,action text not null,
 actor_id uuid not null,actor_name text not null,created_at timestamptz not null default now(),
 note text not null default '',request_id uuid,closeout_id uuid,
 unique(location_id,request_id),unique(closeout_id,item_id)
);
alter table public.stock_board_items enable row level security;
alter table public.stock_board_events enable row level security;
revoke all on public.stock_board_items,public.stock_board_events from public,anon,authenticated;
create or replace function board_private.actor_name(p_user uuid) returns text language sql stable security definer set search_path='' as $$
 select coalesce((select coalesce(nullif(btrim(preferred_name),''),nullif(btrim(full_name),'')) from public.profiles where id=p_user),'Team member');$$;
create or replace function board_private.add_item(p_location uuid,p_user uuid,p_name text,p_note text,p_request uuid,p_closeout uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.stock_board_items%rowtype;event public.stock_board_events%rowtype;normalized text;actor text;existing boolean;
begin
 p_name:=btrim(regexp_replace(p_name,'[[:space:]]+',' ','g'));normalized:=lower(p_name);
 if coalesce(length(p_name),0) not between 1 and 160 or coalesce(length(p_note),0)>500 then raise exception 'Enter an item name (up to 160 characters) and a note up to 500 characters.';end if;
 perform pg_advisory_xact_lock(hashtextextended('stock:'||p_location::text,0));
 if p_request is not null then
 select * into event from public.stock_board_events where location_id=p_location and request_id=p_request;
 if found then
  if event.actor_id<>p_user or lower(event.item_name)<>normalized or event.note<>coalesce(p_note,'') then raise exception 'This request belongs to a different report.';end if;
  return jsonb_build_object('id',event.item_id,'already_active',event.action='reported');
 end if;end if;
 select * into item from public.stock_board_items where location_id=p_location and key=normalized and restocked_at is null;
 existing:=found;actor:=board_private.actor_name(p_user);
 if not existing then insert into public.stock_board_items(location_id,name,key,added_by,added_by_name) values(p_location,p_name,normalized,p_user,actor) returning * into item;end if;
 insert into public.stock_board_events(location_id,item_id,item_name,action,actor_id,actor_name,note,request_id,closeout_id)
 values(p_location,item.id,p_name,case when existing then 'reported' else '86' end,p_user,actor,coalesce(p_note,''),p_request,p_closeout) on conflict(closeout_id,item_id) do nothing;
 return jsonb_build_object('id',item.id,'already_active',existing);
end;$$;
create or replace function public.stock_board_add(p_location_id uuid,p_name text,p_note text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active employee access required.' using errcode='42501';end if;
 if p_request_id is null then raise exception 'Request ID required.';end if;
 return board_private.add_item(p_location_id,auth.uid(),p_name,p_note,p_request_id,null);
end;$$;
create or replace function public.stock_board_restock(p_location_id uuid,p_item_id uuid,p_version integer)
returns void language plpgsql security definer set search_path='' as $$
declare item public.stock_board_items%rowtype;actor text;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active employee access required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('stock:'||p_location_id::text,0));
 select * into item from public.stock_board_items where id=p_item_id and location_id=p_location_id for update;
 if not found then raise exception 'Item not found.';end if;
 if item.restocked_at is not null then return;end if;
 if item.version is distinct from p_version then raise exception 'This item changed. Refresh the board.';end if;
 actor:=board_private.actor_name(auth.uid());
 update public.stock_board_items set restocked_at=clock_timestamp(),restocked_by=auth.uid(),restocked_by_name=actor,version=version+1 where id=item.id;
 insert into public.stock_board_events(location_id,item_id,item_name,action,actor_id,actor_name) values(p_location_id,item.id,item.name,'restocked',auth.uid(),actor);
end;$$;
create or replace function public.stock_board_load(p_location_id uuid,p_date date default null)
returns jsonb language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active employee access required.' using errcode='42501';end if;
 return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(i)-array['location_id','key','added_by','restocked_by'] order by i.restocked_at nulls first,i.added_at desc) from public.stock_board_items i where i.location_id=p_location_id and (i.restocked_at is null or i.restocked_at>now()-interval '30 days')),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(to_jsonb(e)-array['actor_id','request_id','location_id'] order by e.created_at desc,e.id desc) from (select * from public.stock_board_events where location_id=p_location_id and (p_date is null or ((created_at at time zone 'America/Chicago')-interval '4 hours')::date=p_date) order by created_at desc,id desc limit 200) e),'[]'::jsonb));
end;$$;
create or replace function public.stock_closeout_items(p_location_id uuid,p_closeout_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$declare c public.daily_closeouts%rowtype;begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active employee access required.' using errcode='42501';end if;
 select * into c from public.daily_closeouts where id=p_closeout_id and location_id=p_location_id and deleted_at is null;
 if not found or (c.user_id<>auth.uid() and public.mod_is_manager(p_location_id) is not true) then raise exception 'Closeout access required.' using errcode='42501';end if;
 return c.stock_items;
end;$$;
create or replace function board_private.closeout_stock() returns trigger language plpgsql security definer set search_path='' as $$declare value jsonb;name text;begin
 if jsonb_typeof(new.stock_items) is distinct from 'array' or jsonb_array_length(new.stock_items)>50 then raise exception 'Enter up to 50 separate 86 items.';end if;
 for value in select * from jsonb_array_elements(new.stock_items) loop
 if jsonb_typeof(value)<>'string' or length(btrim(value#>>'{}')) not between 1 and 160 then raise exception 'Each 86 item needs a name of up to 160 characters.';end if;
 end loop;
 if new.status<>'submitted' then return new;end if;
 for name in select distinct btrim(regexp_replace(v#>>'{}','[[:space:]]+',' ','g')) from jsonb_array_elements(new.stock_items) v loop
 if TG_OP='UPDATE' then
  if old.status='submitted' and exists(select 1 from jsonb_array_elements(old.stock_items) v where lower(btrim(regexp_replace(v#>>'{}','[[:space:]]+',' ','g')))=lower(name)) then continue;end if;
 end if;
 perform board_private.add_item(new.location_id,coalesce(new.corrected_by,new.user_id),name,'Reported on closeout',null,new.id);
 end loop;return new;
end;$$;
drop trigger if exists stock_closeout_report on public.daily_closeouts;
create trigger stock_closeout_report after insert or update of stock_items,status on public.daily_closeouts for each row execute function board_private.closeout_stock();

-- Permit the GM to hide built-in staff questions without deleting saved answers.
do $$declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('public.closeout_save_config(uuid,integer,jsonb,jsonb)'::regprocedure);
 old:='or q->''required''<>original->''required'' or q->''active''<>original->''active'' or q->''builtin''<>original->''builtin''';
 replacement:='or (q->>''audience''<>''staff'' and (q->''required''<>original->''required'' or q->''active''<>original->''active'')) or q->''builtin''<>original->''builtin''';
 if position('closeout_is_gm' in definition)=0 then definition:=regexp_replace(definition,'begin[[:space:]]*','begin'||chr(10)||' if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.closeout_is_gm(p_location_id) is not true then raise exception ''General manager access required.'' using errcode=''42501'';end if;'||chr(10));end if;
 if position(replacement in definition)=0 then
 if position(old in definition)=0 then raise exception 'Closeout settings validation changed. No changes applied.';end if;
 definition:=replace(definition,old,replacement);
 end if;execute definition;
end;$$;
create or replace function board_private.question_active(p_questions jsonb,p_id text) returns boolean language sql immutable set search_path='' as $$
 select coalesce((select (q->>'active')::boolean from jsonb_array_elements(p_questions) q where q->>'id'=p_id),true);$$;
-- Snapshot omissions and disable associated point rules before scoring new forms.
create or replace function board_private.form_policy() returns trigger language plpgsql security definer set search_path='' as $$
declare questions jsonb;rules jsonb;hidden jsonb;rule jsonb;ids text[]:=array[]::text[];
begin
 if TG_OP='UPDATE' and old.status='submitted' then new.omitted_questions:=old.omitted_questions;return new;end if;
 questions:=public.closeout_config_internal(new.location_id)->'questions';
 select coalesce(jsonb_agg(q->>'id'),'[]'::jsonb) into hidden from jsonb_array_elements(questions) q where q->>'audience'='staff' and (q->>'builtin')::boolean and (q->>'active')::boolean is not true;
 new.omitted_questions:=hidden;
 if new.status<>'submitted' then return new;end if;
 if hidden ? 'staff_0' or hidden ? 'staff_1' then ids:=ids||array['LATE_1_5','LATE_6_14','LATE_15_29','LATE_30_PLUS'];end if;
 if hidden ? 'staff_3' or hidden ? 'staff_0' then ids:=ids||array['SALES_TARGET','SALES_110','SALES_125'];end if;
 if hidden ? 'staff_6' then ids:=array_append(ids,'VOID_OVER_15');end if;
 if hidden ? 'staff_7' then ids:=array_append(ids,'DISCOUNT_OVER_15');end if;
 if hidden ? 'staff_11' then ids:=array_append(ids,'PEER_RECOGNITION');end if;
 rules:=coalesce(new.point_rules_snapshot,public.closeout_config_internal(new.location_id)->'rules');
 select coalesce(jsonb_agg(case when r->>'id'=any(ids) then r||'{"active":false}'::jsonb else r end),'[]'::jsonb) into new.point_rules_snapshot from jsonb_array_elements(rules) r;
 if hidden ? 'staff_0' then new.scheduled_start:='00:00';end if;
 if hidden ? 'staff_1' then new.clock_in:=new.scheduled_start;end if;
 if hidden ? 'staff_2' then new.shift_type:='PM';end if;
 if hidden ? 'staff_3' then new.net_sales:=0;new.zero_sales_confirmed:=true;new.zero_sales_reason:='Net sales question not collected on this form.';end if;
 if hidden ? 'staff_5' then new.cash_deposit:=0;end if;
 if hidden ? 'staff_6' then new.void_value:=0;new.void_count:=0;end if;
 if hidden ? 'staff_7' then new.discount_value:=0;end if;
 if hidden ? 'staff_14' then new.money_turned_in_to:=null;end if;
 if hidden ? 'staff_15' then new.drinks_made_by:=null;end if;
 return new;
end;$$;
drop trigger if exists zx_closeout_form_policy on public.daily_closeouts;
create trigger zx_closeout_form_policy before insert or update on public.daily_closeouts for each row execute function board_private.form_policy();
-- When clock-in is hidden, do not manufacture an hours-worked value.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.closeout_validate_clock_out()'::regprocedure);
 if position('board_private.question_active' in definition)=0 then
 definition:=replace(definition,'if new.status=''submitted'' then','if new.status=''submitted'' and (case when TG_OP=''UPDATE'' and old.status=''submitted'' then not coalesce(old.omitted_questions ? ''staff_1'',false) else board_private.question_active(public.closeout_config_internal(new.location_id)->''questions'',''staff_1'') end) then');execute definition;
 end if;
end;$$;
-- Preserve saved policies on corrections while allowing draft submission to capture omissions.
do $$declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('public.closeout_validate_and_score()'::regprocedure);
 old:='new.point_rules_snapshot:=old.point_rules_snapshot;new.submitted_at:=old.submitted_at;';
 replacement:='if old.status=''submitted'' then new.point_rules_snapshot:=old.point_rules_snapshot;end if;new.submitted_at:=old.submitted_at;';
 if position(replacement in definition)=0 then
 if position(old in definition)=0 then raise exception 'Closeout scoring changed. No changes applied.';end if;
 execute replace(definition,old,replacement);
 end if;
end;$$;
revoke all on all functions in schema board_private from public,anon,authenticated;
revoke all on function public.stock_board_add(uuid,text,text,uuid),public.stock_board_restock(uuid,uuid,integer),public.stock_board_load(uuid,date),public.stock_closeout_items(uuid,uuid) from public,anon,authenticated;
grant execute on function public.stock_board_add(uuid,text,text,uuid),public.stock_board_restock(uuid,uuid,integer),public.stock_board_load(uuid,date),public.stock_closeout_items(uuid,uuid) to authenticated;
create or replace function public.screen_wording_feedback(p_key uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if to_regclass('public.guest_feedback_settings') is null then return '{}'::jsonb;end if;
 return coalesce((select jsonb_object_agg(w.wording_key,w.wording) from public.screen_wording w join public.guest_feedback_settings s on s.location_id=w.location_id join public.locations l on l.id=s.location_id where s.public_key=p_key and s.enabled and l.is_active and w.wording_key like 'GuestFeedbackPage.%'),'{}'::jsonb);
end;$$;
revoke all on function public.screen_wording_feedback(uuid) from public,anon,authenticated;
grant execute on function public.screen_wording_feedback(uuid) to anon,authenticated;
notify pgrst,'reload schema';
commit;

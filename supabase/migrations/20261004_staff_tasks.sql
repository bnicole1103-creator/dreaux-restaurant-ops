begin;
create table if not exists public.staff_task_templates (
 id uuid primary key default gen_random_uuid(), location_id uuid not null references public.locations(id) on delete cascade,
 title text not null, position text not null, phase text not null, items jsonb not null,
 source_key text, source_note text not null default '', reviewed boolean not null default false, active boolean not null default true,
 version integer not null default 1, updated_at timestamptz not null default now(), unique(location_id,source_key),
 check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 200),check(phase in ('Opening','Running','Closing','Weekly','Other'))
);
create table if not exists public.staff_task_runs (
 id uuid primary key default gen_random_uuid(), location_id uuid not null references public.locations(id) on delete cascade,
 template_id uuid references public.staff_task_templates(id), business_date date not null, shift_label text not null default '',
 title text not null, position text not null, phase text not null, items jsonb not null,
 assigned_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), cancelled_at timestamptz,
 request_id uuid not null, unique(location_id,request_id)
);
create table if not exists public.staff_task_assignees (
 run_id uuid not null references public.staff_task_runs(id) on delete cascade,user_id uuid not null references public.profiles(id),
 version integer not null default 1,active boolean not null default true,primary key(run_id,user_id)
);
create table if not exists public.staff_task_checks (
 run_id uuid not null,user_id uuid not null,item_index integer not null check(item_index>=0),completed_at timestamptz not null default now(),
 primary key(run_id,user_id,item_index),foreign key(run_id,user_id) references public.staff_task_assignees(run_id,user_id) on delete cascade
);
create index if not exists staff_task_runs_day on public.staff_task_runs(location_id,business_date);
alter table public.staff_task_templates enable row level security;
alter table public.staff_task_runs enable row level security;
alter table public.staff_task_assignees enable row level security;
alter table public.staff_task_checks enable row level security;
revoke all on public.staff_task_templates,public.staff_task_runs,public.staff_task_assignees,public.staff_task_checks from anon,authenticated;
create or replace function public.staff_tasks_can_manage(p_location_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.closeout_is_member(p_location_id) is true and (public.mod_is_manager(p_location_id) is true or exists(select 1 from public.location_memberships m where m.location_id=p_location_id and m.user_id=auth.uid() and m.status='active' and m.can_manage_tasks));
$$;
create or replace function public.staff_tasks_seed(p_location_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if public.staff_tasks_can_manage(p_location_id) is not true then raise exception 'Task management access required.' using errcode='42501';end if;
 -- Seeds are populated below by the recovered source lists; existing edits are retained.
 insert into public.staff_task_templates(location_id,title,position,phase,items,source_key,source_note)
 select p_location_id,x->>'title',x->>'position',x->>'phase',x->'items',x->>'source_key',x->>'source_note'
 from jsonb_array_elements('[{"title": "Bartender — Opening", "position": "Bartender", "phase": "Opening", "items": ["Restock wells & backups", "Cut citrus & set garnish station"], "source_key": "2025-team-template:Bartender:Opening", "source_note": "Recovered from JusTinis_Team_Tasks_Template, October 28, 2025, task library. Review for current operations before assigning."}, {"title": "Bartender — Running", "position": "Bartender", "phase": "Running", "items": ["Wipe bar tops hourly"], "source_key": "2025-team-template:Bartender:Running", "source_note": "Recovered from JusTinis_Team_Tasks_Template, October 28, 2025, task library. Review for current operations before assigning."}, {"title": "Bartender — Closing", "position": "Bartender", "phase": "Closing", "items": ["Break down stations; wrap garnish"], "source_key": "2025-team-template:Bartender:Closing", "source_note": "Recovered from JusTinis_Team_Tasks_Template, October 28, 2025, task library. Review for current operations before assigning."}, {"title": "Server — Opening", "position": "Server", "phase": "Opening", "items": ["Roll silver & restock sidework"], "source_key": "2025-team-template:Server:Opening", "source_note": "Recovered from JusTinis_Team_Tasks_Template, October 28, 2025, task library. Review for current operations before assigning."}, {"title": "Server — Running", "position": "Server", "phase": "Running", "items": ["Prebuss & restock between turns"], "source_key": "2025-team-template:Server:Running", "source_note": "Recovered from JusTinis_Team_Tasks_Template, October 28, 2025, task library. Review for current operations before assigning."}, {"title": "Server — Closing", "position": "Server", "phase": "Closing", "items": ["Reset tables & condiments"], "source_key": "2025-team-template:Server:Closing", "source_note": "Recovered from JusTinis_Team_Tasks_Template, October 28, 2025, task library. Review for current operations before assigning."}, {"title": "Host — Opening", "position": "Host", "phase": "Opening", "items": ["Sync OpenTable & floor plan"], "source_key": "2025-team-template:Host:Opening", "source_note": "Recovered from JusTinis_Team_Tasks_Template, October 28, 2025, task library. Review for current operations before assigning."}, {"title": "Host — Running", "position": "Host", "phase": "Running", "items": ["Update pacing every 15 min"], "source_key": "2025-team-template:Host:Running", "source_note": "Recovered from JusTinis_Team_Tasks_Template, October 28, 2025, task library. Review for current operations before assigning."}, {"title": "Host — Closing", "position": "Host", "phase": "Closing", "items": ["Confirm tomorrow’s reservations"], "source_key": "2025-team-template:Host:Closing", "source_note": "Recovered from JusTinis_Team_Tasks_Template, October 28, 2025, task library. Review for current operations before assigning."}, {"title": "Busser / Food Runner — Opening", "position": "Busser / Food Runner", "phase": "Opening", "items": ["Set bus tubs & sanitizer buckets"], "source_key": "2025-team-template:Busser / Food Runner:Opening", "source_note": "Recovered from JusTinis_Team_Tasks_Template, October 28, 2025, task library. Review for current operations before assigning."}, {"title": "Busser / Food Runner — Running", "position": "Busser / Food Runner", "phase": "Running", "items": ["Floor sweep hourly"], "source_key": "2025-team-template:Busser / Food Runner:Running", "source_note": "Recovered from JusTinis_Team_Tasks_Template, October 28, 2025, task library. Review for current operations before assigning."}, {"title": "Busser / Food Runner — Closing", "position": "Busser / Food Runner", "phase": "Closing", "items": ["Mop FOH & restrooms"], "source_key": "2025-team-template:Busser / Food Runner:Closing", "source_note": "Recovered from JusTinis_Team_Tasks_Template, October 28, 2025, task library. Review for current operations before assigning."}, {"title": "Bartender — Detailed opening setup", "position": "Bartender", "phase": "Opening", "items": ["Courtyard: Put flowers on tables", "Courtyard: Make sure chairs are neatly placed at each table", "Courtyard: Make sure Brut Bar door is closed", "Courtyard: Put easel out (if there''s no host)", "Setup Main Dining: Notify Jessica if new flowers are needed", "Setup Main Dining: Turn air on 70", "Setup Main Dining: Take chairs and barstools down", "Setup Main Dining: Wipe tables and bar", "Setup Main Dining: Set up tables- menus, water glasses, special promo, flowers", "Setup Main Dining: Light candle", "Setup Main Dining: Turn uber eats on", "Set up Bar: Turn on daiquiri machines", "Set up Bar: Place mats down", "Set up Bar: Setup bar tools", "Set up Bar: Set up Mixers and juices", "Set up Bar: Do quick inventory check and notify Jessica if anything is missing", "Set up Bar: Setup garnish station", "Set up Bar: Setup seasonal garnish station/ bottomless (Friday & Saturday)", "Fruit Tray: Strawberry halves", "Fruit Tray: Lime wedges", "Fruit Tray: Lemon wedges", "Fruit Tray: Blackberries", "Fruit Tray: Blue berries", "Garnish Setup: Dehydrated Lemons", "Garnish Setup: Orange slices", "Garnish Setup: Mint", "Garnish Setup: Sugar/ lemon juice & simple syrup", "Garnish Setup: Rose Petals", "Garnish Setup: Lavender", "Garnish Setup: Shark gummies", "Garnish Setup: Purple orchids", "Garnish Setup: Bourbon cherries", "Garnish Setup: Tajin", "Garnish Setup: Red cherries", "Garnish Setup: Olives", "Garnish Setup: Sprinkles", "Garnish Setup: Dehydrated limes (if in stock)", "Garnish Setup: Coffee beans", "Garnish Setup: Jalapenos", "Garnish Setup: Pineapples", "Garnish Setup: Lychee", "Garnish Setup: Dehydrated Passionfruit", "Non-Alcoholic Beverages: Club soda", "Non-Alcoholic Beverages: Ginger Ale", "Non-Alcoholic Beverages: Sparkling Water- Mountain Valley", "Non-Alcoholic Beverages: Still water - Mountain Valley", "Non-Alcoholic Beverages: Tonic water", "Non-Alcoholic Beverages: Sprite", "Non-Alcoholic Beverages: Coke Zero", "Non-Alcoholic Beverages: Coke", "Non-Alcoholic Beverages: Ginger Beer", "Non-Alcoholic Beverages: Red Bull", "Non-Alcoholic Beverages: Watermelon Red Bull", "Non-Alcoholic Beverages: Bottled Root Beer", "Juices/ Mixers/ Purées: Lemon Mix- 4 pour bottles (6 on fri, sat, sun)", "Juices/ Mixers/ Purées: Lemon Drop- 4 pour bottles (6 on wed, fri, sat)", "Juices/ Mixers/ Purées: Iced Tea - 2 pour bottles (4 on fri, sat, sun)", "Juices/ Mixers/ Purées: Strawberry purée- 1 squeeze bottle", "Juices/ Mixers/ Purées: Peach purée- 1 squeeze bottle", "Juices/ Mixers/ Purées: Watermelon purée- 1 squeeze bottle", "Juices/ Mixers/ Purées: Passionfruit puree- 1 squeeze bottle", "Juices/ Mixers/ Purées: Mango puree - 1 squeeze bottle", "Juices/ Mixers/ Purées: Grenadine- 1 squeeze bottle", "Juices/ Mixers/ Purées: Blue Curacao - 1 squeeze bottle", "Juices/ Mixers/ Purées: Melon Liqueur- 1 squeeze bottle", "Juices/ Mixers/ Purées: Banana Puree- 1 mini squeeze bottle", "Juices/ Mixers/ Purées: Lavender- 1 mini squeeze bottle", "Juices/ Mixers/ Purées: Lemon Juice - 1 squeeze bottle (2 on wed, fri, sat, & sun)", "Juices/ Mixers/ Purées: Lime juice - 1 squeeze bottle", "Juices/ Mixers/ Purées: Orange juice - 1 squeeze bottle", "Juices/ Mixers/ Purées: Pineapple Juice- 1 squeeze bottle", "Juices/ Mixers/ Purées: Cranberry Juice - 1 squeeze bottle", "Juices/ Mixers/ Purées: Cold Brew- 1 pour bottle", "Juices/ Mixers/ Purées: Rosé Syrup - 1 squeeze bottle", "Juices/ Mixers/ Purées: Blueberry puree- 1 squeeze bottle (a backup container)", "Juices/ Mixers/ Purées: Lychee puree-1 squeeze bottle (a backup container)", "Beers: Miller Light", "Beers: Michelob Ultra", "Beers: Coors Light", "Beers: Bud Light", "Import: Modelo", "Import: Corona", "Import: Heineken", "Local: Jucifer", "Local: Holy Roller", "Local: Abita Amber", "Local: Paradise Park", "Local: Truly", "Wine/ Champagne: Canyon Road- Chardonnay", "Wine/ Champagne: White Haven - Sauvignon Blanco", "Wine/ Champagne: William Hill- Chardonnay", "Wine/ Champagne: Hahn- Pinot Grigio", "Wine/ Champagne: Maso Canali - Pinot Grigio", "Wine/ Champagne: Maison No.9- Rosé", "Red Wine: Canyon Road- Cabernet", "Red Wine: Franciscan -Cabernet", "Red Wine: Hahn- Pinot Noir", "Red Wine: Hahn- Merlot", "Red Wine: Estancia - Pinot Noir", "Red Wine: Hahn- GSM", "Red Wine: Prisoner - Red Blend", "Champagne: Opera Prima - Brut", "Champagne: Opera Prima - Sparkling Rosé", "Champagne: Mini Moet Bottles", "Champagne: La Marca Prosecco Bottles", "Other items to be stocked on: Gold long straws", "Other items to be stocked on: Gold short straws", "Other items to be stocked on: Black stirrers", "Other items to be stocked on: Black long straws", "Other items to be stocked on: Garnish sticks", "Other items to be stocked on: Cocktail napkins", "Other items to be stocked on: Dinner napkins", "Other items to be stocked on: To go cups - 9oz", "Other items to be stocked on: To go cups- 12oz", "Other items to be stocked on: To go lids", "Other items to be stocked on: Frozen cocktail straws", "Other To Do''s: Check OpenTable for reservations", "Other To Do''s: Check for Birthday Reservations- notify Jessica", "Other To Do''s: Roll Silverware"], "source_key": "2025-bartender-opening:detailed", "source_note": "Recovered from Opening Bartender Shift email, sent December 10, 2025 (checklist dated July 25, 2025). Review quantities, brands and setup for current operations."}]'::jsonb) x on conflict(location_id,source_key) do nothing;
end;$$;
create or replace function public.staff_tasks_templates(p_location_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 if public.staff_tasks_can_manage(p_location_id) is not true then raise exception 'Task management access required.' using errcode='42501';end if;
 perform public.staff_tasks_seed(p_location_id);
 select coalesce(jsonb_agg(to_jsonb(t) order by position,phase,title),'[]'::jsonb) into result from public.staff_task_templates t where location_id=p_location_id and active;
 return result;end;$$;
create or replace function public.staff_tasks_save_template(p_location_id uuid,p_id uuid,p_version integer,p_title text,p_position text,p_phase text,p_items jsonb,p_reviewed boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare tid uuid;begin
 if public.staff_tasks_can_manage(p_location_id) is not true then raise exception 'Task management access required.' using errcode='42501';end if;
 if p_title is null or length(btrim(p_title)) not between 1 and 200 or p_position is null or length(btrim(p_position)) not between 1 and 100 or p_phase is null or p_phase not in ('Opening','Running','Closing','Weekly','Other') then raise exception 'Enter a title, position and phase.';end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'Enter a task list.';end if;
 if jsonb_array_length(p_items) not between 1 and 200 or exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x)<>'string' or length(btrim(x#>>'{}')) not between 1 and 1000) then raise exception 'Use 1–200 filled tasks, up to 1,000 characters each.';end if;
 if p_id is null then
 insert into public.staff_task_templates(location_id,title,position,phase,items,reviewed) values(p_location_id,btrim(p_title),btrim(p_position),p_phase,p_items,coalesce(p_reviewed,false)) returning id into tid;
 else
 update public.staff_task_templates set title=btrim(p_title),position=btrim(p_position),phase=p_phase,items=p_items,reviewed=coalesce(p_reviewed,false),version=version+1,updated_at=now()
 where id=p_id and location_id=p_location_id and active and version=p_version returning id into tid;
 if tid is null then raise exception 'This list changed. Reload before saving.';end if;end if;
 return tid;end;$$;
create or replace function public.staff_tasks_assign(p_location_id uuid,p_template_id uuid,p_version integer,p_day date,p_shift text,p_users uuid[],p_request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare t public.staff_task_templates; rid uuid; uid uuid;begin
 if public.staff_tasks_can_manage(p_location_id) is not true then raise exception 'Task management access required.' using errcode='42501';end if;
 if p_day is null or p_request_id is null or p_users is null or cardinality(p_users) not between 1 and 100 or p_shift is null or length(p_shift)>100 then raise exception 'Choose a date and 1–100 employees.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_location_id::text||p_request_id::text,0));
 select id into rid from public.staff_task_runs where location_id=p_location_id and request_id=p_request_id;
 if rid is not null then return rid;end if;
 select * into t from public.staff_task_templates where id=p_template_id and location_id=p_location_id and active for share;
 if t.id is null or not t.reviewed or t.version is distinct from p_version then raise exception 'Save and review the current task list before assigning.';end if;
 foreach uid in array p_users loop
 if uid is null or public.closeout_is_member_for_tasks(p_location_id,uid) is not true then raise exception 'Every assignee must be an active member of this location.';end if;
 end loop;
 insert into public.staff_task_runs(location_id,template_id,business_date,shift_label,title,position,phase,items,assigned_by,request_id)
 values(p_location_id,t.id,p_day,btrim(p_shift),t.title,t.position,t.phase,t.items,auth.uid(),p_request_id) returning id into rid;
 insert into public.staff_task_assignees(run_id,user_id) select rid,u from unnest(p_users) u group by u;
 return rid;end;$$;
-- Use both memberships when validating an assignee; a disabled organization membership cannot receive work.
create or replace function public.closeout_is_member_for_tasks(p_location_id uuid,p_user_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.location_memberships m join public.locations l on l.id=m.location_id join public.organization_memberships o on o.organization_id=l.organization_id and o.user_id=m.user_id and o.status='active' where m.location_id=p_location_id and m.user_id=p_user_id and m.status='active');
$$;
create or replace function public.staff_tasks_day(p_location_id uuid,p_day date,p_team boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Location access required.' using errcode='42501';end if;
 if p_team and public.staff_tasks_can_manage(p_location_id) is not true then raise exception 'Task management access required.' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at,q.name),'[]'::jsonb) into result from (
 select r.id,r.title,r.position,r.phase,r.items,r.shift_label,r.business_date,r.created_at,a.user_id,a.version,
 coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''),'Team Member') name,
 coalesce((select jsonb_agg(jsonb_build_object('index',c.item_index,'at',c.completed_at) order by c.item_index) from public.staff_task_checks c where c.run_id=r.id and c.user_id=a.user_id),'[]'::jsonb) checks
 from public.staff_task_runs r join public.staff_task_assignees a on a.run_id=r.id left join public.profiles p on p.id=a.user_id
 where r.location_id=p_location_id and r.business_date=p_day and r.cancelled_at is null and a.active and (p_team or a.user_id=auth.uid())
 ) q;return result;end;$$;
create or replace function public.staff_tasks_check(p_location_id uuid,p_run_id uuid,p_item integer,p_done boolean,p_version integer)
returns integer language plpgsql security definer set search_path='' as $$
declare r public.staff_task_runs; a public.staff_task_assignees;begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Location access required.' using errcode='42501';end if;
 select * into r from public.staff_task_runs where id=p_run_id and location_id=p_location_id and cancelled_at is null for share;
 if r.id is null then raise exception 'This task assignment is no longer available.';end if;
 select * into a from public.staff_task_assignees where run_id=p_run_id and user_id=auth.uid() and active for update;
 if a.run_id is null then raise exception 'You can only check off your own assigned tasks.' using errcode='42501';end if;
 if a.version is distinct from p_version then raise exception 'Task progress changed. Refresh and try again.';end if;
 if p_item is null or p_item<0 or p_item>=jsonb_array_length(r.items) or p_done is null then raise exception 'Choose a valid task.';end if;
 if p_done then insert into public.staff_task_checks(run_id,user_id,item_index) values(p_run_id,auth.uid(),p_item) on conflict do nothing;
 else delete from public.staff_task_checks where run_id=p_run_id and user_id=auth.uid() and item_index=p_item;end if;
 update public.staff_task_assignees set version=version+1 where run_id=p_run_id and user_id=auth.uid() returning version into p_version;
 return p_version;end;$$;
create or replace function public.staff_tasks_remove_assignee(p_location_id uuid,p_run_id uuid,p_user_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if public.staff_tasks_can_manage(p_location_id) is not true then raise exception 'Task management access required.' using errcode='42501';end if;
 perform 1 from public.staff_task_runs where id=p_run_id and location_id=p_location_id for update;
 if not found then raise exception 'Task assignment not found.';end if;
 update public.staff_task_assignees set active=false,version=version+1 where run_id=p_run_id and user_id=p_user_id;
end;$$;
revoke all on function public.staff_tasks_can_manage(uuid),public.closeout_is_member_for_tasks(uuid,uuid),public.staff_tasks_seed(uuid),public.staff_tasks_templates(uuid),public.staff_tasks_save_template(uuid,uuid,integer,text,text,text,jsonb,boolean),public.staff_tasks_assign(uuid,uuid,integer,date,text,uuid[],uuid),public.staff_tasks_day(uuid,date,boolean),public.staff_tasks_check(uuid,uuid,integer,boolean,integer),public.staff_tasks_remove_assignee(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.staff_tasks_can_manage(uuid),public.staff_tasks_templates(uuid),public.staff_tasks_save_template(uuid,uuid,integer,text,text,text,jsonb,boolean),public.staff_tasks_assign(uuid,uuid,integer,date,text,uuid[],uuid),public.staff_tasks_day(uuid,date,boolean),public.staff_tasks_check(uuid,uuid,integer,boolean,integer),public.staff_tasks_remove_assignee(uuid,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;

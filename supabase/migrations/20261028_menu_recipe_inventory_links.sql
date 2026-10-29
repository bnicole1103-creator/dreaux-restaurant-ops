begin;

do $$ begin
 if to_regclass('public.restaurant_menu_items') is null
 or to_regclass('public.training_food') is null
 or to_regclass('public.training_cocktails') is null
 or to_regclass('public.stock_board_items') is null then
  raise exception 'Install the menu catalog, recipe training and 86 board migrations first.';
 end if;
end $$;

create schema if not exists menu_link_private;
revoke all on schema menu_link_private from public,anon,authenticated;

create table if not exists public.menu_inventory_items(
 id uuid primary key default gen_random_uuid(),
 location_id uuid not null references public.locations(id),
 name text not null,
 name_key text generated always as (lower(regexp_replace(btrim(name),'[[:space:]]+',' ','g'))) stored,
 default_unit text not null default 'each',
 archived boolean not null default false,
 version integer not null default 1,
 updated_at timestamptz not null default now(),
 updated_by uuid references public.profiles(id),
 unique(location_id,name_key)
);
create table if not exists public.menu_item_recipe_links(
 id uuid primary key default gen_random_uuid(),
 location_id uuid not null references public.locations(id),
 menu_item_id uuid not null references public.restaurant_menu_items(id) on delete cascade,
 recipe_kind text not null check(recipe_kind in ('food','cocktails')),
 recipe_id uuid not null,
 version integer not null default 1,
 updated_at timestamptz not null default now(),
 updated_by uuid references public.profiles(id),
 unique(location_id,menu_item_id)
);
create table if not exists public.menu_recipe_ingredient_links(
 link_id uuid not null references public.menu_item_recipe_links(id) on delete cascade,
 inventory_item_id uuid not null references public.menu_inventory_items(id),
 quantity_text text not null default '',
 unit text not null,
 notes text not null default '',
 sort_order integer not null,
 primary key(link_id,inventory_item_id),
 unique(link_id,sort_order)
);
create table if not exists public.menu_linked_disposal_sheets(
 id uuid primary key default gen_random_uuid(),
 location_id uuid not null references public.locations(id),
 user_id uuid not null references public.profiles(id),
 request_id uuid not null,
 submitted_at timestamptz not null default now(),
 lines jsonb not null check(jsonb_typeof(lines)='array'),
 unique(location_id,user_id,request_id)
);
alter table public.stock_board_items add column if not exists linked_kind text,add column if not exists linked_id uuid;
alter table public.menu_inventory_items enable row level security;
alter table public.menu_item_recipe_links enable row level security;
alter table public.menu_recipe_ingredient_links enable row level security;
alter table public.menu_linked_disposal_sheets enable row level security;
revoke all on public.menu_inventory_items,public.menu_item_recipe_links,public.menu_recipe_ingredient_links,public.menu_linked_disposal_sheets from public,anon,authenticated;

create or replace function menu_link_private.manager(p_location uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.mod_is_manager(p_location) is true;
$$;
create or replace function menu_link_private.recipe_exists(p_location uuid,p_kind text,p_id uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if p_kind='food' then return exists(select 1 from public.training_food where id=p_id and location_id=p_location);
 elsif p_kind='cocktails' then return exists(select 1 from public.training_cocktails where id=p_id and location_id=p_location);
 end if;
 return false;
end;$$;
create or replace function menu_link_private.affected_menu(p_location uuid,p_inventory uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(x.name order by x.name),'[]'::jsonb) from (
  select distinct m.data->>'name' name
  from public.menu_recipe_ingredient_links ri
  join public.menu_item_recipe_links l on l.id=ri.link_id and l.location_id=p_location
  join public.restaurant_menu_items m on m.id=l.menu_item_id and m.location_id=p_location and not m.archived
  where ri.inventory_item_id=p_inventory
 ) x;
$$;

create or replace function public.menu_link_workspace_load(p_location_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active location access required.' using errcode='42501';end if;
 return jsonb_build_object(
  'manager',menu_link_private.manager(p_location_id),
  'menu',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',data->>'name','category',data->>'category') order by data->>'name',id) from public.restaurant_menu_items where location_id=p_location_id and not archived),'[]'::jsonb),
  'recipes',coalesce((select jsonb_agg(x order by x->>'name') from (
    select jsonb_build_object('id',id,'name',data->>'name','category',data->>'category','kind','food') x from public.training_food where location_id=p_location_id
    union all
    select jsonb_build_object('id',id,'name',data->>'name','category',data->>'category','kind','cocktails') x from public.training_cocktails where location_id=p_location_id
   ) q),'[]'::jsonb),
  'ingredients',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'unit',default_unit,'version',version,'archived',archived) order by archived,name,id) from public.menu_inventory_items where location_id=p_location_id),'[]'::jsonb),
  'links',coalesce((select jsonb_agg(jsonb_build_object(
    'version',l.version,'menu_item_id',l.menu_item_id,'recipe_kind',l.recipe_kind,'recipe_id',l.recipe_id,
    'ingredients',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'quantity',ri.quantity_text,'unit',ri.unit,'notes',ri.notes) order by ri.sort_order) from public.menu_recipe_ingredient_links ri join public.menu_inventory_items i on i.id=ri.inventory_item_id where ri.link_id=l.id),'[]'::jsonb)
   ) order by l.updated_at desc) from public.menu_item_recipe_links l where l.location_id=p_location_id),'[]'::jsonb)
 );
end;$$;

create or replace function public.menu_link_ingredient_save(p_location_id uuid,p_id uuid,p_version integer,p_name text,p_unit text,p_archived boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare row public.menu_inventory_items;begin
 if menu_link_private.manager(p_location_id) is not true then raise exception 'Management access required.' using errcode='42501';end if;
 p_name:=btrim(regexp_replace(p_name,'[[:space:]]+',' ','g'));p_unit:=btrim(regexp_replace(p_unit,'[[:space:]]+',' ','g'));
 if p_name is null or p_unit is null or length(p_name) not between 1 and 160 or length(p_unit) not between 1 and 40 or p_archived is null then raise exception 'Enter an ingredient name and a default unit.';end if;
 if p_id is null then
  insert into public.menu_inventory_items(location_id,name,default_unit,archived,updated_by) values(p_location_id,p_name,p_unit,p_archived,auth.uid()) returning * into row;
 else
  update public.menu_inventory_items set name=p_name,default_unit=p_unit,archived=p_archived,version=version+1,updated_at=now(),updated_by=auth.uid() where id=p_id and location_id=p_location_id and version=p_version returning * into row;
  if not found then raise exception 'This ingredient changed. Reload before saving.';end if;
 end if;
 return to_jsonb(row)-'location_id';
exception when unique_violation then raise exception 'That ingredient already exists. Choose it from the list.';
end;$$;

create or replace function public.menu_link_save(p_location_id uuid,p_menu_item_id uuid,p_recipe_kind text,p_recipe_id uuid,p_expected_version integer,p_ingredients jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare link public.menu_item_recipe_links;line jsonb;position integer:=0;ingredient public.menu_inventory_items;begin
 if menu_link_private.manager(p_location_id) is not true then raise exception 'Management access required.' using errcode='42501';end if;
 if not exists(select 1 from public.restaurant_menu_items where id=p_menu_item_id and location_id=p_location_id and not archived) then raise exception 'Choose an active menu item.';end if;
 if menu_link_private.recipe_exists(p_location_id,p_recipe_kind,p_recipe_id) is not true then raise exception 'Choose a saved recipe.';end if;
 if jsonb_typeof(p_ingredients) is distinct from 'array' or jsonb_array_length(p_ingredients)>100 then raise exception 'Choose up to 100 ingredients.';end if;
 if exists(select 1 from jsonb_array_elements(p_ingredients) x group by x->>'id' having count(*)>1) then raise exception 'Remove duplicate ingredients.';end if;
 perform pg_advisory_xact_lock(hashtextextended('menu-link:'||p_location_id::text||':'||p_menu_item_id::text,0));
 select * into link from public.menu_item_recipe_links where location_id=p_location_id and menu_item_id=p_menu_item_id for update;
 if (found and link.version is distinct from p_expected_version) or (not found and p_expected_version is not null) then raise exception 'Links changed. Reload before saving.';end if;
 insert into public.menu_item_recipe_links(location_id,menu_item_id,recipe_kind,recipe_id,updated_by) values(p_location_id,p_menu_item_id,p_recipe_kind,p_recipe_id,auth.uid())
 on conflict(location_id,menu_item_id) do update set recipe_kind=excluded.recipe_kind,recipe_id=excluded.recipe_id,version=menu_item_recipe_links.version+1,updated_at=now(),updated_by=auth.uid() returning * into link;
 delete from public.menu_recipe_ingredient_links where link_id=link.id;
 for line in select value from jsonb_array_elements(p_ingredients) loop
  if jsonb_typeof(line) is distinct from 'object' or (line-array['id','quantity','unit','notes'])<>'{}'::jsonb then raise exception 'Invalid ingredient row.';end if;
  select * into ingredient from public.menu_inventory_items where id=nullif(line->>'id','')::uuid and location_id=p_location_id and not archived;
  if not found then raise exception 'An ingredient is unavailable. Reload links.';end if;
  if length(coalesce(line->>'quantity',''))>40 or length(btrim(coalesce(line->>'unit',''))) not between 1 and 40 or length(coalesce(line->>'notes',''))>300 then raise exception 'Review ingredient amount, unit and notes.';end if;
  position:=position+1;
  insert into public.menu_recipe_ingredient_links(link_id,inventory_item_id,quantity_text,unit,notes,sort_order) values(link.id,ingredient.id,btrim(coalesce(line->>'quantity','')),btrim(line->>'unit'),btrim(coalesce(line->>'notes','')),position);
 end loop;
 return jsonb_build_object('saved',true,'link_id',link.id,'version',link.version);
end;$$;

create or replace function public.menu_link_remove(p_location_id uuid,p_menu_item_id uuid,p_expected_version integer) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if menu_link_private.manager(p_location_id) is not true then raise exception 'Management access required.' using errcode='42501';end if;
 delete from public.menu_item_recipe_links where location_id=p_location_id and menu_item_id=p_menu_item_id and version=p_expected_version;
 if not found then raise exception 'Links changed. Reload before removing.';end if;
 return found;
end;$$;

create or replace function public.menu_link_disposal_options(p_location_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active location access required.' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'unit',default_unit,'affected_menu',menu_link_private.affected_menu(p_location_id,id)) order by name,id) from public.menu_inventory_items where location_id=p_location_id and not archived),'[]'::jsonb);
end;$$;

create or replace function public.menu_link_disposal_load(p_location_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active location access required.' using errcode='42501';end if;
 return jsonb_build_object('manager',public.mod_is_manager(p_location_id) is true,'history',coalesce((
  select jsonb_agg(jsonb_build_object(
   'id',s.id,'submitted_at',s.submitted_at,
   'employee',coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''),'Team member'),
   'lines',coalesce((select jsonb_agg(x||jsonb_build_object('name',coalesce(i.name,'Archived item'))) from jsonb_array_elements(s.lines) x left join public.menu_inventory_items i on i.id=(x->>'catalog_item_id')::uuid),'[]'::jsonb)
  ) order by s.submitted_at desc)
  from public.menu_linked_disposal_sheets s left join public.profiles p on p.id=s.user_id
  where s.location_id=p_location_id and (s.user_id=auth.uid() or public.mod_is_manager(p_location_id) is true)
 ),'[]'::jsonb));
end;$$;

create or replace function public.menu_link_disposal_submit(p_location_id uuid,p_request_id uuid,p_lines jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare line jsonb;result uuid;begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active location access required.' using errcode='42501';end if;
 if p_request_id is null or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'Enter 1 to 100 disposal rows.';end if;
 for line in select value from jsonb_array_elements(p_lines) loop
  if jsonb_typeof(line) is distinct from 'object' or (line-array['catalog_item_id','quantity','unit','reason'])<>'{}'::jsonb then raise exception 'Invalid disposal row.';end if;
  if not exists(select 1 from public.menu_inventory_items where id=nullif(line->>'catalog_item_id','')::uuid and location_id=p_location_id and not archived) then raise exception 'Choose an active linked item.';end if;
  if jsonb_typeof(line->'quantity') is distinct from 'number' or (line->>'quantity')::numeric<=0 or (line->>'quantity')::numeric>100000 or length(btrim(coalesce(line->>'unit',''))) not between 1 and 40 or coalesce(line->>'reason','') not in ('Spoilage','Spill / waste','Preparation loss','Quality issue','Expired','Other') then raise exception 'Enter a positive quantity, unit and disposal reason.';end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('linked-disposal:'||p_location_id::text||':'||auth.uid()::text||':'||p_request_id::text,0));
 select id into result from public.menu_linked_disposal_sheets where location_id=p_location_id and user_id=auth.uid() and request_id=p_request_id;
 if result is not null then
  if (select lines from public.menu_linked_disposal_sheets where id=result) is distinct from p_lines then raise exception 'This request already saved different rows. Refresh before retrying.';end if;
  return result;
 end if;
 insert into public.menu_linked_disposal_sheets(location_id,user_id,request_id,lines) values(p_location_id,auth.uid(),p_request_id,p_lines) returning id into result;
 return result;
end;$$;

create or replace function public.stock_board_add_linked(p_location_id uuid,p_kind text,p_linked_id uuid,p_note text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare name text;result jsonb;begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active employee access required.' using errcode='42501';end if;
 if p_request_id is null then raise exception 'Request ID required.';end if;
 if p_kind='ingredient' then select i.name into name from public.menu_inventory_items i where i.id=p_linked_id and i.location_id=p_location_id and not i.archived;
 elsif p_kind='menu' then select m.data->>'name' into name from public.restaurant_menu_items m where m.id=p_linked_id and m.location_id=p_location_id and not m.archived;
 else raise exception 'Choose a linked menu item or ingredient.';end if;
 if name is null then raise exception 'Linked item unavailable.';end if;
 result:=board_private.add_item(p_location_id,auth.uid(),name,p_note,p_request_id,null);
 if exists(select 1 from public.stock_board_items where id=(result->>'id')::uuid and linked_id is not null and (linked_kind<>p_kind or linked_id<>p_linked_id)) then raise exception 'A different linked item with this name is already unavailable. Review that entry first.';end if;
 update public.stock_board_items set linked_kind=p_kind,linked_id=p_linked_id where id=(result->>'id')::uuid and location_id=p_location_id and (linked_id is null or (linked_kind=p_kind and linked_id=p_linked_id));
 return result;
end;$$;

create or replace function public.stock_board_load(p_location_id uuid,p_date date default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active employee access required.' using errcode='42501';end if;
 return jsonb_build_object(
  'items',coalesce((select jsonb_agg((to_jsonb(i)-array['location_id','key','added_by','restocked_by'])||jsonb_build_object('affected_menu',case when i.linked_kind='ingredient' then menu_link_private.affected_menu(p_location_id,i.linked_id) when i.linked_kind='menu' then coalesce((select jsonb_build_array(m.data->>'name') from public.restaurant_menu_items m where m.id=i.linked_id and m.location_id=p_location_id),'[]'::jsonb) else '[]'::jsonb end) order by i.restocked_at nulls first,i.added_at desc) from public.stock_board_items i where i.location_id=p_location_id and (i.restocked_at is null or i.restocked_at>now()-interval '30 days')),'[]'::jsonb),
  'events',coalesce((select jsonb_agg(to_jsonb(e)-array['actor_id','request_id','location_id'] order by e.created_at desc,e.id desc) from (select * from public.stock_board_events where location_id=p_location_id and (p_date is null or ((created_at at time zone 'America/Chicago')-interval '4 hours')::date=p_date) order by created_at desc,id desc limit 200) e),'[]'::jsonb),
  'catalog',coalesce((select jsonb_agg(x order by x->>'name') from (
    select jsonb_build_object('kind','ingredient','id',id,'name',name,'affected_menu',menu_link_private.affected_menu(p_location_id,id)) x from public.menu_inventory_items where location_id=p_location_id and not archived
    union all
    select jsonb_build_object('kind','menu','id',id,'name',data->>'name','affected_menu',jsonb_build_array(data->>'name')) x from public.restaurant_menu_items where location_id=p_location_id and not archived
   ) q),'[]'::jsonb)
 );
end;$$;

revoke all on all functions in schema menu_link_private from public,anon,authenticated;
revoke all on function public.menu_link_workspace_load(uuid),public.menu_link_ingredient_save(uuid,uuid,integer,text,text,boolean),public.menu_link_save(uuid,uuid,text,uuid,integer,jsonb),public.menu_link_remove(uuid,uuid,integer),public.menu_link_disposal_options(uuid),public.menu_link_disposal_load(uuid),public.menu_link_disposal_submit(uuid,uuid,jsonb),public.stock_board_add_linked(uuid,text,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.menu_link_workspace_load(uuid),public.menu_link_ingredient_save(uuid,uuid,integer,text,text,boolean),public.menu_link_save(uuid,uuid,text,uuid,integer,jsonb),public.menu_link_remove(uuid,uuid,integer),public.menu_link_disposal_options(uuid),public.menu_link_disposal_load(uuid),public.menu_link_disposal_submit(uuid,uuid,jsonb),public.stock_board_add_linked(uuid,text,uuid,text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;

select true as menu_recipe_inventory_links_installed,false as production_behavior_verified;

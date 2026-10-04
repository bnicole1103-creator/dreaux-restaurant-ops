begin;

-- Group labels are independent of employees' positions.
create or replace function public.staff_task_group_label(p_item text,p_fallback text)
returns text language sql immutable set search_path='' as $$
 select case
  when strpos(p_item,':') between 2 and 61 then
   case lower(btrim(split_part(p_item,':',1)))
    when 'courtyard' then 'Courtyard Setup'
    when 'setup main dining' then 'Store / Dining Room Setup'
    when 'set up bar' then 'Bar Setup'
    when 'fruit tray' then 'Fruit Tray Setup'
    when 'garnish setup' then 'Garnish Setup'
    when 'non-alcoholic beverages' then 'Soft Drinks & Water Restocking'
    when 'juices/ mixers/ purées' then 'Juice, Mixer & Purée Restocking'
    when 'beers' then 'Beer Restocking'
    when 'import' then 'Imported Beer Restocking'
    when 'local' then 'Local Beer & Seltzer Restocking'
    when 'wine/ champagne' then 'White Wine & Rosé Restocking'
    when 'red wine' then 'Red Wine Restocking'
    when 'champagne' then 'Champagne & Prosecco Restocking'
    when 'other items to be stocked on' then 'Service Supplies Restocking'
    when 'other to do''s' then 'Reservations & Service Prep'
    else btrim(split_part(p_item,':',1))
   end
  else p_fallback
 end;
$$;

-- Convert templates into independently assignable groups of at most 8 tasks.
-- Original daily assignments and completed task indexes are retained.
create or replace function public.staff_tasks_group_templates(p_location_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare t public.staff_task_templates;fallback text;g record;part integer;parts integer;group_items jsonb;group_title text;
begin
 if public.staff_tasks_can_manage(p_location_id) is not true then
  raise exception 'Task management access required.' using errcode='42501';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('task-groups:'||p_location_id::text,0));
 for t in select * from public.staff_task_templates where location_id=p_location_id and active order by id for update loop
  fallback:=case t.source_key
   when '2025-team-template:Bartender:Opening' then 'Bar Stock & Garnish Prep'
   when '2025-team-template:Bartender:Running' then 'Bar Cleaning During Service'
   when '2025-team-template:Bartender:Closing' then 'Bar Breakdown & Garnish Storage'
   when '2025-team-template:Server:Opening' then 'Silverware & Sidework Setup'
   when '2025-team-template:Server:Running' then 'Pre-bussing & Service Restocking'
   when '2025-team-template:Server:Closing' then 'Table & Condiment Reset'
   when '2025-team-template:Host:Opening' then 'Reservations & Floor Plan Setup'
   when '2025-team-template:Host:Running' then 'Seating & Pacing Checks'
   when '2025-team-template:Host:Closing' then 'Next-Day Reservation Review'
   when '2025-team-template:Busser / Food Runner:Opening' then 'Bus Tubs & Sanitizer Setup'
   when '2025-team-template:Busser / Food Runner:Running' then 'Floor Cleaning During Service'
   when '2025-team-template:Busser / Food Runner:Closing' then 'Floor & Restroom Closing'
   else t.title end;
  if t.source_key like 'task-group:%' then continue;end if;
  if fallback=t.title and jsonb_array_length(t.items)<=8 and not exists(select 1 from jsonb_array_elements_text(t.items) i where public.staff_task_group_label(i,t.title)<>t.title) then continue;end if;
  for g in
   select public.staff_task_group_label(value,fallback) label,jsonb_agg(value order by ord) items,min(ord) first_item
   from jsonb_array_elements_text(t.items) with ordinality x(value,ord)
   group by public.staff_task_group_label(value,fallback) order by min(ord)
  loop
   parts:=(jsonb_array_length(g.items)+7)/8;
   for part in 1..parts loop
    select jsonb_agg(value order by ord) into group_items
    from jsonb_array_elements(g.items) with ordinality x(value,ord) where ord>(part-1)*8 and ord<=part*8;
    group_title:=left(g.label,170)||case when parts>1 then ' · Part '||part::text||' of '||parts::text else '' end;
    insert into public.staff_task_templates(location_id,title,position,phase,items,source_key,source_note,reviewed)
    values(p_location_id,group_title,'General',t.phase,group_items,
     'task-group:'||t.id::text||':'||g.first_item::text||':'||part::text,
     t.source_note||case when t.source_note='' then '' else ' ' end||'Grouped from '||t.title||'. Assign to any employee.',t.reviewed)
    on conflict(location_id,source_key) do nothing;
   end loop;
  end loop;
  update public.staff_task_templates set active=false,version=version+1,updated_at=now() where id=t.id;
 end loop;
end;
$$;

create or replace function public.staff_tasks_templates(p_location_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if public.staff_tasks_can_manage(p_location_id) is not true then
  raise exception 'Task management access required.' using errcode='42501';
 end if;
 perform public.staff_tasks_seed(p_location_id);
 perform public.staff_tasks_group_templates(p_location_id);
 select coalesce(jsonb_agg(to_jsonb(t) order by phase,title),'[]'::jsonb) into result
 from public.staff_task_templates t where location_id=p_location_id and active;
 return result;
end;
$$;

revoke all on function public.staff_task_group_label(text,text),public.staff_tasks_group_templates(uuid) from public,anon,authenticated;
revoke all on function public.staff_tasks_templates(uuid) from public,anon,authenticated;
grant execute on function public.staff_tasks_templates(uuid) to authenticated;
notify pgrst,'reload schema';
commit;

begin;
-- Exact negative/empty responses only. Real names such as No. 3 Gin remain valid.
create or replace function board_private.actual_item(p_name text)
returns boolean language sql immutable set search_path='' as $$
 select regexp_replace(lower(btrim(coalesce(p_name,''))),'[^a-z0-9]','','g') not in
 ('','no','none','nothing','na','nil','noitems','noneatall','notapplicable','no86','no86s','no86items','no86editems','no86ditems','nothing86','nothing86ed','nothing86d','zero','yes');
$$;
create or replace function board_private.clean_closeout_stock()
returns trigger language plpgsql security definer set search_path='' as $$
declare entry jsonb;item text;clean jsonb:='[]'::jsonb;seen text[]:='{}';
begin
 if new.stock_items is null then new.stock_items:='[]'::jsonb;end if;
 if jsonb_typeof(new.stock_items) is distinct from 'array' or jsonb_array_length(new.stock_items)>50 then raise exception 'Enter up to 50 separate 86 items.';end if;
 for entry in select value from jsonb_array_elements(new.stock_items) loop
  if jsonb_typeof(entry) is distinct from 'string' then raise exception 'Each 86 item must be an item name.';end if;
  item:=btrim(regexp_replace(entry#>>'{}','[[:space:]]+',' ','g'));
  if board_private.actual_item(item) is not true then continue;end if;
  if length(item)>160 then raise exception 'Each 86 item must be 160 characters or fewer.';end if;
  if lower(item)=any(seen) then continue;end if;
  seen:=array_append(seen,lower(item));clean:=clean||jsonb_build_array(item);
 end loop;
 new.stock_items:=clean;return new;
end;$$;
drop trigger if exists clean_closeout_stock_items on public.daily_closeouts;
create trigger clean_closeout_stock_items before insert or update of stock_items,status on public.daily_closeouts
for each row execute function board_private.clean_closeout_stock();
-- Preserve the working board, history, permissions, restocking and sender logic.
do $$begin
 if to_regprocedure('board_private.add_item_before_empty_filter(uuid,uuid,text,text,uuid,uuid)') is null then
  alter function board_private.add_item(uuid,uuid,text,text,uuid,uuid) rename to add_item_before_empty_filter;
 end if;
 if to_regprocedure('board_private.stock_board_load_before_empty_filter(uuid,date)') is null then
  alter function public.stock_board_load(uuid,date) set schema board_private;
  alter function board_private.stock_board_load(uuid,date) rename to stock_board_load_before_empty_filter;
 end if;
 if to_regprocedure('board_private.stock_closeout_items_before_empty_filter(uuid,uuid)') is null then
  alter function public.stock_closeout_items(uuid,uuid) set schema board_private;
  alter function board_private.stock_closeout_items(uuid,uuid) rename to stock_closeout_items_before_empty_filter;
 end if;
end;$$;
create or replace function board_private.add_item(p_location uuid,p_user uuid,p_name text,p_note text,p_request uuid,p_closeout uuid)
returns jsonb language plpgsql security definer set search_path='' as $$begin
 if board_private.actual_item(p_name) is not true then raise exception 'Enter an actual unavailable item, not Yes, No, None or N/A.';end if;
 return board_private.add_item_before_empty_filter(p_location,p_user,p_name,p_note,p_request,p_closeout);
end;$$;
create or replace function public.stock_board_load(p_location_id uuid,p_date date default null)
returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 result:=board_private.stock_board_load_before_empty_filter(p_location_id,p_date);
 return result||jsonb_build_object(
 'items',coalesce((select jsonb_agg(value order by ordinal) from jsonb_array_elements(result->'items') with ordinality as x(value,ordinal) where board_private.actual_item(value->>'name')),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(value order by ordinal) from jsonb_array_elements(result->'events') with ordinality as x(value,ordinal) where board_private.actual_item(value->>'item_name')),'[]'::jsonb));
end;$$;
create or replace function public.stock_closeout_items(p_location_id uuid,p_closeout_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 result:=board_private.stock_closeout_items_before_empty_filter(p_location_id,p_closeout_id);
 return coalesce((select jsonb_agg(value order by ordinal) from jsonb_array_elements(result) with ordinality as x(value,ordinal) where board_private.actual_item(value#>>'{}')),'[]'::jsonb);
end;$$;
revoke all on function board_private.actual_item(text),board_private.clean_closeout_stock(),
 board_private.add_item(uuid,uuid,text,text,uuid,uuid),board_private.add_item_before_empty_filter(uuid,uuid,text,text,uuid,uuid),
 board_private.stock_board_load_before_empty_filter(uuid,date),board_private.stock_closeout_items_before_empty_filter(uuid,uuid) from public,anon,authenticated;
revoke all on function public.stock_board_load(uuid,date),public.stock_closeout_items(uuid,uuid) from public,anon,authenticated;
grant execute on function public.stock_board_load(uuid,date),public.stock_closeout_items(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;

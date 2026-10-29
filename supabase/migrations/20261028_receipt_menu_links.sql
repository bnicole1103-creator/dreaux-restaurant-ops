begin;
create table if not exists public.receipt_catalog_links(
 location_id uuid not null references public.locations(id),
 receipt_type text not null check(receipt_type in ('closeout','purchase')),
 receipt_id uuid not null,
 lines jsonb not null default '[]',
 version integer not null default 1,
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now(),
 primary key(location_id,receipt_type,receipt_id)
);
create table if not exists public.receipt_catalog_link_audit(
 id bigint generated always as identity primary key,
 location_id uuid not null,receipt_type text not null,receipt_id uuid not null,
 actor uuid not null,before_lines jsonb,after_lines jsonb not null,changed_at timestamptz not null default now()
);
alter table public.receipt_catalog_links enable row level security;
alter table public.receipt_catalog_link_audit enable row level security;
revoke all on public.receipt_catalog_links,public.receipt_catalog_link_audit from public,anon,authenticated;
create or replace function public.receipt_item_links(p_location uuid,p_receipt uuid,p_type text,p_lines jsonb default null,p_version integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.closeout_receipts; p public.purchase_receipts; saved public.receipt_catalog_links; allowed boolean:=false; editable boolean:=false; entry jsonb; options jsonb; loaded jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location) is not true then raise exception 'Active location access required.' using errcode='42501';end if;
 if p_type='closeout' then
  select * into c from public.closeout_receipts where location_id=p_location and id=p_receipt and deleted_at is null for update;
  if c.id is null then raise exception 'Receipt not found.';end if;
  loaded:=public.closeout_receipts_load(p_location,c.business_date,c.business_date,null,null);
  select true,coalesce((x->>'can_edit')::boolean,false) into allowed,editable from jsonb_array_elements(coalesce(loaded->'rows','[]')) x where x->>'id'=p_receipt::text limit 1;
 elsif p_type='purchase' then
  select * into p from public.purchase_receipts where location_id=p_location and id=p_receipt and deleted_at is null for update;
  if p.id is null then raise exception 'Receipt not found.';end if;
  allowed:=p.user_id=auth.uid();editable:=allowed;
 else raise exception 'Choose a valid receipt type.';end if;
 if coalesce(allowed,false) is not true then raise exception 'Receipt access required.' using errcode='42501';end if;
 select * into saved from public.receipt_catalog_links where location_id=p_location and receipt_type=p_type and receipt_id=p_receipt for update;
 if p_lines is not null then
  if not coalesce(editable,false) then raise exception 'Receipt editing access required.' using errcode='42501';end if;
  if coalesce(saved.version,0) is distinct from p_version then raise exception 'Item links changed. Reopen the receipt before editing.';end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines)>100 then raise exception 'Choose up to 100 receipt items.';end if;
  for entry in select value from jsonb_array_elements(p_lines) loop
   if entry->>'kind'='menu' then
    if not exists(select 1 from public.restaurant_menu_items where id=(entry->>'id')::uuid and location_id=p_location and not archived) then raise exception 'Menu item unavailable.';end if;
   elsif entry->>'kind'='ingredient' then
    if not exists(select 1 from public.menu_inventory_items where id=(entry->>'id')::uuid and location_id=p_location and not archived) then raise exception 'Ingredient unavailable.';end if;
   else raise exception 'Select a menu item or ingredient.';end if;
   if nullif(entry->>'quantity','') is null or (entry->>'quantity')::numeric<=0 or (entry->>'quantity')::numeric>100000 then raise exception 'Enter a positive quantity.';end if;
  end loop;
  insert into public.receipt_catalog_link_audit(location_id,receipt_type,receipt_id,actor,before_lines,after_lines) values(p_location,p_type,p_receipt,auth.uid(),saved.lines,p_lines);
  insert into public.receipt_catalog_links(location_id,receipt_type,receipt_id,lines,version,updated_by) values(p_location,p_type,p_receipt,p_lines,1,auth.uid())
  on conflict(location_id,receipt_type,receipt_id) do update set lines=excluded.lines,version=receipt_catalog_links.version+1,updated_by=auth.uid(),updated_at=now() returning * into saved;
 end if;
 select coalesce(jsonb_agg(x order by x->>'name'),'[]') into options from (
  select jsonb_build_object('kind','menu','id',id,'name',data->>'name') x from public.restaurant_menu_items where location_id=p_location and not archived
  union all select jsonb_build_object('kind','ingredient','id',id,'name',name) from public.menu_inventory_items where location_id=p_location and not archived
 ) items;
 return jsonb_build_object('lines',coalesce(saved.lines,'[]'),'version',coalesce(saved.version,0),'options',options);
end;$$;
revoke all on function public.receipt_item_links(uuid,uuid,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.receipt_item_links(uuid,uuid,text,jsonb,integer) to authenticated;
notify pgrst,'reload schema';
commit;

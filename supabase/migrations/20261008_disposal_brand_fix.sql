begin;
create or replace function public.inventory_add_brand(p_location_id uuid,p_brand text)
returns text language plpgsql security definer set search_path='' as $$
declare cleaned text; normalized text; existing text;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then
  raise exception 'Active location access required.' using errcode='42501';
 end if;
 cleaned:=regexp_replace(btrim(p_brand),'[[:space:]]+',' ','g');
 if cleaned is null or length(cleaned) not between 1 and 120 or p_brand ~ '[[:cntrl:]]' then
  raise exception 'Enter a brand name from 1 to 120 characters.';
 end if;
 normalized:=lower(replace(replace(cleaned,'’',''),'''',''));
 perform pg_advisory_xact_lock(hashtextextended('inventory-brand:'||normalized,0));
 select brand into existing from public.inventory_bottle_catalog
 where lower(replace(replace(regexp_replace(btrim(brand),'[[:space:]]+',' ','g'),'’',''),'''',''))=normalized
 order by brand limit 1;
 if existing is not null then return existing; end if;
 insert into public.inventory_bottle_catalog(brand) values(cleaned);
 return cleaned;
end; $$;
revoke all on function public.inventory_add_brand(uuid,text) from public,anon,authenticated;
grant execute on function public.inventory_add_brand(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;

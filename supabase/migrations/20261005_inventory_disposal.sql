begin;
create table if not exists public.inventory_bottle_catalog (
 brand text primary key
);
create table if not exists public.inventory_disposal_sheets (
 id uuid primary key default gen_random_uuid(),
 location_id uuid not null references public.locations(id),
 user_id uuid not null references public.profiles(id),
 request_id uuid not null,
 submitted_at timestamptz not null default now(),
 lines jsonb not null check(jsonb_typeof(lines)='array'),
 unique(location_id,user_id,request_id)
);
alter table public.inventory_bottle_catalog enable row level security;
alter table public.inventory_disposal_sheets enable row level security;
revoke all on public.inventory_bottle_catalog,public.inventory_disposal_sheets from public,anon,authenticated;
insert into public.inventory_bottle_catalog(brand) values
('El toro'),('Camarena blanco'),('Camarena Reposado'),('Patron blanco'),('Patron Reposado'),('Don Julio blanco'),('Don Julio Reposado'),('Don Julio Anejo'),('Casamigos blanco'),('Casamigos Reposado'),('Casamigos mezcal'),('Espolon blanco'),('Espolon Reposado'),('Cincoro'),('Komos'),('Svedka'),('Svedka Citron'),('Svedka Vanilla'),('Veil citron'),('Veil vanilla'),('St. Roch'),('Absolut Elyx'),('Tito''s'),('Ketel One'),('Grey Goose'),('Grey Goose strawberry and lemon grass'),('Grey Goose Berry Rouge'),('Chopin'),('Skol'),('Mims'),('Bacardi Silver'),('Spiced Bacardi'),('Bumbu XO'),('Bumbu Crème'),('Malibu'),('Aristocrat'),('Hendricks'),('Bombay Original'),('Bombay Sapphire'),('Bombay Bramble'),('Empress Indigo'),('Empress Elderflower Rose'),('Seagrams'),('Seagrams watermelon'),('Jim Beam'),('Crown Royal'),('Crown Peach'),('Crown Apple'),('Crown Vanilla'),('Crown Blackberry'),('Jameson'),('Gentleman''s Jack'),('Jack Daniel''s'),('Jack Daniel''s honey'),('Jack Daniel''s blackberry'),('Jack Daniel''s apple'),('Bulleit'),('Bulleit rye'),('Sazerac rye'),('Woodford reserve'),('Irish channel'),('Uncle nearest green'),('Uncle nearest rye'),('Uncle nearest 1856'),('Uncle nearest 1884'),('Kentucky owl'),('Angel''s envy'),('Screwball'),('Bruich'),('Dewar''s'),('Glenlevit 12'),('Glenmorangie'),('McCallan 12'),('Johnny walker black label'),('Korbel'),('Dusse'),('Hennessy'),('Remy Martin'),('Remy Martin VSOP'),('Grand Marnier'),('Chambord'),('Coffee liqueur'),('Irish cream'),('White chocolate Irish cream'),('Frangelico'),('Chartreuse'),('Melon'),('Aperol'),('Dry vermouth'),('Sweet vermouth'),('Campari'),('Elderflower'),('Absinth'),('Luxardo'),('Crème de cocoa'),('Praline'),('Pralines and crème'),('Angostura bitters'),('Orange bitters'),('Peychaud''s bitters'),('Free foam'),('Sauvignon blanc'),('Pinot Grigio'),('Still rose'),('Boxed rose'),('Pinot noir'),('Cabernet'),('Merlot'),('Alma Brut'),('Opera Prima Brut'),('Prosecco'),('Sparkling rose')
on conflict(brand) do nothing;
create or replace function public.inventory_disposal_load(p_location_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then
  raise exception 'Active location access required.' using errcode='42501';
 end if;
 return jsonb_build_object(
  'brands',(select coalesce(jsonb_agg(brand order by brand),'[]'::jsonb) from public.inventory_bottle_catalog),
  'history',(select coalesce(jsonb_agg(to_jsonb(h) order by h.submitted_at desc),'[]'::jsonb) from (
   select s.id,s.submitted_at,s.lines,coalesce(nullif(p.preferred_name,''),p.full_name,'Staff member') as employee
   from public.inventory_disposal_sheets s left join public.profiles p on p.id=s.user_id
   where s.location_id=p_location_id and (s.user_id=auth.uid() or public.mod_is_manager(p_location_id))
   order by s.submitted_at desc,s.id limit 50
  ) h)
 );
end; $$;
create or replace function public.inventory_disposal_submit(p_location_id uuid,p_request_id uuid,p_lines jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare line jsonb; result uuid;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then
  raise exception 'Active location access required.' using errcode='42501';
 end if;
 if p_request_id is null or jsonb_typeof(p_lines) is distinct from 'array' then
  raise exception 'Enter disposal rows.';
 end if;
 if jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'Enter 1 to 100 rows.'; end if;
 for line in select value from jsonb_array_elements(p_lines) loop
  if jsonb_typeof(line) is distinct from 'object'
   or not exists(select 1 from public.inventory_bottle_catalog where brand=line->>'brand')
   or line->>'size' is null or line->>'size' not in ('1.75 L','1 L','750 mL','Pint')
   or jsonb_typeof(line->'quantity') is distinct from 'number' then
   raise exception 'Choose a catalog brand, bottle size and whole-bottle quantity.';
  end if;
  if exists(select 1 from jsonb_object_keys(line) k where k not in ('brand','size','quantity')) then
   raise exception 'Unsupported disposal field.';
  end if;
  if (line->>'quantity')::numeric not between 1 and 10000
   or (line->>'quantity')::numeric<>trunc((line->>'quantity')::numeric) then
   raise exception 'Quantity must be a whole number from 1 to 10000.';
  end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_lines) x group by x->>'brand',x->>'size' having count(*)>1) then
  raise exception 'Combine rows with the same brand and size.';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_location_id::text||auth.uid()::text||p_request_id::text,0));
 select id into result from public.inventory_disposal_sheets
 where location_id=p_location_id and user_id=auth.uid() and request_id=p_request_id;
 if result is not null then
  if (select lines from public.inventory_disposal_sheets where id=result) is distinct from p_lines then
   raise exception 'This request already saved different rows. Refresh before submitting again.';
  end if;
  return result;
 end if;
 insert into public.inventory_disposal_sheets(location_id,user_id,request_id,lines)
 values(p_location_id,auth.uid(),p_request_id,p_lines) returning id into result;
 return result;
end; $$;
revoke all on function public.inventory_disposal_load(uuid),public.inventory_disposal_submit(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.inventory_disposal_load(uuid),public.inventory_disposal_submit(uuid,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;

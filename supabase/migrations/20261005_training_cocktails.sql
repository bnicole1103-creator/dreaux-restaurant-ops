begin;
create table if not exists public.training_cocktail_seed (
 seed_key text primary key, data jsonb not null
);
create table if not exists public.training_cocktails (
 id uuid primary key default gen_random_uuid(),
 location_id uuid not null references public.locations(id),
 seed_key text,
 data jsonb not null,
 name_key text generated always as (lower(regexp_replace(btrim(data->>'name'),'[[:space:]]+',' ','g'))) stored,
 version integer not null default 1,
 updated_at timestamptz not null default now(),
 updated_by uuid,
 unique(location_id,name_key), unique(location_id,seed_key)
);
alter table public.training_cocktail_seed enable row level security;
alter table public.training_cocktails enable row level security;
revoke all on public.training_cocktail_seed,public.training_cocktails from public,anon,authenticated;
insert into public.training_cocktail_seed(seed_key,data) values
('stored-01','{"name": "Blues in My Cup", "category": "JusTini''s Signatures", "build": "1.5 oz well vodka\n1 oz lemon\n0.5 oz blueberry purée\n0.5 oz simple", "method": "Shake with ice; strain", "finish": "Sugar rim; 3 blueberries", "notes": "Stored quiz standard uses well vodka; menu reference differs."}'::jsonb),
('stored-02','{"name": "Doo Ya Thang", "category": "JusTini''s Signatures", "build": "1.5 oz Empress Gin\n0.5 oz lemon\n1 oz lavender syrup\nTop Champagne", "method": "Shake first ingredients with ice; strain; top Champagne", "finish": "Coupe; lavender seeds", "notes": ""}'::jsonb),
('stored-03','{"name": "Hello Barbara", "category": "JusTini''s Signatures", "build": "0.5 oz strawberry purée\n0.5 oz triple sec\n0.5 oz lemon\nMuddled mixed berries\n1.5 oz Grey Goose Strawberry & Lemongrass Vodka", "method": "Muddle berries; shake; dirty dump; top sparkling rosé", "finish": "", "notes": "Glass and garnish were marked for manager verification in the latest specification form."}'::jsonb),
('stored-04','{"name": "Fuego", "category": "JusTini''s Signatures", "build": "1.5 oz Tequila Blanco\n0.75 oz triple sec\n0.5 oz lime\nMuddle 2 jalapeños\nTop pineapple", "method": "Muddle jalapeño; shake; dirty dump", "finish": "Tajín rim", "notes": ""}'::jsonb),
('stored-05','{"name": "Down in the 9th Ward", "category": "JusTini''s Signatures", "build": "0.5 oz triple sec\n0.25 oz mint syrup\nFresh mint\n1.5 oz Maker’s Mark\n2 oz sweet tea", "method": "Muddle fresh mint; remaining method not entered.", "finish": "Collins glass; fresh mint; dehydrated lemon wheel", "notes": "Latest form build specifies Maker’s Mark; menu reference specifies Jim Beam."}'::jsonb),
('stored-06','{"name": "Krewe of JusTini", "category": "JusTini''s Signatures", "build": "1.5 oz Long Island mix\n0.5 oz banana purée\n2 oz melon liqueur\nTop with pineapple juice", "method": "", "finish": "Hurricane glass; purple orchid", "notes": "Method not entered in the stored specification form."}'::jsonb),
('stored-07','{"name": "Crystal Clear", "category": "JusTini''s Signatures", "build": "1.5 oz Grey Goose Strawberry & Lemongrass Vodka\n0.5 oz elderflower\n1 oz white cranberry juice\n0.25 oz lime juice", "method": "", "finish": "Martini glass; strawberry garnish", "notes": "Method not entered. Newer specification replaces the earlier gin/cucumber description."}'::jsonb),
('stored-08','{"name": "Good Tea", "category": "JusTini''s Signatures", "build": "", "method": "", "finish": "", "notes": "House measurements, method and finish not entered. Latest menu reference: Camarena Reposado, iced tea, JusTini’s lychee syrup."}'::jsonb),
('stored-09','{"name": "Brown Eyed Girl", "category": "JusTini''s Signatures", "build": "1.5 oz vanilla vodka\n1 oz cold brew\n0.5 oz Kahlúa\n0.5 oz simple", "method": "Fill shaker with plenty of ice; shake hard 10 seconds; strain", "finish": "Martini glass; 3 coffee beans", "notes": "Stored quiz uses cold brew; menu reference uses espresso."}'::jsonb),
('stored-10','{"name": "Sparkling Rum Punch", "category": "JusTini''s Signatures", "build": "1.5 oz Malibu\n1 oz pineapple juice\n1 oz cranberry juice\n1 oz orange juice\n0.5 oz strawberry purée\n0.5 oz simple syrup\nTop Champagne", "method": "", "finish": "Hurricane glass; 2 strawberry halves", "notes": "Method not entered. Menu reference additionally mentions silver rum; the stored measured build does not."}'::jsonb),
('stored-11','{"name": "Hurricane Dauphine", "category": "JusTini''s Signatures", "build": "1.5 oz Cognac\n1 oz passion fruit\n1 oz lemon mix\n0.5 oz orange juice\n0.5 oz grenadine\n0.25 oz simple\nGrand Marnier float", "method": "Shake with ice; strain/serve per house standard", "finish": "", "notes": "Glass and garnish marked for manager verification; menu description differs from the stored measured build."}'::jsonb),
('stored-12','{"name": "Bywater Martini", "category": "JusTini''s Signatures", "build": "1.5 oz Tito’s Vodka\n2 oz lychee syrup\n0.25 oz lime", "method": "Shake with ice; strain", "finish": "Martini glass; lychee garnish", "notes": ""}'::jsonb),
('stored-13','{"name": "Call Her, CEO", "category": "JusTini''s Signatures", "build": "", "method": "", "finish": "", "notes": "House measurements, method and finish not entered. Menu reference: frozen watermelon frosé, Seagram’s Gin, rosé wine."}'::jsonb),
('stored-14','{"name": "Side Hustle", "category": "JusTini''s Signatures", "build": "", "method": "", "finish": "", "notes": "House measurements, method and finish not entered. Menu reference: frozen piña colada, Cognac, coconut rum; Lychee Colada modification."}'::jsonb),
('stored-15','{"name": "Classic Old Fashioned", "category": "Classic Cocktails", "build": "", "method": "", "finish": "", "notes": "House measurements, method and finish not entered. Latest menu reference: Maker’s Mark, orange bitters, maraschino cherries."}'::jsonb),
('stored-16','{"name": "Manhattan", "category": "Classic Cocktails", "build": "1.5 oz bourbon\n1 oz sweet vermouth\n3 dashes Peychaud’s", "method": "Stir with ice; strain", "finish": "Coupe; dark cherry", "notes": "Stored quiz build differs from menu reference of Bulleit Rye and Angostura bitters."}'::jsonb),
('stored-17','{"name": "Classic Lemon Drop", "category": "Classic Cocktails", "build": "1.5 oz Citron Vodka\n1 oz lemon\n0.5 oz triple sec", "method": "Shake with ice; strain", "finish": "Sugar rim; dehydrated lemon wheel", "notes": ""}'::jsonb),
('stored-18','{"name": "Classic Sidecar", "category": "Classic Cocktails", "build": "1.5 oz Cognac\n0.75 oz lemon\n1 oz triple sec", "method": "Shake with ice; strain", "finish": "Coupe; half sugar side rim; orange peel", "notes": "Stored build uses Cognac; menu reference specifies Korbel Brandy."}'::jsonb),
('stored-19','{"name": "Aperol Spritz", "category": "Classic Cocktails", "build": "2 oz Aperol\n1 oz club soda\nTop with Prosecco", "method": "", "finish": "Large wine glass; orange slice", "notes": "Method not entered in the latest form."}'::jsonb),
('stored-20','{"name": "Negroni", "category": "Classic Cocktails", "build": "1 oz gin\n1 oz sweet vermouth\n1 oz Campari", "method": "", "finish": "Rocks glass; orange peel", "notes": "Method not entered in the latest form."}'::jsonb),
('stored-21','{"name": "Mojito", "category": "Classic Cocktails", "build": "", "method": "", "finish": "", "notes": "House measurements, method and finish not entered. Menu reference: white rum, fresh mint, lime."}'::jsonb),
('stored-22','{"name": "Margarita", "category": "Classic Cocktails", "build": "1.5 oz tequila\n0.5 oz lime\n0.75 oz triple sec", "method": "Shake with ice; serve per house standard", "finish": "Sugar or salt rim; optional 0.5 oz purée", "notes": ""}'::jsonb),
('stored-23','{"name": "French 75", "category": "Classic Cocktails", "build": "", "method": "", "finish": "", "notes": "House measurements, method and finish not entered. Latest menu reference: Bombay Dry Gin or Korbel Brandy, lemon, Champagne."}'::jsonb),
('stored-24','{"name": "Sazerac", "category": "Classic Cocktails", "build": "2 tsp absinthe\n1.5 oz Cognac or rye\n0.5 oz simple", "method": "Stir with ice; strain into prepared glass with no ice", "finish": "Rocks glass; lemon peel twist", "notes": ""}'::jsonb),
('stored-25','{"name": "Hurricane JusTini", "category": "JusTini''s Signatures", "build": "1.5 oz spiced rum\n1.5 oz silver rum\n1 oz orange juice\n0.5 oz lime juice\n5 oz passion fruit puree\n0.5 oz grenadine", "method": "", "finish": "Hurricane glass; orange and cherry", "notes": "5 oz passion fruit puree is preserved exactly from the stored form; method not entered."}'::jsonb),
('stored-26','{"name": "Pimm’s Cup", "category": "Classic Cocktails", "build": "", "method": "", "finish": "", "notes": "House measurements, method and finish not entered. Latest menu reference: gin-based cocktail, ginger ale, fresh fruit."}'::jsonb),
('stored-27','{"name": "Brandy Milk Punch", "category": "Classic Cocktails", "build": "1.5 oz brandy\n0.5 oz simple\n1.5 oz Irish cream\n0.25 oz vanilla extract", "method": "Shake with ice; serve per house standard", "finish": "Nutmeg", "notes": "Stored quiz build differs from menu reference of Nyak Cinnamon Cognac, milk and vanilla."}'::jsonb),
('stored-28','{"name": "Cosmopolitan", "category": "Classic Cocktails", "build": "1.5 oz vodka\n0.5 oz cranberry\n0.5 oz lime\n0.75 oz triple sec", "method": "Shake with ice; strain", "finish": "Lime wheel", "notes": ""}'::jsonb),
('stored-29','{"name": "Dirty Martini", "category": "Classic Cocktails", "build": "1.5 oz vodka or gin\n1 oz olive juice\n0.5 oz dry vermouth", "method": "Stir or shake per guest preference; strain", "finish": "Olive", "notes": ""}'::jsonb),
('stored-30','{"name": "Moscow Mule", "category": "Classic Cocktails", "build": "1.5 oz vodka\n1 oz lime\nTop ginger beer", "method": "Build over ice", "finish": "Copper mug; lime", "notes": ""}'::jsonb),
('stored-31','{"name": "Gimlet", "category": "Classic Cocktails", "build": "1.5 oz gin or vodka\n1 oz lime\n0.75 oz simple", "method": "Shake with ice; strain", "finish": "Martini glass; lime wheel", "notes": ""}'::jsonb),
('stored-32','{"name": "Green Tea Shot", "category": "Shots & Other Builds", "build": "0.5 oz Irish whiskey\n0.5 oz peach schnapps\n0.5 oz sweet & sour\nTop Sprite", "method": "Shake first three with ice; strain; top Sprite", "finish": "Shot glass", "notes": ""}'::jsonb),
('stored-33','{"name": "White Tea Shot", "category": "Shots & Other Builds", "build": "0.5 oz vodka OR Tequila Blanco\n0.5 oz peach schnapps\n0.5 oz sweet & sour\nTop Sprite", "method": "Shake first three with ice; strain; top Sprite", "finish": "Shot glass", "notes": ""}'::jsonb),
('stored-34','{"name": "Lemon Drop Shot", "category": "Shots & Other Builds", "build": "0.5 oz Citron Vodka\n0.25 oz lemon\n0.25 oz simple", "method": "Shake with ice; strain", "finish": "Sugar rim", "notes": ""}'::jsonb),
('stored-35','{"name": "Almost Fall Blackberry Fizz", "category": "Pre-Fall Cocktails", "build": "", "method": "", "finish": "", "notes": "Pre-fall menu lists: Blackberry whiskey, fresh blackberry, lemon, Brut Champagne. Exact quantities and build method were not provided."}'::jsonb),
('stored-36','{"name": "Between Seasons Espresso Martini", "category": "Pre-Fall Cocktails", "build": "", "method": "", "finish": "Whipped cream crown", "notes": "Pre-fall menu lists: Vodka, espresso, Irish cream, caramel. Exact quantities and build method were not provided."}'::jsonb),
('stored-37','{"name": "Guava Breeze Side Car", "category": "Pre-Fall Cocktails", "build": "", "method": "", "finish": "Served up", "notes": "Pre-fall menu lists: Cognac, guava, fresh lemon, orange liqueur. Exact quantities and build method were not provided."}'::jsonb),
('stored-38','{"name": "Pornstar Martini", "category": "Pre-Fall Cocktails", "build": "", "method": "", "finish": "Personal bottle of Prosecco to sip or pour", "notes": "Pre-fall menu lists: Vanilla vodka, passionfruit, fresh lime. Exact quantities and build method were not provided."}'::jsonb),
('stored-39','{"name": "Hurricane Dauphine for 2", "category": "Pre-Fall Cocktails", "build": "", "method": "", "finish": "Two Hurricane glasses; designed to share", "notes": "Pre-fall menu lists: D’USSÉ Cognac, passion fruit, pineapple, Grand Marnier. Exact quantities and build method were not provided."}'::jsonb)
on conflict(seed_key) do nothing;
create or replace function public.training_cocktails_load(p_location_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then
  raise exception 'Active location access required.' using errcode='42501';
 end if;
 insert into public.training_cocktails(location_id,seed_key,data)
 select p_location_id,seed_key,data from public.training_cocktail_seed
 on conflict do nothing;
 return (select coalesce(jsonb_agg(to_jsonb(c) order by c.data->>'name'),'[]'::jsonb)
 from public.training_cocktails c where location_id=p_location_id);
end; $$;
create or replace function public.training_cocktails_save(p_location_id uuid,p_recipes jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare item jsonb; d jsonb; k text; rid uuid; expected integer;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.closeout_is_gm(p_location_id) is not true then
  raise exception 'Owner or general manager access required.' using errcode='42501';
 end if;
 if jsonb_typeof(p_recipes) is distinct from 'array' then raise exception 'Enter recipes.'; end if;
 if jsonb_array_length(p_recipes) not between 1 and 50 or length(p_recipes::text)>500000 then raise exception 'Save 1 to 50 recipes at a time.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('training-cocktails:'||p_location_id::text,0));
 for item in select value from jsonb_array_elements(p_recipes) loop
  d:=item->'data';
  if jsonb_typeof(d) is distinct from 'object' then raise exception 'Invalid recipe.'; end if;
  if exists(select 1 from jsonb_object_keys(d) x where x not in ('name','category','build','method','finish','notes')) then raise exception 'Unsupported recipe field.'; end if;
  foreach k in array array['name','category','build','method','finish','notes'] loop
   if jsonb_typeof(d->k) is distinct from 'string' or length(d->>k)>12000 then raise exception 'Invalid or oversized recipe field: %',k; end if;
  end loop;
  if length(btrim(d->>'name')) not between 1 and 160 or length(btrim(d->>'category')) not between 1 and 80 then raise exception 'Enter a cocktail name and category.'; end if;
  d:=jsonb_set(jsonb_set(d,'{name}',to_jsonb(btrim(d->>'name'))),'{category}',to_jsonb(btrim(d->>'category')));
  rid:=nullif(item->>'id','')::uuid;
  if rid is null then
   if exists(select 1 from public.training_cocktails where location_id=p_location_id and name_key=lower(regexp_replace(btrim(d->>'name'),'[[:space:]]+',' ','g'))) then
    raise exception 'Cocktail already exists: %. Open it and choose Edit.',d->>'name';
   end if;
   insert into public.training_cocktails(location_id,data,updated_by) values(p_location_id,d,auth.uid());
  else
   expected:=(item->>'version')::integer;
   update public.training_cocktails set data=d,version=version+1,updated_at=now(),updated_by=auth.uid()
   where id=rid and location_id=p_location_id and version=expected;
   if not found then raise exception 'Recipe changed or is unavailable. Refresh before editing.'; end if;
  end if;
 end loop;
end; $$;
revoke all on function public.training_cocktails_load(uuid),public.training_cocktails_save(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.training_cocktails_load(uuid),public.training_cocktails_save(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;

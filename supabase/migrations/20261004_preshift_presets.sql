begin;
create table if not exists public.preshift_preset_chunks (
 id uuid primary key default gen_random_uuid(),
 location_id uuid not null references public.locations(id) on delete cascade,
 title text not null check(length(btrim(title)) between 1 and 100),
 category text not null check(category in ('hours','specials','service','sales','uniform')),
 weekday integer check(weekday between 0 and 6),
 body text not null check(length(btrim(body)) between 1 and 4000),
 source_key text,
 version integer not null default 1,
 deleted_at timestamptz,
 updated_at timestamptz not null default now(),
 unique(location_id,source_key)
);
alter table public.preshift_preset_chunks enable row level security;
revoke all on public.preshift_preset_chunks from public,anon,authenticated;

create or replace function public.preshift_presets(p_location_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then raise exception 'Manager access required.' using errcode='42501';end if;
 insert into public.preshift_preset_chunks(location_id,title,category,weekday,body,source_key)
 select p_location_id,x->>'title',x->>'category',(x->>'weekday')::integer,x->>'body',x->>'key'
 from jsonb_array_elements($seeds$[
  {
    "key": "hours-0",
    "title": "⏰ Sunday hours",
    "category": "hours",
    "body": "Dining: [confirm opening time]–[confirm closing time].\nBrunch: 11 AM–4 PM.",
    "weekday": 0
  },
  {
    "key": "specials-0",
    "title": "🔥 Sunday specials",
    "category": "specials",
    "body": "Bubbly Flight — $35: bottle of champagne, two juices, and a fruit cup.\nBottomless brunch cocktails: 90 minutes; choose one option and stick with it. Bottomless mimosas are orange juice only; other flavors are regular price.\nAdd today’s featured items and availability.",
    "weekday": 0
  },
  {
    "key": "hours-1",
    "title": "⏰ Monday hours",
    "category": "hours",
    "body": "Dining: [enter Monday hours or Closed].",
    "weekday": 1
  },
  {
    "key": "specials-1",
    "title": "🔥 Monday specials",
    "category": "specials",
    "body": "Add Monday’s specials, featured items, prices, and availability.",
    "weekday": 1
  },
  {
    "key": "hours-2",
    "title": "⏰ Tuesday hours",
    "category": "hours",
    "body": "Dining: [confirm opening time]–[confirm closing time].\nHappy Hour: 3–6 PM.",
    "weekday": 2
  },
  {
    "key": "specials-2",
    "title": "🔥 Tuesday specials",
    "category": "specials",
    "body": "Hot Sausage Taco — $4\nSeafood Taco — $4\nSalmon Taco — $5\nMovies & Margaritas: [today’s movie].\nConfirm specials and availability before posting.",
    "weekday": 2
  },
  {
    "key": "hours-3",
    "title": "⏰ Wednesday hours",
    "category": "hours",
    "body": "Dining: [confirm opening time]–[confirm closing time].\nAll-Day Happy Hour.",
    "weekday": 3
  },
  {
    "key": "specials-3",
    "title": "🔥 Wednesday specials",
    "category": "specials",
    "body": "Promote All-Day Happy Hour early with specific cocktail and appetizer recommendations.\nAdd today’s featured items, prices, and availability.",
    "weekday": 3
  },
  {
    "key": "hours-4",
    "title": "⏰ Thursday hours",
    "category": "hours",
    "body": "Dining: [confirm opening time]–[confirm closing time].\nHappy Hour: 3–6 PM.\nTini Thursday: 6–9 PM.",
    "weekday": 4
  },
  {
    "key": "specials-4",
    "title": "🔥 Thursday specials",
    "category": "specials",
    "body": "Tini Thursday, 6–9 PM:\n$8 Lemon Drops, Cosmos, and Dirty Martinis\n$15 Yakamein\n$15 Ribeye Tacos\n$30 Ribeye Dinner\nConfirm this week’s menu, prices, entertainment, and availability.",
    "weekday": 4
  },
  {
    "key": "hours-5",
    "title": "⏰ Friday hours",
    "category": "hours",
    "body": "Dining: [confirm opening time]–[confirm closing time].\nBrunch: 11 AM–4 PM.\nHappy Hour: 3–7 PM.",
    "weekday": 5
  },
  {
    "key": "specials-5",
    "title": "🔥 Friday specials",
    "category": "specials",
    "body": "Jourdan Ave Hot Honey and Chicken Caesar Sandwiches: available all day at regular price, $19. Friday Happy Hour discount applies during Happy Hour only—confirm today’s discounted price.\nAdd today’s features and availability.",
    "weekday": 5
  },
  {
    "key": "hours-6",
    "title": "⏰ Saturday hours",
    "category": "hours",
    "body": "Dining: [confirm opening time]–[confirm closing time].\nBrunch: 11 AM–4 PM.\nHappy Hour: 5–7 PM.",
    "weekday": 6
  },
  {
    "key": "specials-6",
    "title": "🔥 Saturday specials",
    "category": "specials",
    "body": "Bubbly Flight — $35: bottle of champagne, two juices, and a fruit cup.\nJourdan Ave Chicken Sandwiches — $19, available all day at regular price.\nConfirm availability and add today’s featured items.",
    "weekday": 6
  },
  {
    "key": "payments",
    "title": "🧾 Payments + checkout",
    "category": "service",
    "body": "Give every guest a printed check before processing payment.\nComplete your assigned checklists. Turn cash in to the manager before leaving.\nEveryone must be checked out and released by a manager before leaving.",
    "weekday": null
  },
  {
    "key": "table-detail",
    "title": "✨ Table maintenance + detailing",
    "category": "service",
    "body": "Clear something every time you pass: extra plates, napkins, straw wrappers, empty glasses, and trash.\nUse downtime to detail tables, clean your section, and reset.\nDo not wait for guests to ask for something to be cleared.",
    "weekday": null
  },
  {
    "key": "floor-presence",
    "title": "👀 Floor presence",
    "category": "service",
    "body": "Servers stay visible with tables in sight; bartenders stay behind the bar. Stay in your assigned area and anticipate guest needs.\nNo clustering, side conversations, or casual posture in guest view. Keep the guest the main focus.",
    "weekday": null
  },
  {
    "key": "guest-engagement",
    "title": "🍽️ Guest engagement",
    "category": "service",
    "body": "Every greeting includes a specific recommendation.\nPick up menus once guests place their order.\nComplete a two-bite checkback after guests have tasted their food.\nOffer dessert before presenting the check. Engage with the table instead of only asking, “Are y’all good?”",
    "weekday": null
  },
  {
    "key": "team-support",
    "title": "🤝 Team support",
    "category": "service",
    "body": "Run food and drinks, pre-buss, and support teammates.\nNo one stands around while a teammate is buried.\nThe host stand is everyone’s responsibility—acknowledge guests promptly and help keep service moving.",
    "weekday": null
  },
  {
    "key": "escalation",
    "title": "🚨 Delays + guest concerns",
    "category": "service",
    "body": "Notify the manager immediately about upset or difficult tables.\nIf a drink ticket is over 10 minutes, find a manager to get the drink made immediately. Do not let it become a 15–20 minute ticket.\nCommunicate delays early.",
    "weekday": null
  },
  {
    "key": "sales-targets",
    "title": "🎯 Sales targets",
    "category": "sales",
    "body": "Team net sales target: $[enter target]\nBar target (15%): $[enter amount]\nFloor target (85%): $[enter amount]\nEmployee targets:\n• [Name] — $[target]\n• [Name] — $[target]\nTarget deadline: [enter time]\nGuide guests with specific cocktail, appetizer, and dessert recommendations.",
    "weekday": null
  },
  {
    "key": "uniform",
    "title": "💋 Uniform checks",
    "category": "uniform",
    "body": "Uniform checks are completed before clock-in:\n✅ Black JusTini’s vest\n✅ Full black shirt—no stomach showing\n✅ Black pants and black shoes\n✅ JusTini’s pin\n✅ Red lip\n✅ Hair pulled completely back\nNon-JusTini’s apparel is not permitted on the dining-room floor.",
    "weekday": null
  }
]$seeds$::jsonb) x
 on conflict(location_id,source_key) do nothing;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'category',category,'weekday',weekday,'body',body,'version',version) order by category,weekday,title),'[]'::jsonb)
 into result from public.preshift_preset_chunks where location_id=p_location_id and deleted_at is null;
 return result;
end;$$;

create or replace function public.preshift_preset_save(p_location_id uuid,p_id uuid,p_version integer,p_title text,p_category text,p_weekday integer,p_body text)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then raise exception 'Manager access required.' using errcode='42501';end if;
 if p_title is null or length(btrim(p_title)) not between 1 and 100 or p_body is null or length(btrim(p_body)) not between 1 and 4000 or p_category is null or p_category not in ('hours','specials','service','sales','uniform') or (p_weekday is not null and p_weekday not between 0 and 6) then raise exception 'Enter a title, category and preset text, with a valid day.';end if;
 if p_id is null then
  insert into public.preshift_preset_chunks(location_id,title,category,weekday,body) values(p_location_id,btrim(p_title),p_category,p_weekday,btrim(p_body)) returning id into result;
 else
  update public.preshift_preset_chunks set title=btrim(p_title),category=p_category,weekday=p_weekday,body=btrim(p_body),version=version+1,updated_at=now() where id=p_id and location_id=p_location_id and version=p_version and deleted_at is null returning id into result;
  if result is null then raise exception 'This preset changed. Reload before saving.';end if;
 end if;
 return result;
end;$$;

create or replace function public.preshift_preset_remove(p_location_id uuid,p_id uuid,p_version integer)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then raise exception 'Manager access required.' using errcode='42501';end if;
 update public.preshift_preset_chunks set deleted_at=now(),version=version+1,updated_at=now() where id=p_id and location_id=p_location_id and version=p_version and deleted_at is null;
 if not found then raise exception 'This preset changed. Reload before removing.';end if;
end;$$;
revoke all on function public.preshift_presets(uuid),public.preshift_preset_save(uuid,uuid,integer,text,text,integer,text),public.preshift_preset_remove(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.preshift_presets(uuid),public.preshift_preset_save(uuid,uuid,integer,text,text,integer,text),public.preshift_preset_remove(uuid,uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;

BEGIN;

create or replace function public.staff_tasks_seed_closing(p_location_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare inserted integer;
begin
 if public.staff_tasks_can_manage(p_location_id) is not true then
  raise exception 'Task management access required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('closing-presets:'||p_location_id::text,0));
 insert into public.staff_task_templates(location_id,title,position,phase,items,source_key,source_note,reviewed)
 select p_location_id,x->>'title',x->>'position','Closing',x->'items',x->>'key',
 'Review this closing checklist for current operations before assigning.',false
 from jsonb_array_elements($closing$
[
  {
    "title": "Bartender closing · Well, tools & glassware",
    "position": "Bartender",
    "items": [
      "Clear the well and return liquor bottles to labeled storage. Wipe bottles, speed rails and the back bar.",
      "Wash, rinse and sanitize shakers, jiggers, strainers, pour tools and bar sinks. Air-dry before storing.",
      "Wash and polish used glassware. Return it to the correct shelves and flag any breakage.",
      "Follow the closing procedure for the ice well. Discard used ice and clean the scoop and holder.",
      "Wipe and sanitize bar tops, service stations and frequently touched handles.",
      "Wash bar mats, clean the floor beneath the well and leave mats to dry."
    ],
    "key": "task-group:20261119-closing-bar-clean"
  },
  {
    "title": "Bartender closing · Garnishes, beverages & dry goods",
    "position": "Bartender",
    "items": [
      "Discard expired garnishes. Cover, label, date and store usable cut fruit and garnishes in the approved cooler.",
      "Clean and sanitize the fruit and garnish trays. Restock clean picks and garnish tools.",
      "Non-alcoholic beverages: Restock soft drinks, bottled water and sparkling water. Rotate older stock forward.",
      "Juices, mixers and purées: Label and date opened containers, wipe sticky bottles and restock the service cooler.",
      "Beer and wine: Restock the coolers, rotate stock and record low or out-of-stock items.",
      "Dry goods: Restock napkins, straws, picks and takeout supplies in the designated bins."
    ],
    "key": "task-group:20261119-closing-bar-stock"
  },
  {
    "title": "Bartender closing · Checks & equipment",
    "position": "Bartender",
    "items": [
      "Resolve open bar checks and flag any voids or comps that need a manager review.",
      "Complete the bartender closeout and turn in required receipts to the closing manager.",
      "Follow the approved shutdown or cleaning procedure for bar equipment you operated, including frozen drink equipment if assigned.",
      "Secure liquor and keys as directed. Report low stock, repairs or out-of-stock items to the closing manager."
    ],
    "key": "task-group:20261119-closing-bar-closeout"
  },
  {
    "title": "Server closing · Dining room reset",
    "position": "Server",
    "items": [
      "Clear, wipe and sanitize assigned tables, seats and high chairs. Check under seats for spills and belongings.",
      "Reset tables and chairs to the approved floor layout. Leave aisles and exits clear.",
      "Wipe condiment holders and table accessories. Refill or replace supplies as needed.",
      "Return clean menus to the host stand, remove candles and put away usable flowers or décor.",
      "Check the assigned dining area, side station and nearby floor for anything missed."
    ],
    "key": "task-group:20261119-closing-server-reset"
  },
  {
    "title": "Server closing · Side stations & closeout",
    "position": "Server",
    "items": [
      "Return dirty silverware and glassware to dish. Polish and roll clean silverware to the closing par.",
      "Empty and clean coffee and water service equipment according to the closing procedure.",
      "Dry goods: Restock side-station napkins, utensils, to-go boxes and bags.",
      "Resolve open checks. Attach any required void, comp or discount receipts to the closeout.",
      "Complete the server closeout and report shortages, guest follow-up or maintenance needs to the manager."
    ],
    "key": "task-group:20261119-closing-server-closeout"
  },
  {
    "title": "Food runner closing · Expo & service supplies",
    "position": "Food Runner",
    "items": [
      "Confirm with the kitchen lead that the last tickets and takeout orders have been handed off.",
      "Clear and sanitize the expo pass, trays, handles and food-runner station. Return dirty items to dish.",
      "Return clean plates and service pieces to their designated stations. Report any shortages or breakage.",
      "Dry goods: Restock to-go boxes, bags, utensils, napkins and other expo supplies.",
      "Return food items to the kitchen lead for storage or disposal and flag anything that needs to be logged.",
      "Review low stock and equipment issues with the closing lead."
    ],
    "key": "task-group:20261119-closing-runner-line"
  },
  {
    "title": "Busser closing · Dish, floors & service reset",
    "position": "Busser",
    "items": [
      "Clear remaining dishes, glassware and bus tubs. Separate items for dish and flag breakage.",
      "Wash, rinse and sanitize bus tubs, racks and clearing carts. Air-dry in the designated area.",
      "Sweep and mop assigned service areas after tables are clear. Place wet-floor signs while working.",
      "Empty assigned bins, clean them and install fresh liners. Take waste to the designated area.",
      "Return high chairs and booster seats after cleaning. Reset service stations and put away cleaning tools.",
      "If assigned, check restrooms, restock paper and soap, and report any maintenance issues.",
      "Walk the assigned area with the closing lead and flag spills, lost items or unfinished work."
    ],
    "key": "task-group:20261119-closing-busser-reset"
  },
  {
    "title": "Host — Closing · Cleaning & reset",
    "position": "Host",
    "items": [
      "Sweep, empty trash bins, and wipe mirrors in both bathrooms",
      "Ask the dishwasher to wash all silverware pieces",
      "Check for rolling linen",
      "Send Jessica any messages that have not been sent",
      "Wipe tables down",
      "Pick up flowers and place them in the back bar",
      "Reset all tables",
      "Restock glassware on the back bar shelves"
    ],
    "key": "task-group:20261014-closing-5"
  },
  {
    "title": "Host — Closing · Service supplies",
    "position": "Host",
    "items": [
      "Put chairs down after the floor has been mopped",
      "Blow out candles if lit",
      "Put phones on their chargers",
      "Wipe down and organize menus",
      "Put menus in the designated folder in the file box",
      "Make sure chairs are neatly placed by tables",
      "Roll silverware",
      "Empty water dispensers on top of the back bar"
    ],
    "key": "task-group:20261014-closing-6"
  },
  {
    "title": "Host — Closing · Final shutdown",
    "position": "Host",
    "items": [
      "Turn off music in the Brut Bar",
      "Turn off Brut Bar lights",
      "Turn off lights in the Brut Bar bathroom",
      "Wipe down and organize the host stand",
      "Unplug courtyard lights",
      "Pay for any employee meals",
      "Clock out"
    ],
    "key": "task-group:20261014-closing-7"
  }
]
$closing$::jsonb) x
 on conflict(location_id,source_key) do nothing;
 get diagnostics inserted=row_count;
 -- Retire only untouched imports that mixed bar and floor duties. Reviewed or edited
 -- presets and all assignments retain their existing records.
 update public.staff_task_templates set active=false,version=version+1,updated_at=now()
 where location_id=p_location_id and active and not reviewed and version=1
 and source_key in ('task-group:20261014-closing-1','task-group:20261014-closing-2',
                    'task-group:20261014-closing-3','task-group:20261014-closing-4');
 return inserted;
end;$$;

REVOKE ALL ON FUNCTION public.staff_tasks_seed_closing(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.staff_tasks_seed_closing(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

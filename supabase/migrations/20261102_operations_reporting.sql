BEGIN;
SET LOCAL lock_timeout='5s';
CREATE SCHEMA IF NOT EXISTS ops_reporting_private;
REVOKE ALL ON SCHEMA ops_reporting_private FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION ops_reporting_private.assert_access(loc uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(loc) IS NOT TRUE OR public.mod_is_manager(loc) IS NOT TRUE
 OR public.app_access_allowed(loc,'reports','builder') IS NOT TRUE THEN
  RAISE EXCEPTION 'Active Management report access required.' USING errcode='42501';
 END IF;
END;$$;
CREATE TABLE IF NOT EXISTS ops_reporting_private.products(
 location_id uuid NOT NULL REFERENCES public.locations(id),product_key text NOT NULL,
 name text NOT NULL,vendor text NOT NULL DEFAULT '',prices jsonb NOT NULL DEFAULT '{}',
 recipes jsonb NOT NULL DEFAULT '[]',receipts jsonb NOT NULL DEFAULT '[]',notes text NOT NULL DEFAULT '',
 inventory_item_id uuid,version integer NOT NULL DEFAULT 1,updated_by uuid,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(location_id,product_key)
);
CREATE TABLE IF NOT EXISTS ops_reporting_private.product_audit(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,location_id uuid,product_key text,
 actor uuid,changed_at timestamptz NOT NULL DEFAULT now(),before_record jsonb,after_record jsonb
);
CREATE TABLE IF NOT EXISTS ops_reporting_private.layouts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),location_id uuid NOT NULL REFERENCES public.locations(id),
 title text NOT NULL,spec jsonb NOT NULL,version integer NOT NULL DEFAULT 1,updated_by uuid,updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ops_reporting_private.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_reporting_private.product_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_reporting_private.layouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA ops_reporting_private FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION ops_reporting_private.product_key(brand text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT 'bottle:'||lower(regexp_replace(btrim(brand),'[[:space:]]+',' ','g'));
$$;
CREATE OR REPLACE FUNCTION ops_reporting_private.size_label(size text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE lower(regexp_replace(btrim(size),'[[:space:]]','','g'))
 WHEN '1l' THEN '1 L' WHEN '1000ml' THEN '1 L' WHEN '750ml' THEN '750 mL'
 WHEN '1.75l' THEN '1.75 L' WHEN '1750ml' THEN '1.75 L' ELSE coalesce(nullif(btrim(size),''),'Unspecified') END;
$$;

-- Explicit adapters: only listed business fields leave this private function.
CREATE OR REPLACE FUNCTION ops_reporting_private.source_query(kind text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 RETURN CASE kind
 WHEN 'closeouts' THEN 'select to_jsonb(t) j from public.daily_closeouts t where t.location_id=$1'
 WHEN 'manager_closeouts' THEN 'select to_jsonb(t)||jsonb_build_object(''business_date'',s.shift_date,''user_id'',t.submitted_by) j from public.mod_closeouts t join public.shifts s on s.id=t.shift_id and s.location_id=t.location_id where t.location_id=$1'
 WHEN 'quizzes' THEN 'select to_jsonb(a)||jsonb_build_object(''id'',q.id::text||'':''||a.user_id::text,''business_date'',q.quiz_date,''title'',q.title) j from public.daily_quiz_attempts a join public.daily_quizzes q on q.id=a.quiz_id where q.location_id=$1'
 WHEN 'tasks' THEN 'select to_jsonb(t)||jsonb_build_object(''id'',t.id::text||'':''||a.user_id::text,''user_id'',a.user_id,''status'',case when a.active then ''Assigned'' else ''Inactive assignment'' end,''total_items'',jsonb_array_length(t.items),''completed_items'',(select count(*) from public.staff_task_checks c where c.run_id=t.id and c.user_id=a.user_id)) j from public.staff_task_runs t join public.staff_task_assignees a on a.run_id=t.id where t.location_id=$1'
 WHEN 'receipts' THEN 'select to_jsonb(t) j from public.closeout_receipts t where t.location_id=$1 and (t.added_at is not null or coalesce(t.legacy_linked,false))'
 WHEN 'profiles' THEN 'select jsonb_build_object(''id'',p.id,''user_id'',p.id,''role'',coalesce(to_jsonb(m)->>''job_role'',m.role),''status'',m.status,''title'',coalesce(nullif(p.preferred_name,''''),p.full_name)) j from public.location_memberships m join public.profiles p on p.id=m.user_id where m.location_id=$1'
 WHEN 'ranks' THEN 'select s||jsonb_build_object(''id'',t.id::text||'':''||(s->>''user_id''),''business_date'',t.week_start,''submitted_at'',t.published_at,''revision'',t.revision,''title'',''Published weekly rank'') j from (select distinct on(month,week_start) * from leaderboard_private.publications where location_id=$1 order by month,week_start,revision desc,published_at desc) t cross join lateral jsonb_array_elements(t.standings) s'
 WHEN 'points' THEN 'select to_jsonb(s)||jsonb_build_object(''id'',s.entry_key||'':''||s.user_id::text,''points'',coalesce(o.points,s.points)) j from public.points_source_entries($1) s left join public.point_entry_overrides o on o.location_id=$1 and o.user_id=s.user_id and o.entry_key=s.entry_key'
 WHEN 'games' THEN 'select to_jsonb(t) j from public.restaurant_game_rounds t where t.location_id=$1'
 WHEN 'reservations' THEN 'select to_jsonb(t)||jsonb_build_object(''business_date'',t.reservation_date,''user_id'',to_jsonb(t)->>''created_by'') j from public.reservations t where t.location_id=$1'
 WHEN 'seating' THEN 'select to_jsonb(t)||jsonb_build_object(''id'',t.request_id,''user_id'',t.server_id) j from public.floor_seating_history_v1 t where t.location_id=$1'
 WHEN 'preshift' THEN 'select to_jsonb(t)||jsonb_build_object(''id'',t.session_id,''business_date'',p.shift_date,''title'',p.title) j from public.preshift_view_sessions t join public.preshift_posts p on p.id=t.post_id where p.location_id=$1'
 WHEN 'sections' THEN 'select to_jsonb(t)||jsonb_build_object(''user_id'',t.employee_id) j from public.floor_section_plans t where t.location_id=$1'
 WHEN 'training' THEN 'select to_jsonb(t)||jsonb_build_object(''title'',t.data->>''name'',''kind'',''Food recipe'') j from public.training_food t where t.location_id=$1 union all select to_jsonb(t)||jsonb_build_object(''title'',t.data->>''name'',''kind'',''Drink recipe'') j from public.training_cocktails t where t.location_id=$1'
 WHEN 'reviews' THEN 'select to_jsonb(t)||jsonb_build_object(''id'',t.shift_id::text||'':''||t.user_id::text,''business_date'',s.shift_date,''submitted_at'',m.submitted_at) j from public.mod_staff_reviews t join public.mod_closeouts m on m.shift_id=t.shift_id join public.shifts s on s.id=t.shift_id and s.location_id=m.location_id where m.location_id=$1'
 WHEN 'schedule' THEN 'select r||jsonb_build_object(''business_date'',t.schedule_date,''user_id'',l.user_id,''title'',r->>''role'',''submitted_at'',r->>''start'') j from public.home_schedule_cache t cross join lateral jsonb_array_elements(t.rows) r left join public.team_schedule_links l on l.location_id=t.location_id and l.employee_key=r->>''employee_key'' where t.location_id=$1'
 WHEN 'goals' THEN 'select d||jsonb_build_object(''id'',t.month::text||'':''||(d->>''date''),''business_date'',d->>''date'',''title'',''Daily restaurant goal'') j from sales_month_private.goal_plans t cross join lateral jsonb_array_elements(t.days) d where t.location_id=$1'
 WHEN '86' THEN 'select to_jsonb(t)||jsonb_build_object(''user_id'',t.actor_id) j from public.stock_board_events t where t.location_id=$1'
 ELSE NULL END;
END;$$;

CREATE OR REPLACE FUNCTION ops_reporting_private.normalize(kind text,j jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE stamp timestamptz;day date;clock text;uid text;row jsonb;nm text;
BEGIN
 stamp:=coalesce(nullif(j->>'submitted_at',''),nullif(j->>'seated_at',''),nullif(j->>'completed_at',''),nullif(j->>'starts_at',''),nullif(j->>'started_at',''),nullif(j->>'created_at',''))::timestamptz;
 day:=coalesce(nullif(j->>'business_date',''),nullif(j->>'closeout_date',''))::date;
 IF day IS NULL AND stamp IS NOT NULL THEN day:=((stamp AT TIME ZONE 'America/Chicago')-interval '4 hours')::date;END IF;
 clock:=CASE WHEN kind='reservations' THEN j->>'reservation_time' WHEN stamp IS NOT NULL THEN to_char(stamp AT TIME ZONE 'America/Chicago','HH24:MI') END;
 uid:=j->>'user_id';
 row:=jsonb_build_object('category',kind,'record_id',coalesce(j->>'id',j->>'shift_id'),'service_date',day,'time',clock,'recorded_at',stamp,'user_id',uid,
 'status',coalesce(j->>'status',j->>'verification_status'),'role',coalesce(j->>'job_role',j->>'role',j->>'position'),
 'title',coalesce(j->>'title',j->>'description',j->>'game_id',j->>'item_name',j->>'kind',kind),
 'staff_sales',CASE WHEN kind='closeouts' THEN j->'net_sales' END,
 'restaurant_sales',CASE WHEN kind='manager_closeouts' THEN coalesce(j->'restaurant_net_sales',j->'net_sales') END,
 'sales_target',CASE WHEN kind='closeouts' THEN j->'sales_target' END,
 'cash_deposit',CASE WHEN kind='closeouts' THEN j->'cash_deposit' END,
 'manager_individual_sales',CASE WHEN kind='manager_closeouts' THEN j->'individual_net_sales' END,
 'final_cash_deposit',CASE WHEN kind='manager_closeouts' THEN j->'final_cash_deposit' END,
 'point_change',CASE WHEN kind='points' THEN j->'points' END,
 'closeout_point_adjustment',CASE WHEN kind='closeouts' THEN j->'points_delta' END,
 'quiz_correct',CASE WHEN kind='quizzes' THEN j->'result'->'score' END,
 'quiz_total',CASE WHEN kind='quizzes' THEN j->'result'->'total' END,
 'quiz_percent',CASE WHEN kind='quizzes' THEN j->'result'->'percent' END,
 'quiz_reward',CASE WHEN kind='quizzes' THEN j->'reward_points' END,
 'task_total',CASE WHEN kind='tasks' THEN j->'total_items' END,
 'task_completed',CASE WHEN kind='tasks' THEN j->'completed_items' END,
 'receipt_amount',CASE WHEN kind='receipts' THEN j->'amount' END,
 'reason',coalesce(j->>'reason',j->>'action'),
 'published_rank',CASE WHEN kind='ranks' THEN j->'rank' END,
 'published_points',CASE WHEN kind='ranks' THEN j->'total' END,
 'combined_score',CASE WHEN kind='ranks' THEN j->'combined_score' END,
 'publication_revision',CASE WHEN kind='ranks' THEN j->'revision' END,
 'game_correct',CASE WHEN kind='games' THEN j->'correct_count' END,
 'game_total',CASE WHEN kind='games' THEN j->'total' END,
 'guests',CASE WHEN kind IN('reservations','seating') THEN j->'party_size' END,
 'tables',coalesce(j->>'table_names',CASE WHEN kind='sections' THEN j->>'table_ids' END),
 'visible_seconds',CASE WHEN kind='preshift' THEN (j->>'visible_ms')::numeric/1000 END,
 'manager_rating',CASE WHEN kind='reviews' THEN j->'rating' END,
 'scheduled_end',CASE WHEN kind='schedule' THEN j->>'end' END,
 'daily_restaurant_goal',CASE WHEN kind='goals' THEN j->'target' END,
 'snapshot',kind IN('profiles','training'));
 RETURN row;
END;$$;

CREATE OR REPLACE FUNCTION public.operations_report_rows(p_location_id uuid,p_sources jsonb,p_filters jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE kind text;query text;rows jsonb:='[]';batch jsonb;coverage jsonb:='[]';first_day date;last_day date;who text;clock_from text;clock_to text;amount_min numeric;amount_max numeric;brand_filter text;size_filter text;limited boolean:=false;
BEGIN
 PERFORM ops_reporting_private.assert_access(p_location_id);
 IF jsonb_typeof(p_sources) IS DISTINCT FROM 'array' OR jsonb_array_length(p_sources) NOT BETWEEN 1 AND 24 OR jsonb_typeof(p_filters) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Choose report categories and filters.';END IF;
 first_day:=(p_filters->>'from')::date;last_day:=(p_filters->>'to')::date;who:=nullif(p_filters->>'user_id','');
 clock_from:=nullif(p_filters->>'time_from','');clock_to:=nullif(p_filters->>'time_to','');
 brand_filter:=nullif(btrim(p_filters->>'brand'),'');size_filter:=nullif(p_filters->>'bottle_size','');
 amount_min:=nullif(p_filters->>'sales_min','')::numeric;amount_max:=nullif(p_filters->>'sales_max','')::numeric;
 IF first_day IS NULL OR last_day IS NULL OR last_day<first_day OR last_day-first_day>3660 THEN RAISE EXCEPTION 'Choose a date range of up to ten years.';END IF;
 IF clock_from IS NOT NULL THEN PERFORM clock_from::time;END IF;IF clock_to IS NOT NULL THEN PERFORM clock_to::time;END IF;
 FOR kind IN SELECT DISTINCT value#>>'{}' FROM jsonb_array_elements(p_sources) LOOP
  IF kind='disposal' THEN
   query:=$q$select jsonb_build_object('category','disposal','record_id',s.id::text||':'||l.n::text,'service_date',((s.submitted_at at time zone 'America/Chicago')-interval '4 hours')::date,'time',to_char(s.submitted_at at time zone 'America/Chicago','HH24:MI'),'recorded_at',s.submitted_at,'user_id',s.user_id,'title',l.v->>'brand','brand',l.v->>'brand','product_key',ops_reporting_private.product_key(l.v->>'brand'),'bottle_size',ops_reporting_private.size_label(l.v->>'size'),'quantity',(l.v->>'quantity')::numeric,'unit','bottles','source_sheet','Bottle disposal','sheet_id',s.id,'snapshot',false) row from public.inventory_disposal_sheets s cross join lateral jsonb_array_elements(s.lines) with ordinality l(v,n) where s.location_id=$1 and to_jsonb(s)->>'deleted_at' is null$q$;
   IF to_regclass('public.menu_linked_disposal_sheets') IS NOT NULL AND to_regclass('public.menu_inventory_items') IS NOT NULL THEN
    query:=query||$q$ union all select jsonb_build_object('category','disposal','record_id',s.id::text||':'||l.n::text,'service_date',((s.submitted_at at time zone 'America/Chicago')-interval '4 hours')::date,'time',to_char(s.submitted_at at time zone 'America/Chicago','HH24:MI'),'recorded_at',s.submitted_at,'user_id',s.user_id,'title',i.name,'brand',i.name,'product_key','ingredient:'||i.id::text,'bottle_size',null,'quantity',(l.v->>'quantity')::numeric,'unit',l.v->>'unit','reason',l.v->>'reason','source_sheet','Linked food / ingredient disposal','sheet_id',s.id,'snapshot',false) row from public.menu_linked_disposal_sheets s cross join lateral jsonb_array_elements(s.lines) with ordinality l(v,n) join public.menu_inventory_items i on i.id=(l.v->>'catalog_item_id')::uuid and i.location_id=s.location_id where s.location_id=$1 and to_jsonb(s)->>'deleted_at' is null$q$;
   ELSE coverage:=coverage||jsonb_build_array(jsonb_build_object('category','linked_disposal','status','Unavailable: linked-disposal tables are not installed'));END IF;
  ELSE
   query:=ops_reporting_private.source_query(kind);
   IF query IS NULL THEN RAISE EXCEPTION 'Unsupported category: %',kind;END IF;
   IF kind='manager_closeouts' THEN
    IF to_regclass('sales_month_private.manager_days') IS NOT NULL THEN
     query:='select j||coalesce((select to_jsonb(d) from sales_month_private.manager_days d where d.location_id=$1 and d.shift_id=(j->>''shift_id'')::uuid),''{}''::jsonb) j from ('||query||') legacy';
    ELSE coverage:=coverage||jsonb_build_array(jsonb_build_object('category','manager_sales','status','Unavailable: final-day sales reports are not installed'));END IF;
   END IF;
   query:='select ops_reporting_private.normalize('||quote_literal(kind)||',j) row from ('||query||') source where j->>''deleted_at'' is null and j->>''cancelled_at'' is null';
   IF kind='closeouts' THEN query:=query||' and j->>''status''=''submitted''';END IF;
  END IF;
  BEGIN
   EXECUTE 'select coalesce(jsonb_agg(row order by row->>''service_date'' desc,row->>''record_id''),''[]''::jsonb) from (select row from ('||query||') normalized where ((row->>''snapshot'')::boolean is true or (row->>''service_date'')::date between $2 and $3) and ($4 is null or row->>''user_id''=$4) and (case when $5 is not null and $6 is not null and $5>$6 then (row->>''time'' >= $5 or row->>''time'' <= $6) else ($5 is null or row->>''time'' >= $5) and ($6 is null or row->>''time'' <= $6) end) and ($7 is null or (row->>''staff_sales'')::numeric >= $7) and ($8 is null or (row->>''staff_sales'')::numeric <= $8) and ($9 is null or position(lower($9) in lower(coalesce(row->>''brand'','''')))>0) and ($10 is null or row->>''bottle_size''=$10) order by row->>''service_date'' desc,row->>''record_id'' limit 5001) r'
   INTO batch USING p_location_id,first_day,last_day,who,clock_from,clock_to,amount_min,amount_max,brand_filter,size_filter;
   IF jsonb_array_length(batch)>5000 THEN limited:=true;END IF;
   coverage:=coverage||jsonb_build_array(jsonb_build_object('category',kind,'status','Loaded','rows',least(jsonb_array_length(batch),5000)));
   rows:=rows||batch;
  EXCEPTION WHEN undefined_table OR undefined_column OR undefined_function THEN
   coverage:=coverage||jsonb_build_array(jsonb_build_object('category',kind,'status','Unavailable: source is missing or needs a migration'));
  END;
 END LOOP;
 IF jsonb_array_length(rows)>5000 THEN limited:=true;END IF;
 SELECT coalesce(jsonb_agg(r||jsonb_build_object('employee',coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''),nullif(r->>'user_id',''),'Unassigned'),'vendor',product.vendor,'reference_unit_price',product.prices->coalesce(r->>'bottle_size',r->>'unit'),'current_cost_estimate',case when product.prices ? coalesce(r->>'bottle_size',r->>'unit') then (product.prices->>coalesce(r->>'bottle_size',r->>'unit'))::numeric*(r->>'quantity')::numeric end) ORDER BY r->>'service_date' DESC,r->>'category',r->>'record_id'),'[]') INTO rows
 FROM (SELECT value r FROM jsonb_array_elements(rows) ORDER BY value->>'service_date' DESC,value->>'category',value->>'record_id' LIMIT 5000) s
 LEFT JOIN public.profiles p ON p.id::text=r->>'user_id'
 LEFT JOIN ops_reporting_private.products product ON product.location_id=p_location_id AND product.product_key=r->>'product_key';
 RETURN jsonb_build_object('rows',rows,'coverage',coverage,'truncated',limited,'generated_at',clock_timestamp());
END;$$;

CREATE OR REPLACE FUNCTION public.operations_report_library(p_location_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM ops_reporting_private.assert_access(p_location_id);
 RETURN jsonb_build_object('employees',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',coalesce(nullif(p.preferred_name,''),p.full_name),'status',m.status) ORDER BY p.full_name),'[]') FROM public.location_memberships m JOIN public.profiles p ON p.id=m.user_id WHERE m.location_id=p_location_id),
 'layouts',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY updated_at DESC),'[]') FROM ops_reporting_private.layouts t WHERE location_id=p_location_id));
END;$$;
CREATE OR REPLACE FUNCTION public.operations_report_save(p_location_id uuid,p_id uuid,p_version integer,p_title text,p_spec jsonb,p_remove boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved ops_reporting_private.layouts;
BEGIN
 PERFORM ops_reporting_private.assert_access(p_location_id);
 IF p_remove THEN DELETE FROM ops_reporting_private.layouts WHERE id=p_id AND location_id=p_location_id AND version=p_version RETURNING * INTO saved;
  IF NOT FOUND THEN RAISE EXCEPTION 'Report changed. Refresh before removing.';END IF;RETURN jsonb_build_object('removed',true);END IF;
 IF length(btrim(p_title)) NOT BETWEEN 1 AND 240 OR jsonb_typeof(p_spec) IS DISTINCT FROM 'object' OR octet_length(p_spec::text)>60000 THEN RAISE EXCEPTION 'Enter a title and valid report settings.';END IF;
 IF p_id IS NULL THEN INSERT INTO ops_reporting_private.layouts(location_id,title,spec,updated_by) VALUES(p_location_id,btrim(p_title),p_spec,auth.uid()) RETURNING * INTO saved;
 ELSE UPDATE ops_reporting_private.layouts SET title=btrim(p_title),spec=p_spec,version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() WHERE location_id=p_location_id AND id=p_id AND version=p_version RETURNING * INTO saved;
 IF NOT FOUND THEN RAISE EXCEPTION 'Report changed. Refresh before saving.';END IF;END IF;
 RETURN to_jsonb(saved);
END;$$;

CREATE OR REPLACE FUNCTION public.operations_product_load(p_location_id uuid,p_key text,p_name text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;recipes jsonb:='[]';receipts jsonb:='[]';
BEGIN
 PERFORM ops_reporting_private.assert_access(p_location_id);
 SELECT to_jsonb(p) INTO result FROM ops_reporting_private.products p WHERE location_id=p_location_id AND product_key=p_key;
 IF to_regclass('public.training_food') IS NOT NULL THEN EXECUTE 'select coalesce(jsonb_agg(jsonb_build_object(''id'',id,''kind'',''food'',''name'',data->>''name'',''description'',coalesce(data->>''description'',data->>''instructions''))),''[]'') from public.training_food where location_id=$1' INTO recipes USING p_location_id;END IF;
 IF to_regclass('public.training_cocktails') IS NOT NULL THEN EXECUTE 'select $2||coalesce(jsonb_agg(jsonb_build_object(''id'',id,''kind'',''cocktails'',''name'',data->>''name'',''description'',coalesce(data->>''description'',data->>''instructions''))),''[]'') from public.training_cocktails where location_id=$1' INTO recipes USING p_location_id,recipes;END IF;
 IF to_regclass('public.closeout_receipts') IS NOT NULL THEN EXECUTE 'select coalesce(jsonb_agg(x),''[]'') from (select jsonb_build_object(''id'',id,''bucket'',origin_bucket,''path'',file_path,''label'',business_date::text||'' · ''||kind||'' · $''||coalesce(amount::text,''?'')) x from public.closeout_receipts where location_id=$1 and deleted_at is null and (added_at is not null or coalesce(legacy_linked,false)) order by business_date desc,id limit 500) r' INTO receipts USING p_location_id;END IF;
 RETURN jsonb_build_object('product',coalesce(result,jsonb_build_object('product_key',p_key,'name',p_name,'vendor','','prices','{}'::jsonb,'recipes','[]'::jsonb,'receipts','[]'::jsonb,'notes','','version',0)), 'recipes',recipes,'receipts',receipts);
END;$$;
CREATE OR REPLACE FUNCTION public.operations_product_save(p_location_id uuid,p_key text,p_version integer,p_values jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior ops_reporting_private.products;saved ops_reporting_private.products;item jsonb;price record;tbl text;valid boolean;
BEGIN
 PERFORM ops_reporting_private.assert_access(p_location_id);
 IF p_key IS NULL OR length(p_key)>220 OR p_key!~'^(bottle:.+|ingredient:[0-9a-f-]{36})$' OR jsonb_typeof(p_values) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Choose a valid product.';END IF;
 IF length(btrim(coalesce(p_values->>'name',''))) NOT BETWEEN 1 AND 240 OR length(coalesce(p_values->>'vendor',''))>200 OR length(coalesce(p_values->>'notes',''))>5000 OR jsonb_typeof(p_values->'prices') IS DISTINCT FROM 'object' OR jsonb_typeof(p_values->'recipes') IS DISTINCT FROM 'array' OR jsonb_typeof(p_values->'receipts') IS DISTINCT FROM 'array' OR jsonb_array_length(p_values->'recipes')>100 OR jsonb_array_length(p_values->'receipts')>50 THEN RAISE EXCEPTION 'Review product details and attachments.';END IF;
 FOR price IN SELECT * FROM jsonb_each_text(p_values->'prices') LOOP
  IF length(price.key)>40 OR price.value !~ '^[0-9]+(\.[0-9]{1,2})?$' OR price.value::numeric>1000000 THEN RAISE EXCEPTION 'Prices must be positive USD amounts with up to two decimals.';END IF;
 END LOOP;
 p_values:=jsonb_set(p_values,'{prices}',coalesce((SELECT jsonb_object_agg(ops_reporting_private.size_label(key),value) FROM jsonb_each(p_values->'prices')),'{}'::jsonb));
 FOR item IN SELECT value FROM jsonb_array_elements(p_values->'recipes') LOOP
  tbl:=CASE item->>'kind' WHEN 'food' THEN 'public.training_food' WHEN 'cocktails' THEN 'public.training_cocktails' ELSE NULL END;
  IF tbl IS NULL OR to_regclass(tbl) IS NULL THEN RAISE EXCEPTION 'Choose an installed recipe.';END IF;
  EXECUTE 'select exists(select 1 from '||tbl||' where location_id=$1 and id=$2)' INTO valid USING p_location_id,(item->>'id')::uuid;
  IF NOT valid THEN RAISE EXCEPTION 'Recipe is not available at this location.';END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_values->'receipts') LOOP
  IF item->>'type'='receipt' THEN
   EXECUTE 'select exists(select 1 from public.closeout_receipts where location_id=$1 and id=$2 and deleted_at is null and (added_at is not null or coalesce(legacy_linked,false)))' INTO valid USING p_location_id,(item->>'id')::uuid;
  ELSIF item->>'type'='file' THEN
   SELECT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='product-documents' AND name=item->>'path' AND split_part(name,'/',1)=p_location_id::text) INTO valid;
  ELSE valid:=false;END IF;
  IF NOT valid THEN RAISE EXCEPTION 'Choose an attached receipt or upload a product document at this location.';END IF;
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended('product:'||p_location_id::text||p_key,0));
 SELECT * INTO prior FROM ops_reporting_private.products WHERE location_id=p_location_id AND product_key=p_key FOR UPDATE;
 IF coalesce(prior.version,0) IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'Product changed. Reopen before saving.';END IF;
 INSERT INTO ops_reporting_private.products(location_id,product_key,name,vendor,prices,recipes,receipts,notes,updated_by)
 VALUES(p_location_id,p_key,btrim(p_values->>'name'),btrim(coalesce(p_values->>'vendor','')),p_values->'prices',p_values->'recipes',p_values->'receipts',coalesce(p_values->>'notes',''),auth.uid())
 ON CONFLICT(location_id,product_key) DO UPDATE SET name=excluded.name,vendor=excluded.vendor,prices=excluded.prices,recipes=excluded.recipes,receipts=excluded.receipts,notes=excluded.notes,version=products.version+1,updated_at=clock_timestamp(),updated_by=auth.uid() RETURNING * INTO saved;
 INSERT INTO ops_reporting_private.product_audit(location_id,product_key,actor,before_record,after_record) VALUES(p_location_id,p_key,auth.uid(),CASE WHEN prior.version IS NULL THEN NULL ELSE to_jsonb(prior) END,to_jsonb(saved));
 RETURN to_jsonb(saved);
END;$$;

-- Private optional uploads. Every path begins with the location UUID.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('product-documents','product-documents',false,10485760,ARRAY['image/jpeg','image/png','image/webp','application/pdf']) ON CONFLICT(id) DO NOTHING;
CREATE OR REPLACE FUNCTION public.operations_product_file_access(path text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE loc uuid;
BEGIN
 BEGIN loc:=split_part(path,'/',1)::uuid;EXCEPTION WHEN invalid_text_representation THEN RETURN false;END;
 RETURN auth.uid() IS NOT NULL AND public.closeout_is_member(loc) IS TRUE AND public.mod_is_manager(loc) IS TRUE AND public.app_access_allowed(loc,'reports','builder') IS TRUE;
END;$$;
DROP POLICY IF EXISTS product_documents_read ON storage.objects;
DROP POLICY IF EXISTS product_documents_insert ON storage.objects;
CREATE POLICY product_documents_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='product-documents' AND public.operations_product_file_access(name));
CREATE POLICY product_documents_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='product-documents' AND public.operations_product_file_access(name));

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ops_reporting_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.operations_report_rows(uuid,jsonb,jsonb),public.operations_report_library(uuid),public.operations_report_save(uuid,uuid,integer,text,jsonb,boolean),public.operations_product_load(uuid,text,text),public.operations_product_save(uuid,text,integer,jsonb),public.operations_product_file_access(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.operations_report_rows(uuid,jsonb,jsonb),public.operations_report_library(uuid),public.operations_report_save(uuid,uuid,integer,text,jsonb,boolean),public.operations_product_load(uuid,text,text),public.operations_product_save(uuid,text,integer,jsonb),public.operations_product_file_access(text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT true AS reporting_installed,false AS production_behavior_verified;

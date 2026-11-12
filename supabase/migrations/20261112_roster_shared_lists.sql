BEGIN;
;
SET LOCAL lock_timeout='5s';
;
DO $$ BEGIN IF md5(pg_get_functiondef('roster_work_private.canonical_before(uuid,date,jsonb)'::regprocedure)) <> '1f835824db6c6b9df145de0b9eda4ff7' THEN RAISE EXCEPTION 'Installed function differs: roster_work_private.canonical_before. No changes applied.'; END IF; END $$;
;
DO $$ BEGIN IF md5(pg_get_functiondef('roster_work_private.apply_day_before(uuid,date,jsonb)'::regprocedure)) <> 'c4bfabc0ef8d9cd4aa3df59d32b3af2d' THEN RAISE EXCEPTION 'Installed function differs: roster_work_private.apply_day_before. No changes applied.'; END IF; END $$;
;
DO $$ BEGIN IF md5(pg_get_functiondef('crew_ops_private.canonical(uuid,date,jsonb)'::regprocedure)) <> 'feb502d9c1a618171db105512bbf56be' THEN RAISE EXCEPTION 'Installed function differs: crew_ops_private.canonical. No changes applied.'; END IF; END $$;
;
DO $$ BEGIN IF md5(pg_get_functiondef('crew_ops_private.apply_day(uuid,date,jsonb)'::regprocedure)) <> 'c8870d90ca9422158b5b7f3f26a54c09' THEN RAISE EXCEPTION 'Installed function differs: crew_ops_private.apply_day. No changes applied.'; END IF; END $$;
;
DO $$ BEGIN IF md5(pg_get_functiondef('crew_ops_private.day_rows(uuid,date)'::regprocedure)) <> '11d1eb21367bda768b5806d5d32735b0' THEN RAISE EXCEPTION 'Installed function differs: crew_ops_private.day_rows. No changes applied.'; END IF; END $$;
;
CREATE OR REPLACE FUNCTION roster_work_private.canonical_before(p_location uuid, p_day date, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 r jsonb;
 uid uuid;
 at_start timestamptz;
 at_end timestamptz;
 name text;
 employee text;
 result jsonb:='[]';
begin
 if p_day is null
 or now()>=staff_ops_private.cutoff(p_day)
 or p_day>((now() at time zone 'America/Chicago')::date+366) then
  raise exception 'Choose an open service day within one year; past 4 AM deadlines cannot be changed here.';
 end if;

 if jsonb_typeof(p_rows) is distinct from 'array'
 or jsonb_array_length(p_rows)>200 then
  raise exception 'Use up to 200 shifts.';
 end if;

 for r in select value from jsonb_array_elements(p_rows) loop
  uid:=nullif(r->>'user_id','')::uuid;

  if uid is not null and public.closeout_is_member_for_tasks(p_location,uid) is not true then
   raise exception 'Link every shift to an active app employee before saving or approving coverage.';
  end if;

  if coalesce(length(r->>'id'),0) not between 1 and 150
  or coalesce(length(btrim(r->>'role')),0) not between 1 and 100
  or jsonb_typeof(r->'requires_closeout') is distinct from 'boolean' then
   raise exception 'Each shift needs an ID, position and closeout setting.';
  end if;

  if exists(
   select 1 from jsonb_array_elements(result) x
   where x->>'id'=r->>'id'
  ) then
   raise exception 'Duplicate shift ID.';
  end if;

  if r ? 'start_time' then
   if coalesce(r->>'start_time','')
    !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
   or coalesce(r->>'end_time','')
    !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Enter valid start and end times.';
   end if;

   at_start:=(
    (p_day+case when (r->>'start_time')::time<time '04:00'
     then 1 else 0 end)+(r->>'start_time')::time
   ) at time zone 'America/Chicago';

   at_end:=(
    (p_day+case when (r->>'end_time')::time<time '04:00'
     then 1 else 0 end)+(r->>'end_time')::time
   ) at time zone 'America/Chicago';

   if at_end<at_start then
    at_end:=at_end+interval '1 day';
   end if;
  else
   at_start:=(r->>'start')::timestamptz;
   at_end:=(r->>'end')::timestamptz;
  end if;

  if at_start is null or at_end is null
  or at_start<((p_day+time '04:00') at time zone 'America/Chicago')
  or at_end>staff_ops_private.cutoff(p_day)
  or at_end<=at_start
  or at_end>at_start+interval '24 hours' then
   raise exception 'Use real start/end times within this service day (4 AM to 4 AM).';
  end if;

  name:=nullif(btrim(r->>'name'),'');employee:=coalesce(nullif(r->>'employee_key',''),'unlinked:'||(r->>'id'));
  if uid is not null then
  select btrim(p.full_name),coalesce(l.employee_key,'app:'||uid::text)
  into name,employee
  from public.profiles p
  left join public.team_schedule_links l
   on l.location_id=p_location and l.user_id=p.id
  where p.id=uid;
  end if;

  result:=result||jsonb_build_array(jsonb_build_object(
   'id',r->>'id','user_id',uid,'employee_key',employee,
   'assigned',true,'name',name,'role',btrim(r->>'role'),
   'station',coalesce(r->>'station',''),
   'start',at_start,'end',at_end,
   'close',false,'business_decline',false,
   'requires_closeout',(r->>'requires_closeout')::boolean
  ));
 end loop;

 if exists(
  select 1
  from jsonb_array_elements(result) a
  join jsonb_array_elements(result) b
   on a->>'id'<b->>'id'
   and a->>'user_id'=b->>'user_id'
   and (a->>'start')::timestamptz<(b->>'end')::timestamptz
   and (b->>'start')::timestamptz<(a->>'end')::timestamptz
 ) then
  raise exception 'One employee cannot work overlapping shifts. Choose another replacement or correct the hours.';
 end if;

 return result;
end$function$

;
CREATE OR REPLACE FUNCTION roster_work_private.apply_day_before(p_location uuid, p_day date, p_rows jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 saved_at timestamptz:=clock_timestamp();
 r jsonb;
 ov jsonb;
 old_flag text;
begin
 select coalesce(overrides,'{}'::jsonb) into ov
 from public.sales_target_day_overrides
 where location_id=p_location and target_date=p_day;

 ov:=coalesce(ov,'{}');

 insert into public.crew_schedule_overrides(
  location_id,business_date,rows,upstream_rows,updated_by,updated_at
 )
 values(
  p_location,p_day,p_rows,
  (select rows from public.home_schedule_cache
   where location_id=p_location and schedule_date=p_day),
  auth.uid(),saved_at
 )
 on conflict(location_id,business_date) do update
 set rows=excluded.rows,version=crew_schedule_overrides.version+1,
  updated_by=excluded.updated_by,updated_at=excluded.updated_at;

 old_flag:=current_setting('crew_ops.local_apply',true);
 perform set_config('crew_ops.local_apply','on',true);

 insert into public.home_schedule_cache(
  location_id,schedule_date,rows,synced_at,last_error
 )
 values(p_location,p_day,p_rows,saved_at,null)
 on conflict(location_id,schedule_date) do update
 set rows=excluded.rows,synced_at=excluded.synced_at,last_error=null;

 perform set_config('crew_ops.local_apply',coalesce(old_flag,''),true);

 delete from public.staff_scheduled_shifts
 where location_id=p_location and business_date=p_day;

 for r in select value from jsonb_array_elements(p_rows) where nullif(value->>'user_id','') is not null loop
  insert into public.staff_scheduled_shifts(
   location_id,business_date,shift_key,user_id,
   start_at,end_at,role_name,requires_closeout
  )
  values(
   p_location,p_day,r->>'id',(r->>'user_id')::uuid,
   (r->>'start')::timestamptz,(r->>'end')::timestamptz,
   r->>'role',(r->>'requires_closeout')::boolean
  );
 end loop;

 insert into public.staff_schedule_days(
  location_id,business_date,confirmed_by,confirmed_at,
  schedule_snapshot,valid
 )
 values(p_location,p_day,auth.uid(),saved_at,p_rows,true)
 on conflict(location_id,business_date) do update
 set confirmed_by=excluded.confirmed_by,
  confirmed_at=excluded.confirmed_at,
  schedule_snapshot=excluded.schedule_snapshot,valid=true;

 insert into public.staff_required_roster_reviews(
  location_id,business_date,confirmed_at,source_snapshot
 )
 values(p_location,p_day,saved_at,p_rows)
 on conflict(location_id,business_date) do update
 set confirmed_at=excluded.confirmed_at,
  source_snapshot=excluded.source_snapshot;

 perform staff_ops_private.sync_quizzes(p_location,p_day);

 insert into public.sales_target_rosters(location_id,target_date,rows)
 values(p_location,p_day,p_rows)
 on conflict(location_id,target_date) do update
 set rows=excluded.rows,version=sales_target_rosters.version+1,
  updated_at=saved_at;

 select coalesce(jsonb_object_agg(
  rr->>'id',
  jsonb_build_object(
   'group',coalesce(
    ov->(rr->>'id')->>'group',
    settings.role_groups->>lower(btrim(rr->>'role')),
    case
     when rr->>'role' ~* '\mbartender\M' then 'bar'
     when rr->>'role' ~* '\mserver\M' then 'floor'
     else 'exclude'
    end
   ),
   'hours',extract(
    epoch from (rr->>'end')::timestamptz-(rr->>'start')::timestamptz
   )/3600
  )
 ),'{}')
 into ov
 from jsonb_array_elements(p_rows) rr
 left join public.sales_target_settings settings
  on settings.location_id=p_location;

 insert into public.sales_target_day_overrides(
  location_id,target_date,overrides
 )
 values(p_location,p_day,ov)
 on conflict(location_id,target_date) do update
 set overrides=excluded.overrides;

 update public.sales_target_settings
 set version=version+1,updated_at=saved_at
 where location_id=p_location;
end$function$

;
CREATE OR REPLACE FUNCTION crew_ops_private.day_rows(p_location uuid, p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 select rows into result from public.crew_schedule_overrides where location_id=p_location and business_date=p_day;
 if found then return result;end if;
 if staff_ops_private.roster_ready(p_location,p_day) then
  select coalesce(jsonb_agg(jsonb_build_object(
   'id',s.shift_key,
   'user_id',s.user_id,
   'employee_key',coalesce(l.employee_key,'app:'||s.user_id::text),
   'name',coalesce(nullif(p.full_name,''),'Employee'),
   'role',s.role_name,'station','',
   'start',s.start_at,'end',s.end_at,
   'close',false,'business_decline',false,
   'assigned',true,'requires_closeout',s.requires_closeout
  ) order by s.start_at,s.shift_key),'[]'::jsonb) into result
  from public.staff_scheduled_shifts s
  join public.profiles p on p.id=s.user_id
  left join public.team_schedule_links l
   on l.location_id=s.location_id and l.user_id=s.user_id
  where s.location_id=p_location and s.business_date=p_day;

  return result;
 end if;

 select rows into result
 from public.crew_schedule_overrides
 where location_id=p_location and business_date=p_day;

 if found then return result;end if;

 select coalesce(jsonb_agg(s||jsonb_build_object(
  'user_id',p.id,
  'name',coalesce(nullif(p.full_name,''),s->>'name'),
  'requires_closeout',case when s ? 'requires_closeout'
   then (s->>'requires_closeout')::boolean
   else s->>'role' ~* '(server|bartender)'
  end
 ) order by s->>'start',s->>'id'),'[]'::jsonb) into result
 from public.home_schedule_cache c
 cross join lateral jsonb_array_elements(c.rows) s
 left join public.team_schedule_links l
  on l.location_id=p_location and l.employee_key=s->>'employee_key'
 left join public.location_memberships m
  on m.location_id=p_location
  and m.user_id=coalesce(nullif(s->>'user_id','')::uuid,l.user_id)
  and m.status='active'
 left join public.profiles p on p.id=m.user_id
 where c.location_id=p_location and c.schedule_date=p_day
  and (s->>'assigned')::boolean is true;

 return coalesce(result,'[]'::jsonb);
end$function$

;
CREATE OR REPLACE FUNCTION crew_ops_private.canonical(p_location uuid, p_day date, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE result jsonb;key text;input_row jsonb;
BEGIN
 FOR input_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  FOREACH key IN ARRAY ARRAY[
   'requires_quiz','requires_disposal','requires_tasks'
  ] LOOP
   IF input_row ? key
   AND jsonb_typeof(input_row->key) IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'Work requirement choices must be checked or unchecked.';
   END IF;
  END LOOP;
 END LOOP;

 result:=roster_work_private.canonical_before(p_location,p_day,p_rows);

 RETURN (
  SELECT coalesce(jsonb_agg(c||jsonb_build_object(
   'requires_quiz',coalesce(
    (r->>'requires_quiz')::boolean,
    (
     SELECT bool_or(s.requires_quiz)
     FROM public.staff_scheduled_shifts s
     WHERE s.location_id=p_location AND s.business_date=p_day
      AND s.user_id=(c->>'user_id')::uuid
    ),true
   ),
   'requires_disposal',coalesce(
    (r->>'requires_disposal')::boolean,
    EXISTS(
     SELECT 1 FROM public.disposal_requirements a
     WHERE a.location_id=p_location AND a.business_date=p_day
      AND a.user_id=(c->>'user_id')::uuid AND a.active
    )
   ),
   'requires_tasks',coalesce(
    (r->>'requires_tasks')::boolean,
    roster_work_private.has_tasks(
     p_location,p_day,(c->>'user_id')::uuid
    )
   ),
   'task_templates',coalesce(r->'task_templates','[]'::jsonb),
   'task_template_id',nullif(r->>'task_template_id',''),
   'task_template_version',nullif(r->>'task_template_version','')::integer
  ) ORDER BY ord),'[]'::jsonb)
  FROM jsonb_array_elements(result) WITH ORDINALITY x(c,ord)
  JOIN jsonb_array_elements(p_rows) y(r) ON r->>'id'=c->>'id'
 );
END $function$

;
CREATE SCHEMA IF NOT EXISTS roster_split_private;
REVOKE ALL ON SCHEMA roster_split_private FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS roster_split_private.plans(location_id uuid NOT NULL,day date NOT NULL,signature text NOT NULL,runs uuid[] NOT NULL DEFAULT '{}',PRIMARY KEY(location_id,day));
ALTER TABLE roster_split_private.plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON roster_split_private.plans FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION roster_split_private.assign_lists(l uuid,d date,rows jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE wanted jsonb;prior roster_split_private.plans;entry record;member jsonb;batch jsonb;groups jsonb;stop_at timestamptz;users uuid[];pieces jsonb;t public.staff_task_templates;rid uuid;newruns uuid[]:='{}';i integer;n integer;sig text;
BEGIN
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'template',x->>'start',x->>'id'),'[]'::jsonb) INTO wanted FROM (
 SELECT DISTINCT jsonb_build_object('template',p->>'id','version',p->>'version','id',r->>'id','user_id',r->>'user_id','start',r->>'start','end',r->>'end') x
 FROM jsonb_array_elements(rows) r CROSS JOIN LATERAL jsonb_array_elements(coalesce(r->'task_templates','[]')) p
 WHERE (r->>'requires_tasks')::boolean IS TRUE
 ) q;
 IF jsonb_array_length(wanted)>0 THEN PERFORM public.app_access_assert(l,'tasks','assign');IF public.staff_tasks_can_manage(l) IS NOT TRUE THEN RAISE EXCEPTION 'Task management access required.' USING errcode='42501';END IF;END IF;
 sig:=md5(wanted::text);SELECT * INTO prior FROM roster_split_private.plans WHERE location_id=l AND day=d FOR UPDATE;
 IF FOUND AND prior.signature=sig THEN RETURN;END IF;
 IF EXISTS(SELECT 1 FROM public.staff_task_checks c WHERE c.run_id=ANY(prior.runs)) THEN
 RAISE EXCEPTION 'This shared task plan has completed work. Keep its roster/list selections; use task management to review changes without losing completion history.';END IF;
 UPDATE public.staff_task_runs SET cancelled_at=clock_timestamp() WHERE id=ANY(prior.runs) AND cancelled_at IS NULL;
 FOR entry IN SELECT DISTINCT x->>'template' tid FROM jsonb_array_elements(wanted) x LOOP
 SELECT * INTO t FROM public.staff_task_templates WHERE id=entry.tid::uuid AND location_id=l AND active AND reviewed FOR SHARE;
 IF t.id IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(wanted) x WHERE x->>'template'=entry.tid AND (x->>'version')::integer IS DISTINCT FROM t.version) THEN RAISE EXCEPTION 'A selected task preset changed. Reload and review it.';END IF;
 -- Build groups with a common scheduled interval; touching shifts do not share work.
 groups:='[]';batch:='[]';stop_at:=NULL;
 FOR member IN SELECT x FROM jsonb_array_elements(wanted) x WHERE x->>'template'=entry.tid ORDER BY (x->>'start')::timestamptz,x->>'id' LOOP
 IF stop_at IS NOT NULL AND (member->>'start')::timestamptz>=stop_at THEN groups:=groups||jsonb_build_array(batch);batch:='[]';stop_at:=NULL;END IF;
 batch:=batch||jsonb_build_array(member);stop_at:=least(coalesce(stop_at,(member->>'end')::timestamptz),(member->>'end')::timestamptz);
 END LOOP;
 IF jsonb_array_length(batch)>0 THEN groups:=groups||jsonb_build_array(batch);END IF;
 FOR batch IN SELECT value FROM jsonb_array_elements(groups) LOOP
 n:=jsonb_array_length(batch);i:=0;
 FOR member IN SELECT value FROM jsonb_array_elements(batch) LOOP
 SELECT coalesce(jsonb_agg(value ORDER BY ord),'[]') INTO pieces FROM jsonb_array_elements(t.items) WITH ORDINALITY x(value,ord) WHERE mod((ord-1)::integer,n)=i;
 i:=i+1;
 -- Unlinked shares remain reserved in the saved roster. They are not assigned to another account.
 IF nullif(member->>'user_id','') IS NULL OR jsonb_array_length(pieces)=0 THEN CONTINUE;END IF;
 IF public.closeout_is_member_for_tasks(l,(member->>'user_id')::uuid) IS NOT TRUE THEN RAISE EXCEPTION 'A task assignee is no longer active in this location.';END IF;
 -- Never silently duplicate a list assigned outside this roster workflow.
 IF EXISTS(SELECT 1 FROM public.staff_task_runs run JOIN public.staff_task_assignees a ON a.run_id=run.id WHERE run.location_id=l AND run.business_date=d AND run.template_id=t.id AND run.cancelled_at IS NULL AND a.active AND a.user_id=(member->>'user_id')::uuid AND NOT(run.id=ANY(coalesce(prior.runs,'{}')))) THEN RAISE EXCEPTION 'This preset already has an assignment outside the shared roster plan. Review it in Tasks before redistributing.';END IF;
 INSERT INTO public.staff_task_runs(location_id,template_id,business_date,shift_label,title,position,phase,items,assigned_by,request_id,available_at)
 VALUES(l,t.id,d,'Shared roster list',t.title,t.position,t.phase,pieces,auth.uid(),gen_random_uuid(),(member->>'start')::timestamptz) RETURNING id INTO rid;
 INSERT INTO public.staff_task_assignees(run_id,user_id) VALUES(rid,(member->>'user_id')::uuid);newruns:=array_append(newruns,rid);
 END LOOP;END LOOP;END LOOP;
 INSERT INTO roster_split_private.plans VALUES(l,d,sig,newruns) ON CONFLICT(location_id,day) DO UPDATE SET signature=excluded.signature,runs=excluded.runs;
END $$;
;
CREATE OR REPLACE FUNCTION crew_ops_private.apply_day(p_location uuid, p_day date, p_rows jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 person record;
 item jsonb;
 template public.staff_task_templates%rowtype;
 wanted boolean;
BEGIN
 PERFORM roster_work_private.apply_day_before(p_location,p_day,p_rows);
 PERFORM staff_ops_private.apply_controls(p_location,p_day);

 FOR person IN
  SELECT (r->>'user_id')::uuid uid,
   bool_or((r->>'requires_disposal')::boolean) disposal,
   bool_or((r->>'requires_tasks')::boolean) tasks
  FROM jsonb_array_elements(p_rows) r
  WHERE nullif(r->>'user_id','') IS NOT NULL
  GROUP BY r->>'user_id'
 LOOP
  IF person.disposal IS NOT NULL THEN
   PERFORM public.disposal_requirement_assign(
    p_location,p_day,person.uid,person.disposal
   );
  END IF;

  IF person.tasks IS FALSE THEN
   UPDATE public.staff_task_assignees a
   SET active=false,version=version+1
   FROM public.staff_task_runs t
   WHERE a.run_id=t.id
    AND t.location_id=p_location AND t.business_date=p_day
    AND t.cancelled_at IS NULL
    AND a.user_id=person.uid AND a.active
    AND EXISTS(
     SELECT 1
     FROM jsonb_array_elements(t.items) WITH ORDINALITY x(item,n)
     WHERE NOT EXISTS(
      SELECT 1 FROM public.staff_task_checks c
      WHERE c.run_id=t.id AND c.user_id=a.user_id
       AND c.item_index=x.n-1
     )
    );

  END IF;
 END LOOP;
 PERFORM roster_split_private.assign_lists(p_location,p_day,p_rows);
END $function$

;
CREATE OR REPLACE FUNCTION staff_ops_private.recurring_match(l uuid,u uuid,k text,d date) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
SELECT CASE WHEN k LIKE 'task:%' AND EXISTS(SELECT 1 FROM public.crew_schedule_overrides c CROSS JOIN LATERAL jsonb_array_elements(c.rows) r WHERE c.location_id=l AND c.business_date=d AND r->>'user_id'=u::text AND r ? 'task_templates') THEN false ELSE roster_work_private.recurring_before(l,u,k,d) END;
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA roster_split_private FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT true AS roster_shared_lists_installed,false AS production_behavior_verified;
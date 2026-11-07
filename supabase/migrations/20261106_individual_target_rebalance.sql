begin;
create schema if not exists target_balance_private;
revoke all on schema target_balance_private from public,anon,authenticated;
-- Retain the installed schedule, dining-hours and locked-day calculation.
do $$begin
 if to_regprocedure('target_balance_private.base_day(uuid,date)') is null then
  alter function shift_context_private.target_day(uuid,date) set schema target_balance_private;
  alter function target_balance_private.target_day(uuid,date) rename to base_day;
 end if;
end$$;
create or replace function target_balance_private.balance(base jsonb,manual jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare fixed numeric;goal numeric;free_count integer;remaining numeric;out_rows jsonb;
begin
 if coalesce((base->>'ready')::boolean,false) is not true then return base;end if;
 if not exists(select 1 from jsonb_array_elements(base->'rows') x where manual ? ((x->>'group')||':'||(x->>'employee_key'))) then return base;end if;
 goal:=round((base->>'team_target')::numeric*100);
 if goal is null or goal<0 or goal::text in ('NaN','Infinity','-Infinity') then raise exception 'The team target is invalid.';end if;
 if exists(select 1 from jsonb_array_elements(base->'rows') x where nullif(x->>'employee_key','') is null or (x->>'hours')::numeric is null or (x->>'hours')::numeric<=0 or (x->>'hours')::numeric::text in ('NaN','Infinity','-Infinity')) then raise exception 'Usable selling hours are required to redistribute the goal.';end if;
 if exists(select 1 from jsonb_each(manual) e where jsonb_typeof(e.value) is distinct from 'number' or (e.value::text)::numeric<0 or (e.value::text)::numeric<>round((e.value::text)::numeric,2)) then raise exception 'Manual targets must be valid nonnegative amounts with at most two decimals.';end if;
 with people as(select distinct (x->>'group')||':'||(x->>'employee_key') id from jsonb_array_elements(base->'rows') x)
 select coalesce(sum(round((manual->>id)::numeric*100)) filter(where manual ? id),0),count(*) filter(where not manual ? id) into fixed,free_count from people;
 remaining:=goal-fixed;
 if remaining<0 then raise exception 'Manual individual targets exceed the team goal. Lower or reset a manual target.';end if;
 if free_count=0 and remaining<>0 then raise exception 'All targets are manually set. They must add up to the team goal; reset a target to allow redistribution.';end if;
 with shifts as(select x,n,(x->>'group')||':'||(x->>'employee_key') id,(x->>'hours')::numeric hours from jsonb_array_elements(base->'rows') with ordinality a(x,n)),
 people as(select id,sum(hours) hours from shifts group by id),
 weights as(select *,case when manual ? id then round((manual->>id)::numeric*100) else remaining*hours/nullif(sum(hours) filter(where not manual ? id) over(),0) end raw from people),
 ranked as(select *,row_number() over(partition by (manual ? id) order by raw-floor(raw) desc,id collate "C") rank,sum(floor(raw)) filter(where not manual ? id) over() allocated from weights),
 amounts as(select id,case when manual ? id then raw else floor(raw)+case when rank<=remaining-allocated then 1 else 0 end end cents from ranked),
 parts as(select s.*,a.cents,a.cents*s.hours/nullif(sum(s.hours) over(partition by s.id),0) raw from shifts s join amounts a using(id)),
 split as(select *,row_number() over(partition by id order by raw-floor(raw) desc,n) rank,sum(floor(raw)) over(partition by id) allocated from parts)
 select jsonb_agg(x||jsonb_build_object('target',(floor(raw)+case when rank<=cents-allocated then 1 else 0 end)/100.0,'manual_target',manual ? id) order by n) into out_rows from split;
 return base||jsonb_build_object('rows',out_rows,'individual_target_total',(select sum((x->>'target')::numeric) from jsonb_array_elements(out_rows) x),'bar_target',(select coalesce(sum((x->>'target')::numeric),0) from jsonb_array_elements(out_rows) x where x->>'group'='bar'),'floor_target',(select coalesce(sum((x->>'target')::numeric),0) from jsonb_array_elements(out_rows) x where x->>'group'='floor'),'individual_balance','fixed_manual_then_selling_hours');
end$$;
create or replace function shift_context_private.target_day(p_location uuid,p_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare base jsonb;manual jsonb;begin
 base:=target_balance_private.base_day(p_location,p_date);
 select coalesce(jsonb_object_agg(pool||':'||employee_key,target),'{}'::jsonb) into manual from closeout_fix_private.personal_targets where location_id=p_location and target_date=p_date and target is not null;
 begin return target_balance_private.balance(base,manual);
 exception when raise_exception then return base||jsonb_build_object('ready',false,'reason',sqlerrm,'individual_balance','invalid_manual_targets');end;
end$$;
-- Keep the existing membership, role, locked-date, audit and version checks.
create or replace function public.personal_sales_target_save(p_location_id uuid,p_date date,p_employee_key text,p_pool text,p_target numeric,p_version integer,p_allow_locked boolean default false,p_reason text default '')
returns void language plpgsql security definer set search_path='' as $$
declare prior closeout_fix_private.personal_targets;after_row closeout_fix_private.personal_targets;base jsonb;manual jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then raise exception 'Management access required.' using errcode='42501';end if;
 if p_date is null or p_pool is null or p_pool not in ('bar','floor') or nullif(btrim(p_employee_key),'') is null or length(p_employee_key)>200 or p_version is null or p_version<0 or (p_target is not null and (p_target<0 or p_target>100000000 or p_target<>round(p_target,2) or p_target::text in ('NaN','Infinity','-Infinity'))) then raise exception 'Choose an employee, pool and valid target amount.';end if;
 perform pg_advisory_xact_lock(hashtextextended('closeout-target:'||p_location_id::text||':'||p_date::text,0));
 if exists(select 1 from public.closeout_target_days where location_id=p_location_id and target_date=p_date) and (public.closeout_is_gm(p_location_id) is not true or not coalesce(p_allow_locked,false) or length(btrim(coalesce(p_reason,'')))<3) then raise exception 'This date is locked. Elevated access, explicit override and a reason are required.';end if;
 if length(coalesce(p_reason,''))>2000 then raise exception 'Keep the change reason under 2,000 characters.';end if;
 base:=target_balance_private.base_day(p_location_id,p_date);
 if coalesce((base->>'ready')::boolean,false) is not true or not exists(select 1 from jsonb_array_elements(base->'rows') x where x->>'employee_key'=p_employee_key and x->>'group'=p_pool) then raise exception 'Employee has no available assigned target for this date and pool.';end if;
 select * into prior from closeout_fix_private.personal_targets where location_id=p_location_id and target_date=p_date and employee_key=p_employee_key and pool=p_pool for update;
 if coalesce(prior.version,0) is distinct from p_version then raise exception 'This target changed. Reload before saving.';end if;
 select coalesce(jsonb_object_agg(pool||':'||employee_key,target),'{}'::jsonb) into manual from closeout_fix_private.personal_targets where location_id=p_location_id and target_date=p_date and target is not null;
 manual:=manual-(p_pool||':'||p_employee_key);
 if p_target is not null then manual:=manual||jsonb_build_object(p_pool||':'||p_employee_key,p_target);end if;
 perform target_balance_private.balance(base,manual);
 insert into closeout_fix_private.personal_targets(location_id,target_date,employee_key,pool,target,updated_by) values(p_location_id,p_date,p_employee_key,p_pool,p_target,auth.uid()) on conflict(location_id,target_date,employee_key,pool) do update set target=excluded.target,version=personal_targets.version+1,updated_by=auth.uid(),updated_at=clock_timestamp() returning * into after_row;
 insert into closeout_fix_private.target_audit(location_id,changed_by,reason,before_record,after_record) values(p_location_id,auth.uid(),coalesce(p_reason,''),to_jsonb(prior),to_jsonb(after_row));
end$$;
revoke all on all functions in schema target_balance_private from public,anon,authenticated;
revoke all on function shift_context_private.target_day(uuid,date) from public,anon,authenticated;
revoke all on function public.personal_sales_target_save(uuid,date,text,text,numeric,integer,boolean,text) from public,anon,authenticated;
grant execute on function public.personal_sales_target_save(uuid,date,text,text,numeric,integer,boolean,text) to authenticated;
notify pgrst,'reload schema';
commit;

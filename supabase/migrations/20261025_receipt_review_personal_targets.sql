begin;
create schema if not exists closeout_fix_private;
revoke all on schema closeout_fix_private from public,anon,authenticated;
do $$begin
 if to_regprocedure('public.manager_day_load(uuid)') is null or to_regprocedure('public.menu_sales_items(uuid)') is null then raise exception 'Install the menu and monthly day-close update first.';end if;
 if to_regprocedure('public.receipt_responsibility_requests(uuid)') is null or to_regprocedure('public.receipt_private_write_guard()') is null or to_regprocedure('public.closeout_validate_and_score()') is null then raise exception 'Install the existing receipt responsibility and closeout workflow first.';end if;
end$$;
create table if not exists closeout_fix_private.receipt_context(tx bigint not null,actor uuid not null,closeout_id uuid not null,primary key(tx,actor,closeout_id));
alter table closeout_fix_private.receipt_context enable row level security;
revoke all on closeout_fix_private.receipt_context from public,anon,authenticated;
create or replace function closeout_fix_private.receipt_correction_allowed(before_row jsonb,after_row jsonb) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from closeout_fix_private.receipt_context where tx=txid_current() and actor=auth.uid() and closeout_id=(before_row->>'id')::uuid)
 and (before_row-array['receipt_reason_policy','correction_note','void_count','void_value','discount_value'])=(after_row-array['receipt_reason_policy','correction_note','void_count','void_value','discount_value']);
$$;
-- Keep the established validation/scoring implementation, extending only its permission gate.
do $$declare def text;needle text:='if not public.closeout_is_member(old.location_id) or not public.mod_is_manager(old.location_id) then';begin
 def:=pg_get_functiondef('public.closeout_validate_and_score()'::regprocedure);
 if position('closeout_fix_private.receipt_correction_allowed' in def)=0 then
  if position(needle in def)=0 then raise exception 'Closeout validation changed. Share its current definition before installing this update.';end if;
  execute replace(def,needle,'if (not public.closeout_is_member(old.location_id) or not public.mod_is_manager(old.location_id)) and not closeout_fix_private.receipt_correction_allowed(to_jsonb(old),to_jsonb(new)) then');
 end if;
end$$;
create or replace function public.receipt_private_write_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then return new;end if;
 if public.closeout_is_member(new.location_id) is not true then raise exception 'Active location access required.' using errcode='42501';end if;
 if TG_OP='INSERT' then
  if new.user_id<>auth.uid() then raise exception 'Capture receipts in your own wallet.' using errcode='42501';end if;
 elsif old.user_id<>auth.uid() then
  if TG_TABLE_NAME='closeout_receipts' then
   if public.mod_is_manager(old.location_id) is true and public.receipt_is_submitted(old.id) then return new;end if;
   if old.assigned_user_id=auth.uid() and (to_jsonb(new)-array['responsibility_response','responsibility_responded_at','version','updated_at'])=(to_jsonb(old)-array['responsibility_response','responsibility_responded_at','version','updated_at']) then return new;end if;
   if old.assigned_user_id=auth.uid() and old.deleted_at is null and (to_jsonb(new)-array['kind','reason','amount','check_number','notes','verified_by','verifier_name','ready','details_saved_at','version','updated_at'])=(to_jsonb(old)-array['kind','reason','amount','check_number','notes','verified_by','verifier_name','ready','details_saved_at','version','updated_at']) then return new;end if;
  end if;
  raise exception 'Private wallets are visible only to their owner. Only the sent receipt may be reviewed by its recipient.' using errcode='42501';
 end if;return new;
end$$;
create or replace function public.receipt_recipient_details_save(p_location_id uuid,p_id uuid,p_version integer,p_values jsonb,p_change_note text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.closeout_receipts;updated public.closeout_receipts;c public.daily_closeouts;v numeric;k text;why text;begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active location access required.' using errcode='42501';end if;
 select * into r from public.closeout_receipts where id=p_id and location_id=p_location_id;
 if r.id is null or r.deleted_at is not null or r.assigned_user_id is distinct from auth.uid() or r.user_id=auth.uid() then raise exception 'Only the recipient of this sent receipt may review it here.' using errcode='42501';end if;
 if r.closeout_key is not null then perform pg_advisory_xact_lock(hashtextextended('closeout-submit:'||r.user_id::text||r.closeout_key::text,0));end if;
 select * into r from public.closeout_receipts where id=p_id and location_id=p_location_id for update;
 if r.deleted_at is not null or r.assigned_user_id is distinct from auth.uid() then raise exception 'Receipt access changed. Refresh the wallet.' using errcode='42501';end if;
 if r.version is distinct from p_version then raise exception 'Receipt changed. Reopen it before saving.';end if;
 if jsonb_typeof(p_values) is distinct from 'object' or (p_values-array['kind','reason','amount','check_number','notes','verifier_name'])<>'{}'::jsonb then raise exception 'Only receipt submission details may be edited.';end if;
 k:=p_values->>'kind';why:=p_values->>'reason';
 if k is null or k not in ('void','comp','discount') or why is null or (k='void' and why not in ('customer_changed_mind','server_error','86ed_item','testing_training')) or (k in ('comp','discount') and why not in ('guest_recovery','server_error','kitchen_error','employee_discount','spill_waste_server_error','spill_waste_kitchen_error')) then raise exception 'Choose a valid receipt type and reason.';end if;
 if jsonb_typeof(p_values->'amount') is distinct from 'number' then raise exception 'Enter a positive receipt amount.';end if;
 v:=(p_values->>'amount')::numeric;
 if v<=0 or v>100000000 or v<>round(v,2) or v::text in ('NaN','Infinity','-Infinity') then raise exception 'Enter a positive amount with at most two decimals.';end if;
 if jsonb_typeof(p_values->'check_number') is distinct from 'string' or length(p_values->>'check_number')>100 or jsonb_typeof(p_values->'notes') is distinct from 'string' or length(p_values->>'notes')>2000 or jsonb_typeof(p_values->'verifier_name') is distinct from 'string' or length(btrim(p_values->>'verifier_name')) not between 1 and 160 then raise exception 'Enter valid check, notes and verifier details.';end if;
 if length(coalesce(p_change_note,''))>2000 or (public.receipt_is_submitted(p_id) and length(btrim(coalesce(p_change_note,'')))<3) then raise exception 'Enter a correction reason for this submitted receipt.';end if;
 if not exists(select 1 from storage.objects where bucket_id=r.origin_bucket and name=r.file_path) then raise exception 'The original receipt photo is unavailable.';end if;
 if r.closeout_key is not null then select * into c from public.daily_closeouts where id=r.closeout_key for update;if c.deleted_at is not null then raise exception 'The linked closeout was deleted.';end if;end if;
 update public.closeout_receipts set kind=k,reason=why,amount=v,check_number=btrim(p_values->>'check_number'),notes=p_values->>'notes',verified_by=null,verifier_name=btrim(p_values->>'verifier_name'),ready=true,details_saved_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() where id=p_id returning * into updated;
 insert into public.closeout_receipt_audit(receipt_id,actor_id,before_record,after_record) values(p_id,auth.uid(),to_jsonb(r),to_jsonb(updated)||jsonb_build_object('event','Recipient reviewed submission details','change_note',coalesce(p_change_note,'')));
 if c.id is not null and c.status='submitted' then
  insert into closeout_fix_private.receipt_context values(txid_current(),auth.uid(),c.id);
  update public.daily_closeouts set receipt_reason_policy=true,correction_note=left(btrim(p_change_note),1800)||E'\nRecipient receipt correction '||p_id::text,
   void_count=(select count(*) from public.closeout_receipts where closeout_key=c.id and deleted_at is null and ready and kind='void'),
   void_value=(select coalesce(sum(amount),0) from public.closeout_receipts where closeout_key=c.id and deleted_at is null and ready and kind='void'),
   discount_value=(select coalesce(sum(amount),0) from public.closeout_receipts where closeout_key=c.id and deleted_at is null and ready and kind in ('comp','discount')) where id=c.id;
  delete from closeout_fix_private.receipt_context where tx=txid_current() and actor=auth.uid() and closeout_id=c.id;
 end if;return to_jsonb(updated);
end$$;
do $$begin
 if to_regprocedure('closeout_fix_private.requests_before_review(uuid)') is null then
  alter function public.receipt_responsibility_requests(uuid) set schema closeout_fix_private;
  alter function closeout_fix_private.receipt_responsibility_requests(uuid) rename to requests_before_review;
 end if;
end$$;
create or replace function public.receipt_responsibility_requests(p_location_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 result:=closeout_fix_private.requests_before_review(p_location_id);
 return coalesce((select jsonb_agg(x||jsonb_build_object('can_edit',true,'can_delete',false)) from jsonb_array_elements(result) x),'[]'::jsonb);
end$$;
revoke all on all functions in schema closeout_fix_private from public,anon,authenticated;
revoke all on function public.receipt_recipient_details_save(uuid,uuid,integer,jsonb,text),public.receipt_responsibility_requests(uuid) from public,anon,authenticated;
grant execute on function public.receipt_recipient_details_save(uuid,uuid,integer,jsonb,text),public.receipt_responsibility_requests(uuid) to authenticated;
create table if not exists closeout_fix_private.personal_targets(location_id uuid not null references public.locations(id),target_date date not null,employee_key text not null,pool text not null check(pool in ('bar','floor')),target numeric(14,2),version integer not null default 1,updated_by uuid not null,updated_at timestamptz not null default now(),primary key(location_id,target_date,employee_key,pool),check(target is null or target between 0 and 100000000));
create table if not exists closeout_fix_private.target_audit(id bigint generated always as identity primary key,location_id uuid not null,changed_by uuid not null,changed_at timestamptz not null default now(),reason text not null,before_record jsonb,after_record jsonb);
alter table closeout_fix_private.personal_targets enable row level security;
alter table closeout_fix_private.target_audit enable row level security;
revoke all on all tables in schema closeout_fix_private from public,anon,authenticated;
revoke all on all sequences in schema closeout_fix_private from public,anon,authenticated;
do $$begin
 if to_regprocedure('closeout_fix_private.targets_before_personal(uuid,date)') is null then
  alter function shift_context_private.target_day(uuid,date) set schema closeout_fix_private;
  alter function closeout_fix_private.target_day(uuid,date) rename to targets_before_personal;
 end if;
 if to_regprocedure('closeout_fix_private.inputs_before_personal(uuid,date)') is null then
  alter function public.sales_target_inputs(uuid,date) set schema closeout_fix_private;
  alter function closeout_fix_private.sales_target_inputs(uuid,date) rename to inputs_before_personal;
 end if;
 if to_regprocedure('closeout_fix_private.home_before_personal(uuid,date)') is null then
  alter function public.my_home_sales_targets(uuid,date) set schema closeout_fix_private;
  alter function closeout_fix_private.my_home_sales_targets(uuid,date) rename to home_before_personal;
 end if;
end$$;
create or replace function shift_context_private.target_day(p_location uuid,p_date date) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;rows jsonb;begin
 result:=closeout_fix_private.targets_before_personal(p_location,p_date);
 if coalesce((result->>'ready')::boolean,false) is not true then return result;end if;
 with base as(select x,n,o.target override_target from jsonb_array_elements(result->'rows') with ordinality a(x,n) left join closeout_fix_private.personal_targets o on o.location_id=p_location and o.target_date=p_date and o.employee_key=x->>'employee_key' and o.pool=x->>'group'),
 weights as(select *,sum((x->>'hours')::numeric) over(partition by x->>'employee_key',x->>'group') hrs from base),
 fractions as(select *,case when override_target is not null then round(override_target*100)*(x->>'hours')::numeric/nullif(hrs,0) end raw from weights),
 ranked as(select *,row_number() over(partition by x->>'employee_key',x->>'group' order by raw-floor(raw) desc,n) rank,sum(floor(raw)) over(partition by x->>'employee_key',x->>'group') allocated from fractions)
 select coalesce(jsonb_agg(case when override_target is null then x else x||jsonb_build_object('target',(floor(raw)+case when rank<=round(override_target*100)-allocated then 1 else 0 end)/100.0,'manual_target',true) end order by n),'[]'::jsonb) into rows from ranked;
 return result||jsonb_build_object('rows',rows,'individual_target_total',(select coalesce(sum((x->>'target')::numeric),0) from jsonb_array_elements(rows) x));
end$$;
create or replace function public.sales_target_inputs(p_location_id uuid,p_date date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 result:=closeout_fix_private.inputs_before_personal(p_location_id,p_date);
 return result||jsonb_build_object('personal_targets',coalesce((select jsonb_object_agg(pool||':'||employee_key,target) from closeout_fix_private.personal_targets where location_id=p_location_id and target_date=p_date and target is not null),'{}'::jsonb));
end$$;
create or replace function public.my_home_sales_targets(p_location_id uuid,p_date date default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 result:=closeout_fix_private.home_before_personal(p_location_id,p_date);
 return result||jsonb_build_object('can_manage',public.mod_is_manager(p_location_id) is true);
end$$;
create or replace function public.personal_sales_targets_load(p_location_id uuid,p_date date) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 result:=public.sales_targets_for_day(p_location_id,p_date);
 return result||jsonb_build_object('can_override',public.closeout_is_gm(p_location_id) is true,'overrides',coalesce((select jsonb_agg(to_jsonb(t)) from closeout_fix_private.personal_targets t where location_id=p_location_id and target_date=p_date),'[]'::jsonb));
end$$;
create or replace function public.personal_sales_target_save(p_location_id uuid,p_date date,p_employee_key text,p_pool text,p_target numeric,p_version integer,p_allow_locked boolean default false,p_reason text default '') returns void language plpgsql security definer set search_path='' as $$
declare prior closeout_fix_private.personal_targets;after_row closeout_fix_private.personal_targets;allocation jsonb;begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then raise exception 'Management access required.' using errcode='42501';end if;
 if p_date is null or p_pool not in ('bar','floor') or nullif(btrim(p_employee_key),'') is null or length(p_employee_key)>200 or p_version is null or p_version<0 or (p_target is not null and (p_target<0 or p_target>100000000 or p_target<>round(p_target,2) or p_target::text in ('NaN','Infinity','-Infinity'))) then raise exception 'Choose an employee, pool and valid target amount.';end if;
 perform pg_advisory_xact_lock(hashtextextended('closeout-target:'||p_location_id::text||':'||p_date::text,0));
 if exists(select 1 from public.closeout_target_days where location_id=p_location_id and target_date=p_date) and (public.closeout_is_gm(p_location_id) is not true or not coalesce(p_allow_locked,false) or length(btrim(coalesce(p_reason,'')))<3) then raise exception 'This date is locked. Elevated access, explicit override and a reason are required.';end if;
 if length(coalesce(p_reason,''))>2000 then raise exception 'Keep the change reason under 2,000 characters.';end if;
 allocation:=shift_context_private.target_day(p_location_id,p_date);
 if coalesce((allocation->>'ready')::boolean,false) is not true or not exists(select 1 from jsonb_array_elements(allocation->'rows') x where x->>'employee_key'=p_employee_key and x->>'group'=p_pool) then raise exception 'Employee has no available assigned target for this date and pool.';end if;
 select * into prior from closeout_fix_private.personal_targets where location_id=p_location_id and target_date=p_date and employee_key=p_employee_key and pool=p_pool for update;
 if coalesce(prior.version,0) is distinct from p_version then raise exception 'This target changed. Reload before saving.';end if;
 insert into closeout_fix_private.personal_targets(location_id,target_date,employee_key,pool,target,updated_by) values(p_location_id,p_date,p_employee_key,p_pool,p_target,auth.uid()) on conflict(location_id,target_date,employee_key,pool) do update set target=excluded.target,version=personal_targets.version+1,updated_by=auth.uid(),updated_at=clock_timestamp() returning * into after_row;
 insert into closeout_fix_private.target_audit(location_id,changed_by,reason,before_record,after_record) values(p_location_id,auth.uid(),coalesce(p_reason,''),to_jsonb(prior),to_jsonb(after_row));
end$$;
revoke all on all functions in schema closeout_fix_private from public,anon,authenticated;
revoke all on function public.sales_target_inputs(uuid,date),public.my_home_sales_targets(uuid,date),public.personal_sales_targets_load(uuid,date),public.personal_sales_target_save(uuid,date,text,text,numeric,integer,boolean,text) from public,anon,authenticated;
grant execute on function public.sales_target_inputs(uuid,date),public.my_home_sales_targets(uuid,date),public.personal_sales_targets_load(uuid,date),public.personal_sales_target_save(uuid,date,text,text,numeric,integer,boolean,text) to authenticated;
notify pgrst,'reload schema';
commit;

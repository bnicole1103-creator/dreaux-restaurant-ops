begin;
alter table public.daily_closeouts
 add column if not exists zero_sales_confirmed boolean not null default false,
 add column if not exists zero_sales_reason text,
 add column if not exists shift_type text,
 add column if not exists completion_points_withheld boolean not null default false,
 add column if not exists correction_note text,
 add column if not exists edit_version integer not null default 1,
 add column if not exists corrected_at timestamptz,
 add column if not exists corrected_by uuid,
 add column if not exists submitted_at timestamptz;
create table if not exists public.staff_closeout_edit_audit(
 id bigint generated always as identity primary key, closeout_id uuid not null,
 location_id uuid not null, changed_by uuid not null, changed_at timestamptz not null default now(),
 reason text not null, before_record jsonb not null, after_record jsonb not null
);
alter table public.staff_closeout_edit_audit enable row level security;
revoke all on public.staff_closeout_edit_audit from public,anon,authenticated;

create or replace function public.closeout_validate_and_score() returns trigger
language plpgsql security definer set search_path='' as $$
declare rules jsonb; codes text[]:=array[]::text[]; code text; value integer; summary jsonb:='[]'; delta integer:=0; late numeric; ratio numeric; changed boolean;
begin
 if TG_OP='UPDATE' then
  if (new.location_id,new.organization_id,new.user_id,new.created_at,new.closeout_date) is distinct from (old.location_id,old.organization_id,old.user_id,old.created_at,old.closeout_date) then raise exception 'Closeout identity and submission date cannot be changed.'; end if;
  if old.status='submitted' and new.status is distinct from old.status then raise exception 'A submitted closeout cannot be returned to draft.';end if;
  new.point_rules_snapshot:=old.point_rules_snapshot;new.submitted_at:=old.submitted_at;
  new.edit_version:=old.edit_version;new.corrected_at:=old.corrected_at;new.corrected_by:=old.corrected_by;
  changed:=(to_jsonb(new)-array['deleted_at','deleted_by','deleted_record']) is distinct from (to_jsonb(old)-array['deleted_at','deleted_by','deleted_record']);
  if not changed then return new; end if;
  if old.status='submitted' then
   if not public.closeout_is_member(old.location_id) or not public.mod_is_manager(old.location_id) then raise exception 'Managers must correct submitted closeouts.' using errcode='42501'; end if;
   if coalesce(length(btrim(new.correction_note)),0) not between 1 and 2000 then raise exception 'Enter the reason for this correction.'; end if;
   if old.completion_points_withheld and not new.completion_points_withheld then raise exception 'Only the GM can restore points using the points editor.'; end if;
   new.corrected_at:=clock_timestamp();new.corrected_by:=auth.uid();new.edit_version:=old.edit_version+1;
  else
   new.completion_points_withheld:=false;new.correction_note:=null;
   if new.status='submitted' then new.submitted_at:=now();end if;
  end if;
 else
  new.completion_points_withheld:=false;new.correction_note:=null;new.edit_version:=1;new.corrected_at:=null;new.corrected_by:=null;
  if new.status='submitted' then new.submitted_at:=now(); end if;
 end if;
 if new.status<>'submitted' then return new; end if;
 if new.job_role is null or new.job_role not in ('server','main_bartender','back_bartender_1','back_bar_service_bartender','host','busser','manager','assistant_manager','general_manager') then raise exception 'Choose a valid role.';end if;
 if TG_OP='INSERT' and (new.shift_type is null or new.shift_type not in ('AM','PM','TO_VOLUME') or new.employee_certified is distinct from true) then raise exception 'Select your shift and certify the closeout.';end if;
 if new.net_sales is null or new.net_sales not between 0 and 100000000 or new.sales_target is null or new.sales_target not between 0 and 100000000 or new.cash_deposit is null or new.cash_deposit not between 0 and 100000000 or new.void_value is null or new.void_value not between 0 and 100000000 or new.discount_value is null or new.discount_value not between 0 and 100000000 or new.void_count is null or new.void_count not between 0 and 100000 then raise exception 'Enter valid, nonnegative sales, target, cash, voids and discounts.'; end if;
 if new.scheduled_start is null or new.clock_in is null then raise exception 'Enter scheduled and actual clock-in times.'; end if;
 if new.net_sales=0 and not new.completion_points_withheld and (not new.zero_sales_confirmed or coalesce(length(btrim(new.zero_sales_reason)),0) not between 3 and 2000) then raise exception 'Confirm that $0 sales is accurate and explain why before submitting.'; end if;
 rules:=coalesce(new.point_rules_snapshot,public.closeout_config_internal(new.location_id)->'rules');new.point_rules_snapshot:=rules;
 late:=greatest(0,extract(epoch from new.clock_in::time-new.scheduled_start::time)/60);
 if late>=30 then codes:=array_append(codes,'LATE_30_PLUS');elsif late>=15 then codes:=array_append(codes,'LATE_15_29');elsif late>=6 then codes:=array_append(codes,'LATE_6_14');elsif late>=1 then codes:=array_append(codes,'LATE_1_5');end if;
 if new.sales_target>0 then
  ratio:=new.net_sales/new.sales_target*100;
  if ratio>=125 then codes:=array_append(codes,'SALES_125');elsif ratio>=110 then codes:=array_append(codes,'SALES_110');elsif ratio>=100 then codes:=array_append(codes,'SALES_TARGET');end if;
 end if;
 if new.void_value>15 then codes:=array_append(codes,'VOID_OVER_15');end if;
 if new.discount_value>15 then codes:=array_append(codes,'DISCOUNT_OVER_15');end if;
 codes:=array_append(codes,'CLOSEOUT_COMPLETE');
 foreach code in array codes loop
  value:=public.closeout_rule_value(rules,code);
  if code='CLOSEOUT_COMPLETE' and new.completion_points_withheld then value:=0;end if;
  summary:=summary||jsonb_build_array(jsonb_build_object('code',code,'points',value,'description',case when code='CLOSEOUT_COMPLETE' and new.completion_points_withheld then 'Completion bonus withheld: inaccurate original closeout' else coalesce((select r->>'reason' from jsonb_array_elements(rules) r where r->>'id'=code),code) end));delta:=delta+value;
 end loop;
 new.points_summary:=summary;new.points_delta:=delta;new.shift_score:=100+delta;
 return new;
end; $$;
revoke all on function public.closeout_validate_and_score() from public,anon,authenticated;
drop trigger if exists zz_closeout_validate_and_score on public.daily_closeouts;
create trigger zz_closeout_validate_and_score before insert or update on public.daily_closeouts for each row execute function public.closeout_validate_and_score();

-- Keep existing transaction IDs so GM adjustments retain their entry keys.
create or replace function public.closeout_sync_scored_points() returns trigger
language plpgsql security definer set search_path='' as $$
declare item jsonb; code text; tx_id public.reward_point_transactions.id%type;
begin
 if new.status<>'submitted' then return new; end if;
 if TG_OP='UPDATE' then
  if new.edit_version=old.edit_version and new.status=old.status then return new;end if;
  if old.status='submitted' then
  insert into public.staff_closeout_edit_audit(closeout_id,location_id,changed_by,reason,before_record,after_record)
  values(new.id,new.location_id,auth.uid(),new.correction_note,to_jsonb(old),to_jsonb(new));
  end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('closeout-points:'||new.id::text,0));
 update public.reward_point_transactions set points=0 where closeout_id=new.id and user_id=new.user_id
  and action_code in ('LATE_30_PLUS','LATE_15_29','LATE_6_14','LATE_1_5','SALES_125','SALES_110','SALES_TARGET','VOID_OVER_15','DISCOUNT_OVER_15','NO_VOIDS','NO_DISCOUNTS','CLOSEOUT_COMPLETE');
 for item in select value from jsonb_array_elements(new.points_summary) loop
  code:=item->>'code';
  select id into tx_id from public.reward_point_transactions where closeout_id=new.id and user_id=new.user_id and action_code=code order by id limit 1;
  if tx_id is null then
   insert into public.reward_point_transactions(organization_id,location_id,user_id,closeout_id,business_date,action_code,description,points)
   values(new.organization_id,new.location_id,new.user_id,new.id,new.closeout_date,code,item->>'description',(item->>'points')::integer)
   returning id into tx_id;
  end if;
  update public.reward_point_transactions set points=(item->>'points')::integer,description=item->>'description' where id=tx_id;
 end loop;
 return new;
end; $$;
revoke all on function public.closeout_sync_scored_points() from public,anon,authenticated;
drop trigger if exists closeout_sync_scored_points on public.daily_closeouts;
create trigger closeout_sync_scored_points after insert or update on public.daily_closeouts for each row execute function public.closeout_sync_scored_points();

-- Old app versions cannot add a second completion/sales award after saving.
create or replace function public.closeout_guard_scored_points() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.closeout_id is not null and new.action_code in ('LATE_30_PLUS','LATE_15_29','LATE_6_14','LATE_1_5','SALES_125','SALES_110','SALES_TARGET','VOID_OVER_15','DISCOUNT_OVER_15','NO_VOIDS','NO_DISCOUNTS','CLOSEOUT_COMPLETE') and pg_trigger_depth()=1 then raise exception 'Closeout points are saved automatically with the form.'; end if;
 return new;
end; $$;
revoke all on function public.closeout_guard_scored_points() from public,anon,authenticated;
drop trigger if exists zz_closeout_guard_scored_points on public.reward_point_transactions;
create trigger zz_closeout_guard_scored_points before insert or update on public.reward_point_transactions for each row execute function public.closeout_guard_scored_points();

create or replace function public.closeout_manager_correct(p_location_id uuid,p_closeout_id uuid,p_version integer,p_values jsonb,p_reason text,p_inaccurate boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.daily_closeouts%rowtype; next_row public.daily_closeouts%rowtype; q jsonb; answer text; updated public.daily_closeouts%rowtype;
begin
 if auth.uid() is null or not public.closeout_is_member(p_location_id) or not public.mod_is_manager(p_location_id) then raise exception 'Manager access required.' using errcode='42501';end if;
 select * into c from public.daily_closeouts where id=p_closeout_id and location_id=p_location_id and deleted_at is null for update;
 if c.id is null or c.status<>'submitted' then raise exception 'Submitted closeout not found.';end if;
 if c.edit_version is distinct from p_version then raise exception 'This closeout changed. Refresh before editing.';end if;
 if coalesce(length(btrim(p_reason)),0) not between 1 and 2000 or jsonb_typeof(p_values) is distinct from 'object' or p_inaccurate is null then raise exception 'Enter correction details and a reason.';end if;
 if exists(select 1 from jsonb_object_keys(p_values) k where k not in ('scheduled_start','clock_in','job_role','shift_type','net_sales','sales_target','cash_deposit','void_count','void_value','discount_value','notes','custom_answers','zero_sales_confirmed','zero_sales_reason')) then raise exception 'Unsupported correction field.';end if;
 next_row:=jsonb_populate_record(c,p_values);
 if next_row.job_role not in ('server','main_bartender','back_bartender_1','back_bar_service_bartender','host','busser','manager','assistant_manager','general_manager') then raise exception 'Choose a valid role.';end if;
 if next_row.shift_type is not null and next_row.shift_type not in ('','AM','PM','TO_VOLUME') then raise exception 'Choose a valid shift.';end if;
 if jsonb_typeof(next_row.custom_answers) is distinct from 'object' then raise exception 'Invalid answers.';end if;
 for q in select value from jsonb_array_elements(c.question_snapshot) loop
  answer:=next_row.custom_answers->>(q->>'id');
  if (q->>'required')::boolean and coalesce(length(btrim(answer)),0)=0 then raise exception 'Answer required: %',q->>'label';end if;
  if answer is not null and answer<>'' and (length(answer)>2000 or jsonb_typeof(next_row.custom_answers->(q->>'id')) is distinct from 'string' or (q->>'type'='yesno' and answer not in ('yes','no')) or (q->>'type'='number' and answer !~ '^-?[0-9]+([.][0-9]+)?$')) then raise exception 'Invalid answer: %',q->>'label';end if;
 end loop;
 update public.daily_closeouts set scheduled_start=next_row.scheduled_start,clock_in=next_row.clock_in,job_role=next_row.job_role,shift_type=next_row.shift_type,
 net_sales=next_row.net_sales,sales_target=next_row.sales_target,cash_deposit=next_row.cash_deposit,void_count=next_row.void_count,void_value=next_row.void_value,discount_value=next_row.discount_value,notes=next_row.notes,custom_answers=next_row.custom_answers,
 zero_sales_confirmed=next_row.zero_sales_confirmed,zero_sales_reason=next_row.zero_sales_reason,completion_points_withheld=c.completion_points_withheld or p_inaccurate,correction_note=btrim(p_reason) where id=c.id returning * into updated;
 return to_jsonb(updated);
end; $$;
revoke all on function public.closeout_manager_correct(uuid,uuid,integer,jsonb,text,boolean) from public,anon,authenticated;
grant execute on function public.closeout_manager_correct(uuid,uuid,integer,jsonb,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;

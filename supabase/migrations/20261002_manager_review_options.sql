begin;
alter table public.mod_closeouts add column if not exists shift_mvp uuid references auth.users(id);
do $$ begin
 if to_regprocedure('public.mod_submit_before_mvp(uuid,jsonb,boolean,numeric,text,boolean,numeric,text,jsonb)') is null then
  alter function public.mod_submit_closeout(uuid,jsonb,boolean,numeric,text,boolean,numeric,text,jsonb) rename to mod_submit_before_mvp;
 end if;
end $$;
revoke all on function public.mod_submit_before_mvp(uuid,jsonb,boolean,numeric,text,boolean,numeric,text,jsonb) from public,anon,authenticated;
create or replace function public.mod_submit_closeout(
 p_shift_id uuid,p_reviews jsonb,p_roster_confirmed boolean,
 p_cash_deposit numeric,p_cash_left_at text,p_register_balanced boolean,
 p_register_difference numeric,p_register_notes text,p_answers jsonb
) returns void language plpgsql security definer set search_path='' as $$
declare loc uuid; mvp uuid; old_mvp uuid;
begin
 select location_id into loc from public.shifts where id=p_shift_id;
 if not public.mod_is_manager(loc) then raise exception 'Manager access required.' using errcode='42501'; end if;
 if jsonb_typeof(p_answers) is distinct from 'object' then raise exception 'Invalid question answers.'; end if;
 if p_answers ? '_shift_mvp' then
  if jsonb_typeof(p_answers->'_shift_mvp') is distinct from 'string' then raise exception 'Invalid Shift MVP.'; end if;
  mvp:=nullif(p_answers->>'_shift_mvp','')::uuid;
  if mvp is not null and (jsonb_typeof(p_reviews) is distinct from 'array'
    or not exists(select 1 from jsonb_array_elements(p_reviews) r where r->>'user_id'=mvp::text)) then
   raise exception 'Shift MVP must be one of the staff reviewed for this shift.';
  end if;
 end if;
 perform public.mod_submit_before_mvp(p_shift_id,p_reviews,p_roster_confirmed,
  p_cash_deposit,p_cash_left_at,p_register_balanced,p_register_difference,p_register_notes,p_answers-'_shift_mvp');
 select shift_mvp into old_mvp from public.mod_closeouts where shift_id=p_shift_id for update;
 if p_answers ? '_shift_mvp' then
  update public.mod_closeouts set shift_mvp=mvp where shift_id=p_shift_id;
  if old_mvp is distinct from mvp then
   insert into public.mod_question_audit(shift_id,changed_by,previous_data,next_data)
   values(p_shift_id,auth.uid(),jsonb_build_object('shift_mvp',old_mvp),jsonb_build_object('shift_mvp',mvp));
  end if;
 elsif old_mvp is not null and not exists(select 1 from jsonb_array_elements(p_reviews) r where r->>'user_id'=old_mvp::text) then
  raise exception 'Include the saved Shift MVP in the staff list, or clear the MVP using the updated form.';
 end if;
end $$;
create or replace function public.closeout_manager_answers(p_shift_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare loc uuid; result jsonb;
begin
 select location_id into loc from public.shifts where id=p_shift_id;
 if not public.mod_is_manager(loc) then raise exception 'Manager access required.' using errcode='42501'; end if;
 select jsonb_build_object('answers',custom_answers,'questions',question_snapshot,'shift_mvp',shift_mvp)
 into result from public.mod_closeouts where shift_id=p_shift_id;
 return result;
end $$;
revoke all on function public.mod_submit_closeout(uuid,jsonb,boolean,numeric,text,boolean,numeric,text,jsonb) from public,anon,authenticated;
grant execute on function public.mod_submit_closeout(uuid,jsonb,boolean,numeric,text,boolean,numeric,text,jsonb) to authenticated;
revoke all on function public.closeout_manager_answers(uuid) from public,anon,authenticated;
grant execute on function public.closeout_manager_answers(uuid) to authenticated;
notify pgrst,'reload schema';
commit;

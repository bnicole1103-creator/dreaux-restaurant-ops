begin;
alter table public.closeout_receipts add column if not exists manager_shift_id uuid references public.shifts(id);
alter table public.closeout_receipts add column if not exists assigned_user_id uuid references public.profiles(id);
alter table public.closeout_receipts add column if not exists assigned_employee_key text;
alter table public.closeout_receipts add column if not exists assigned_employee_name text;
create index if not exists closeout_receipt_assignee on public.closeout_receipts(location_id,assigned_user_id,business_date);

-- Import is automatic and idempotent; two open closeout screens share one receipt.
create or replace function public.closeout_receipt_import_photo(p_location_id uuid,p_photo_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.purchase_receipts%rowtype; r public.closeout_receipts%rowtype;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Location access required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('receipt-wallet:'||p_photo_id::text,0));
 select * into p from public.purchase_receipts where id=p_photo_id and location_id=p_location_id and deleted_at is null for update;
 if not found or (p.user_id<>auth.uid() and public.mod_is_manager(p_location_id) is not true) then raise exception 'Photo access denied.' using errcode='42501';end if;
 select * into r from public.closeout_receipts where source_purchase_id=p.id;
 if found then return to_jsonb(r);end if;
 if p.data->>'source' is distinct from 'photo' or not exists(select 1 from storage.objects where bucket_id='purchase-receipts' and name=p.file_path) then raise exception 'Finish saving this photo first.';end if;
 perform public.closeout_receipt_save(p_location_id,gen_random_uuid(),0,jsonb_build_object('user_id',p.user_id,'business_date',p.purchase_date,'source_purchase_id',p.id),'');
 update public.closeout_receipts set created_at=p.created_at where source_purchase_id=p.id returning * into r;
 return to_jsonb(r);
end;$$;

do $$begin
 if to_regprocedure('public.closeout_receipt_save_before_assignment(uuid,uuid,integer,jsonb,text)') is null then
  alter function public.closeout_receipt_save(uuid,uuid,integer,jsonb,text) rename to closeout_receipt_save_before_assignment;
 end if;
 if to_regprocedure('public.closeout_receipts_load_before_assignment(uuid,date,date,uuid,uuid)') is null then
  alter function public.closeout_receipts_load(uuid,date,date,uuid,uuid) rename to closeout_receipts_load_before_assignment;
 end if;
end;$$;
revoke all on function public.closeout_receipt_save_before_assignment(uuid,uuid,integer,jsonb,text),public.closeout_receipts_load_before_assignment(uuid,date,date,uuid,uuid) from public,anon,authenticated;

create or replace function public.closeout_receipt_save(p_location_id uuid,p_id uuid,p_version integer,p_values jsonb,p_change_note text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved jsonb; result public.closeout_receipts%rowtype; uid uuid; person_name text; person_key text;
begin
 if exists(select 1 from public.closeout_receipts r join public.mod_closeouts m on m.shift_id=r.manager_shift_id where r.id=p_id and r.location_id=p_location_id) then
  if public.mod_is_manager(p_location_id) is not true or length(btrim(p_change_note))<3 then raise exception 'A manager and a correction reason are required for submitted manager receipts.';end if;
 end if;
 -- The original API performs membership, ownership, version and submitted-closeout checks.
 saved:=public.closeout_receipt_save_before_assignment(p_location_id,p_id,p_version,p_values-array['assigned_user_id','assigned_employee_key','assigned_employee_name'],p_change_note);
 if p_values ? 'assigned_employee_key' then
  if public.mod_is_manager(p_location_id) is not true then raise exception 'Only managers may assign receipts.' using errcode='42501';end if;
  uid:=nullif(p_values->>'assigned_user_id','')::uuid;
  person_name:=nullif(btrim(p_values->>'assigned_employee_name'),'');person_key:=nullif(p_values->>'assigned_employee_key','');
  if uid is not null then
   select coalesce(nullif(p.preferred_name,''),p.full_name) into person_name from public.profiles p join public.location_memberships m on m.user_id=p.id where p.id=uid and m.location_id=p_location_id and m.status='active';
   if not found then raise exception 'Choose an active employee at this location.';end if;
   person_key:='app:'||uid::text;
  elsif person_key is not null and (person_key !~ '^unlinked:[0-9a-f-]{36}$' or person_name is null) then raise exception 'Enter the employee name.';
  end if;
  if length(person_name)>200 then raise exception 'Employee name is too long.';end if;
  update public.closeout_receipts set assigned_user_id=uid,assigned_employee_name=person_name,assigned_employee_key=person_key where id=p_id returning * into result;
  insert into public.closeout_receipt_audit(receipt_id,actor_id,before_record,after_record) values(p_id,auth.uid(),saved,to_jsonb(result)||'{"event":"Employee assignment updated"}'::jsonb);
  return to_jsonb(result);
 end if;
 return saved;
end;$$;

do $$begin
 if to_regprocedure('public.receipt_wallet_list_before_closeout_link(uuid,date,date)') is null then
  alter function public.receipt_wallet_list(uuid,date,date) rename to receipt_wallet_list_before_closeout_link;
 end if;
end;$$;
revoke all on function public.receipt_wallet_list_before_closeout_link(uuid,date,date) from public,anon,authenticated;
create or replace function public.receipt_wallet_list(p_location_id uuid,p_start date,p_end date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; rows jsonb;
begin
 result:=public.receipt_wallet_list_before_closeout_link(p_location_id,p_start,p_end);
 select coalesce(jsonb_agg(value||jsonb_build_object('closeout_receipt_id',(select r.id from public.closeout_receipts r where r.source_purchase_id=(value->>'id')::uuid and r.deleted_at is null))),'[]'::jsonb) into rows from jsonb_array_elements(result->'rows');
 return result||jsonb_build_object('rows',rows);
end;$$;
revoke all on function public.receipt_wallet_list(uuid,date,date) from public,anon,authenticated;
grant execute on function public.receipt_wallet_list(uuid,date,date) to authenticated;

-- Assigned receipts appear on the employee profile without transferring the original closeout.
create or replace function public.closeout_receipts_load(p_location_id uuid,p_start date,p_end date,p_user_id uuid default null,p_closeout_key uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; extra jsonb; people jsonb;
begin
 result:=public.closeout_receipts_load_before_assignment(p_location_id,p_start,p_end,p_user_id,p_closeout_key);
 if p_user_id is not null and p_closeout_key is null then
  select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('employee',coalesce(nullif(p.preferred_name,''),p.full_name),'submitted',c.status='submitted','can_edit',false,'points',0,'closeout_deleted',c.deleted_at is not null,'has_file',exists(select 1 from storage.objects o where o.bucket_id=r.origin_bucket and o.name=r.file_path))),'[]'::jsonb)
  into extra from public.closeout_receipts r join public.profiles p on p.id=r.user_id left join public.daily_closeouts c on c.id=r.closeout_key
  where r.location_id=p_location_id and r.assigned_user_id=p_user_id and r.user_id<>p_user_id and r.deleted_at is null and r.business_date between p_start and p_end;
  result:=jsonb_set(result,'{rows}',(result->'rows')||extra);
 end if;
 select coalesce(jsonb_agg(x),'[]'::jsonb) into people from (
  select distinct assigned_employee_key key,assigned_employee_name name from public.closeout_receipts where location_id=p_location_id and deleted_at is null and assigned_user_id is null and assigned_employee_key is not null and (result->>'manager')::boolean
 ) x;
 select coalesce(jsonb_agg(value||case when exists(select 1 from public.mod_closeouts m where m.shift_id=(value->>'manager_shift_id')::uuid) then jsonb_build_object('submitted',true,'can_edit',(result->>'manager')::boolean) else '{}'::jsonb end),'[]'::jsonb) into extra from jsonb_array_elements(result->'rows');
 return result||jsonb_build_object('assignment_people',people,'rows',extra);
end;$$;

-- Allow an assigned employee to see that receipt's original image, subject to location access.
create or replace function public.closeout_receipt_assigned_file(p_bucket text,p_path text)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.closeout_receipts r where r.origin_bucket=p_bucket and r.file_path=p_path and r.deleted_at is null and r.assigned_user_id=auth.uid() and public.closeout_is_member(r.location_id) is true);
$$;
-- Preserve the existing access function; add assigned viewing through read policies.
drop policy if exists closeout_receipt_assigned_read on storage.objects;
create policy closeout_receipt_assigned_read on storage.objects for select to authenticated using(bucket_id='closeout-receipts' and public.closeout_receipt_assigned_file(bucket_id,name));
alter policy closeout_receipt_read_guard on storage.objects using(bucket_id<>'closeout-receipts' or public.closeout_receipt_file_access(name,false) or public.closeout_receipt_assigned_file(bucket_id,name));
-- Purchase originals use a second policy; restrictive guards must also admit the assignee.
drop policy if exists receipt_assigned_purchase_read on storage.objects;
create policy receipt_assigned_purchase_read on storage.objects for select to authenticated using(bucket_id='purchase-receipts' and public.closeout_receipt_assigned_file(bucket_id,name));
alter policy purchase_receipt_read_guard on storage.objects using(bucket_id<>'purchase-receipts' or public.receipt_wallet_file_access(name,false) or public.closeout_receipt_assigned_file(bucket_id,name));

-- Enforce review-or-delete on staff submission, including photos not yet opened in the UI.
create or replace function public.receipt_pending_closeout_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='submitted' and (TG_OP='INSERT' or old.status is distinct from 'submitted') then
  if exists(select 1 from public.purchase_receipts p where p.location_id=new.location_id and p.user_id=new.user_id and p.purchase_date=new.closeout_date and p.deleted_at is null and p.data->>'source'='photo' and exists(select 1 from storage.objects o where o.bucket_id='purchase-receipts' and o.name=p.file_path) and not exists(select 1 from public.closeout_receipts r where r.source_purchase_id=p.id and r.deleted_at is null and (r.added_at is not null or coalesce(r.legacy_linked,false))))
   or exists(select 1 from public.closeout_receipts r where r.location_id=new.location_id and r.user_id=new.user_id and r.business_date=new.closeout_date and r.deleted_at is null and r.added_at is null and not coalesce(r.legacy_linked,false))
  then raise exception 'Review each saved receipt photo and add it to closeout, or delete the duplicate/unneeded photo, before submitting.';end if;
 end if;
 return new;
end;$$;
drop trigger if exists zz_receipt_pending_closeout_guard on public.daily_closeouts;
create trigger zz_receipt_pending_closeout_guard before insert or update on public.daily_closeouts for each row execute function public.receipt_pending_closeout_guard();
revoke all on function public.closeout_receipt_import_photo(uuid,uuid),public.closeout_receipt_save(uuid,uuid,integer,jsonb,text),public.closeout_receipts_load(uuid,date,date,uuid,uuid),public.closeout_receipt_assigned_file(text,text),public.receipt_pending_closeout_guard() from public,anon,authenticated;
grant execute on function public.closeout_receipt_import_photo(uuid,uuid),public.closeout_receipt_save(uuid,uuid,integer,jsonb,text),public.closeout_receipts_load(uuid,date,date,uuid,uuid),public.closeout_receipt_assigned_file(text,text) to authenticated;

create or replace function public.closeout_receipt_add_to_manager(p_location_id uuid,p_id uuid,p_version integer,p_shift_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.closeout_receipts%rowtype; prior jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then raise exception 'Manager access required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('manager-receipts:'||p_shift_id::text,0));
 select * into r from public.closeout_receipts where id=p_id and location_id=p_location_id and deleted_at is null for update;
 if not found or r.version<>p_version or r.closeout_key is not null then raise exception 'Receipt changed or belongs to a staff closeout.';end if;
 if r.added_at is not null then raise exception 'Receipt already added.';end if;
 if exists(select 1 from public.mod_closeouts where shift_id=p_shift_id) then raise exception 'This manager closeout was already submitted.';end if;
 if not exists(select 1 from public.shifts where id=p_shift_id and location_id=p_location_id and shift_date=r.business_date) then raise exception 'Select a shift matching the receipt date.';end if;
 if not r.ready or r.amount is null or r.reason is null or nullif(btrim(r.verifier_name),'') is null or not exists(select 1 from storage.objects where bucket_id=r.origin_bucket and name=r.file_path) then raise exception 'Save the photo, amount, reason and verifier first.';end if;
 prior:=to_jsonb(r);
 update public.closeout_receipts set manager_shift_id=p_shift_id,shift_id=p_shift_id,added_at=clock_timestamp(),added_by=auth.uid(),version=version+1,updated_at=clock_timestamp() where id=p_id returning * into r;
 insert into public.closeout_receipt_audit(receipt_id,actor_id,before_record,after_record) values(p_id,auth.uid(),prior,to_jsonb(r));
 return to_jsonb(r);
end;$$;
revoke all on function public.closeout_receipt_add_to_manager(uuid,uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.closeout_receipt_add_to_manager(uuid,uuid,integer,uuid) to authenticated;
create or replace function public.receipt_pending_manager_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare day date;
begin
 perform pg_advisory_xact_lock(hashtextextended('manager-receipts:'||new.shift_id::text,0));
 select shift_date into day from public.shifts where id=new.shift_id;
 if exists(select 1 from public.closeout_receipts r where r.location_id=new.location_id and r.business_date=day and r.deleted_at is null and r.added_at is null and not coalesce(r.legacy_linked,false) and (r.shift_id=new.shift_id or r.user_id=auth.uid()))
 or exists(select 1 from public.purchase_receipts p where p.location_id=new.location_id and p.user_id=auth.uid() and p.purchase_date=day and p.deleted_at is null and p.data->>'source'='photo' and exists(select 1 from storage.objects where bucket_id='purchase-receipts' and name=p.file_path) and not exists(select 1 from public.closeout_receipts r where r.source_purchase_id=p.id and r.deleted_at is null and r.added_at is not null)) then raise exception 'Review and add or delete each unsubmitted receipt photo before submitting the manager closeout.';end if;
 return new;
end;$$;
drop trigger if exists receipt_pending_manager_guard on public.mod_closeouts;
create trigger receipt_pending_manager_guard before insert on public.mod_closeouts for each row execute function public.receipt_pending_manager_guard();
revoke all on function public.receipt_pending_manager_guard() from public,anon,authenticated;

notify pgrst,'reload schema';
commit;

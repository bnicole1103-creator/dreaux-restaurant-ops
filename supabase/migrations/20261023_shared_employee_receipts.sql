begin;

-- Older captures used the calendar date after midnight. Keep explicit backdates.
create or replace function public.receipt_hub_day(p_date date,p_created timestamptz)
returns date language sql immutable set search_path='' as $$
 select case when p_date=(p_created at time zone 'America/Chicago')::date
 then ((p_created at time zone 'America/Chicago')-interval '4 hours')::date else p_date end;
$$;

-- One source for Home, profiles, staff closeouts, manager closeouts and reports.
create or replace function public.receipt_hub_load(p_location_id uuid,p_start date,p_end date,p_user_id uuid default null,p_closeout_key uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare managed boolean; selected uuid; owner uuid; entries jsonb; photos jsonb; people jsonb; title text;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active location access required.' using errcode='42501';end if;
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>366 then raise exception 'Choose a date range of up to one year.';end if;
 managed:=public.mod_is_manager(p_location_id) is true;
 selected:=p_user_id;
 if p_closeout_key is not null then
  select user_id into owner from public.daily_closeouts where id=p_closeout_key and location_id=p_location_id;
  selected:=coalesce(owner,p_user_id,auth.uid());
  if p_user_id is not null and selected<>p_user_id then raise exception 'Receipt and closeout employee must match.';end if;
 end if;
 if not managed then
  if selected is not null and selected<>auth.uid() then raise exception 'Only your receipt wallet is available.' using errcode='42501';end if;
  selected:=auth.uid();
 end if;
 select coalesce(jsonb_agg(x.item order by x.service_day desc,x.created desc),'[]'::jsonb) into entries from (
  select to_jsonb(r)||jsonb_build_object(
   'business_date',case when c.id is null and m.shift_id is null and p.id is not null then public.receipt_hub_day(p.purchase_date,p.created_at) else r.business_date end,
   'employee',coalesce(nullif(person.preferred_name,''),nullif(person.full_name,''),'Team member'),
   'submitted',coalesce(c.status='submitted',false) or m.shift_id is not null,
   'can_edit',managed or (r.user_id=auth.uid() and c.id is null and m.shift_id is null),
   'attachable',c.id is null and r.manager_shift_id is null and r.user_id=coalesce(selected,auth.uid()),
   'closeout_deleted',c.deleted_at is not null,
   'points',case when c.status='submitted' and c.deleted_at is null and c.receipt_reason_policy and coalesce((to_jsonb(c)->>'operations_points_apply')::boolean,true) and r.ready and r.reason in ('server_error','spill_waste_server_error') then -5 else 0 end,
   'has_file',exists(select 1 from storage.objects o where o.bucket_id=r.origin_bucket and o.name=r.file_path)
  ) item,
  case when c.id is null and m.shift_id is null and p.id is not null then public.receipt_hub_day(p.purchase_date,p.created_at) else r.business_date end as service_day,r.created_at as created
  from public.closeout_receipts r
  join public.profiles person on person.id=r.user_id
  left join public.purchase_receipts p on p.id=r.source_purchase_id
  left join public.daily_closeouts c on c.id=r.closeout_key
  left join public.mod_closeouts m on m.shift_id=r.manager_shift_id
  where r.location_id=p_location_id and r.deleted_at is null
   and (managed or r.user_id=auth.uid() or r.assigned_user_id=auth.uid())
   and (selected is null or r.user_id=selected or r.assigned_user_id=selected)
 ) x where x.service_day between p_start and p_end;
 select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object(
  'purchase_date',public.receipt_hub_day(p.purchase_date,p.created_at),
  'employee',coalesce(nullif(person.preferred_name,''),nullif(person.full_name,''),'Team member'),
  'origin_bucket','purchase-receipts',
  'has_file',exists(select 1 from storage.objects o where o.bucket_id='purchase-receipts' and o.name=p.file_path)
 ) order by p.created_at desc),'[]'::jsonb) into photos
 from public.purchase_receipts p join public.profiles person on person.id=p.user_id
 where p.location_id=p_location_id and p.deleted_at is null and p.file_path is not null
 and (managed or p.user_id=auth.uid()) and (selected is null or p.user_id=selected)
 and public.receipt_hub_day(p.purchase_date,p.created_at) between p_start and p_end
 and not exists(select 1 from public.closeout_receipts r where r.source_purchase_id=p.id and r.deleted_at is null);
 select coalesce(jsonb_agg(x),'[]'::jsonb) into people from (
  select distinct assigned_employee_key key,assigned_employee_name name from public.closeout_receipts
  where location_id=p_location_id and deleted_at is null and assigned_user_id is null and assigned_employee_key is not null and managed
 ) x;
 select coalesce(nullif(preferred_name,''),full_name) into title from public.profiles where id=selected;
 return jsonb_build_object('rows',entries,'photos',photos,'manager',managed,'employee_name',coalesce(title,'All employees'),'assignment_people',people,
 'closeouts',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'user_id',c.user_id,'closeout_date',c.closeout_date,'shift_type',c.shift_type,'void_count',c.void_count,'void_value',c.void_value,'discount_value',c.discount_value)),'[]'::jsonb) from public.daily_closeouts c where c.location_id=p_location_id and c.deleted_at is null and c.status='submitted' and c.closeout_date between p_start and p_end and (managed or c.user_id=auth.uid()) and (selected is null or c.user_id=selected)));
end;$$;

-- Keep existing callers on the same loader; bypass the historical wrapper chain.
create or replace function public.closeout_receipts_load(p_location_id uuid,p_start date,p_end date,p_user_id uuid default null,p_closeout_key uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
 select public.receipt_hub_load(p_location_id,p_start,p_end,p_user_id,p_closeout_key);
$$;

-- Review transparently opens a photo; staff never have to import it manually.
create or replace function public.receipt_hub_import(p_location_id uuid,p_photo_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare photo public.purchase_receipts%rowtype; receipt public.closeout_receipts%rowtype; day date; before_photo jsonb; before_receipt jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active location access required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('receipt-wallet:'||p_photo_id::text,0));
 select * into photo from public.purchase_receipts where id=p_photo_id and location_id=p_location_id and deleted_at is null for update;
 if not found or (photo.user_id<>auth.uid() and public.mod_is_manager(p_location_id) is not true) then raise exception 'Photo access denied.' using errcode='42501';end if;
 if not exists(select 1 from storage.objects where bucket_id='purchase-receipts' and name=photo.file_path) then raise exception 'This photo upload is incomplete. Delete this entry or retry its upload.';end if;
 if photo.file_mime is null then
  update public.purchase_receipts p set file_mime=(select metadata->>'mimetype' from storage.objects where bucket_id='purchase-receipts' and name=p.file_path),version=version+1,updated_at=clock_timestamp() where p.id=photo.id returning * into photo;
  if photo.file_mime is null then raise exception 'This saved photo has no confirmed file type. Delete it and retake the photo.';end if;
 end if;

 select * into receipt from public.closeout_receipts where source_purchase_id=photo.id for update;
 if receipt.id is not null and receipt.deleted_at is not null then raise exception 'This photo belongs to a removed receipt. Delete the remaining photo entry from this wallet.';end if;
 if receipt.id is not null and (exists(select 1 from public.daily_closeouts where id=receipt.closeout_key) or exists(select 1 from public.mod_closeouts where shift_id=receipt.manager_shift_id)) then return to_jsonb(receipt);end if;
 day:=public.receipt_hub_day(photo.purchase_date,photo.created_at);
 if photo.purchase_date is distinct from day or photo.data->>'source' is distinct from 'photo' then
  before_photo:=to_jsonb(photo);
  update public.purchase_receipts set purchase_date=day,data=jsonb_set(jsonb_set(data,'{purchase_date}',to_jsonb(day)),'{source}','"photo"'::jsonb),version=version+1,updated_at=clock_timestamp() where id=photo.id returning * into photo;
  insert into public.purchase_receipt_events(receipt_id,actor_id,kind,details) values(photo.id,auth.uid(),'service_date_aligned',jsonb_build_object('before',before_photo,'after',to_jsonb(photo)));
 end if;
 if receipt.id is null then
  perform public.closeout_receipt_save(p_location_id,gen_random_uuid(),0,jsonb_build_object('user_id',photo.user_id,'business_date',day,'source_purchase_id',photo.id),'');
  update public.closeout_receipts set created_at=photo.created_at where source_purchase_id=photo.id returning * into receipt;
 elsif receipt.business_date is distinct from day then
  before_receipt:=to_jsonb(receipt);
  update public.closeout_receipts set business_date=day,shift_id=null,closeout_key=null,added_at=null,added_by=null,legacy_linked=false,version=version+1,updated_at=clock_timestamp() where id=receipt.id returning * into receipt;
  insert into public.closeout_receipt_audit(receipt_id,actor_id,before_record,after_record) values(receipt.id,auth.uid(),before_receipt,to_jsonb(receipt)||'{"event":"Unsaved receipt aligned with photo service date"}'::jsonb);
 end if;
 return to_jsonb(receipt);
end;$$;

-- Saved standalone receipts attach automatically; unreviewed photos still block.
create or replace function public.receipt_hub_finalize() returns trigger
language plpgsql security definer set search_path='' as $$
declare owner uuid; day date; key uuid; manager_mode boolean; receipt public.closeout_receipts%rowtype; after_row public.closeout_receipts%rowtype;
begin
 manager_mode:=TG_TABLE_NAME='mod_closeouts';
 if manager_mode then
  owner:=new.submitted_by;key:=new.shift_id;
  if TG_OP='UPDATE' then return new;end if;
  select shift_date into day from public.shifts where id=key and location_id=new.location_id;
 else
  if new.status<>'submitted' then return new;end if;
  if TG_OP='UPDATE' and old.status='submitted' then return new;end if;
  owner:=new.user_id;key:=new.id;day:=new.closeout_date;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('receipt-hub:'||new.location_id::text||owner::text||day::text,0));
 if exists(select 1 from public.purchase_receipts p where p.location_id=new.location_id and p.deleted_at is null and p.user_id=owner and p.file_path is not null and public.receipt_hub_day(p.purchase_date,p.created_at)=day and not exists(select 1 from public.closeout_receipts r where r.source_purchase_id=p.id and r.deleted_at is null and (r.added_at is not null or coalesce(r.legacy_linked,false) or (r.ready and nullif(btrim(r.verifier_name),'') is not null and r.details_saved_at is not null)))) then raise exception 'Review and save or delete every receipt photo for this date before submitting.';end if;
 if exists(select 1 from public.closeout_receipts r where r.location_id=new.location_id and r.deleted_at is null and (r.user_id=owner or (manager_mode and r.shift_id=key)) and r.business_date=day and r.added_at is null and not coalesce(r.legacy_linked,false) and (not r.ready or r.details_saved_at is null or nullif(btrim(r.verifier_name),'') is null or not exists(select 1 from storage.objects o where o.bucket_id=r.origin_bucket and o.name=r.file_path))) then raise exception 'Review and save or delete every receipt photo for this date before submitting.';end if;
 for receipt in select r.* from public.closeout_receipts r where r.location_id=new.location_id and r.deleted_at is null and r.business_date=day and r.user_id=owner and r.ready and r.details_saved_at is not null and nullif(btrim(r.verifier_name),'') is not null and not exists(select 1 from public.daily_closeouts c where c.id=r.closeout_key) and not exists(select 1 from public.mod_closeouts m where m.shift_id=r.manager_shift_id) and (r.manager_shift_id is null or (manager_mode and r.manager_shift_id=key)) and exists(select 1 from storage.objects o where o.bucket_id=r.origin_bucket and o.name=r.file_path) for update loop
  update public.closeout_receipts set closeout_key=case when manager_mode then null else key end,manager_shift_id=case when manager_mode then key else null end,added_at=coalesce(added_at,clock_timestamp()),added_by=coalesce(added_by,auth.uid()),legacy_linked=false,version=version+1,updated_at=clock_timestamp() where id=receipt.id returning * into after_row;
  insert into public.closeout_receipt_audit(receipt_id,actor_id,before_record,after_record) values(receipt.id,auth.uid(),to_jsonb(receipt),to_jsonb(after_row)||'{"event":"Reviewed wallet receipt attached on closeout submission"}'::jsonb);
 end loop;
 return new;
end;$$;
drop trigger if exists a_receipt_hub_finalize on public.daily_closeouts;
create trigger a_receipt_hub_finalize before insert or update on public.daily_closeouts for each row execute function public.receipt_hub_finalize();
drop trigger if exists a_receipt_hub_finalize on public.mod_closeouts;
create trigger a_receipt_hub_finalize before insert on public.mod_closeouts for each row execute function public.receipt_hub_finalize();

revoke all on function public.receipt_hub_day(date,timestamptz),public.receipt_hub_load(uuid,date,date,uuid,uuid),public.closeout_receipts_load(uuid,date,date,uuid,uuid),public.receipt_hub_import(uuid,uuid),public.receipt_hub_finalize() from public,anon,authenticated;
grant execute on function public.receipt_hub_load(uuid,date,date,uuid,uuid),public.closeout_receipts_load(uuid,date,date,uuid,uuid),public.receipt_hub_import(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;

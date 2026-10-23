begin;
alter table public.closeout_receipts add column if not exists responsibility_response text check (responsibility_response in ('accepted','declined'));
alter table public.closeout_receipts add column if not exists responsibility_responded_at timestamptz;
alter table public.closeout_receipts add column if not exists responsibility_override text check (responsibility_override in ('accepted','declined'));
alter table public.closeout_receipts add column if not exists responsibility_override_reason text;
alter table public.closeout_receipts add column if not exists responsibility_overridden_by uuid references public.profiles(id);
alter table public.closeout_receipts add column if not exists responsibility_overridden_at timestamptz;

create or replace function public.receipt_is_submitted(p_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.closeout_receipts r
 left join public.daily_closeouts c on c.id=r.closeout_key
 left join public.mod_closeouts m on m.shift_id=r.manager_shift_id
 where r.id=p_id and ((c.status='submitted' and c.deleted_at is null) or m.shift_id is not null));
$$;

-- A tag grants access to this receipt only, never to the sender's wallet.
create or replace function public.receipt_responsibility_requests(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active location access required.' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('employee',coalesce(nullif(p.preferred_name,''),p.full_name),'submitted',public.receipt_is_submitted(r.id),'can_edit',false,'points',0,'closeout_deleted',false) order by r.created_at desc),'[]'::jsonb)
 from public.closeout_receipts r join public.profiles p on p.id=r.user_id
 where r.location_id=p_location_id and r.deleted_at is null and r.assigned_user_id=auth.uid());
end;$$;

create or replace function public.receipt_access_load(p_location_id uuid,p_start date,p_end date,p_user_id uuid default null,p_closeout_key uuid default null,p_submissions boolean default false)
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
 if not p_submissions or not managed then
  if selected is not null and selected<>auth.uid() then raise exception 'Only your receipt wallet is available.' using errcode='42501';end if;
  selected:=auth.uid();
 end if;
 select coalesce(jsonb_agg(x.item order by x.service_day desc,x.created desc),'[]'::jsonb) into entries from (
  select to_jsonb(r)||jsonb_build_object(
   'business_date',case when c.id is null and m.shift_id is null and p.id is not null then public.receipt_hub_day(p.purchase_date,p.created_at) else r.business_date end,
   'employee',coalesce(nullif(person.preferred_name,''),nullif(person.full_name,''),'Team member'),
   'submitted',coalesce(c.status='submitted',false) or m.shift_id is not null,
   'can_edit',(managed and p_submissions) or (r.user_id=auth.uid() and c.id is null and m.shift_id is null),
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
   and (r.user_id=auth.uid() or (managed and p_submissions))
   and (not p_submissions or ((c.status='submitted' and c.deleted_at is null) or m.shift_id is not null))
   and (selected is null or r.user_id=selected)
   and (not p_submissions or p_closeout_key is null or r.closeout_key=p_closeout_key)
 ) x where x.service_day between p_start and p_end or (x.item->>'submitted')::boolean is not true;
 select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object(
  'purchase_date',public.receipt_hub_day(p.purchase_date,p.created_at),
  'employee',coalesce(nullif(person.preferred_name,''),nullif(person.full_name,''),'Team member'),
  'origin_bucket','purchase-receipts',
  'has_file',exists(select 1 from storage.objects o where o.bucket_id='purchase-receipts' and o.name=p.file_path)
 ) order by p.created_at desc),'[]'::jsonb) into photos
 from public.purchase_receipts p join public.profiles person on person.id=p.user_id
 where p.location_id=p_location_id and p.deleted_at is null and p.file_path is not null
 and not p_submissions and p.user_id=auth.uid() and (selected is null or p.user_id=selected)

 -- Unsubmitted source photos remain visible regardless of the selected dates.
 and not exists(select 1 from public.closeout_receipts r where r.source_purchase_id=p.id and r.deleted_at is null);
 select coalesce(jsonb_agg(x),'[]'::jsonb) into people from (
  select distinct assigned_employee_key key,assigned_employee_name name from public.closeout_receipts
  where location_id=p_location_id and deleted_at is null and assigned_user_id is null and assigned_employee_key is not null and false
 ) x;
 select coalesce(nullif(preferred_name,''),full_name) into title from public.profiles where id=selected;
 return jsonb_build_object('rows',entries,'photos',photos,'manager',managed,'employee_name',coalesce(title,'All employees'),'assignment_people',people,'tag_people',(select coalesce(jsonb_agg(jsonb_build_object('user_id',u.id,'name',coalesce(nullif(u.preferred_name,''),u.full_name)) order by coalesce(nullif(u.preferred_name,''),u.full_name)),'[]'::jsonb) from public.location_memberships lm join public.profiles u on u.id=lm.user_id where lm.location_id=p_location_id and lm.status='active'),'requests',case when p_submissions then '[]'::jsonb else public.receipt_responsibility_requests(p_location_id) end,
 'closeouts',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'user_id',c.user_id,'closeout_date',c.closeout_date,'shift_type',c.shift_type,'void_count',c.void_count,'void_value',c.void_value,'discount_value',c.discount_value)),'[]'::jsonb) from public.daily_closeouts c where c.location_id=p_location_id and c.deleted_at is null and c.status='submitted' and c.closeout_date between p_start and p_end and (managed or c.user_id=auth.uid()) and (selected is null or c.user_id=selected)));
end;$$;


create or replace function public.receipt_hub_load(p_location_id uuid,p_start date,p_end date,p_user_id uuid default null,p_closeout_key uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
 select public.receipt_access_load(p_location_id,p_start,p_end,p_user_id,p_closeout_key,false);
$$;
create or replace function public.receipt_submissions_load(p_location_id uuid,p_start date,p_end date,p_user_id uuid default null,p_closeout_key uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
 select public.receipt_access_load(p_location_id,p_start,p_end,p_user_id,p_closeout_key,true);
$$;
-- Historical report callers now receive submitted records only.
create or replace function public.closeout_receipts_load(p_location_id uuid,p_start date,p_end date,p_user_id uuid default null,p_closeout_key uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
 select public.receipt_submissions_load(p_location_id,p_start,p_end,p_user_id,p_closeout_key);
$$;

-- Guard all older mutation APIs too, including imports and removals.
create or replace function public.receipt_private_write_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then return new;end if;
 if public.closeout_is_member(new.location_id) is not true then raise exception 'Active location access required.' using errcode='42501';end if;
 if TG_OP='INSERT' then
  if new.user_id<>auth.uid() then raise exception 'Capture receipts in your own wallet.' using errcode='42501';end if;
 elsif old.user_id<>auth.uid() then
  if TG_TABLE_NAME='closeout_receipts' then
   if public.mod_is_manager(old.location_id) is true and public.receipt_is_submitted(old.id) then return new;end if;
   if old.assigned_user_id=auth.uid() and
      (to_jsonb(new)-array['responsibility_response','responsibility_responded_at','version','updated_at'])=
      (to_jsonb(old)-array['responsibility_response','responsibility_responded_at','version','updated_at']) then return new;end if;
  end if;
  raise exception 'Private wallets are visible only to their owner. Management may review submitted receipts.' using errcode='42501';
 end if;
 return new;
end;$$;
drop trigger if exists receipt_private_write on public.closeout_receipts;
create trigger receipt_private_write before insert or update on public.closeout_receipts for each row execute function public.receipt_private_write_guard();
drop trigger if exists receipt_private_write on public.purchase_receipts;
create trigger receipt_private_write before insert or update on public.purchase_receipts for each row execute function public.receipt_private_write_guard();

-- Retain existing detail, closeout, verifier and audit validation.
do $$begin
 if to_regprocedure('public.closeout_receipt_save_before_responsibility(uuid,uuid,integer,jsonb,text)') is null then
  alter function public.closeout_receipt_save(uuid,uuid,integer,jsonb,text) rename to closeout_receipt_save_before_responsibility;
 end if;
end;$$;
revoke all on function public.closeout_receipt_save_before_responsibility(uuid,uuid,integer,jsonb,text) from public,anon,authenticated;
create or replace function public.closeout_receipt_save(p_location_id uuid,p_id uuid,p_version integer,p_values jsonb,p_change_note text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved jsonb; prior public.closeout_receipts%rowtype; result public.closeout_receipts%rowtype; target uuid; title text;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active location access required.' using errcode='42501';end if;
 select * into prior from public.closeout_receipts where id=p_id and location_id=p_location_id for update;
 if prior.id is not null and prior.user_id<>auth.uid() and not (public.mod_is_manager(p_location_id) is true and public.receipt_is_submitted(p_id)) then raise exception 'Receipt access denied.' using errcode='42501';end if;
 if prior.id is null and coalesce((p_values->>'user_id')::uuid,auth.uid())<>auth.uid() then raise exception 'Capture receipts in your own wallet.' using errcode='42501';end if;
 saved:=public.closeout_receipt_save_before_responsibility(p_location_id,p_id,p_version,p_values-array['assigned_user_id','assigned_employee_key','assigned_employee_name'],p_change_note);
 if p_values ? 'assigned_user_id' then
  target:=nullif(p_values->>'assigned_user_id','')::uuid;
  if target is distinct from prior.assigned_user_id or (target is not null and not public.receipt_is_submitted(p_id) and (saved->'amount',saved->'reason',saved->'kind',saved->'check_number',saved->'notes') is distinct from (to_jsonb(prior)->'amount',to_jsonb(prior)->'reason',to_jsonb(prior)->'kind',to_jsonb(prior)->'check_number',to_jsonb(prior)->'notes')) then
   if public.receipt_is_submitted(p_id) then raise exception 'Responsibility tags cannot change after submission. Management may override the response.';end if;
   if target is not null then
    select coalesce(nullif(p.preferred_name,''),p.full_name) into title from public.profiles p join public.location_memberships m on m.user_id=p.id where p.id=target and m.location_id=p_location_id and m.status='active';
    if not found then raise exception 'Choose an active user at this location.';end if;
   end if;
   update public.closeout_receipts set assigned_user_id=target,assigned_employee_key=case when target is not null then 'app:'||target::text end,assigned_employee_name=title,
    responsibility_response=null,responsibility_responded_at=null,responsibility_override=null,responsibility_override_reason=null,responsibility_overridden_by=null,responsibility_overridden_at=null where id=p_id;
  end if;
 end if;
 select * into result from public.closeout_receipts where id=p_id;
 if to_jsonb(result) is distinct from saved then
  insert into public.closeout_receipt_audit(receipt_id,actor_id,before_record,after_record) values(p_id,auth.uid(),saved,to_jsonb(result)||jsonb_build_object('event','Responsibility requested; acceptance required'));
 end if;
 return to_jsonb(result);
end;$$;

create or replace function public.receipt_responsibility_respond(p_location_id uuid,p_id uuid,p_version integer,p_decision text,p_override boolean default false,p_reason text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.closeout_receipts%rowtype; result public.closeout_receipts%rowtype;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active location access required.' using errcode='42501';end if;
 if p_decision is null or p_decision not in ('accepted','declined') then raise exception 'Choose Accept or Decline.';end if;
 select * into r from public.closeout_receipts where id=p_id and location_id=p_location_id and deleted_at is null for update;
 if not found or r.assigned_user_id is null then raise exception 'Responsibility request unavailable.';end if;
 if r.version is distinct from p_version then raise exception 'Receipt changed. Refresh before responding.';end if;
 if p_override then
  if public.mod_is_manager(p_location_id) is not true or not public.receipt_is_submitted(p_id) then raise exception 'Management can override submitted receipts only.' using errcode='42501';end if;
  if length(btrim(coalesce(p_reason,'')))<3 or length(p_reason)>2000 then raise exception 'Enter an override reason (3–2000 characters).';end if;
  update public.closeout_receipts set responsibility_override=p_decision,responsibility_override_reason=btrim(p_reason),responsibility_overridden_by=auth.uid(),responsibility_overridden_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() where id=p_id returning * into result;
 else
  if r.assigned_user_id<>auth.uid() then raise exception 'Only the tagged user can respond.' using errcode='42501';end if;
  if r.responsibility_response is not null or r.responsibility_override is not null then raise exception 'Request already decided. Management must override a decision.';end if;
  update public.closeout_receipts set responsibility_response=p_decision,responsibility_responded_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() where id=p_id returning * into result;
 end if;
 insert into public.closeout_receipt_audit(receipt_id,actor_id,before_record,after_record) values(p_id,auth.uid(),to_jsonb(r),to_jsonb(result)||jsonb_build_object('event',case when p_override then 'Management responsibility override' else 'Tagged user response' end));
 return to_jsonb(result);
end;$$;

-- Signed photo URLs use the same owner / tagged receipt / submitted rules.
create or replace function public.closeout_receipt_file_access(p_path text,p_upload boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.closeout_receipts r where r.file_path=p_path and r.deleted_at is null and public.closeout_is_member(r.location_id) is true and
 case when p_upload then r.user_id=auth.uid() and r.created_by=auth.uid() and not r.ready and r.origin_bucket='closeout-receipts'
 else r.user_id=auth.uid() or r.assigned_user_id=auth.uid() or (public.mod_is_manager(r.location_id) is true and public.receipt_is_submitted(r.id)) end);
$$;
create or replace function public.closeout_receipt_assigned_file(p_bucket text,p_path text)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.closeout_receipts r where r.origin_bucket=p_bucket and r.file_path=p_path and r.deleted_at is null and public.closeout_is_member(r.location_id) is true and (r.user_id=auth.uid() or r.assigned_user_id=auth.uid() or (public.mod_is_manager(r.location_id) is true and public.receipt_is_submitted(r.id))));
$$;
create or replace function public.receipt_wallet_file_access(p_path text,p_upload boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.purchase_receipts r where r.file_path=p_path and r.deleted_at is null and public.closeout_is_member(r.location_id) is true and r.user_id=auth.uid() and (not p_upload or r.status='draft'));
$$;
-- Legacy purchase wallet list is owner-only, even for managers.
create or replace function public.receipt_wallet_list(p_location_id uuid,p_start date,p_end date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare managed boolean;result jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active location access required.' using errcode='42501';end if;
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>366 then raise exception 'Choose a date range of at most one year.';end if;
 managed:=public.mod_is_manager(p_location_id) is true;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.purchase_date desc,x.created_at desc),'[]'::jsonb) into result from (
  select r.*,coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''),'Purchaser') employee,
  coalesce(nullif(reviewer.preferred_name,''),nullif(reviewer.full_name,'')) reviewer,
  exists(select 1 from storage.objects o where o.bucket_id='purchase-receipts' and o.name=r.file_path) has_file
  from public.purchase_receipts r join public.profiles p on p.id=r.user_id left join public.profiles reviewer on reviewer.id=r.reviewed_by
  where r.location_id=p_location_id and r.user_id=auth.uid() and r.deleted_at is null and r.purchase_date between p_start and p_end
  order by r.purchase_date desc,r.created_at desc limit 201
 ) x;
 return jsonb_build_object('manager',managed,'user_id',auth.uid(),'rows',result);
end;$$;

create or replace function public.receipt_hub_import(p_location_id uuid,p_photo_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare photo public.purchase_receipts%rowtype; receipt public.closeout_receipts%rowtype; day date; before_photo jsonb; before_receipt jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active location access required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('receipt-wallet:'||p_photo_id::text,0));
 select * into photo from public.purchase_receipts where id=p_photo_id and location_id=p_location_id and deleted_at is null for update;
 if not found or photo.user_id<>auth.uid() then raise exception 'Photo access denied.' using errcode='42501';end if;
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

create or replace function public.closeout_receipt_import_photo(p_location_id uuid,p_photo_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.purchase_receipts%rowtype; r public.closeout_receipts%rowtype;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Location access required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('receipt-wallet:'||p_photo_id::text,0));
 select * into p from public.purchase_receipts where id=p_photo_id and location_id=p_location_id and deleted_at is null for update;
 if not found or p.user_id<>auth.uid() then raise exception 'Photo access denied.' using errcode='42501';end if;
 select * into r from public.closeout_receipts where source_purchase_id=p.id;
 if found then return to_jsonb(r);end if;
 if p.data->>'source' is distinct from 'photo' or not exists(select 1 from storage.objects where bucket_id='purchase-receipts' and name=p.file_path) then raise exception 'Finish saving this photo first.';end if;
 perform public.closeout_receipt_save(p_location_id,gen_random_uuid(),0,jsonb_build_object('user_id',p.user_id,'business_date',p.purchase_date,'source_purchase_id',p.id),'');
 update public.closeout_receipts set created_at=p.created_at where source_purchase_id=p.id returning * into r;
 return to_jsonb(r);
end;$$;


do $$begin
 if to_regprocedure('public.receipt_wallet_attach_before_privacy(uuid,uuid)') is null then
  alter function public.receipt_wallet_attach(uuid,uuid) rename to receipt_wallet_attach_before_privacy;
 end if;
end;$$;
create or replace function public.receipt_wallet_attach(p_location_id uuid,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.purchase_receipts where id=p_id and location_id=p_location_id and user_id=auth.uid() and deleted_at is null) then raise exception 'Receipt access denied.' using errcode='42501';end if;
 return public.receipt_wallet_attach_before_privacy(p_location_id,p_id);
end;$$;
revoke all on function public.receipt_wallet_attach(uuid,uuid) from public,anon,authenticated;
grant execute on function public.receipt_wallet_attach(uuid,uuid) to authenticated;

-- Close early-return paths in historical attachment/removal RPCs.
create or replace function public.closeout_receipt_add(p_location_id uuid,p_id uuid,p_version integer,p_closeout_key uuid,p_change_note text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.closeout_receipts%rowtype; result public.closeout_receipts%rowtype; saved jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Location access required.' using errcode='42501';end if;
 select * into r from public.closeout_receipts where id=p_id and location_id=p_location_id and deleted_at is null;
 if r.id is null or r.user_id<>auth.uid() then raise exception 'Receipt access denied.' using errcode='42501';end if;
 if p_closeout_key is null then raise exception 'Open or select a closeout before adding this receipt.';end if;
 if r.closeout_key is not null and r.closeout_key<>p_closeout_key then raise exception 'A receipt already belongs to another closeout.';end if;
 perform pg_advisory_xact_lock(hashtextextended('closeout-submit:'||r.user_id::text||p_closeout_key::text,0));
 select * into r from public.closeout_receipts where id=p_id for update;
 if r.deleted_at is not null then raise exception 'Receipt is no longer available.';end if;
 if (r.added_at is not null or coalesce(r.legacy_linked,false)) and r.closeout_key=p_closeout_key then return to_jsonb(r);end if;
 if r.version is distinct from p_version then raise exception 'Receipt changed. Reopen the wallet.';end if;
 if not r.ready or r.amount is null or r.reason is null or nullif(btrim(r.verifier_name),'') is null then raise exception 'Save the amount, reason and verifier before adding to closeout.';end if;
 saved:=public.closeout_receipt_save_before_wallet_flow(p_location_id,p_id,p_version,jsonb_build_object('closeout_key',p_closeout_key,'ready',true),p_change_note);
 update public.closeout_receipts set added_at=clock_timestamp(),added_by=auth.uid(),legacy_linked=false where id=p_id returning * into result;
 insert into public.closeout_receipt_audit(receipt_id,actor_id,before_record,after_record)
 values(p_id,auth.uid(),saved,to_jsonb(result)||'{"event":"Receipt added to closeout"}'::jsonb);
 return to_jsonb(result);
end;$$;
create or replace function public.closeout_receipt_add_to_manager(p_location_id uuid,p_id uuid,p_version integer,p_shift_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.closeout_receipts%rowtype; prior jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then raise exception 'Manager access required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('manager-receipts:'||p_shift_id::text,0));
 select * into r from public.closeout_receipts where id=p_id and location_id=p_location_id and deleted_at is null and user_id=auth.uid() for update;
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
create or replace function public.receipt_wallet_remove(p_location_id uuid,p_id uuid,p_version integer,p_change_note text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.purchase_receipts%rowtype; linked public.closeout_receipts%rowtype; result public.purchase_receipts%rowtype;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active location access required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('receipt-wallet:'||p_id::text,0));
 select * into r from public.purchase_receipts where id=p_id and location_id=p_location_id for update;
 if not found or r.user_id<>auth.uid() then raise exception 'Receipt access denied.' using errcode='42501';end if;
 if r.data->>'source' is distinct from 'photo' then raise exception 'Choose a photo entry.';end if;
 if r.deleted_at is not null then return to_jsonb(r);end if;
 if r.version is distinct from p_version then raise exception 'This receipt changed. Refresh the wallet before removing it.';end if;
 if length(coalesce(p_change_note,''))>2000 then raise exception 'Keep the removal note within 2,000 characters.';end if;
 select * into linked from public.closeout_receipts where source_purchase_id=r.id and deleted_at is null;
 if found then
  -- Retain the established manager checks, correction reason, audit and scoring.
  perform public.closeout_receipt_save(p_location_id,linked.id,linked.version,'{"remove":true}'::jsonb,coalesce(p_change_note,''));
 end if;
 update public.purchase_receipts set deleted_at=clock_timestamp(),deleted_by=auth.uid(),version=version+1,updated_at=clock_timestamp() where id=p_id returning * into result;
 insert into public.purchase_receipt_events(receipt_id,actor_id,kind,details)
 values(p_id,auth.uid(),'removed',jsonb_build_object('before',to_jsonb(r),'after',to_jsonb(result),'reason',p_change_note));
 return to_jsonb(result);
end;$$;


-- Private purchase records and cached scans are owner-only on every RPC path.
create or replace function public.receipt_wallet_save(p_location_id uuid,p_id uuid,p_version integer,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.purchase_receipts%rowtype;r public.purchase_receipts%rowtype;d jsonb;item jsonb;
 vendor text;source text;day date;amount numeric;tax numeric;tip numeric;subtotal numeric:=0;qty numeric;price numeric;items jsonb;file text;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active location access required.' using errcode='42501';end if;
 if p_id is null or p_version is null or p_version<0 or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Complete the receipt details.';end if;
 if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('vendor','purchase_date','source','category','payment','reimburse','notes','items','tax','tip','total')) then raise exception 'Unsupported receipt field.';end if;
 vendor:=btrim(coalesce(p_data->>'vendor',''));source:=p_data->>'source';day:=(p_data->>'purchase_date')::date;
 if source is null or source not in ('photo','manual') or day is null or day>(now() at time zone 'America/Chicago')::date then raise exception 'Choose a receipt type and a valid purchase date.';end if;
 if length(vendor)>200 or length(coalesce(p_data->>'category',''))>100 or length(coalesce(p_data->>'payment',''))>100 or length(coalesce(p_data->>'notes',''))>4000 then raise exception 'Receipt text is too long.';end if;
 if p_data ? 'reimburse' and jsonb_typeof(p_data->'reimburse') is distinct from 'boolean' then raise exception 'Choose whether reimbursement is needed.';end if;
 items:=coalesce(p_data->'items','[]'::jsonb);
 if jsonb_typeof(items) is distinct from 'array' then raise exception 'Invalid receipt items.';end if;
 if jsonb_array_length(items)>100 then raise exception 'Use at most 100 line items.';end if;
 for item in select value from jsonb_array_elements(items) loop
  if jsonb_typeof(item) is distinct from 'object' or length(btrim(coalesce(item->>'description',''))) not between 1 and 200
   or jsonb_typeof(item->'quantity') is distinct from 'number' or jsonb_typeof(item->'unit_price') is distinct from 'number' then raise exception 'Enter an item description, quantity and unit price.';end if;
  qty:=(item->>'quantity')::numeric;price:=(item->>'unit_price')::numeric;
  if qty not between 0.001 and 10000 or price not between 0 and 1000000 then raise exception 'Enter valid item quantities and prices.';end if;
  subtotal:=subtotal+round(qty*price,2);
 end loop;
 if (p_data ? 'tax' and jsonb_typeof(p_data->'tax') is distinct from 'number') or (p_data ? 'tip' and jsonb_typeof(p_data->'tip') is distinct from 'number') then raise exception 'Tax and tip must be amounts.';end if;
 tax:=coalesce((p_data->>'tax')::numeric,0);tip:=coalesce((p_data->>'tip')::numeric,0);
 if tax not between 0 and 1000000 or tip not between 0 and 1000000 then raise exception 'Enter valid tax and tip amounts.';end if;
 if p_data->'total' is not null and p_data->'total'<>'null'::jsonb and jsonb_typeof(p_data->'total') is distinct from 'number' then raise exception 'Enter a valid receipt total.';end if;
 amount:=(p_data->>'total')::numeric;
 if amount is not null and amount not between 0 and 9999999999.99 then raise exception 'Enter a valid receipt total.';end if;
 if jsonb_array_length(items)>0 then
  if amount is distinct from round(subtotal+tax+tip,2) then raise exception 'The receipt total must match its items, tax and tip.';end if;
 end if;
 if source='manual' and (vendor='' or amount is null) then raise exception 'Manual purchase records need a vendor and total.';end if;
 d:=jsonb_build_object('vendor',vendor,'purchase_date',day,'source',source,'category',btrim(coalesce(p_data->>'category','')),
 'payment',btrim(coalesce(p_data->>'payment','')),'reimburse',coalesce((p_data->>'reimburse')::boolean,false),
 'notes',btrim(coalesce(p_data->>'notes','')),'items',items,'tax',round(tax,2),'tip',round(tip,2),'total',round(amount,2));
 perform pg_advisory_xact_lock(hashtextextended('receipt-wallet:'||p_id::text,0));
 select * into prior from public.purchase_receipts where id=p_id for update;
 if found then
  if prior.location_id<>p_location_id or prior.user_id<>auth.uid() then raise exception 'Receipt access denied.' using errcode='42501';end if;
  if p_version=0 and prior.user_id<>auth.uid() then raise exception 'Receipt access denied.' using errcode='42501';end if;
  if prior.data=d then return to_jsonb(prior);end if;
  if prior.version is distinct from p_version then raise exception 'This receipt changed. Refresh the wallet before editing.';end if;
  if prior.data->>'source' is distinct from source then raise exception 'Keep the original receipt type.';end if;
  update public.purchase_receipts set data=d,purchase_date=day,total=round(amount,2),
   status=case when source='photo' and file_mime is null then 'draft' when vendor='' or amount is null then 'captured' else 'recorded' end,
   version=version+1,updated_at=clock_timestamp(),review_note=null,reviewed_by=null,reviewed_at=null,checked_at=null
  where id=p_id returning * into r;
  insert into public.purchase_receipt_events(receipt_id,actor_id,kind,details) values(p_id,auth.uid(),'edited',jsonb_build_object('before',prior.data,'after',d));
 else
  if p_version<>0 then raise exception 'Receipt not found. Refresh the wallet.';end if;
  if source='photo' then file:=p_location_id::text||'/'||auth.uid()::text||'/'||p_id::text||'/original';end if;
  insert into public.purchase_receipts(id,location_id,user_id,purchase_date,data,total,status,file_path,requires_check)
  values(p_id,p_location_id,auth.uid(),day,d,round(amount,2),case when source='manual' then 'recorded' else 'draft' end,file,public.mod_is_manager(p_location_id) is not true) returning * into r;
  insert into public.purchase_receipt_events(receipt_id,actor_id,kind,details) values(p_id,auth.uid(),'created',d);
 end if;
 return to_jsonb(r);
end;$$;
create or replace function public.receipt_wallet_scan_claim(p_id uuid,p_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.purchase_receipts%rowtype;
begin
 select * into r from public.purchase_receipts where id=p_id for update;
 if auth.uid() is null or not found or public.closeout_is_member(r.location_id) is not true
 or r.user_id<>auth.uid() then raise exception 'Receipt access denied.' using errcode='42501';end if;
 if r.file_mime is null then raise exception 'Finish uploading the receipt first.';end if;
 if r.extraction is not null then return jsonb_build_object('extraction',r.extraction);end if;
 if p_token is null then raise exception 'Scan token required.';end if;
 if r.scan_token is not null and r.scan_started_at>clock_timestamp()-interval '2 minutes' then raise exception 'This receipt is already scanning. Try again shortly.';end if;
 update public.purchase_receipts set scan_token=p_token,scan_started_at=clock_timestamp() where id=p_id;
 return jsonb_build_object('file_path',r.file_path,'mime',r.file_mime);
end;$$;
create or replace function public.receipt_wallet_scan_store(p_id uuid,p_token uuid,p_extraction jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare r public.purchase_receipts%rowtype;
begin
 select * into r from public.purchase_receipts where id=p_id for update;
 if auth.uid() is null or not found or public.closeout_is_member(r.location_id) is not true
 or r.user_id<>auth.uid() then raise exception 'Receipt access denied.' using errcode='42501';end if;
 if p_token is null or r.scan_token is distinct from p_token then raise exception 'This scan expired. Try again.';end if;
 if p_extraction is not null and (jsonb_typeof(p_extraction) is distinct from 'object' or octet_length(p_extraction::text)>100000) then raise exception 'Invalid scan result.';end if;
 update public.purchase_receipts set extraction=p_extraction,scan_token=null,scan_started_at=null where id=p_id;
 if p_extraction is not null then insert into public.purchase_receipt_events(receipt_id,actor_id,kind,details) values(p_id,auth.uid(),'scanned','{}');end if;
end;$$;

-- Team profiles must not summarize somebody else's private wallet drafts.
do $profile_privacy$
declare def text; signature regprocedure;
begin
 signature:=to_regprocedure('public.team_profile_details(uuid,uuid,date,date)');
 if signature is not null then
  def:=pg_get_functiondef(signature);
  if position('if to_regclass(''public.purchase_receipts'') is not null then' in def)>0 then
   execute replace(def,'if to_regclass(''public.purchase_receipts'') is not null then','if to_regclass(''public.purchase_receipts'') is not null and p_user_id=auth.uid() then');
  elsif position('p_user_id=auth.uid() then' in def)=0 then
   raise exception 'Team profile wallet logic changed; privacy update stopped for review.';
  end if;
 end if;
end;$profile_privacy$;

-- Older RPC aliases must not expose broader historical loaders.
do $$declare f record;begin
 for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and (proname like '%receipt%before%' or proname in ('receipt_access_load','receipt_is_submitted','receipt_private_write_guard')) loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 end loop;
end;$$;
revoke all on function public.receipt_responsibility_requests(uuid),public.receipt_submissions_load(uuid,date,date,uuid,uuid),public.receipt_responsibility_respond(uuid,uuid,integer,text,boolean,text),public.receipt_hub_load(uuid,date,date,uuid,uuid),public.closeout_receipts_load(uuid,date,date,uuid,uuid),public.closeout_receipt_save(uuid,uuid,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.receipt_responsibility_requests(uuid),public.receipt_submissions_load(uuid,date,date,uuid,uuid),public.receipt_responsibility_respond(uuid,uuid,integer,text,boolean,text),public.receipt_hub_load(uuid,date,date,uuid,uuid),public.closeout_receipts_load(uuid,date,date,uuid,uuid),public.closeout_receipt_save(uuid,uuid,integer,jsonb,text) to authenticated;
notify pgrst,'reload schema';
commit;

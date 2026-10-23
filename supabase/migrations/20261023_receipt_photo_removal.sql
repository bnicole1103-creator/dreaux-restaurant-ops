begin;
alter table public.purchase_receipts add column if not exists deleted_at timestamptz;
alter table public.purchase_receipts add column if not exists deleted_by uuid references public.profiles(id);

do $keep$
begin
 if to_regprocedure('public.receipt_wallet_list_before_photo_removal(uuid,date,date)') is null then
  alter function public.receipt_wallet_list(uuid,date,date) rename to receipt_wallet_list_before_photo_removal;
 end if;
 if to_regprocedure('public.closeout_receipts_load_before_photo_removal(uuid,date,date,uuid,uuid)') is null then
  alter function public.closeout_receipts_load(uuid,date,date,uuid,uuid) rename to closeout_receipts_load_before_photo_removal;
 end if;
end;$keep$;
revoke all on function public.receipt_wallet_list_before_photo_removal(uuid,date,date),public.closeout_receipts_load_before_photo_removal(uuid,date,date,uuid,uuid) from public,anon,authenticated;

create or replace function public.receipt_wallet_remove(p_location_id uuid,p_id uuid,p_version integer,p_change_note text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.purchase_receipts%rowtype; linked public.closeout_receipts%rowtype; result public.purchase_receipts%rowtype;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active location access required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('receipt-wallet:'||p_id::text,0));
 select * into r from public.purchase_receipts where id=p_id and location_id=p_location_id for update;
 if not found or (r.user_id<>auth.uid() and public.mod_is_manager(p_location_id) is not true) then raise exception 'Receipt access denied.' using errcode='42501';end if;
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

create or replace function public.receipt_wallet_list(p_location_id uuid,p_start date,p_end date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare allowed jsonb; result jsonb;
begin
 allowed:=public.receipt_wallet_list_before_photo_removal(p_location_id,p_start,p_end);
 select coalesce(jsonb_agg(to_jsonb(x) order by x.purchase_date desc,x.created_at desc),'[]'::jsonb) into result from (
  select r.*,coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''),'Purchaser') employee,
  coalesce(nullif(reviewer.preferred_name,''),nullif(reviewer.full_name,'')) reviewer,
  exists(select 1 from storage.objects o where o.bucket_id='purchase-receipts' and o.name=r.file_path) has_file
  from public.purchase_receipts r join public.profiles p on p.id=r.user_id left join public.profiles reviewer on reviewer.id=r.reviewed_by
  where r.location_id=p_location_id and r.deleted_at is null and ((allowed->>'manager')::boolean or r.user_id=auth.uid()) and r.purchase_date between p_start and p_end
  order by r.purchase_date desc,r.created_at desc limit 201
 ) x;
 return allowed||jsonb_build_object('rows',result);
end;$$;

create or replace function public.closeout_receipts_load(p_location_id uuid,p_start date,p_end date,p_user_id uuid default null,p_closeout_key uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; photos jsonb;
begin
 result:=public.closeout_receipts_load_before_photo_removal(p_location_id,p_start,p_end,p_user_id,p_closeout_key);
 select coalesce(jsonb_agg(value),'[]'::jsonb) into photos from jsonb_array_elements(coalesce(result->'photos','[]'::jsonb)) where value->>'deleted_at' is null;
 return result||jsonb_build_object('photos',photos);
end;$$;

create or replace function public.receipt_photo_import_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare removed timestamptz;
begin
 -- The existing save API uses INSERT ON CONFLICT for ordinary receipt edits.
 if new.source_purchase_id is null or exists(select 1 from public.closeout_receipts where id=new.id) then return new;end if;
 select deleted_at into removed from public.purchase_receipts where id=new.source_purchase_id for update;
 if not found or removed is not null then raise exception 'This photo entry was removed. Refresh the wallet.';end if;
 return new;
end;$$;
drop trigger if exists receipt_photo_import_guard on public.closeout_receipts;
create trigger receipt_photo_import_guard before insert on public.closeout_receipts for each row execute function public.receipt_photo_import_guard();
revoke all on function public.receipt_photo_import_guard() from public,anon,authenticated;
revoke all on function public.receipt_wallet_remove(uuid,uuid,integer,text),public.receipt_wallet_list(uuid,date,date),public.closeout_receipts_load(uuid,date,date,uuid,uuid) from public,anon,authenticated;
grant execute on function public.receipt_wallet_remove(uuid,uuid,integer,text),public.receipt_wallet_list(uuid,date,date),public.closeout_receipts_load(uuid,date,date,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;

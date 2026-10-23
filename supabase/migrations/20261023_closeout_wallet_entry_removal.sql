begin;
-- Remove imported entries and their source wallet entry together. Keep the
-- existing deletion, authorization, manager correction, audit and scoring APIs.
create or replace function public.closeout_receipt_remove_entry(
 p_location_id uuid,p_id uuid,p_version integer,p_change_note text default ''
) returns void language plpgsql security definer set search_path='' as $$
declare receipt public.closeout_receipts%rowtype; photo public.purchase_receipts%rowtype;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then
  raise exception 'Active location access required.' using errcode='42501';
 end if;
 select * into receipt from public.closeout_receipts
 where id=p_id and location_id=p_location_id and deleted_at is null;
 if not found then raise exception 'This receipt was removed. Refresh the wallet.';end if;
 if receipt.user_id<>auth.uid() and public.mod_is_manager(p_location_id) is not true then
  raise exception 'Receipt access denied.' using errcode='42501';
 end if;
 if receipt.source_purchase_id is not null then
  -- Follow the same source-photo -> closeout-entry lock order as wallet removal.
  perform pg_advisory_xact_lock(hashtextextended('receipt-wallet:'||receipt.source_purchase_id::text,0));
  select * into photo from public.purchase_receipts
   where id=receipt.source_purchase_id and location_id=p_location_id for update;
  if not found then raise exception 'Source photo unavailable. Refresh the wallet.';end if;
  select * into receipt from public.closeout_receipts
   where id=p_id and location_id=p_location_id and deleted_at is null for update;
  if not found or receipt.version is distinct from p_version then
   raise exception 'This receipt changed. Refresh the wallet before removing it.';
  end if;
  if photo.deleted_at is null then
   perform public.receipt_wallet_remove(p_location_id,photo.id,photo.version,coalesce(p_change_note,''));
  else
   perform public.closeout_receipt_save(p_location_id,p_id,p_version,'{"remove":true}'::jsonb,coalesce(p_change_note,''));
  end if;
 else
  perform public.closeout_receipt_save(p_location_id,p_id,p_version,'{"remove":true}'::jsonb,coalesce(p_change_note,''));
 end if;
end;$$;
revoke all on function public.closeout_receipt_remove_entry(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.closeout_receipt_remove_entry(uuid,uuid,integer,text) to authenticated;
notify pgrst,'reload schema';
commit;

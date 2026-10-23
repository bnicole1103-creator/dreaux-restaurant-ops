begin;
update storage.buckets set public=false where id in ('purchase-receipts','closeout-receipts');
drop policy if exists rebuild_receipt_read_boundary on storage.objects;
create policy rebuild_receipt_read_boundary on storage.objects as restrictive for select to authenticated using(
 bucket_id not in ('purchase-receipts','closeout-receipts') or public.closeout_receipt_assigned_file(bucket_id,name)
 or (bucket_id='purchase-receipts' and public.receipt_wallet_file_access(name,false))
 or (bucket_id='closeout-receipts' and public.closeout_receipt_file_access(name,false)));
-- Replace the standard historical read guards with the same scoped predicate.
drop policy if exists closeout_receipt_read_guard on storage.objects;
create policy closeout_receipt_read_guard on storage.objects as restrictive for select to authenticated using(bucket_id<>'closeout-receipts' or public.closeout_receipt_file_access(name,false) or public.closeout_receipt_assigned_file(bucket_id,name));
drop policy if exists purchase_receipt_read_guard on storage.objects;
create policy purchase_receipt_read_guard on storage.objects as restrictive for select to authenticated using(bucket_id<>'purchase-receipts' or public.receipt_wallet_file_access(name,false) or public.closeout_receipt_assigned_file(bucket_id,name));
drop policy if exists rebuild_receipt_scoped_read on storage.objects;
create policy rebuild_receipt_scoped_read on storage.objects for select to authenticated using(bucket_id in ('purchase-receipts','closeout-receipts') and (public.closeout_receipt_assigned_file(bucket_id,name) or (bucket_id='purchase-receipts' and public.receipt_wallet_file_access(name,false)) or (bucket_id='closeout-receipts' and public.closeout_receipt_file_access(name,false))));
notify pgrst,'reload schema';commit;

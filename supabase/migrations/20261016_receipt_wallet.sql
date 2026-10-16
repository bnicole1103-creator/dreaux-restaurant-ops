begin;
create table if not exists public.purchase_receipts (
 id uuid primary key,location_id uuid not null references public.locations(id),user_id uuid not null references public.profiles(id),
 purchase_date date not null,data jsonb not null,total numeric(12,2),
 status text not null check(status in ('draft','captured','recorded')),
 file_path text unique,file_mime text,version integer not null default 1,
 review_note text,reviewed_by uuid references public.profiles(id),reviewed_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
-- Upgrade the previous wallet without removing receipts or their history.
alter table public.purchase_receipts add column if not exists requires_check boolean not null default false;
alter table public.purchase_receipts add column if not exists checked_at timestamptz;
alter table public.purchase_receipts add column if not exists extraction jsonb;
alter table public.purchase_receipts add column if not exists scan_token uuid;
alter table public.purchase_receipts add column if not exists scan_started_at timestamptz;
alter table public.purchase_receipts drop constraint if exists purchase_receipts_status_check;
update public.purchase_receipts set status=case
 when data->>'source'='photo' and file_mime is null then 'draft'
 when nullif(btrim(data->>'vendor'),'') is null or total is null then 'captured'
 else 'recorded' end where status in ('pending','approved','needs_info');
alter table public.purchase_receipts add constraint purchase_receipts_status_check check(status in ('draft','captured','recorded'));
create index if not exists purchase_receipts_day on public.purchase_receipts(location_id,purchase_date,user_id);
create table if not exists public.purchase_receipt_events (
 id bigint generated always as identity primary key,receipt_id uuid not null references public.purchase_receipts(id),
 actor_id uuid not null references public.profiles(id),kind text not null,details jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.purchase_receipts enable row level security;
alter table public.purchase_receipt_events enable row level security;
revoke all on public.purchase_receipts,public.purchase_receipt_events from public,anon,authenticated;
revoke all on sequence public.purchase_receipt_events_id_seq from public,anon,authenticated;

create or replace function public.receipt_wallet_file_access(p_path text,p_upload boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
 select 1 from public.purchase_receipts r where r.file_path=p_path and public.closeout_is_member(r.location_id) is true
 and case when p_upload then r.user_id=auth.uid() and r.status='draft'
 else r.user_id=auth.uid() or public.mod_is_manager(r.location_id) is true end
 );
$$;
revoke all on function public.receipt_wallet_file_access(text,boolean) from public,anon,authenticated;
grant execute on function public.receipt_wallet_file_access(text,boolean) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('purchase-receipts','purchase-receipts',false,12582912,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists purchase_receipt_upload on storage.objects;
create policy purchase_receipt_upload on storage.objects for insert to authenticated
with check(bucket_id='purchase-receipts' and public.receipt_wallet_file_access(name,true));
drop policy if exists purchase_receipt_read on storage.objects;
create policy purchase_receipt_read on storage.objects for select to authenticated
using(bucket_id='purchase-receipts' and public.receipt_wallet_file_access(name,false));

-- Restrictive guards keep this bucket private even if another policy is broad.
drop policy if exists purchase_receipt_read_guard on storage.objects;
create policy purchase_receipt_read_guard on storage.objects as restrictive for select to authenticated
using(bucket_id<>'purchase-receipts' or public.receipt_wallet_file_access(name,false));
drop policy if exists purchase_receipt_insert_guard on storage.objects;
create policy purchase_receipt_insert_guard on storage.objects as restrictive for insert to authenticated
with check(bucket_id<>'purchase-receipts' or public.receipt_wallet_file_access(name,true));
drop policy if exists purchase_receipt_update_guard on storage.objects;
create policy purchase_receipt_update_guard on storage.objects as restrictive for update to authenticated
using(bucket_id<>'purchase-receipts') with check(bucket_id<>'purchase-receipts');
drop policy if exists purchase_receipt_delete_guard on storage.objects;
create policy purchase_receipt_delete_guard on storage.objects as restrictive for delete to authenticated
using(bucket_id<>'purchase-receipts');
drop policy if exists purchase_receipt_anon_guard on storage.objects;
create policy purchase_receipt_anon_guard on storage.objects as restrictive for all to anon
using(bucket_id<>'purchase-receipts') with check(bucket_id<>'purchase-receipts');

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
  if prior.location_id<>p_location_id or (prior.user_id<>auth.uid() and public.mod_is_manager(p_location_id) is not true) then raise exception 'Receipt access denied.' using errcode='42501';end if;
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

create or replace function public.receipt_wallet_attach(p_location_id uuid,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.purchase_receipts%rowtype;mime text;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active location access required.' using errcode='42501';end if;
 select * into r from public.purchase_receipts where id=p_id and location_id=p_location_id and user_id=auth.uid() for update;
 if not found then raise exception 'Your receipt was not found.' using errcode='42501';end if;
 if r.file_mime is not null then return to_jsonb(r);end if;
 select metadata->>'mimetype' into mime from storage.objects where bucket_id='purchase-receipts' and name=r.file_path;
 if mime is null or mime not in ('image/jpeg','image/png','image/webp','application/pdf') then raise exception 'Upload the receipt photo or PDF first.';end if;
 update public.purchase_receipts set file_mime=mime,status=case when nullif(btrim(data->>'vendor'),'') is null or total is null then 'captured' else 'recorded' end,version=version+1,updated_at=clock_timestamp() where id=p_id returning * into r;
 insert into public.purchase_receipt_events(receipt_id,actor_id,kind,details) values(p_id,auth.uid(),'attachment',jsonb_build_object('file',r.file_path,'mime',mime));
 return to_jsonb(r);
end;$$;

-- Checking a staff purchase is independent of scanning/recording it. No approval workflow.
drop function if exists public.receipt_wallet_review(uuid,uuid,integer,text,text);
create or replace function public.receipt_wallet_check(p_location_id uuid,p_id uuid,p_version integer)
returns void language plpgsql security definer set search_path='' as $$
declare r public.purchase_receipts%rowtype;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then raise exception 'Management access required.' using errcode='42501';end if;
 select * into r from public.purchase_receipts where id=p_id and location_id=p_location_id for update;
 if not found then raise exception 'Receipt not found.';end if;
 if not r.requires_check then raise exception 'This purchaser does not need a management check.';end if;
 if r.checked_at is not null then return;end if;
 if r.version is distinct from p_version then raise exception 'The receipt changed. Refresh before checking.';end if;
 if r.status='draft' then raise exception 'The purchaser must finish uploading the receipt first.';end if;
 update public.purchase_receipts set checked_at=clock_timestamp(),reviewed_by=auth.uid(),version=version+1,updated_at=clock_timestamp() where id=p_id;
 insert into public.purchase_receipt_events(receipt_id,actor_id,kind,details) values(p_id,auth.uid(),'checked','{}');
end;$$;

-- A short lease prevents overlapping paid scans. Cached extraction never edits purchase details.
create or replace function public.receipt_wallet_scan_claim(p_id uuid,p_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.purchase_receipts%rowtype;
begin
 select * into r from public.purchase_receipts where id=p_id for update;
 if auth.uid() is null or not found or public.closeout_is_member(r.location_id) is not true
 or (r.user_id<>auth.uid() and public.mod_is_manager(r.location_id) is not true) then raise exception 'Receipt access denied.' using errcode='42501';end if;
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
 or (r.user_id<>auth.uid() and public.mod_is_manager(r.location_id) is not true) then raise exception 'Receipt access denied.' using errcode='42501';end if;
 if p_token is null or r.scan_token is distinct from p_token then raise exception 'This scan expired. Try again.';end if;
 if p_extraction is not null and (jsonb_typeof(p_extraction) is distinct from 'object' or octet_length(p_extraction::text)>100000) then raise exception 'Invalid scan result.';end if;
 update public.purchase_receipts set extraction=p_extraction,scan_token=null,scan_started_at=null where id=p_id;
 if p_extraction is not null then insert into public.purchase_receipt_events(receipt_id,actor_id,kind,details) values(p_id,auth.uid(),'scanned','{}');end if;
end;$$;
revoke all on function public.receipt_wallet_scan_claim(uuid,uuid),public.receipt_wallet_scan_store(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.receipt_wallet_scan_claim(uuid,uuid),public.receipt_wallet_scan_store(uuid,uuid,jsonb) to authenticated;

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
  where r.location_id=p_location_id and (managed or r.user_id=auth.uid()) and r.purchase_date between p_start and p_end
  order by r.purchase_date desc,r.created_at desc limit 201
 ) x;
 return jsonb_build_object('manager',managed,'user_id',auth.uid(),'rows',result);
end;$$;
revoke all on function public.receipt_wallet_save(uuid,uuid,integer,jsonb),public.receipt_wallet_attach(uuid,uuid),public.receipt_wallet_check(uuid,uuid,integer),public.receipt_wallet_list(uuid,date,date) from public,anon,authenticated;
grant execute on function public.receipt_wallet_save(uuid,uuid,integer,jsonb),public.receipt_wallet_attach(uuid,uuid),public.receipt_wallet_check(uuid,uuid,integer),public.receipt_wallet_list(uuid,date,date) to authenticated;
notify pgrst,'reload schema';
commit;

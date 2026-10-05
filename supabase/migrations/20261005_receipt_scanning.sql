begin;
create table if not exists public.inventory_receipts(
 id uuid primary key default gen_random_uuid(),
 location_id uuid not null references public.locations(id),
 user_id uuid not null references public.profiles(id),
 request_id uuid not null,
 file_path text not null unique,
 mime text not null check(mime in ('image/jpeg','image/png','image/webp','application/pdf')),
 status text not null default 'draft' check(status in ('draft','submitted')),
 created_at timestamptz not null default now(),
 submitted_at timestamptz,
 scan_count integer not null default 0,
 scan_started_at timestamptz,
 vendor text, invoice_number text, received_date date,
 receipt_total numeric(12,2), notes text,
 lines jsonb not null default '[]',
 extraction jsonb,
 unique(location_id,user_id,request_id)
);
create table if not exists public.inventory_receipt_scan_events(user_id uuid not null,created_at timestamptz not null default now());
alter table public.inventory_receipt_scan_events enable row level security;
revoke all on public.inventory_receipt_scan_events from public,anon,authenticated;
alter table public.inventory_receipts enable row level security;
revoke all on public.inventory_receipts from public,anon,authenticated;
create or replace function public.inventory_receipt_access(p_path text,p_write boolean)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
 select 1 from public.inventory_receipts r where r.file_path=p_path
 and public.closeout_is_member(r.location_id) is true
 and case when p_write then r.user_id=auth.uid() and r.status='draft'
 else r.user_id=auth.uid() or public.mod_is_manager(r.location_id) is true end);
$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('inventory-receipts','inventory-receipts',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists inventory_receipts_upload on storage.objects;
create policy inventory_receipts_upload on storage.objects for insert to authenticated
with check(bucket_id='inventory-receipts' and public.inventory_receipt_access(name,true));
drop policy if exists inventory_receipts_read on storage.objects;
create policy inventory_receipts_read on storage.objects for select to authenticated
using(bucket_id='inventory-receipts' and public.inventory_receipt_access(name,false));
create or replace function public.inventory_receipt_create(p_location_id uuid,p_request_id uuid,p_mime text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.inventory_receipts; rid uuid:=gen_random_uuid(); ext text;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Staff access required.' using errcode='42501';end if;
 if p_request_id is null or p_mime is null or p_mime not in ('image/jpeg','image/png','image/webp','application/pdf') then raise exception 'Upload a JPG, PNG, WebP or PDF receipt.';end if;
 perform pg_advisory_xact_lock(hashtextextended('receipt-create:'||auth.uid()::text,0));
 select * into r from public.inventory_receipts where location_id=p_location_id and user_id=auth.uid() and request_id=p_request_id;
 if r.id is not null then return to_jsonb(r);end if;
 if (select count(*) from public.inventory_receipts where user_id=auth.uid() and created_at>now()-interval '1 day')>=50 then raise exception 'Daily receipt limit reached.';end if;
 ext:=case p_mime when 'application/pdf' then 'pdf' when 'image/png' then 'png' when 'image/webp' then 'webp' else 'jpg' end;
 insert into public.inventory_receipts(id,location_id,user_id,request_id,mime,file_path)
 values(rid,p_location_id,auth.uid(),p_request_id,p_mime,p_location_id::text||'/'||auth.uid()::text||'/'||rid::text||'.'||ext) returning * into r;
 return to_jsonb(r);
end;$$;
create or replace function public.inventory_receipt_scan_claim(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.inventory_receipts;
begin
 perform pg_advisory_xact_lock(hashtextextended('receipt-scan:'||auth.uid()::text,0));
 select * into r from public.inventory_receipts where id=p_id and user_id=auth.uid() and status='draft' for update;
 if r.id is null or public.closeout_is_member(r.location_id) is not true then raise exception 'Receipt not available.' using errcode='42501';end if;
 if r.extraction is not null then return to_jsonb(r);end if;
 if r.scan_started_at>now()-interval '2 minutes' then raise exception 'Scan already running. Wait two minutes before retrying.';end if;
 if r.scan_count>=5 or (select count(*) from public.inventory_receipt_scan_events where user_id=auth.uid() and created_at>now()-interval '1 day')>=30 then raise exception 'Receipt scan limit reached. Enter or finish the slip manually.';end if;
 insert into public.inventory_receipt_scan_events(user_id) values(auth.uid());
 update public.inventory_receipts set scan_count=scan_count+1,scan_started_at=now() where id=r.id;
 return to_jsonb(r);
end;$$;
create or replace function public.inventory_receipt_scan_store(p_id uuid,p_extraction jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_extraction is not null and (jsonb_typeof(p_extraction) is distinct from 'object' or length(p_extraction::text)>100000) then raise exception 'Invalid scan result.';end if;
 update public.inventory_receipts set extraction=p_extraction,scan_started_at=null
 where id=p_id and user_id=auth.uid() and status='draft' and public.closeout_is_member(location_id) is true;
 if not found then raise exception 'Receipt not available.' using errcode='42501';end if;
end;$$;
create or replace function public.inventory_receipt_submit(p_id uuid,p_values jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.inventory_receipts; line jsonb; q numeric; pack numeric; cost numeric; d date;
begin
 select * into r from public.inventory_receipts where id=p_id and user_id=auth.uid() for update;
 if r.id is null or public.closeout_is_member(r.location_id) is not true then raise exception 'Receipt not available.' using errcode='42501';end if;
 if r.status='submitted' then return r.id;end if;
 if not exists(select 1 from storage.objects where bucket_id='inventory-receipts' and name=r.file_path) then raise exception 'Upload the receipt first.';end if;
 if p_values->>'reviewed' is distinct from 'true' then raise exception 'Review the receipt and confirm quantities before submitting.';end if;
 if coalesce(length(btrim(p_values->>'vendor')),0) not between 1 and 200 or coalesce(length(p_values->>'invoice_number'),0)>200 or coalesce(length(p_values->>'notes'),0)>4000 then raise exception 'Enter vendor and valid receipt details.';end if;
 d:=(p_values->>'received_date')::date;
 if d is null or d>(now() at time zone 'America/Chicago')::date then raise exception 'Choose an actual received date.';end if;
 if jsonb_typeof(p_values->'lines') is distinct from 'array' then raise exception 'Enter receipt items.';end if;
 if jsonb_array_length(p_values->'lines') not between 1 and 100 then raise exception 'Enter 1 to 100 items.';end if;
 for line in select value from jsonb_array_elements(p_values->'lines') loop
  if coalesce(length(btrim(line->>'item')),0) not between 1 and 200 or coalesce(length(btrim(line->>'size')),0) not between 1 and 80 or jsonb_typeof(line->'quantity') is distinct from 'number' or jsonb_typeof(line->'pack_size') is distinct from 'number' then raise exception 'Enter item, size/unit, quantity and units per pack.';end if;
  q:=(line->>'quantity')::numeric;pack:=(line->>'pack_size')::numeric;
  if q not between 0.001 and 10000 or pack not between 1 and 1000 or pack<>trunc(pack) then raise exception 'Enter valid quantities and whole units per pack.';end if;
  if line->'unit_cost' is distinct from 'null'::jsonb then
   if jsonb_typeof(line->'unit_cost') is distinct from 'number' then raise exception 'Cost must be a number or blank.';end if;
   cost:=(line->>'unit_cost')::numeric;
   if cost not between 0 and 1000000 then raise exception 'Enter a valid cost per pack.';end if;
  end if;
 end loop;
 if p_values->'receipt_total' is distinct from 'null'::jsonb then
  if jsonb_typeof(p_values->'receipt_total') is distinct from 'number' or (p_values->>'receipt_total')::numeric not between 0 and 9999999999.99 then raise exception 'Enter a valid receipt total or leave it blank.';end if;
 end if;
 if nullif(btrim(p_values->>'invoice_number'),'') is not null and exists(select 1 from public.inventory_receipts where location_id=r.location_id and status='submitted' and lower(btrim(vendor))=lower(btrim(p_values->>'vendor')) and lower(btrim(invoice_number))=lower(btrim(p_values->>'invoice_number'))) then raise exception 'This vendor and invoice number have already been submitted.';end if;
 update public.inventory_receipts set status='submitted',submitted_at=now(),vendor=btrim(p_values->>'vendor'),invoice_number=nullif(btrim(p_values->>'invoice_number'),''),received_date=d,receipt_total=(p_values->>'receipt_total')::numeric,notes=p_values->>'notes',lines=p_values->'lines' where id=r.id;
 return r.id;
end;$$;
create unique index if not exists inventory_receipts_unique_invoice on public.inventory_receipts(location_id,lower(btrim(vendor)),lower(btrim(invoice_number))) where status='submitted' and invoice_number is not null;
create or replace function public.inventory_receipt_report(p_location_id uuid,p_start date,p_end date)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Staff access required.' using errcode='42501';end if;
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>366 then raise exception 'Choose a report range of up to one year.';end if;
 return jsonb_build_object('manager',public.mod_is_manager(p_location_id),'receipts',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select r.*,exists(select 1 from storage.objects o where o.bucket_id='inventory-receipts' and o.name=r.file_path) has_file,coalesce(nullif(p.preferred_name,''),p.full_name,'Staff') employee from public.inventory_receipts r left join public.profiles p on p.id=r.user_id where r.location_id=p_location_id and (r.user_id=auth.uid() or public.mod_is_manager(p_location_id) is true) and (case when r.status='submitted' then r.received_date else (r.created_at at time zone 'America/Chicago')::date end) between p_start and p_end order by r.created_at desc limit 500) x),'[]'::jsonb),'limit',500);
end;$$;
revoke all on function public.inventory_receipt_access(text,boolean),public.inventory_receipt_create(uuid,uuid,text),public.inventory_receipt_scan_claim(uuid),public.inventory_receipt_scan_store(uuid,jsonb),public.inventory_receipt_submit(uuid,jsonb),public.inventory_receipt_report(uuid,date,date) from public,anon,authenticated;
grant execute on function public.inventory_receipt_access(text,boolean),public.inventory_receipt_create(uuid,uuid,text),public.inventory_receipt_scan_claim(uuid),public.inventory_receipt_scan_store(uuid,jsonb),public.inventory_receipt_submit(uuid,jsonb),public.inventory_receipt_report(uuid,date,date) to authenticated;
notify pgrst,'reload schema';
commit;

begin;
-- Existing closeouts keep their original scoring until a manager adds receipt evidence.
alter table public.daily_closeouts add column if not exists receipt_reason_policy boolean not null default false;
alter table public.daily_closeouts alter column receipt_reason_policy set default true;
create table if not exists public.closeout_receipts (
 id uuid primary key, location_id uuid not null references public.locations(id),
 user_id uuid not null references public.profiles(id), created_by uuid not null references public.profiles(id),
 business_date date not null, closeout_key uuid, shift_id uuid references public.shifts(id),
 kind text not null default 'void' check(kind in ('void','comp','discount')),
 reason text, amount numeric(12,2) check(amount>0), check_number text not null default '', notes text not null default '',
 file_path text not null unique, file_mime text not null, ready boolean not null default false,
 version integer not null default 1, deleted_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check (reason is null or (kind='void' and reason in ('customer_changed_mind','server_error','86ed_item','testing_training')) or
 (kind in ('comp','discount') and reason in ('guest_recovery','server_error','kitchen_error','employee_discount','spill_waste_server_error','spill_waste_kitchen_error')))
);
alter table public.closeout_receipts add column if not exists origin_bucket text not null default 'closeout-receipts';
alter table public.closeout_receipts add column if not exists source_purchase_id uuid references public.purchase_receipts(id);
create unique index if not exists closeout_receipts_source on public.closeout_receipts(source_purchase_id);
-- closeout_key is also a reserved draft UUID before the closeout is submitted.
create index if not exists closeout_receipts_key on public.closeout_receipts(closeout_key);
create index if not exists closeout_receipts_report on public.closeout_receipts(location_id,business_date,user_id);
create table if not exists public.closeout_receipt_audit (
 id bigint generated always as identity primary key, receipt_id uuid not null,
 actor_id uuid not null, changed_at timestamptz not null default clock_timestamp(), before_record jsonb, after_record jsonb
);
alter table public.closeout_receipts enable row level security;
alter table public.closeout_receipt_audit enable row level security;
revoke all on public.closeout_receipts,public.closeout_receipt_audit from public,anon,authenticated;
revoke all on sequence public.closeout_receipt_audit_id_seq from public,anon,authenticated;

create or replace function public.closeout_receipt_file_access(p_path text,p_upload boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.closeout_receipts r
 where r.file_path=p_path and r.deleted_at is null and public.closeout_is_member(r.location_id) is true
 and case when p_upload then r.created_by=auth.uid() and not r.ready and r.origin_bucket='closeout-receipts'
 else r.user_id=auth.uid() or public.mod_is_manager(r.location_id) is true end);
$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('closeout-receipts','closeout-receipts',false,12582912,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists closeout_receipt_read on storage.objects;
create policy closeout_receipt_read on storage.objects for select to authenticated using(bucket_id='closeout-receipts' and public.closeout_receipt_file_access(name,false));
drop policy if exists closeout_receipt_upload on storage.objects;
create policy closeout_receipt_upload on storage.objects for insert to authenticated with check(bucket_id='closeout-receipts' and public.closeout_receipt_file_access(name,true));
drop policy if exists closeout_receipt_read_guard on storage.objects;
create policy closeout_receipt_read_guard on storage.objects as restrictive for select to authenticated using(bucket_id<>'closeout-receipts' or public.closeout_receipt_file_access(name,false));
drop policy if exists closeout_receipt_insert_guard on storage.objects;
create policy closeout_receipt_insert_guard on storage.objects as restrictive for insert to authenticated with check(bucket_id<>'closeout-receipts' or public.closeout_receipt_file_access(name,true));
drop policy if exists closeout_receipt_change_guard on storage.objects;
create policy closeout_receipt_change_guard on storage.objects as restrictive for update to authenticated using(bucket_id<>'closeout-receipts') with check(bucket_id<>'closeout-receipts');
drop policy if exists closeout_receipt_delete_guard on storage.objects;
create policy closeout_receipt_delete_guard on storage.objects as restrictive for delete to authenticated using(bucket_id<>'closeout-receipts');

drop policy if exists closeout_receipt_anon_guard on storage.objects;
create policy closeout_receipt_anon_guard on storage.objects as restrictive for all to anon using(bucket_id<>'closeout-receipts') with check(bucket_id<>'closeout-receipts');

create or replace function public.closeout_receipts_load(p_location_id uuid,p_start date,p_end date,p_user_id uuid default null,p_closeout_key uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; manager boolean;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Location access required.' using errcode='42501';end if;
 manager:=public.mod_is_manager(p_location_id) is true;
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>366 then raise exception 'Choose a date range of up to one year.';end if;
 if not manager and p_user_id is not null and p_user_id<>auth.uid() then raise exception 'Only your receipts are available.' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('employee',coalesce(p.preferred_name,p.full_name),'submitted',c.status='submitted','can_edit',manager or c.id is null,'points',case when c.status='submitted' and c.deleted_at is null and c.receipt_reason_policy and coalesce((to_jsonb(c)->>'operations_points_apply')::boolean,true) and r.ready and r.reason in ('server_error','spill_waste_server_error') then -5 else 0 end,'closeout_deleted',c.deleted_at is not null) order by r.business_date desc,r.created_at desc),'[]'::jsonb)
 into result from public.closeout_receipts r join public.profiles p on p.id=r.user_id
 left join public.daily_closeouts c on c.id=r.closeout_key
 where r.location_id=p_location_id and r.business_date between p_start and p_end and r.deleted_at is null
 and (manager or r.user_id=auth.uid()) and (p_user_id is null or r.user_id=p_user_id)
 and (p_closeout_key is null or r.user_id=coalesce((select k.user_id from public.daily_closeouts k where k.id=p_closeout_key and k.location_id=p_location_id),auth.uid()))
 and (p_closeout_key is null or r.closeout_key=p_closeout_key or r.closeout_key is null);
 return jsonb_build_object('rows',result,'manager',manager,'closeouts',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'user_id',c.user_id,'closeout_date',c.closeout_date,'shift_type',c.shift_type,'void_count',c.void_count,'void_value',c.void_value,'discount_value',c.discount_value)),'[]'::jsonb) from public.daily_closeouts c where c.location_id=p_location_id and c.status='submitted' and c.deleted_at is null and c.closeout_date between p_start and p_end and (manager or c.user_id=auth.uid()) and (p_user_id is null or c.user_id=p_user_id)));
end;$$;

create or replace function public.closeout_receipt_save(p_location_id uuid,p_id uuid,p_version integer,p_values jsonb,p_change_note text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.closeout_receipts%rowtype; prior public.closeout_receipts%rowtype; c public.daily_closeouts%rowtype; manager boolean; target_key uuid; source public.purchase_receipts%rowtype;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Location access required.' using errcode='42501';end if;
 if p_id is null or jsonb_typeof(p_values) is distinct from 'object' then raise exception 'Invalid receipt.';end if;
 manager:=public.mod_is_manager(p_location_id) is true;
 target_key:=(p_values->>'closeout_key')::uuid;
 -- Use stored identity for the submission lock, including when clients omit attachment fields.
 select * into prior from public.closeout_receipts where id=p_id;
 if coalesce(prior.closeout_key,target_key) is not null then perform pg_advisory_xact_lock(hashtextextended('closeout-submit:'||coalesce(prior.user_id::text,p_values->>'user_id',auth.uid()::text)||coalesce(prior.closeout_key,target_key)::text,0));end if;
 select * into prior from public.closeout_receipts where id=p_id for update;
 if prior.id is not null then
  if prior.location_id<>p_location_id or prior.deleted_at is not null or (not manager and prior.user_id<>auth.uid()) then raise exception 'Receipt access denied.' using errcode='42501';end if;
  if prior.version is distinct from p_version then raise exception 'Receipt changed. Reopen the wallet.';end if;
  if target_key is not null and prior.closeout_key is not null and target_key<>prior.closeout_key then raise exception 'A receipt already belongs to another closeout.';end if;
  r:=prior;
 else
  r.id:=p_id;r.location_id:=p_location_id;r.user_id:=coalesce((p_values->>'user_id')::uuid,auth.uid());r.created_by:=auth.uid();r.business_date:=(p_values->>'business_date')::date;r.closeout_key:=target_key;r.shift_id:=(p_values->>'shift_id')::uuid;
  r.file_mime:=p_values->>'file_mime';r.file_path:=p_location_id::text||'/'||p_id::text||'/original';r.origin_bucket:='closeout-receipts';r.source_purchase_id:=(p_values->>'source_purchase_id')::uuid;r.kind:='void';r.check_number:='';r.notes:='';r.ready:=false;r.version:=0;r.created_at:=now();
 end if;
 if prior.id is null and r.source_purchase_id is not null then
  select * into source from public.purchase_receipts where id=r.source_purchase_id and location_id=p_location_id;
  if source.id is null or source.user_id<>r.user_id or source.purchase_date<>r.business_date or source.file_path is null or source.file_mime is null or source.data->>'source' is distinct from 'photo' then raise exception 'Choose a saved receipt photo for this employee and date.';end if;
  r.origin_bucket:='purchase-receipts';r.file_path:=source.file_path;r.file_mime:=source.file_mime;r.kind:=case when source.data->>'category'='Comp receipt' then 'comp' else 'void' end;r.amount:=source.total;r.check_number:=left(coalesce(source.data->>'vendor',''),100);r.notes:=left(coalesce(source.data->>'notes',''),2000);
 end if;
 if not manager and r.user_id<>auth.uid() then raise exception 'Choose your own employee profile.' using errcode='42501';end if;
 if not exists(select 1 from public.location_memberships where location_id=p_location_id and user_id=r.user_id and status='active') then raise exception 'Choose an active employee.';end if;
 if r.business_date is null or r.business_date>((now() at time zone 'America/Chicago')::date) or r.file_mime not in ('image/jpeg','image/png','image/webp','application/pdf') then raise exception 'Choose a valid date and receipt file.';end if;
 if r.shift_id is not null and not exists(select 1 from public.shifts where id=r.shift_id and location_id=p_location_id and shift_date=r.business_date) then raise exception 'Shift does not match this date.';end if;
 -- A receipt may be attached later, but cannot be moved away from a saved closeout.
 if p_values ? 'closeout_key' and r.closeout_key is null then r.closeout_key:=target_key;end if;
 select * into c from public.daily_closeouts where id=r.closeout_key for update;
 if c.id is not null then
  if c.location_id<>p_location_id or c.user_id<>r.user_id or c.closeout_date<>r.business_date or c.deleted_at is not null then raise exception 'Receipt and closeout must match employee, location and date.';end if;
  if c.status='submitted' and not manager then raise exception 'A manager must edit receipts on submitted closeouts.' using errcode='42501';end if;
  if c.status='submitted' and length(btrim(p_change_note))<3 then raise exception 'Enter a reason for changing this submitted closeout.';end if;
 elsif r.closeout_key is not null and r.user_id<>auth.uid() then raise exception 'For another employee, select their saved closeout or save an unattached photo first.';end if;
 if p_values ? 'kind' then r.kind:=p_values->>'kind';end if;
 if p_values ? 'reason' then r.reason:=nullif(p_values->>'reason','');end if;
 if p_values ? 'amount' then r.amount:=nullif(p_values->>'amount','')::numeric;end if;
 if p_values ? 'check_number' then r.check_number:=btrim(p_values->>'check_number');end if;
 if p_values ? 'notes' then r.notes:=p_values->>'notes';end if;
 if length(r.notes)>2000 or length(r.check_number)>100 or length(p_change_note)>2000 then raise exception 'Receipt text is too long.';end if;
 if p_values ? 'ready' then r.ready:=(p_values->>'ready')::boolean;end if;
 if coalesce((p_values->>'remove')::boolean,false) then r.deleted_at:=now();end if;
 if r.ready and (r.reason is null or r.amount is null or not exists(select 1 from storage.objects where bucket_id=r.origin_bucket and name=r.file_path)) then raise exception 'Upload the photo and enter an amount and reason first.';end if;
 r.version:=r.version+1;r.updated_at:=clock_timestamp();
 insert into public.closeout_receipts select r.* on conflict(id) do update set closeout_key=excluded.closeout_key,kind=excluded.kind,reason=excluded.reason,amount=excluded.amount,check_number=excluded.check_number,notes=excluded.notes,ready=excluded.ready,deleted_at=excluded.deleted_at,version=excluded.version,updated_at=excluded.updated_at;
 insert into public.closeout_receipt_audit(receipt_id,actor_id,before_record,after_record) values(r.id,auth.uid(),case when prior.id is null then null else to_jsonb(prior) end,to_jsonb(r)||jsonb_build_object('change_note',p_change_note));
 if c.status='submitted' then update public.daily_closeouts set receipt_reason_policy=true,correction_note=left(btrim(p_change_note),1800)||E'\nReceipt '||r.id::text||' version '||r.version::text where id=c.id;end if;
 return to_jsonb(r);
end;$$;

-- Runs after the established validation trigger, before its point ledger synchronizer.
create or replace function public.closeout_receipt_score() returns trigger language plpgsql security definer set search_path='' as $$
declare r record; summary jsonb; delta integer; vcount integer; vtotal numeric; ctotal numeric;
begin
 if TG_OP='INSERT' then new.receipt_reason_policy:=true;
 elsif old.status<>'submitted' then new.receipt_reason_policy:=true;
 elsif old.receipt_reason_policy and not new.receipt_reason_policy then raise exception 'Receipt-based scoring cannot be disabled.';end if;
 if new.status<>'submitted' or not new.receipt_reason_policy or new.deleted_at is not null then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended('closeout-submit:'||new.user_id::text||new.id::text,0));
 if TG_OP='INSERT' or old.status<>'submitted' then
  if exists(select 1 from public.closeout_receipts x where x.closeout_key=new.id and x.deleted_at is null and (x.location_id<>new.location_id or x.user_id<>new.user_id or x.business_date<>new.closeout_date or not x.ready)) then raise exception 'Complete every attached receipt with its photo, amount and reason.';end if;
  select count(*) filter(where kind='void'),coalesce(sum(amount) filter(where kind='void'),0),coalesce(sum(amount) filter(where kind in ('comp','discount')),0) into vcount,vtotal,ctotal from public.closeout_receipts where closeout_key=new.id and deleted_at is null and ready;
  if coalesce(new.omitted_questions,'[]'::jsonb) ? 'staff_6' then new.void_count:=vcount;new.void_value:=vtotal;end if;
  if coalesce(new.omitted_questions,'[]'::jsonb) ? 'staff_7' then new.discount_value:=ctotal;end if;
  if new.void_count<>vcount or new.void_value<>vtotal or new.discount_value<>ctotal then raise exception 'Receipt entries must match the closeout void count, void total and comp/discount total.';end if;
 end if;
 select coalesce(jsonb_agg(x),'[]'::jsonb) into summary from jsonb_array_elements(new.points_summary) x where x->>'code' not in ('VOID_OVER_15','DISCOUNT_OVER_15','VOID_SERVER_ERROR','COMP_SERVER_ERROR');
 for r in select kind,count(*) n from public.closeout_receipts where closeout_key=new.id and deleted_at is null and ready and reason in ('server_error','spill_waste_server_error') group by kind loop
  summary:=summary||jsonb_build_array(jsonb_build_object('code',case when r.kind='void' then 'VOID_SERVER_ERROR' else 'COMP_SERVER_ERROR' end,'points',-5*r.n,'description',r.n||' '||r.kind||' entries: server error (-5 each)'));
 end loop;
 -- Merge comp and discount deductions into one stable ledger code.
 select coalesce(jsonb_agg(jsonb_build_object('code',code,'points',pts,'description',description)),'[]'::jsonb) into summary from (select x->>'code' code,sum((x->>'points')::integer) pts,string_agg(x->>'description','; ') description from jsonb_array_elements(summary) x group by x->>'code') t;
 select coalesce(sum((x->>'points')::integer),0) into delta from jsonb_array_elements(summary) x;
 new.points_summary:=summary;new.points_delta:=delta;new.shift_score:=100+delta;
 return new;
end;$$;
drop trigger if exists zzz_closeout_receipt_score on public.daily_closeouts;
create trigger zzz_closeout_receipt_score before insert or update on public.daily_closeouts for each row execute function public.closeout_receipt_score();
-- Extend the existing ledger reset and write guard without replacing its other logic.
do $$declare def text;begin
 def:=pg_get_functiondef('public.closeout_sync_scored_points()'::regprocedure);
 if position('VOID_SERVER_ERROR' in def)=0 then
  if position('''VOID_OVER_15'',''DISCOUNT_OVER_15''' in def)=0 then raise exception 'Point synchronizer changed; migration stopped.';end if;
  execute replace(def,'''VOID_OVER_15'',''DISCOUNT_OVER_15''','''VOID_OVER_15'',''DISCOUNT_OVER_15'',''VOID_SERVER_ERROR'',''COMP_SERVER_ERROR''');
 end if;
 def:=pg_get_functiondef('public.closeout_guard_scored_points()'::regprocedure);
 if position('VOID_SERVER_ERROR' in def)=0 then
  if position('''VOID_OVER_15'',''DISCOUNT_OVER_15''' in def)=0 then raise exception 'Point write guard changed; migration stopped.';end if;
  execute replace(def,'''VOID_OVER_15'',''DISCOUNT_OVER_15''','''VOID_OVER_15'',''DISCOUNT_OVER_15'',''VOID_SERVER_ERROR'',''COMP_SERVER_ERROR''');
 end if;
end;$$;
revoke all on function public.closeout_receipt_file_access(text,boolean),public.closeout_receipts_load(uuid,date,date,uuid,uuid),public.closeout_receipt_save(uuid,uuid,integer,jsonb,text),public.closeout_receipt_score() from public,anon,authenticated;
grant execute on function public.closeout_receipt_file_access(text,boolean),public.closeout_receipts_load(uuid,date,date,uuid,uuid),public.closeout_receipt_save(uuid,uuid,integer,jsonb,text) to authenticated;
commit;

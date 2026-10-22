begin;
do $check$
begin
 if to_regprocedure('public.closeout_receipt_save(uuid,uuid,integer,jsonb,text)') is null or to_regprocedure('public.closeout_receipts_load(uuid,date,date,uuid,uuid)') is null then
  raise exception 'Install the existing receipt closeout update first.';
 end if;
end;$check$;
alter table public.closeout_receipts add column if not exists verified_by uuid references public.profiles(id);
alter table public.closeout_receipts add column if not exists verifier_name text;
alter table public.closeout_receipts add column if not exists details_saved_at timestamptz;
alter table public.closeout_receipts add column if not exists added_at timestamptz;
alter table public.closeout_receipts add column if not exists added_by uuid references public.profiles(id);
alter table public.closeout_receipts add column if not exists legacy_linked boolean;
-- Keep prior linked receipts and scoring. Unknown historical verifier names stay unknown.
update public.closeout_receipts r set legacy_linked=true
where r.closeout_key is not null and r.added_at is null and r.legacy_linked is null
and (r.ready or exists(select 1 from public.daily_closeouts c where c.id=r.closeout_key));
-- An unfinished photo reserved against an unsaved closeout returns to Unsubmitted.
with prior as (select r.* from public.closeout_receipts r where r.closeout_key is not null and not r.ready and r.added_at is null and not coalesce(r.legacy_linked,false)
 and not exists(select 1 from public.daily_closeouts c where c.id=r.closeout_key)),moved as (
 update public.closeout_receipts r set closeout_key=null,version=r.version+1,updated_at=clock_timestamp() from prior p where r.id=p.id
 returning r.id,r.created_by,to_jsonb(p) before_record,to_jsonb(r) after_record)
insert into public.closeout_receipt_audit(receipt_id,actor_id,before_record,after_record)
select id,created_by,before_record,after_record||'{"change_note":"Unfinished photo returned to Unsubmitted during wallet upgrade"}'::jsonb from moved;

do $preserve$
begin
 if to_regprocedure('public.closeout_receipt_save_before_wallet_flow(uuid,uuid,integer,jsonb,text)') is null then
  alter function public.closeout_receipt_save(uuid,uuid,integer,jsonb,text) rename to closeout_receipt_save_before_wallet_flow;
 end if;
 if to_regprocedure('public.closeout_receipts_load_before_wallet_flow(uuid,date,date,uuid,uuid)') is null then
  alter function public.closeout_receipts_load(uuid,date,date,uuid,uuid) rename to closeout_receipts_load_before_wallet_flow;
 end if;
end;$preserve$;
revoke all on function public.closeout_receipt_save_before_wallet_flow(uuid,uuid,integer,jsonb,text),public.closeout_receipts_load_before_wallet_flow(uuid,date,date,uuid,uuid) from public,anon,authenticated;

create or replace function public.closeout_receipt_save(p_location_id uuid,p_id uuid,p_version integer,p_values jsonb,p_change_note text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved jsonb; prior public.closeout_receipts%rowtype; result public.closeout_receipts%rowtype; verifier uuid; name text;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Location access required.' using errcode='42501';end if;
 if jsonb_typeof(p_values) is distinct from 'object' then raise exception 'Invalid receipt.';end if;
 select * into prior from public.closeout_receipts where id=p_id and location_id=p_location_id;
 if nullif(p_values->>'closeout_key','') is not null and (prior.id is null or prior.closeout_key is null or (prior.added_at is null and not coalesce(prior.legacy_linked,false))) then
  raise exception 'Save receipt details first, then choose Add to closeout.';
 end if;
 verifier:=case when p_values ? 'verified_by' then nullif(p_values->>'verified_by','')::uuid else prior.verified_by end;
 name:=case when p_values ? 'verifier_name' then btrim(p_values->>'verifier_name') else prior.verifier_name end;
 if verifier is not null then
  select coalesce(nullif(p.preferred_name,''),nullif(p.full_name,'')) into name from public.profiles p
  join public.location_memberships m on m.user_id=p.id and m.location_id=p_location_id and m.status='active' where p.id=verifier;
  if not found or name is null then raise exception 'Choose an active verifier from this location or enter their name.';end if;
 end if;
 if length(coalesce(name,''))>160 then raise exception 'Keep the verifier name within 160 characters.';end if;
 if not coalesce((p_values->>'remove')::boolean,false) and coalesce((p_values->>'ready')::boolean,prior.ready,false) and nullif(btrim(name),'') is null then raise exception 'Enter who verified this void or comp before completing the receipt.';end if;
 saved:=public.closeout_receipt_save_before_wallet_flow(p_location_id,p_id,p_version,p_values-array['verified_by','verifier_name'],p_change_note);
 update public.closeout_receipts set verified_by=verifier,verifier_name=nullif(btrim(name),''),details_saved_at=case when p_values ? 'amount' or p_values ? 'reason' then clock_timestamp() else details_saved_at end where id=p_id returning * into result;
 insert into public.closeout_receipt_audit(receipt_id,actor_id,before_record,after_record)
 values(p_id,auth.uid(),saved,to_jsonb(result)||'{"event":"Receipt details saved; verifier recorded"}'::jsonb);
 return to_jsonb(result);
end;$$;

create or replace function public.closeout_receipt_add(p_location_id uuid,p_id uuid,p_version integer,p_closeout_key uuid,p_change_note text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.closeout_receipts%rowtype; result public.closeout_receipts%rowtype; saved jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Location access required.' using errcode='42501';end if;
 select * into r from public.closeout_receipts where id=p_id and location_id=p_location_id and deleted_at is null;
 if r.id is null or (r.user_id<>auth.uid() and public.mod_is_manager(p_location_id) is not true) then raise exception 'Receipt access denied.' using errcode='42501';end if;
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

create or replace function public.closeout_receipts_load(p_location_id uuid,p_start date,p_end date,p_user_id uuid default null,p_closeout_key uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; owner uuid; selected_user uuid; enriched jsonb; photos jsonb;
begin
 selected_user:=p_user_id;
 if p_closeout_key is not null then
  select user_id into owner from public.daily_closeouts where id=p_closeout_key and location_id=p_location_id;
  selected_user:=coalesce(owner,p_user_id,auth.uid());
  if p_user_id is not null and p_user_id<>selected_user then raise exception 'Receipt and closeout employee must match.';end if;
 end if;
 result:=public.closeout_receipts_load_before_wallet_flow(p_location_id,p_start,p_end,selected_user,null);
 select coalesce(jsonb_agg(value||jsonb_build_object('has_file',exists(select 1 from storage.objects o where o.bucket_id=coalesce(value->>'origin_bucket','closeout-receipts') and o.name=value->>'file_path'))),'[]'::jsonb) into enriched from jsonb_array_elements(result->'rows');
 select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('employee',coalesce(nullif(p.preferred_name,''),p.full_name),'has_file',exists(select 1 from storage.objects o where o.bucket_id='purchase-receipts' and o.name=r.file_path)) order by r.purchase_date desc,r.created_at desc),'[]'::jsonb)
 into photos from public.purchase_receipts r join public.profiles p on p.id=r.user_id
 where r.location_id=p_location_id and r.purchase_date between p_start and p_end and r.data->>'source'='photo'
 and ((result->>'manager')::boolean or r.user_id=auth.uid()) and (selected_user is null or r.user_id=selected_user)
 and not exists(select 1 from public.closeout_receipts x where x.source_purchase_id=r.id);
 return result||jsonb_build_object('rows',enriched,'photos',photos);
end;$$;

create or replace function public.closeout_receipts_daily_summary(p_location_id uuid,p_day date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare data jsonb; receipt_totals jsonb; pos_totals jsonb; pending integer;
begin
 data:=public.closeout_receipts_load(p_location_id,p_day,p_day,null,null);
 select jsonb_build_object('void_count',count(*) filter(where value->>'kind'='void'),'void_total',coalesce(sum((value->>'amount')::numeric) filter(where value->>'kind'='void'),0),
 'comp_count',count(*) filter(where value->>'kind'='comp'),'comp_total',coalesce(sum((value->>'amount')::numeric) filter(where value->>'kind'='comp'),0),
 'discount_count',count(*) filter(where value->>'kind'='discount'),'discount_total',coalesce(sum((value->>'amount')::numeric) filter(where value->>'kind'='discount'),0)) into receipt_totals
 from jsonb_array_elements(data->'rows') where (value->>'submitted')::boolean is true and (value->>'ready')::boolean is true and (value->>'closeout_deleted')::boolean is not true;
 select count(*) into pending from jsonb_array_elements(data->'rows') where (value->>'submitted')::boolean is not true and (value->>'closeout_deleted')::boolean is not true;
 select jsonb_build_object('void_count',coalesce(sum(c.void_count),0),'void_total',coalesce(sum(c.void_value),0),'comps_discounts_total',coalesce(sum(c.discount_value),0)) into pos_totals
 from public.daily_closeouts c where c.location_id=p_location_id and c.closeout_date=p_day and c.status='submitted' and c.deleted_at is null and ((data->>'manager')::boolean or c.user_id=auth.uid());
 return jsonb_build_object('manager',data->'manager','receipts',receipt_totals,'closeouts',pos_totals,'pending',pending,'unreviewed_photos',jsonb_array_length(data->'photos'));
end;$$;
revoke all on function public.closeout_receipt_save(uuid,uuid,integer,jsonb,text),public.closeout_receipt_add(uuid,uuid,integer,uuid,text),public.closeout_receipts_load(uuid,date,date,uuid,uuid),public.closeout_receipts_daily_summary(uuid,date) from public,anon,authenticated;
grant execute on function public.closeout_receipt_save(uuid,uuid,integer,jsonb,text),public.closeout_receipt_add(uuid,uuid,integer,uuid,text),public.closeout_receipts_load(uuid,date,date,uuid,uuid),public.closeout_receipts_daily_summary(uuid,date) to authenticated;
notify pgrst,'reload schema';
commit;

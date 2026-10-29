begin;
create or replace function public.reservation_future_load(p_location_id uuid,p_day date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then raise exception 'Management access required.' using errcode='42501';end if;
 perform public.app_access_assert(p_location_id,'floor','reservations');
 if p_day is null or p_day<(now() at time zone 'America/Chicago')::date then raise exception 'Choose today or a future date.';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'edit_version',edit_version,'guest_name',guest_name,'reservation_date',reservation_date,'reservation_time',reservation_time,'party_size',party_size,'phone',phone,'email',email,'notes',notes,'status',status) order by reservation_time,id) from public.reservations where location_id=p_location_id and reservation_date=p_day and coalesce(status,'booked') not in ('cancelled','canceled')),'[]'::jsonb);
end;$$;
create or replace function public.reservation_future_change(p_location_id uuid,p_id uuid,p_version integer,p_remove boolean,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare before_row public.reservations;after_row public.reservations;day date;clock time;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then raise exception 'Management access required.' using errcode='42501';end if;
 perform public.app_access_assert(p_location_id,'floor','reservations');
 select * into before_row from public.reservations where id=p_id and location_id=p_location_id for update;
 if not found then raise exception 'Reservation unavailable.';end if;
 if before_row.edit_version is distinct from p_version then raise exception 'This reservation changed. Refresh and reopen it.';end if;
 if before_row.reservation_date<(now() at time zone 'America/Chicago')::date or before_row.status in ('seated','completed','cancelled','canceled') then raise exception 'Only active reservations for today or future dates can be changed here.';end if;
 if p_remove is true then
  update public.reservations set status='cancelled' where id=p_id returning * into after_row;
 else
  day:=(p_data->>'reservation_date')::date;clock:=(p_data->>'reservation_time')::time;
  if day is null or day<(now() at time zone 'America/Chicago')::date or clock is null or length(btrim(coalesce(p_data->>'guest_name',''))) not between 1 and 200 or coalesce(p_data->>'party_size','') !~ '^[0-9]{1,3}$' or (p_data->>'party_size')::integer not between 1 and 500 or length(coalesce(p_data->>'notes',''))>4000 or length(coalesce(p_data->>'phone',''))>100 or length(coalesce(p_data->>'email',''))>250 then raise exception 'Review guest name, date, time, party size and contact details.';end if;
  update public.reservations set guest_name=btrim(p_data->>'guest_name'),reservation_date=day,reservation_time=clock,party_size=(p_data->>'party_size')::integer,phone=nullif(btrim(p_data->>'phone'),''),email=nullif(btrim(p_data->>'email'),''),notes=nullif(btrim(p_data->>'notes'),'') where id=p_id returning * into after_row;
 end if;
 insert into public.reservation_edit_audit(location_id,reservation_id,changed_by,before_record,after_record) values(p_location_id,p_id,auth.uid(),to_jsonb(before_row),to_jsonb(after_row));
 return to_jsonb(after_row);
end;$$;
revoke all on function public.reservation_future_load(uuid,date),public.reservation_future_change(uuid,uuid,integer,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.reservation_future_load(uuid,date),public.reservation_future_change(uuid,uuid,integer,boolean,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;

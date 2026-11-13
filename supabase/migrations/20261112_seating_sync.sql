begin;
alter table public.table_sessions
  add column if not exists reservation_id uuid references public.reservations(id);
create or replace function public.sync_seated_reservation_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.source<>'reservation' or new.reservation_id is null then return new;end if;
 update public.reservations
 set status='seated',edit_version=coalesce(edit_version,0)+1
 where id=new.reservation_id and location_id=new.location_id
 and lower(coalesce(status,'')) not in ('cancelled','canceled','no_show','completed');
 if not found then raise exception 'Reservation changed. Refresh before seating.';end if;
 update public.table_sessions set reservation_id=new.reservation_id
 where id=new.session_id and location_id=new.location_id
 and (reservation_id is null or reservation_id=new.reservation_id);
 if not found then raise exception 'Seating session unavailable or linked to another reservation.';end if;
 return new;
end $$;
revoke all on function public.sync_seated_reservation_v1() from public,anon,authenticated;
drop trigger if exists sync_seated_reservation_v1 on public.floor_seating_history_v1;
create trigger sync_seated_reservation_v1 after insert on public.floor_seating_history_v1
for each row execute function public.sync_seated_reservation_v1();
commit;

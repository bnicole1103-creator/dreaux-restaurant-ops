begin;

create or replace function public.inquiry_studio_authorize(p_location_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $function$
  select auth.uid() is not null
    and public.mod_is_manager(p_location_id)
    and exists (
      select 1 from public.locations
      where id = p_location_id and is_active
        and lower(replace(name, '’', '''')) = 'justini''s new orleans'
    );
$function$;

create or replace function public.inquiry_combined_host_load(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
begin
  if not public.inquiry_studio_authorize(p_location_id) then
    raise exception 'Manager access required.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(r) order by r.created_at desc)
    from (
      select id, guest_name, phone, email, party_size, inquiry_type,
        preferred_date, preferred_time, second_preferred_time,
        third_preferred_time, guest_notes, internal_notes, preset_label,
        status, created_at
      from public.reservation_inquiries
      where location_id = p_location_id
      order by created_at desc limit 2000
    ) r
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.inquiry_studio_authorize(uuid) from public, anon;
revoke all on function public.inquiry_combined_host_load(uuid) from public, anon;
grant execute on function public.inquiry_studio_authorize(uuid),
  public.inquiry_combined_host_load(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;

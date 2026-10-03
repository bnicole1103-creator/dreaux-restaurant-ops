begin;
create or replace function public.floor_apply_photo_layout(p_location_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare n integer; missing jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or not (
 public.mod_is_manager(p_location_id) is true or exists(select 1 from public.location_memberships m where m.location_id=p_location_id and m.user_id=auth.uid() and m.status='active' and m.can_edit_floor)) then
 raise exception 'Floor editing access required.' using errcode='42501'; end if;
 if exists(select 1 from public.floor_tables t where t.location_id=p_location_id and t.is_active group by regexp_replace(lower(t.table_name),'[^a-z0-9]','','g') having count(*)>1) then
 raise exception 'Duplicate table labels require review before applying this layout.'; end if;
 with preset(label,shape,x,y,w,h) as (values ('b1','round',3.5,10.71429,9,8.57143),
('b2','round',16.5,10.71429,9,8.57143),
('b3','round',30.5,10.71429,9,8.57143),
('b4','round',44.5,10.71429,9,8.57143),
('b5','round',58.5,10.71429,9,8.57143),
('b6','round',72.5,10.71429,9,8.57143),
('h1','round',16.5,31.71429,9,8.57143),
('h2','round',32.5,31.71429,9,8.57143),
('h3','round',48.5,31.71429,9,8.57143),
('h4','round',64.5,31.71429,9,8.57143),
('h5','round',16.5,48.71429,9,8.57143),
('h6','round',32.5,48.71429,9,8.57143),
('h7','round',48.5,48.71429,9,8.57143),
('h8','round',64.5,48.71429,9,8.57143),
('hi2','round',86.5,37.71429,9,8.57143),
('t1','round',4.5,73.71429,9,8.57143),
('t2','round',20.5,73.71429,9,8.57143),
('t3','round',36.5,73.71429,9,8.57143),
('t4','round',52.5,73.71429,9,8.57143),
('t5','round',68.5,73.71429,9,8.57143),
('t6','round',84.5,73.71429,9,8.57143),
('l12','square',2.5,13.0,9,10),
('l13','square',2.5,28.0,9,10),
('l11','square',2.5,51.0,9,10),
('l10','square',20.5,29.0,9,10),
('l9','square',31.5,29.0,9,10),
('l8','square',42.5,29.0,9,10),
('l7','square',53.5,29.0,9,10),
('l6','square',87.5,15.0,9,10),
('l5','square',87.5,43.0,9,10),
('l1','round',16.75,76.27778,8.5,9.44444),
('l2','round',25.75,76.27778,8.5,9.44444),
('l3','round',34.75,76.27778,8.5,9.44444),
('l4','round',43.75,76.27778,8.5,9.44444),
('c8','round',12.75,15.95238,8.5,8.09524),
('c7','round',36.75,15.95238,8.5,8.09524),
('c6','round',63.0,14.28571,12,11.42857),
('c5','round',87.75,15.95238,8.5,8.09524),
('c1','round',1.75,53.95238,8.5,8.09524),
('c4','round',89.75,55.95238,8.5,8.09524),
('c2','round',23.75,78.95238,8.5,8.09524),
('c3','round',49.75,78.95238,8.5,8.09524),
('g1','rectangle',31.0,39.0,38,22))
 update public.floor_tables t set shape=p.shape,position_x=p.x,position_y=p.y,width=p.w,height=p.h from preset p
 where t.location_id=p_location_id and t.is_active and regexp_replace(lower(t.table_name),'[^a-z0-9]','','g')=p.label;
 get diagnostics n = row_count;
 with preset(label,shape,x,y,w,h) as (values ('b1','round',3.5,10.71429,9,8.57143),
('b2','round',16.5,10.71429,9,8.57143),
('b3','round',30.5,10.71429,9,8.57143),
('b4','round',44.5,10.71429,9,8.57143),
('b5','round',58.5,10.71429,9,8.57143),
('b6','round',72.5,10.71429,9,8.57143),
('h1','round',16.5,31.71429,9,8.57143),
('h2','round',32.5,31.71429,9,8.57143),
('h3','round',48.5,31.71429,9,8.57143),
('h4','round',64.5,31.71429,9,8.57143),
('h5','round',16.5,48.71429,9,8.57143),
('h6','round',32.5,48.71429,9,8.57143),
('h7','round',48.5,48.71429,9,8.57143),
('h8','round',64.5,48.71429,9,8.57143),
('hi2','round',86.5,37.71429,9,8.57143),
('t1','round',4.5,73.71429,9,8.57143),
('t2','round',20.5,73.71429,9,8.57143),
('t3','round',36.5,73.71429,9,8.57143),
('t4','round',52.5,73.71429,9,8.57143),
('t5','round',68.5,73.71429,9,8.57143),
('t6','round',84.5,73.71429,9,8.57143),
('l12','square',2.5,13.0,9,10),
('l13','square',2.5,28.0,9,10),
('l11','square',2.5,51.0,9,10),
('l10','square',20.5,29.0,9,10),
('l9','square',31.5,29.0,9,10),
('l8','square',42.5,29.0,9,10),
('l7','square',53.5,29.0,9,10),
('l6','square',87.5,15.0,9,10),
('l5','square',87.5,43.0,9,10),
('l1','round',16.75,76.27778,8.5,9.44444),
('l2','round',25.75,76.27778,8.5,9.44444),
('l3','round',34.75,76.27778,8.5,9.44444),
('l4','round',43.75,76.27778,8.5,9.44444),
('c8','round',12.75,15.95238,8.5,8.09524),
('c7','round',36.75,15.95238,8.5,8.09524),
('c6','round',63.0,14.28571,12,11.42857),
('c5','round',87.75,15.95238,8.5,8.09524),
('c1','round',1.75,53.95238,8.5,8.09524),
('c4','round',89.75,55.95238,8.5,8.09524),
('c2','round',23.75,78.95238,8.5,8.09524),
('c3','round',49.75,78.95238,8.5,8.09524),
('g1','rectangle',31.0,39.0,38,22))
 select coalesce(jsonb_agg(p.label order by p.label),'[]'::jsonb) into missing from preset p
 where not exists(select 1 from public.floor_tables t where t.location_id=p_location_id and t.is_active and regexp_replace(lower(t.table_name),'[^a-z0-9]','','g')=p.label);
 return jsonb_build_object('updated',n,'missing',missing);
end;
$function$;
revoke all on function public.floor_apply_photo_layout(uuid) from public,anon,authenticated;
grant execute on function public.floor_apply_photo_layout(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;

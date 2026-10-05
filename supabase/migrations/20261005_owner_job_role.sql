begin;
update public.location_memberships m
set role = 'owner'
from public.closeout_permissions p
where p.location_id = m.location_id
  and p.user_id = m.user_id
  and p.access_level = 'owner'
  and m.role = 'general_manager';
notify pgrst, 'reload schema';
commit;

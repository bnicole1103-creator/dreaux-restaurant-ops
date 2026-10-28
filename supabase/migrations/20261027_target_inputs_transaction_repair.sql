begin;

-- Target input loaders initialize a settings row. Their wrappers must allow
-- that write; STABLE wrappers make PostgREST run the RPC read-only.
do $repair$
declare signature text; target regprocedure;
begin
 if to_regprocedure('public.sales_target_inputs(uuid,date)') is null then
  raise exception 'Sales target inputs are not installed. No changes applied.';
 end if;
 foreach signature in array array[
  'public.sales_target_inputs(uuid,date)',
  'shift_context_private.target_inputs_base(uuid,date)',
  'sales_month_private.inputs_before_dining(uuid,date)',
  'closeout_fix_private.inputs_before_personal(uuid,date)'
 ] loop
  target:=to_regprocedure(signature);
  if target is not null then
   execute format('alter function %s volatile',target);
  end if;
 end loop;
end
$repair$;

notify pgrst,'reload schema';
commit;

select p.oid::regprocedure::text as function_name,
 p.provolatile='v' as permits_settings_initialization
from pg_proc p
where p.oid in (
 to_regprocedure('public.sales_target_inputs(uuid,date)'),
 to_regprocedure('shift_context_private.target_inputs_base(uuid,date)'),
 to_regprocedure('sales_month_private.inputs_before_dining(uuid,date)'),
 to_regprocedure('closeout_fix_private.inputs_before_personal(uuid,date)')
);

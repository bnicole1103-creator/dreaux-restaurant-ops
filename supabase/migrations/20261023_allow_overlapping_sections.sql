begin;

do $update$
declare
  item record;
  original text;
  revised text;
  changed integer := 0;
  overlap_guard text := $pattern$\mif\M[[:space:]]+(exists|p_mode[[:space:]]*=[[:space:]]*'schedule'[[:space:]]+and[[:space:]]+exists|p_publish[[:space:]]+and[[:space:]]+exists|original->>'kind'[[:space:]]*=[[:space:]]*'plan'[[:space:]]+and[[:space:]]+exists)[[:space:]]*\([^;]*then[[:space:]]+raise exception '(These tables already have a planned section during that time[.] Edit that plan or choose another window[.]|A published section already uses these tables during this window[.] Edit or unpublish that plan first[.]|A table is assigned twice during the same shift or time[.]|These tables overlap another planned section[.]|These tables still have an untimed assignment[.] Edit that assignment with Assign now and an end time first[.]|Convert the overlapping untimed assignment to an end-time section before publishing this window[.])';[[:space:]]*end if;$pattern$;
begin
  if to_regprocedure(
    'public.floor_schedule_save_person(uuid,uuid,integer,text,uuid,uuid[],date,time without time zone,time without time zone,uuid,text)'
  ) is null then
    raise exception 'Install the section scheduling update before running this SQL.';
  end if;

  for item in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname in ('public', 'operations_workflow_private')
      and l.lanname = 'plpgsql'
      and p.proname in (
        'floor_schedule_save',
        'floor_schedule_save_person',
        'floor_section_save_window',
        'floor_schedule_publish',
        'floor_publish_before',
        'preshift_post_save_sections'
      )
  loop
    original := pg_get_functiondef(item.oid);
    revised := regexp_replace(original, overlap_guard, '', 'gi');

    if revised is distinct from original then
      execute revised;
      changed := changed + 1;
    end if;
  end loop;

  raise notice 'Updated % section functions. Overlapping tables can be saved and published.', changed;
end;
$update$;

notify pgrst, 'reload schema';

commit;

begin;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists supabase_vault with schema vault;
do $$
declare sid uuid;t text:='PASTE_PUSH_DISPATCH_TOKEN_HERE';
begin
 if t='PASTE_'||'PUSH_DISPATCH_TOKEN_HERE' then raise exception 'Run setup_push_keys.cjs and paste the generated .push-cron-setup.sql instead.';end if;
 select id into sid from vault.secrets where name='justinis_push_dispatch';
 if sid is null then perform vault.create_secret(t,'justinis_push_dispatch');
 else perform vault.update_secret(sid,t,'justinis_push_dispatch');end if;
end;$$;
create or replace function push_private.dispatch_tick() returns void language plpgsql security definer set search_path='' as $$
declare token text;
begin
 select decrypted_secret into token from vault.decrypted_secrets where name='justinis_push_dispatch';
 if token is null then return;end if;
 perform net.http_post(
 url:='https://ipgkhvnedtkfqtfflgow.supabase.co/functions/v1/push-dispatch',
 headers:=jsonb_build_object('Content-Type','application/json','x-push-dispatch-token',token),
 body:='{"action":"dispatch"}'::jsonb,timeout_milliseconds:=55000);
end;$$;
revoke all on function push_private.dispatch_tick() from public,anon,authenticated;
do $$declare jid bigint;begin
 for jid in select jobid from cron.job where jobname='justinis-push-dispatch' loop perform cron.unschedule(jid);end loop;
 perform cron.schedule('justinis-push-dispatch','* * * * *','select push_private.dispatch_tick()');
end;$$;
commit;

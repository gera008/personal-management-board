-- Scheduled jobs. Requires the pg_cron and pg_net extensions (enable them in
-- Dashboard > Database > Extensions) and two Vault secrets:
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<service_role key>', 'service_role_key');

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Apply due transactions and top up subscriptions every 15 minutes, so items
-- flip to "applied" shortly after local midnight in any time zone.
select cron.schedule('finance-jobs', '*/15 * * * *', $$select public.run_finance_jobs()$$);

-- Push reminders (events, tasks, habits, daily digest) every 5 minutes.
select cron.schedule(
  'send-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{"mode":"reminders"}'::jsonb
  )
  $$
);

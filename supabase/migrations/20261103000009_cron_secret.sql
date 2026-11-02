-- Reminder job authenticates with a dedicated secret instead of the
-- service-role key (works with Supabase's new sb_secret_ keys too). Needs two
-- Vault secrets, created once in the SQL editor:
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<random value, same as the CRON_SECRET function secret>', 'cron_secret');

select cron.unschedule('send-reminders') where exists (select 1 from cron.job where jobname = 'send-reminders');

select cron.schedule(
  'send-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{"mode":"reminders"}'::jsonb
  )
  $$
);

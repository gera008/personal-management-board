-- Google Calendar sync every 10 minutes (same cron secret as the other jobs).
select cron.unschedule('google-sync') where exists (select 1 from cron.job where jobname = 'google-sync');
select cron.schedule(
  'google-sync',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/google',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{"mode":"sync"}'::jsonb
  )
  $$
);

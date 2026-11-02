-- Sync every 6 hours (uses the same cron secret as the reminders job).
select cron.unschedule('garmin-sync') where exists (select 1 from cron.job where jobname = 'garmin-sync');
select cron.schedule(
  'garmin-sync',
  '15 */6 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/garmin',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{"mode":"sync"}'::jsonb
  )
  $$
);

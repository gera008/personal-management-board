-- Reset the demo account every night (03:00 Monterrey) so visitors always see it fresh.
-- Does nothing until a user with this email exists.
select cron.unschedule('demo-reset') where exists (select 1 from cron.job where jobname = 'demo-reset');
select cron.schedule(
  'demo-reset',
  '0 9 * * *',
  $$ select public.seed_demo(email) from auth.users where email = 'demo@example.com' $$
);

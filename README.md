# Personal Hub

Personal management PWA: dashboard, calendar, lists & tasks, finance (Money Manager style) and a habit tracker. React + TypeScript + Vite + Tailwind, Supabase (Postgres + RLS, Auth, Edge Functions, pg_cron), Web Push.

The app starts empty. Only three task lists (Personal, School, Work) and the MXN rate are created for a new user.

## Local development

Node 22 is installed with nvm (`~/.nvm`). In a new terminal, `nvm use 22` (or open a fresh shell).

```bash
npm install
cp .env.example .env.local   # fill in the values below
npm run dev                  # http://localhost:5173
npm test                     # unit tests: finance totals, recurring schedule, habit streaks, import
npm run build                # typecheck + production build
```

## One-time Supabase setup (hosted project)

1. Create a project at supabase.com. In **Project Settings › API**, copy the Project URL and the `anon` public key into `.env.local`:
   ```
   VITE_SUPABASE_URL=https://<ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon key>
   ```
2. **Database › Extensions**: enable `pg_cron` and `pg_net`.
3. Apply the migrations in `supabase/migrations` (in order). Either paste each file into the SQL editor, or:
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```
4. Store two Vault secrets so the cron job can call the push function (SQL editor):
   ```sql
   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
   select vault.create_secret('<service_role key>', 'service_role_key');
   ```
5. **Authentication › URL configuration**: set the Site URL to your deployed URL (and add `http://localhost:5173` to redirect URLs).

## Push notifications

1. Generate VAPID keys: `npx web-push generate-vapid-keys`
2. Put the public key in `.env.local` (and in Vercel) as `VITE_VAPID_PUBLIC_KEY`.
3. Set the function secrets and deploy:
   ```bash
   npx supabase secrets set VAPID_PUBLIC_KEY=<public> VAPID_PRIVATE_KEY=<private> VAPID_SUBJECT=mailto:<your email>
   npx supabase functions deploy push
   ```
4. In the app: **Settings › Notifications › Enable**, then **Send test**.

Android Chrome and desktop Chrome work directly. On iOS 16.4+ the app must be added to the Home Screen first.

## Scheduled jobs

| Job | Schedule | What it does |
|---|---|---|
| `finance-jobs` | every 15 min | `run_finance_jobs()`: applies pending transactions whose date has arrived, tops up subscriptions (12 months ahead), closes finished series |
| `send-reminders` | every 5 min | calls the `push` Edge Function: event reminders, task reminders, habit reminders, daily digest of tasks due (Settings › digest time, in the profile time zone) |

## Deploy (Vercel)

Import the repo, framework preset **Vite**, and set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_VAPID_PUBLIC_KEY`. Add a rewrite so deep links work:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

(already in `vercel.json`).

## Key design decisions

- **Money:** every transaction stores its original amount, currency, the exchange rate used, and the MXN value, so historical totals never change when rates are edited.
- **Transfers:** two linked rows (out/in) sharing `transfer_pair_id`, each in its own account's currency. Deleting one side deletes both.
- **Balances:** `account_balances` view = initial balance + applied transactions. Pending rows don't count until applied.
- **Recurring:** creating a series generates its future payments as `pending` (all payments for installments, 12 months for subscriptions). The job applies them on their date. Editing rebuilds only future pending payments, and cancelling removes them; paid history is untouched.
- **Habits:** bad habits count "días sin" (days without a slip). "X times per week" habits count their streak in weeks. Weeks start on the profile's week start (Sunday by default).
- **Import:** Money Manager Excel parsed in the browser with a preview and per-issue choices. Each row gets a stable hash (`import_hash`, unique per user), so re-importing the same file adds nothing.
- **RLS:** every table has `user_id` and owner-only policies.

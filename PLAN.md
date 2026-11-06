# Mios — MVP Plan

Status: **draft, waiting for confirmation**. Nothing is built yet.

## 0. Environment findings (blockers first)

- **Node.js is not installed** on this Mac (no `node`, `npm`, `brew`, or Docker). It's needed before setup can start. Recommended: install Node 22 LTS from nodejs.org (the .pkg installer), or let me install it with `nvm`. That second option downloads and runs an install script, so I'll only do it if you say yes.
- **Supabase:** local Supabase needs Docker, which isn't installed. Recommended: a free hosted Supabase project for dev. I'd use the Supabase CLI through `npx supabase` for migrations, and pure-logic tests run without a DB.
- **Git:** the folder isn't a repo yet. I'll run `git init` at setup and make small commits.

### What the sample export actually contains (verified)

| Fact | Value |
|---|---|
| Rows | 1,813 (May 11 2025 → Jun 17 2028) |
| Exp. / Income / Transfer-In / Transfer-Out | 1,409 / 164 / 120 / 120 |
| Currencies | MXN 1,750, CAD 63 |
| Accounts | 12 (Credit Card (Azul), Tarjeta de Vales, Ahorro, Credit Card (Oro), Debit Card, TD, Cash, Canada Cash, GBM, Ahorro Rosy, GBM Stocks, GBM Advisory) |
| Category/Subcategory pairs | 60 |
| Future-dated rows (after 2026-11-01) | 20, all "Pago mensualidad iPhone (n/20)" on Credit Card (Oro) |
| Duplicate subcategory names | Only "Reposición de gastos" vs "Reposición de Gastos" |
| Rows with a real time (not 00:00) | 101 |

Things the spec doesn't mention that the importer has to handle:

1. **For transfers, the `Category` column holds the other account.** A Transfer-Out row has `Accounts`=source and `Category`=destination, and Transfer-In is the reverse. Pairs share the exact same timestamp. I'll pair rows on (timestamp, account A↔B, amount).
2. **The CAD rate isn't exactly 13.84.** `MXN / Amount` ranges from 13.835 to 13.840 because MXN is rounded. Mismatch checks will use a tolerance of ±0.01 MXN per unit or ±0.5%. The rate I store will be `MXN / Amount`, not a hardcoded 13.84.
3. **4 cross-currency transfers** (TD and Canada Cash ↔ MXN accounts) are labeled `Currency = MXN`, but `Amount` is really the CAD side (e.g. Amount 2550, MXN 35,281.22). The importer will infer currency from the account's currency and flag these rows in the preview.
4. The trailing duplicate `Accounts` column holds an amount, not an account. It will be ignored as specified.

## 1. Tech decisions

- React 18 + TypeScript + Vite, `vite-plugin-pwa` (injectManifest mode, so push handling goes in a custom service worker).
- Tailwind with theme tokens as CSS variables (`--bg`, `--fg`, `--muted`, `--border`, `--accent-*`), plus a `[data-theme]` override for dark mode.
- TanStack Query for server state, Zustand only for tiny UI state (e.g. collapsed indicators). React Router.
- react-i18next with `en` (default) and `es` JSON namespaces per module.
- **Calendar: custom build** on `date-fns`. Month, week, day, and agenda are all simple grids or lists, and a custom calendar matches the grayscale/e-ink look better than FullCalendar's styling.
- Recharts for analytics. The heatmap is a custom SVG grid (lighter and fully themeable).
- Excel parsing with SheetJS (`xlsx`) **in the browser**, so the preview runs client-side and the commit goes to an RPC in batches.
- Money as `numeric(14,2)`, rates as `numeric(14,6)`. Dates are stored as `timestamptz` with the user's time zone kept in `profiles.timezone` (default `America/Monterrey`).
- Tests: Vitest for pure domain logic (totals, recurrence, streaks, import parsing) and pgTAP-style SQL tests later if useful. Playwright smoke tests are optional.
- Hosting: Vercel.

## 2. Folder structure

```
personal-hub/
├─ src/
│  ├─ app/                 # router, providers, layout shell, bottom nav
│  ├─ lib/                 # supabase client, query client, i18n, dates, money
│  ├─ domain/              # PURE logic, fully unit-tested
│  │  ├─ finance/          # totals, indicators, projections, transfer pairing
│  │  ├─ recurring/        # next-occurrence, schedule generation
│  │  ├─ habits/           # schedule matching, streaks, completion %
│  │  └─ import/           # Excel import parser, normalizer, validator
│  ├─ features/
│  │  ├─ dashboard/        # widgets + registry
│  │  ├─ calendar/         # month/week/day/agenda + event form
│  │  ├─ tasks/            # lists, tasks, subtasks, Today view
│  │  ├─ finance/          # main, accounts, categories, budgets, recurring, analytics, import
│  │  ├─ habits/           # today, heatmap, habit form
│  │  └─ settings/
│  ├─ components/ui/       # buttons, sheets, inputs, collapsible, color dot…
│  ├─ locales/{en,es}/*.json
│  └─ sw.ts                # service worker (precache + push + notificationclick)
├─ supabase/
│  ├─ migrations/          # numbered SQL migrations
│  ├─ functions/           # edge functions: daily-job, send-reminders, push-test
│  └─ seed.sql
├─ tests/                  # vitest specs mirroring src/domain
└─ public/                 # icons, manifest assets
```

## 3. Database migrations

Each table gets `user_id uuid not null default auth.uid() references auth.users`, `created_at`, `updated_at`, and RLS enabled with four policies (`select/insert/update/delete using (user_id = auth.uid())`). Child tables without a direct `user_id` (subtasks) also get a `user_id` column, so all policies stay one-liners.

| # | Migration | Contents / changes vs. your draft |
|---|---|---|
| 001 | `profiles` | + `timezone`, `week_start` (0/1). `dashboard_layout jsonb` = `[{id, visible}]` in order. Trigger creates a profile, default lists, and default currency rates on signup. |
| 002 | `events` | As drafted. `reminder_minutes int null`, + `reminder_sent_at`. |
| 003 | `task_lists`, `tasks`, `subtasks` | `tasks.priority smallint 0–3`, `position`, + `reminder_sent_at`. Index on `(user_id, due_date)`. |
| 004 | `accounts` | + `position`, `include_in_total bool`, `external_key` (import). |
| 005 | `categories` | Two levels enforced by trigger (a parent can't have a parent). Unique `(user_id, type, parent_id, lower(name))`, which handles the "Gastos/gastos" duplicate. |
| 006 | `currency_rates` | PK `(user_id, currency)`. MXN is fixed at 1. |
| 007 | `recurring_series` | As drafted + `amount_mxn`, `exchange_rate`, `subcategory_id`, `occurrences_created int`, `day_of_month`. |
| 008 | `transactions` | `occurred_at timestamptz` (not date only, since the export has times). Transfers are **2 rows** sharing `transfer_pair_id`, each with its own account, currency, amount, and rate, plus a `direction in/out` field. `series_index int` (e.g. 2 of 20). `import_hash text` with a unique `(user_id, import_hash)` constraint for idempotency. `CHECK`s keep type/category/transfer fields consistent. |
| 009 | `budgets` | Unique `(user_id, category_id)`. |
| 010 | `habits`, `habit_logs` | `tags text[]` on habits (simpler than a join table). `frequency jsonb` = `{type: daily}` / `{type: weekdays, days:[1,3,5]}` / `{type: times_per_week, n:3}` / `{type: every_n_days, n:2}`. Logs are unique `(habit_id, date)`. |
| 011 | `push_subscriptions` | Unique `(user_id, endpoint)`. |
| 012 | Views/RPCs | `account_balances` view, `finance_indicators(range)` RPC, `import_transactions(jsonb)` RPC (single transaction, upserts on hash). |
| 013 | Cron | `pg_cron` + `pg_net`: hourly call to the `daily-job` edge function (it applies work that's due in each user's local time) and a **5-minute** call to `send-reminders`. |

**Balance rule:** account balance = `initial_balance + Σ applied signed amounts in the account's currency`. Pending rows are excluded from balances but shown in lists and projections.

**Recurring logic:** when a series is created, the app generates the **full schedule as pending transactions** for installments, and the next 12 occurrences for subscriptions (topped up by the job). The daily job flips `pending → applied` once `occurred_at <= now()` in the user's time zone. Editing "going forward" updates only pending rows. Cancelling deletes pending rows and keeps applied ones. This is idempotent and makes "2/20" progress and calendar previews trivial.

## 4. Screens

Bottom nav on mobile (Home · Calendar · Tasks · Finance · Habits) and a sidebar on desktop. Settings is in the header.

1. **Dashboard:** widget registry with 6 widgets, order/visibility from `profiles.dashboard_layout`.
2. **Calendar:** month (default) / week / day / agenda tabs, plus an event sheet (create/edit), and task chips that link to the task.
3. **Tasks:** Lists home (Today smart view + lists), list detail, and a task sheet (notes, due, time, priority, tags, subtasks, reminder). List create/edit (name, color, icon).
4. **Finance:** main view (collapsible indicators + day-grouped infinite list) and a transaction sheet (expense/income/transfer tabs, currency + rate suggestion). Sub-routes: Accounts, Account detail, Categories, Budgets, Recurring (+ series detail), Analytics (8 charts), Import (upload → preview + inconsistencies → commit → report), Export.
5. **Habits:** Today (check/number input/"slip" button + note), habit detail (streaks, %, goal progress, yearly heatmap), habit form, combined heatmap.
6. **Settings:** language, theme, currencies and rates, dashboard widgets (toggle + up/down), notifications (enable, test), data (import/export CSV/JSON).
7. **Auth:** email magic link / password sign-in page (single user, but real auth so RLS works).

## 5. Build order (matches your list), each step ending with run + tests + summary + commit

1. Project setup, PWA skeleton, auth shell, layout, theme tokens
2. Supabase schema + RLS (001–011) + seed
3. Settings + i18n
4. Calendar
5. Lists & Tasks
6. Finance core (accounts, categories, transactions, transfers, balances)
7. Recurring series + daily job
8. Budgets + indicators
9. Import (Excel)
10. Analytics
11. Habits
12. Dashboard
13. PWA install + Web Push + reminders

## 6. Open questions

1. **Node install:** OK for me to install Node via `nvm` (downloads a script), or will you install Node 22 LTS yourself?
2. **Supabase:** hosted project (you create it and give me the URL + anon key, and later the service-role key as an env var only, never in chat) or install Docker for local dev?
3. **Account currencies:** I assume `TD` and `Canada Cash` are **CAD** accounts and all others are MXN. Correct? Are `GBM`, `GBM Stocks`, and `GBM Advisory` investment accounts?
4. **Account types:** is "Tarjeta de Vales" `other` (meal vouchers)? Is "Ahorro Rosy" `savings`?
5. **Initial balances:** the export begins May 2025. Should initial balances be 0 (balance = sum of history), or will you enter today's real balances so I can back-compute the opening balance?
6. **Imported iPhone installments:** should the 20 future rows (and the earlier "n/20" ones) be grouped into one installment `recurring_series`, or just imported as standalone pending transactions?
7. **Week start:** Monday or Sunday?
8. **Default currency** is MXN for all reporting. Should USD/CAD rates start at placeholders (e.g. USD 18.00, CAD 13.84), which you then edit?
9. **Habit "X times per week":** is a streak counted in weeks (met the weekly target) or in days? I propose weeks for that frequency type and days for the others.
10. **Bad habits:** does "días sin" count from the habit's creation date (or the last slip), with no daily check-in needed? I assume yes, since a day with no slip counts as a success.
11. **App name:** keep "Mios"?

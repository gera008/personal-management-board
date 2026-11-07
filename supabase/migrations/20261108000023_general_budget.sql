-- A general budget: no category, it covers every expense. One per user.
alter table public.budgets alter column category_id drop not null;
create unique index if not exists budgets_one_general on public.budgets (user_id) where category_id is null;

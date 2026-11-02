-- Marks expenses paid on someone else's behalf (partner, family…).
alter table public.transactions add column if not exists paid_for_others boolean not null default false;

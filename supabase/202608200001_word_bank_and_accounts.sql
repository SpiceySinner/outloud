-- OutLoud: accounts + word bank
--
-- Adds the pieces the dashboard and profile pages need:
--   1. moments.user_id      -- links a saved run to a signed-in Supabase auth user.
--                              Runs saved by email only (no account) keep user_id null.
--   2. public.word_bank     -- the words and frames a learner collected, one row per phrase
--                              per user. This is what the dashboard shows and what the
--                              "your words come back tomorrow" promise is built on.
--
-- Safe to re-run.

alter table public.moments
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists moments_user_id_created_at_idx
  on public.moments (user_id, created_at desc);

create table if not exists public.word_bank (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  moment_id uuid references public.moments(id) on delete set null,
  -- The phrase itself, exactly as the coach handed it over.
  spanish text not null,
  meaning_en text,
  -- Where it came from: a coach tool during the session, or the rescue card.
  source text not null default 'coach_tool' check (source in ('coach_tool', 'rescue_phrase', 'rescue_pattern')),
  -- Filled once the learner uses the phrase again in a later session.
  times_practiced integer not null default 0,
  last_practiced_at timestamptz,
  created_at timestamptz not null default now()
);

-- One row per phrase per learner: re-saving the same word updates instead of duplicating.
create unique index if not exists word_bank_user_phrase_idx
  on public.word_bank (user_id, lower(spanish));

create index if not exists word_bank_user_created_at_idx
  on public.word_bank (user_id, created_at desc);

-- RLS: the app writes through the service-role key (which bypasses RLS), but these policies
-- make the table safe if it is ever read with a user's anon-key session directly.
alter table public.word_bank enable row level security;

drop policy if exists word_bank_select_own on public.word_bank;
create policy word_bank_select_own
  on public.word_bank for select
  using (auth.uid() = user_id);

drop policy if exists word_bank_modify_own on public.word_bank;
create policy word_bank_modify_own
  on public.word_bank for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

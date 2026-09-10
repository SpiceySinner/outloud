-- OutLoud: the bridge to PostHog, and the login that can only cross it.
--
-- Safe to re-run.
--
-- PostHog knows behaviour: who arrived, who spoke, where they stopped. The database knows truth:
-- whether the run was saved, which rung of the ladder it reached, whether the phrase ever came
-- back. Neither is a whole picture, and the join key already existed -- PostHog's `distinct_id` IS
-- the browser's `outloud-session-id`, which is `sessions.id` here.
--
-- Two things make that join safe rather than a data leak.
--
--   1. **The views carry no free text.** Every column below is an id, a timestamp, an enum from a
--      fixed list, or a count. `ph_runs` carries the LENGTH of `original_text` and of both
--      attempts, never the text. No rescue, no transcript, no outcome sentence, no Spanish, no
--      email address.
--
--   2. **The login can read nothing else.** `posthog_reader` has SELECT on exactly these four
--      views, by name, and nothing anywhere else in the schema. A warehouse connector configured
--      with an ordinary Postgres user could read `moments.original_text` -- what somebody could
--      not say to their partner's mother. The views make that impossible to send by accident;
--      the role makes it impossible to send on purpose.
--
-- The password is deliberately NOT in this file: it is set out of band and lives in `.env`, which
-- is gitignored. A migration carrying a credential is a credential in git forever.
--
-- Connection, for whoever configures the connector next: Supabase's direct host is IPv6-only, so
-- external tools go through the pooler --
--   host `aws-0-us-east-2.pooler.supabase.com`, port 5432, database `postgres`,
--   user `posthog_reader.ksspmrtfrjvaukojrvmx`.
--
-- All four sync as **full_refresh**, not incremental. These are aggregate views whose existing
-- rows change: a phrase gets `landed_at` set, an event's `beats_done` climbs, a session's
-- `runs_saved` goes up. Incremental sync only ever fetches new rows, so it would quietly freeze
-- every one of those at its first observed value -- and a metric that is silently stale is worse
-- than one that is missing.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'posthog_reader') then
    -- `nologin` until the password is set out of band, so a half-applied migration cannot leave
    -- an open door behind it.
    create role posthog_reader nologin;
  end if;
end $$;

-- Nothing inherited from whatever the defaults happen to be.
revoke all on schema public from posthog_reader;
revoke all on all tables in schema public from posthog_reader;

grant usage on schema public to posthog_reader;

-- Exactly four, by name. A table added next month is not readable unless somebody comes back to
-- this file and says so, which is the property worth having.
grant select on public.ph_sessions to posthog_reader;
grant select on public.ph_runs     to posthog_reader;
grant select on public.ph_phrases  to posthog_reader;
grant select on public.ph_events   to posthog_reader;

-- Without this, an `alter default privileges` elsewhere could widen the grant silently.
alter default privileges in schema public revoke all on tables from posthog_reader;

-- The views run with their owner's rights, which is what lets this role read them without any
-- grant at all on `moments`, `word_bank`, `events` or `sessions`.
alter view public.ph_sessions set (security_invoker = off);
alter view public.ph_runs     set (security_invoker = off);
alter view public.ph_phrases  set (security_invoker = off);
alter view public.ph_events   set (security_invoker = off);

-- Set the password separately, never here:
--   alter role posthog_reader login password '<the value in .env>';

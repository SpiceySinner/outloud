-- OutLoud: the analytics table goes, and the research it was borrowing gets its own home.
--
-- Safe to re-run.
--
-- `analytics_events` was never OutLoud's. It belongs to an older product that shared this Supabase
-- account: 642 of its 644 rows were written between 2026-07-30 and 2026-08-04 by a tracker that is
-- not in this codebase and never was. Behaviour and funnels live in PostHog from 2026-09-10, and a
-- second table answering the same questions is how two systems start disagreeing.
--
-- The two rows that ARE ours are `kept_scenario`, and they are not analytics at all.
--
-- **What `kept_requests` is for.** When the router understands somebody perfectly and there is no
-- engine behind it, the screen reads it back, says so plainly, and keeps the sentence. For the
-- learner that turns a dead end into a promise. For us it is the corpus of what to build next --
-- real requests in real words. That is research, and research belongs next to the rows it
-- describes, in a table named for what it holds.
--
-- It also must NEVER go to PostHog: it is free text about somebody's life, and the line drawn in
-- `docs/features/tracking.md` section 2 is that no free text leaves for a third party. Keeping it
-- here is what makes that line keepable.
--
-- Since `ask_phrase` and `stung` got engines on 2026-09-07, the intents that land here are `talk`
-- (which is never being built) and `unclear`. How many people ask for open conversation is worth
-- knowing precisely BECAUSE we refuse them.

create table if not exists public.kept_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Anonymous identity: the browser's outloud-session-id. Null is allowed -- an unrouteable
  -- sentence is worth keeping even from a browser that never got as far as an identity.
  session_id uuid,

  -- Which intent the router settled on. Not constrained to a CHECK on purpose: the intent list has
  -- already split once (`talk` into three, 2026-09-07) and a constraint here would turn the next
  -- split into a migration in a table nothing depends on.
  intent text not null,

  -- What they actually said, verbatim, and the one-line reading the screen showed them. The
  -- read-back is stored beside the sentence because the pair is what says whether we understood.
  said text not null,
  read_back_en text,

  -- Whatever the router pulled out, when it pulled anything out.
  situation_en text,
  who_en text,
  when_en text,
  topic_en text
);

create index if not exists kept_requests_created_at_idx on public.kept_requests (created_at desc);
create index if not exists kept_requests_intent_idx on public.kept_requests (intent, created_at desc);

-- Carry across the two real rows before the table they are sitting in goes away.
-- `where not exists` rather than `on conflict`: the ids are new, so re-running must not duplicate.
insert into public.kept_requests (created_at, session_id, intent, said, read_back_en, situation_en, who_en, when_en, topic_en)
select
  a.created_at,
  a.session_id,
  coalesce(nullif(a.step, ''), 'unknown'),
  coalesce(a.metadata_json ->> 'said', ''),
  a.metadata_json ->> 'readBackEn',
  a.metadata_json ->> 'situationEn',
  a.metadata_json ->> 'whoEn',
  a.metadata_json ->> 'whenEn',
  a.metadata_json ->> 'topicEn'
from public.analytics_events a
where a.event_name = 'kept_scenario'
  and coalesce(a.metadata_json ->> 'said', '') <> ''
  and not exists (
    select 1 from public.kept_requests k
    where k.created_at = a.created_at and k.said = a.metadata_json ->> 'said'
  );

-- Service-role only, like every other table here that has no user-facing read path.
alter table public.kept_requests enable row level security;

-- And the borrowed table goes. This destroys the 642 rows belonging to the older product; that is
-- the intended effect, and they are not OutLoud's to keep.
drop table if exists public.analytics_events;

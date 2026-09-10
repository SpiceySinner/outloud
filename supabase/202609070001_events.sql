-- OutLoud: dreaded events (#30)
--
-- Everything else the app stores is a MOMENT: a thing somebody tried to say, failed at, and got
-- rescued. `moments` says so in its own columns -- original_text, first_attempt, retry_attempt
-- and rescue_json are all not null.
--
-- "dinner at my girlfriend's parents on friday" is none of that. Nobody tried to say anything;
-- somebody named a date. So it needs a row of its own: the situation, when it happens, and the
-- handful of goes we lay out between now and then.
--
-- Two things worth knowing before changing this:
--
--   1. `happens_on` is nullable ON PURPOSE. A learner who says "sometime soon" has an event with
--      no date, and inventing one would be the same lie the router is forbidden to tell. Undated
--      events still get a plan; they just have no countdown.
--   2. The beats live in `plan_json` rather than a table of their own. They are written once,
--      always read as a unit, and never queried across events -- a second table would buy
--      nothing but joins.
--
-- `rescue_json` is filled by the first beat (which runs the normal intake) and reused by every
-- beat after it, which is what lets a scene start without a fresh placement each time.
--
-- Safe to re-run.

create table if not exists public.events (
  id uuid primary key,
  -- Anonymous identity, exactly as moments use it: the browser's outloud-session-id.
  session_id uuid references public.sessions(id) on delete set null,
  -- Null until the learner signs in on this device; claimed by session_id at that point.
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),

  -- What they actually said, verbatim. The read-back comes from it, and it is the corpus.
  said text not null,
  -- What the app calls it every time it brings it up. `situation_en` is a sentence and will not
  -- fit in a header; this is the noun phrase that does.
  name_en text not null,
  situation_en text not null,
  who_en text,
  -- "friday", "in two weeks" -- their words for when, kept even once a date is resolved.
  when_said text,
  -- The resolved date, or null. NEVER guessed.
  happens_on date,
  timezone text,

  status text not null default 'planned' check (
    status in ('planned', 'running', 'done', 'answered', 'abandoned')
  ),

  -- The beats: what each go at this evening is, in the order the evening happens.
  plan_json jsonb not null,
  -- Written by beat 1, reused by every beat after it.
  rescue_json jsonb,
  focus_blocker text,

  -- "how did it go?" -- stored verbatim, unclassified. The sentence is worth more than a label.
  outcome_said text,
  outcome_at timestamptz,
  -- Whether they got to say any of it. One tap, no model: the mastery ladder must not claim
  -- "you used it for real" just because somebody turned up and froze.
  outcome_spoke boolean,

  deleted_at timestamptz
);

create index if not exists events_session_created_at_idx
  on public.events (session_id, created_at desc);

create index if not exists events_user_created_at_idx
  on public.events (user_id, created_at desc);

create index if not exists events_status_happens_on_idx
  on public.events (status, happens_on);

-- Which evening a saved run belonged to. Null for every moment that is not part of an event,
-- which is all of them today.
alter table public.moments
  add column if not exists event_id uuid references public.events(id) on delete set null;

create index if not exists moments_event_id_idx
  on public.moments (event_id);

-- Only the service-role key touches this table (it bypasses RLS). Enabling RLS with no policy
-- means an anon-key client gets nothing, which is right: /dash reads events through
-- /api/events, which is the only place that knows whether the caller owns them.
alter table public.events enable row level security;

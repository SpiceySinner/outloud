-- OutLoud: engine sessions
--
-- The coach (/api/coach) and the practice conversation (/api/converse) are multi-request:
-- `start` builds the state, later `respond` calls read and extend it. That state used to live
-- in a module-level Map, which only works while every request hits the same long-running
-- process -- true for `npm run dev`, false for any serverless host. There, `respond` can land
-- on a different or freshly cold-started instance than `start` did, and the learner gets
-- "session expired" in the middle of a conversation; every deploy would kill live sessions too.
--
-- Keying the state on the session id in one shared table makes which instance answers
-- irrelevant. Rows are short-lived: they are deleted when the session closes, and expired
-- leftovers are pruned opportunistically (see lib/session-store.ts).
--
-- Safe to re-run.

create table if not exists public.engine_sessions (
  id uuid primary key,
  -- Which engine owns this row. Guards against a coach id being read as a conversation.
  kind text not null check (kind in ('coach', 'converse')),
  -- The whole engine state blob (turns, evidence, context). Shape is owned by the route.
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists engine_sessions_expires_at_idx
  on public.engine_sessions (expires_at);

-- Only the service-role key touches this table (it bypasses RLS). Enabling RLS without any
-- policy means an anon-key client gets nothing, which is exactly right: engine state is
-- server-internal and there is no user-facing read path for it.
alter table public.engine_sessions enable row level security;

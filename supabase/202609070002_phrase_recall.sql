-- Phrases a learner ASKED for, and the schedule that brings them back.
--
-- Safe to re-run.
--
-- Two things land here and they are deliberately in the same table.
--
-- The phrase itself already has a home: `word_bank` holds one row per phrase per learner, and the
-- unique index on (user_id, lower(spanish)) already guarantees that. Copying the Spanish string
-- into a second table to hold its schedule would create exactly the drift this codebase keeps
-- paying for -- two rows that are the same phrase until somebody edits one of them.
--
-- What is genuinely new is the resurfacing state: when the phrase is next worth putting in front
-- of them, how many times it has come back without being produced, and whether it has ever landed
-- unaided. That last one is the point of the whole feature: a phrase somebody asked for on Tuesday
-- turning up on Friday inside a scene built for something else, and being reached for without
-- help. See `docs/features/router-talk-feat.md`.

-- `asked` joins the sources. The others are all phrases WE handed over during a session; this is
-- the only one the learner went looking for, which is what makes it the strongest thing to bring
-- back. Dropping and re-adding the constraint is the only way to widen a CHECK in Postgres.
alter table public.word_bank drop constraint if exists word_bank_source_check;
alter table public.word_bank
  add constraint word_bank_source_check
  check (source in ('coach_tool', 'rescue_phrase', 'rescue_pattern', 'asked'));

-- When this phrase is worth resurfacing. Null means never scheduled -- everything saved before
-- this migration, and anything we hand over rather than being asked for.
alter table public.word_bank add column if not exists due_at timestamptz;

-- How many times it has been put in front of them without coming back out. A phrase that keeps
-- failing to surface is either too hard or wrong for them, and after a couple of goes it should
-- drop out of rotation rather than nag.
alter table public.word_bank add column if not exists resurfaced_count integer not null default 0;

-- The moment it landed: produced inside a scene, unaided. Set once and never cleared. A phrase
-- with this set stops competing for a slot -- it is theirs now.
alter table public.word_bank add column if not exists landed_at timestamptz;

-- The whole read is "what is due for this learner right now", so the index is the pair.
-- Partial: a landed phrase is never due again, and there is no reason to carry it here.
create index if not exists word_bank_due_idx
  on public.word_bank (user_id, due_at)
  where landed_at is null;

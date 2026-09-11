-- Every saved phrase joins the recall queue, including the ones already in the table.
--
-- Safe to re-run.
--
-- The closing card tells a learner "we'll bring this back in a new situation, with a little less
-- help" about the phrases their session produced. Those are `coach_tool`, `rescue_phrase` and
-- `rescue_pattern`, and until 2026-09-11 not one of them was ever given a `due_at` -- only the
-- handful somebody typed an explicit question about. `lib/phrase-recall.ts` skips a row with no
-- `due_at`, so the promise was false for effectively every phrase in the app, on the one screen
-- where we ask for an account.
--
-- The application half is fixed in `app/api/word-bank/route.ts`. That only helps phrases saved
-- from here on. This is the other half: the rows that were promised a return and never scheduled
-- for one.

-- `created_at` rather than `now()`, for two reasons. It staggers the backfill instead of making a
-- learner's entire history come due at the same instant, and it puts each phrase where it WOULD
-- have been if the rule had been right when the row was written -- which for anything older than
-- two days means due now, and that is the honest answer.
--
-- `+ interval '2 days'` is `nextDueAt(0)` in `lib/phrase-recall.ts`: `reviewSpacingDaysAfterReview`
-- returns 2 for `needed_full_help`, and a phrase that was just handed over is by definition a thing
-- they could not say. Change one and this comment is wrong -- the ladder lives in TypeScript and
-- this is a one-off catch-up, not a second scheduler.
update public.word_bank
   set due_at = created_at + interval '2 days'
 where due_at is null
   and landed_at is null;

-- Landed phrases are deliberately untouched. `landed_at` means they produced it alone in a real
-- scene; it is theirs, and scheduling it again would take that back.

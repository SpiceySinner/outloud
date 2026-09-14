# Who has what

Split agreed 2026-09-14, when a second person joined the repo.

`docs/TODO.md` says **what is open and why**, with the file that proves each claim. This says
**who has it**. When the two disagree, TODO.md is the record and this is the plan.

Screen names — Funnel, Home, Room, Dash, Account, and the phases inside the Room — are in
[AGENTS.md](../AGENTS.md). Use them here and in conversation; one name per surface.

---

## Before anyone starts

None of the tasks below can honestly begin until these three are done.

| | why it blocks |
|---|---|
| **Own OpenAI API key** | Own spend, own rate limits. `MAX_OPENAI_REQUESTS_PER_SESSION=400` sits in Timo's `.env` for testing and must not follow anybody to a deploy. |
| **Supabase access** | **The same production database as everyone else** — Timo's call, 2026-09-14. There is no local one and no second project. See the box below; it is the most dangerous thing about this repo. |
| **Supabase MCP, `--read-only`** | Reading the schema and the advisors covers every task here. Nothing below needs write access through MCP. |

Then read [AGENTS.md](../AGENTS.md) and [checks/README.md](../checks/README.md). Ten minutes,
and they are the difference between finding a bug and re-causing one.

### Working against the production database

There is no local database and no second project: your dev server writes to the same Supabase the
live app uses, with a service-role key that bypasses RLS. It holds roughly forty saved moments and
thirty-seven runs — every piece of evidence this product has about whether it works. A mistake
there is not recoverable by re-running anything.

Four rules, and they are not negotiable:

1. **Supabase MCP stays `--read-only`.** Shared production makes that more important, not less.
2. **Never a bulk `UPDATE` or `DELETE`.** Every statement that changes rows names the rows it
   changes — by id, or by a session id or email you created yourself and can point at.
3. **Make your own rows before you write anything that changes rows.** Run a session, note the
   ids, work on those.
4. **Nothing destructive runs for the first time without Timo.** Ask, and let him watch it.

`deleted_at` is a *soft* delete, which is the saving grace for the delete-path task: setting it
marks a row rather than removing it. The retention task has no such cushion — see it below.

The service-role key is shared, so the database cannot tell your writes from anybody else's. If
something looks wrong, say so early; there is no log that will work it out for you.

**Branches.** `main` is what deploys and only Timo merges into it. **One branch per task off
`main`, one PR per task** — the branch names are listed in [AGENTS.md](../AGENTS.md#names). Separate
PRs mean a slow review never forces two tasks into one diff, and Timo can review in whatever order
suits him.

Three real dependencies, and nothing else is ordered:

- **check `build-group`** (Playwright) comes before `build-navigation`, `room-restore` and
  `screen-fingerprint`
- **`retention`** builds on **`delete-path`**
- **`date-nav-bug`** and the **`build-navigation`** check are the same investigation — build the
  check first and the bisect nearly writes itself

### Driving it by hand, from the browser console

Automated checks only ever prove the typed path. The voice layer has no automated cover and cannot
get any, so the console is where you actually look at it.

**Turn on voice tracing.** Once, in the browser console on `/`:

```js
__outloudVoiceDebug(true)      // persists in localStorage["outloud-debug-realtime"]
```

It survives reloads, so you arm it once and forget it. Then use the app and read it back:

```js
copy(__outloudVoiceDump())     // the whole trace, on your clipboard
__outloudVoiceDump()           // or just print it
```

Every line is timestamped and carries the state it was written in:

```
10:17:48.177 [voice:finish] transcript: "Hola, un agua, por favor." | speechSeen: true | mic:closed mode:open turn:thinking capturing:false
10:17:48.301 [voice:vad] transcription language -> es | mic:closed mode:open capturing:false
```

**Why it exists rather than `console.log`.** The voice layer fails silently in a dozen places by
design — a closed data channel, a superseded press, a guard that returns early, a `catch {}` that
drops to the MediaRecorder fallback. From the outside every one of them looks identical: "the mic
does nothing". The buffer also survives console filters and DevTools opened after the fact, which
during one of these bugs looked exactly like "no logging at all".

**One limit.** `__outloudVoiceDump()` is defined by the Room. Opening **Dash** directly in a fresh
tab fills the buffer but gives you no function to print it — arrive from `/` in the same tab and
you have both.

### The other environment switches

| | |
|---|---|
| `OUTLOUD_MOCK_AI=true npm run dev` | fixtures instead of the model. Deterministic, free, and **worthless for anything about a prompt** — see AGENTS.md rule 5 |
| `OUTLOUD_DEAD_LIST=1 npm test` | the dead-export check prints all 91 instead of the first six |
| `OUTLOUD_CHECK_BASE=http://localhost:4000 npm run test:live` | point the live checks at a server that is not on port 3000 |

**Deploys are Timo's.** Commits from the second seat do not deploy to Vercel automatically. Any
task whose result can only be seen on the deployed app stays on Timo's side, or ends at the point
where a deploy is needed and is handed back.

---

## Second seat — coding

In order. Each one is small enough to finish, and each is verifiable without a deploy.

### 1. `device_json` stores the raw User-Agent

`sessions.device_json` keeps the whole User-Agent string, which is a pure fingerprinting surface.
A device class — "iPhone, Safari" — serves every use we actually have.

Comes with a unit check: a pure function, a table of real User-Agent strings, the class each one
should become. Good first task because it is the shape everything here takes — a small honest
function and a check that imports it.

**Done when:** no raw User-Agent is written, `checks/unit/device-class.check.mjs` covers the
common cases and the unknown one, `npm test` green.

### 2. There is no delete path

`deleted_at` exists on `moments` and on `events` and **nothing in the app ever sets it**. A
deletion request today has to be done by hand in Supabase. This is the one legal obligation on the
whole list.

**This runs against production.** `deleted_at` is a soft delete, so a mistake marks rows rather
than destroying them — but a marked row disappears from every read path, which for the person it
belongs to is the same thing. Test it on a session you created yourself and can name.

**Done when:** a signed-in person can delete their data from Account, the rows carry `deleted_at`,
every read path excludes them, and a check proves a deleted row does not come back through
`/api/library`, `/api/moments` or phrase recall.

### 3. `MAX_REALTIME_SESSIONS_PER_DAY` is 5 in production

[realtime-token/route.ts:36](../app/api/realtime-token/route.ts#L36). It is not set in `.env` at
all, so the code's own fallback decides: `NODE_ENV === "development" ? 100 : 5`. Five voice
sessions per day per client, for everybody, the moment it is deployed.

**Timo's call: 100 while this is a test phase.**

**Done when:** production gets 100 **and** the line carries a comment saying it must go back down
before launch, plus a line in `docs/TODO.md` under the launch items. A raised limit with no note
is an open cost tap nobody remembers opening.

### 4. No retention policy

Nothing ages out except `engine_sessions`. Transcripts, conversations and events are kept forever
by default. Same area as the delete path and best done straight after it.

**This is the one task on the list that can destroy data**, and it runs against production. So it
is built in two halves and the second one waits:

1. **A dry run that only reads.** It reports what it *would* remove, by table and by count, with a
   sample of rows. That is the whole first deliverable. Timo reads the list.
2. Only once he has read it does anything actually remove a row — and the first real run happens
   with him watching.

**Done when:** the policy is written down, the dry run reports against production without changing
anything, a check proves the selection does not include rows it should not, and the destructive
half is merged separately after Timo has seen the dry run's output.

### 5. Date the production-build navigation bug

In a local `vinext build` + `vinext start`, **every** `next/link` navigation throws
`TypeError: e is not a function` and the URL does not change. The dev server does all of them
cleanly. Reached directly with a fresh page load, every route renders fine.

This half is mechanical and ideal for an agent: `git bisect` across the build, click one link,
record. No deploy needed — this is exactly how the bug was found.

**Stops here.** Whether the *deployed* app has it depends on `NITRO_PRESET` / Vercel and needs a
deploy, so that conclusion goes back to Timo.

**Done when:** the first bad commit is named, with the build output that proves it.

### 6. Store what the AI said

`moments.conversation_turns_json` already holds every character line and every reply of a saved
run. What is missing is reading it as a corpus rather than judging it one screen at a time.

This one unlocks the whole of TODO 1.3, which is the largest open question in the product.

**Done when:** there is a repeatable way to pull every AI line across runs and ask a question of
the set. Not an answer to the question — the means to ask it.

### 7. `account_created` is recorded wrongly, and half of it not at all

Two holes in the same corner. Both are plain bugs with obvious fixes, and both need fixing
whatever the post-signup screen eventually turns out to be — which is why they stayed here when
that screen went to Timo's list:

- **`track("account_created", { unclaimedRuns: 0 })`** at [page.tsx:598](../app/page.tsx#L598) —
  the zero is hardcoded. The Room has the real count and already sends it correctly at
  [page.tsx:3929](../app/page.tsx#L3929) (`account_ask_seen`); `AuthDialog` is simply never given
  it. So the one number that says how much practice the account ask actually claimed is recorded
  as zero every time.
- **The Google path is not counted at all.** `signInWithGoogle` redirects away and
  `account_created` fires only in the email branch — there is exactly one call site in the repo.
  **Every OAuth signup is invisible in PostHog.**

The second one has to fire on the OAuth *return*, after `restoreRoomAfterAuth`, not before the
redirect — a signup that the visitor abandons on Google's screen is not a signup.

**Done when:** both paths fire once and only once, the real count reaches the event, and a check
proves the count is not zero when the device has unclaimed runs.

**Not in scope:** what the learner sees afterwards. That is on Timo's list below, undecided.

---

## Second seat — checks

A separate list, and most of it costs **no credits**. Several items in `docs/TODO.md` are not
missing features, they are missing checks — this is that half.

| | check | group | needs |
|---|---|---|---|
| 1 | Unit checks for the pure modules nothing covers yet: `freeze`, `conversation-pacing`, `blocker-taxonomy`, `repair-loop`, `learning-loop`, `natural-spanish`, `teaching-policy` | `unit` | nothing |
| 2 | **Playwright as a devDependency, and the `build` group** | `build` | nothing |
| 3 | **Production-build navigation** — `vinext build` + `start`, every `next/link` | `build` | nothing |
| 4 | **Room restore, five cases** | `build` | mock build |
| 5 | **Structural fingerprint of every screen** against a mock build | `build` | nothing |
| 6 | **Persona sweep harness** — four personas, three runs each | `live` | own key |

On (2): there is no way to drive a browser without a browser driver, so this is not the "do not
add a dependency for something small" case. Add it.

On (6): the harness is yours; the judgment of what counts as teaching is not.

### Check 4 in detail — room restore

The other five checks explain themselves. This one does not, so here is the whole thing.

**Do check 2 first.** This needs Playwright and the `build` group.

#### What the mechanism actually is

The Room is React state. Leaving the page empties it. So before any exit that unloads the
document, the Room writes itself down as a `RoomSnapshot` and reads it back on the way in. There
are **two journeys**, and they are stored in different places on purpose:

| journey | written when | where | read when |
|---|---|---|---|
| `auth` | just before the Google OAuth redirect ([page.tsx:6383](../app/page.tsx#L6383)) | `localStorage["outloud-pending-verdict"]` | a sign-in event fires |
| `return` | the Account pill's `onClick`, and `pagehide` ([page.tsx:4501](../app/page.tsx#L4501)) — which covers reload, back button and closing the tab | `sessionStorage["outloud-left-room"]` | at mount, **last** in the hand-off ladder |

`sessionStorage` for `return` is the entire safety argument for that journey. It belongs to one
tab: closing the tab throws the intention away with it, tomorrow morning is a new tab with
nothing in it, and two open tabs cannot steal each other's session. `restoreRoom`'s guard against
overwriting a live room does nothing on this journey, because at mount the room is empty by
definition — so the storage choice is carrying the weight instead.

`restoreRoom` ([page.tsx:4338](../app/page.tsx#L4338)) reads the snapshot, **clears it before any
refusal**, and then refuses if: the room already has unsaved work, the snapshot is older than two
hours, or there is nothing in it.

Two places clear the key deliberately, because they mean "I am finished": the exit button
([page.tsx:5463](../app/page.tsx#L5463)) and sign-out on Account
([account/page.tsx:102](../app/account/page.tsx#L102)).

#### Where to start

```bash
OUTLOUD_MOCK_AI=true npm run build && OUTLOUD_MOCK_AI=true npm run start
```

Mock, because none of this is about what the model says — it is about what survives a navigation.
Deterministic and free.

Then get a room with something in it: answer the Opening question and say one thing. That is
enough — `roomHasUnsavedWork` is true from the first sentence, and the bug that taught us to write
it that way was a learner who had said exactly one thing and registered as having nothing to lose.

Read `sessionStorage["outloud-left-room"]` in the page after each exit. That, plus what is on
screen after coming back, is the whole observable surface.

#### The five cases

| | do this | must happen | why |
|---|---|---|---|
| 1 | mid-session, click the Account pill, then come back | same phase, same coach line, same rescue | the pill stashes in its `onClick` |
| 2 | mid-session, reload | restored | `pagehide` catches it |
| 3 | **press the exit button, then reload** | **nothing restored** | exit means finished |
| 4 | **open a second tab while the first is mid-session** | **the second stays empty** | `sessionStorage` belongs to one tab |
| 5 | **sign out on Account, then go back to the Room** | **nothing restored** | signing out means finished |

**Cases 3, 4 and 5 are the check.** 1 and 2 only confirm that it works — and something that only
confirms success cannot tell "it works" from "the check cannot fail". A wrong restore is worse
than no restore: it drops somebody into the middle of a conversation they did not start.

#### Prove it can fail, before you believe it

`baselineComparison` is for library modules and does not apply here, so do it by hand, once:

1. Delete the `window.sessionStorage.removeItem(leftRoomKey)` at
   [page.tsx:5463](../app/page.tsx#L5463) — the exit button's clear.
2. Rebuild, run the check. **Case 3 must go red.** If it stays green, the check is not testing
   what it says it is.
3. Put the line back. Rebuild. Green again.

Write what happened in the check's header comment. A check nobody has watched fail is not a check.

#### Done when

All five cases run in the `build` group, case 3 goes red when the exit button's clear is removed
and green when it is back, and `npm run test:all` passes with the code intact.

Cases 4 and 5 have their own mechanisms — `sessionStorage` being per-tab, and the sign-out clear
in `app/account/page.tsx`. If you want the same confidence in those two, break each one the same
way, one at a time.

---

## First seat — Timo and Claude

| | why it stays here |
|---|---|
| **Three pre-existing TypeScript errors** | `Fetcher` / `D1Database` hang off the Cloudflare build config, which is the deploy corner. Small for us, unverifiable from the second seat. (The lint half of this item was done 2026-09-14 — `npm run lint` is clean and exits 0.) |
| **1.6 The Scene does not take no for an answer** | Prompt work on `/api/converse`, against the real model. The scenario rule has to be internalised, and that is learned by breaking it, not by reading it. |
| **1.6 Transcription bias** | Voice path. Only checkable by hand on Dash. |
| **`lastVoiceFreeze` on the realtime path** | Voice path. |
| **#42 Barge-in, Half B** | Gated on a real iPhone echo test on speakerphone at real volume. The failure mode is the coach interrupting *itself* and then blaming the learner — audible, not measurable. |
| **Persona sweep, the judgment half** | What counts as teaching is a product question. |
| **Privacy policy** | Timo's text. `docs/user-data.json` is the inventory. |

---

## Timo's, until he is sure

Not blocking anything on either list above.

- **Does the return half get built, or does the promise get removed?** `/api/retrieval` has no
  callers, there is no `vercel.json`, `app/m/` does not exist — and the closing card promises a
  weekday out loud. Both answers are defensible. Leaving it as it is, is not.
- **Answering a Spanish Coach turn in English during the intake.** It now steps out to the Aside
  immediately, where it used to count toward the two-strike nudge. It follows from the rule and it
  also bypasses a deliberate design.
- **How often should a resurfaced phrase fire?** One scene in three (`sceneChance` in
  `lib/phrase-recall.ts`). One constant in a pure module, deliberately, because nobody has
  evidence yet.
- **What a learner sees after creating an account.** Today: `onAuthed(email)`, `onClose()`,
  dialog shut, nothing acknowledged. Pulled back 2026-09-14 because the task is not defined
  enough to hand over — and because writing it down surfaced a conflict with something we
  deliberately built.

  **The conflict.** The account ask lives on the **Verdict card**, mid-session
  ([page.tsx:6231](../app/page.tsx#L6231)), and the header pill can open it from anywhere
  ([page.tsx:5551](../app/page.tsx#L5551)). `stashRoom("auth")` runs before the OAuth redirect so
  the whole Room survives it — its own comment says the half before the Verdict "is the half
  somebody is most likely to be in when they decide to sign up". **Sending them to Home after
  creating an account throws that away.** The two designs collide, and which one wins depends on
  where they signed up from.

  What has to be decided before anyone builds it:

  1. **Mid-session signup** — back into the Room where they were, or out to Home? Home costs them
     the session we spent 2026-09-11 learning to keep.
  2. **Its own screen, a state of Home, or a line on the Verdict card?**
  3. **Sign-up only, or sign-in too?** Coming back is not the same event as arriving.
  4. **What may it honestly claim?** It can only name runs that the claim-by-`session_id` actually
     picked up. A count that turns out to be zero reads as a broken promise on the one screen
     where we are asking for trust.

- **The taster session (TODO 1.5).** Deprioritised 2026-09-14: the effort can backfire and the
  Funnel works well apart from 1.6.

---

## Finishing a task

1. `npm test` and `npm run lint` and `npx tsc --noEmit` — the last one has three known errors and
   no others.
2. A check that would have caught the thing you fixed. If you changed a file, use
   `baselineComparison()` to confirm your check can tell your change from `HEAD`.
3. A CHANGELOG entry saying what broke, what the first theory was, and what you actually verified
   — including "not verified, only real audio exercises this" when that is the truth.
4. Tick the item in `docs/TODO.md` with the date.

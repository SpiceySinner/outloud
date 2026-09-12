# OutLoud — what is actually open

Last swept: **2026-09-11**, after the surface audit.

Written by reading the code, not from memory. Where an item makes a claim, the file that proves it
is named — an item nobody can check is an item nobody will act on.

Three documents feed this one and none of them replaces it:

- **`outloud-master-build-plan.md`** — the *why*, and the 54 numbered items. Numbers below like
  **#32** point at it.
- **`CHANGELOG.md`** — what shipped and what it cost.
- **`docs/Tests/TEST_RUN.md`** — the manual run. Several items here are only closable by doing it.

> **The master plan is out of date.** Its build order still lists Phase 4 as unbuilt and its
> self-audit says *"Phases 4–6 are entirely unbuilt"*. Both are wrong now: **#30** (build backward
> from a real event) and **#51–54** (the Speaking Journey) shipped. Fixing it is in section 0 —
> low priority by choice, but a roadmap people have stopped trusting stops steering anything, and
> the numbers in section 3 are only as good as the document they point at.

---

## 0. Low-prio tasks

*Footnotes rather than work. Housekeeping that happens alongside whatever is actually being built.*

- [ ] **Commit the working tree.** Four stages of the `talk` build, the event engine, the router,
      and two new migrations are all uncommitted. `git status` currently shows ~14 modified files
      and a dozen untracked ones.
- [ ] **Update `outloud-master-build-plan.md`.** Mark **#30** and **#51–54** shipped; correct the
      self-audit line about Phases 4–6; add the router (`/dash`) which the plan predates entirely.
- [ ] **Run `docs/Tests/TEST_RUN.md` blocks 4.0e–4.0h** on a real phone. Everything in the `talk`
      build is verified on the typed path only. **4.0h needs an account and a day's gap** — it is
      the one that proves the whole feature was worth building.
- [ ] **Fold in `stuffihavetodo.md`** and delete it once its three items are captured here (they
      are, in section 5).

---

## 1. Next up — the actual work

*Agreed 2026-09-07. Numbered in the order they were agreed, which is no longer the order they
happen in: **1.5 is what is next**, and 1.3 waits on it — analysing how well the app teaches is
worth less while the screen that teaches a phrase has no door leading to it.*

### 1.1 Where the account belongs — **decided and built 2026-09-10**

**Greenlight.** The co-founder's objection was withdrawn, so requiring an account is allowed.
Master-plan **#32** asked the harder question — *show what they'd get before asking for the
address* — and that is what got answered.

**The finding that decided it.** The pitch we wanted to make was already false. `/api/library`
claimed prior runs with `.eq("email", user.email)`, and a run saved without an email is stored
under the synthetic `anonymous+<session-id>@outloud.local`, which by construction never equals
anybody's real address. **Anonymous practice was saved and permanently unreachable** — by the
learner and by us — while the closing card promised it would come with them.

**Decisions taken (Timo, 2026-09-10):**

- [x] **Claim by `session_id`**, exactly as `/api/events` has since #30. The device is the
      credential. Trade accepted: signing in on a shared browser claims the anonymous practice
      sitting in it — the only model under which "your practice follows you" is true for
      somebody who never typed an address.
- [x] **The ask points at what is already there**, not at an invisible future. A count of
      unclaimed runs on this device, from a new sceneless `GET /api/moments`. Under two runs it
      keeps the older wording, because there is nothing worth pointing at yet.
- [x] **No new places to ask.** Nothing added on `/dash`, nothing after the first aha, and the
      room's `profile-pill` stays silent.

- [x] **One ask per session.** There were two — at the verdict and on the closing card — and
      both were gated on being signed out, so the second could only ever be seen by somebody
      who had just declined the first. The closing-card one is gone. The verdict keeps it: it
      is where the value is still on screen, and it is the block that also carries the email
      fallback and the fine print.

`docs/user-data.json` was the input, and gained a `claiming` note from the outcome.

### 1.2 PostHog — **built 2026-09-10**

Full design in **`docs/features/tracking.md`**. The short version: seven questions, each with the
decision it feeds, and a hard line on what may never leave for a third party.

- [x] **Supabase MCP access.** Project `ksspmrtfrjvaukojrvmx`, region **us-east-2** — which also
      closes the open region question in `docs/user-data.json`.
- [x] **`lib/track.ts`** — a **closed** catalogue. An event not in it does not compile, and no
      property in it is a bare string, so a sentence cannot be attached by accident.
- [x] **`/dash` instrumented** — Q1, Q2, Q3.
- [x] **The room instrumented** — Q4 and Q5: session started, rescue reached, session closed,
      and the account ask seen / opened / converted.
- [x] **Session replay ON**, with typed input *and* rendered learner/coach text masked. Behaviour
      visible, content unreadable.
- [x] **`analytics_events` dropped.** It was never ours — 642 of its 644 rows belonged to an older
      product sharing this Supabase account.
- [x] **`kept_requests`** — the two rows that WERE ours, in a table named for what it holds. The
      one thing that could not move to PostHog, because it is free text.
- [x] **Four text-free views** (`ph_sessions`, `ph_runs`, `ph_phrases`, `ph_events`) so PostHog
      and the database form one picture, joined on the session id both already use.

**Still to do:**

- [ ] **Verify events arrive** once somebody uses the app for real, and watch one replay end to
      end to confirm the masking covers what it claims to.
- [x] **Audit the `.private` class** across the UI — **done 2026-09-11, and it had already fallen
      behind.** `.private` was on zero elements; roughly forty content classes were not on the list,
      so session replay was recording learners' sentences, the coach's replies and the verdict's
      diagnosis in readable text. Fixed by inverting the default rather than by extending the list:
      `maskTextSelector: "*"` plus `replayText`, so everything masks and a short hand-checked
      `chromeSelectors` names what may be read. Verified against rrweb itself, not just the config.
- [x] **Turn on `word_bank` traffic** — **2026-09-11, and "nothing to fix" was wrong.** The table
      really had never held a row, but not because nobody had asked for a phrase. `saveWordBank`
      had one caller, `saveReturnEmail`, so finishing a session signed in saved a moment and no
      words: 40 moments, 0 word-bank rows. `saveCurrentMoment` now saves the words with the moment.
      Q7 still has no data until somebody signs in and finishes a run.

**Done in the second pass (2026-09-10):**

- [x] **Warehouse connected.** Source `01a08946-7862-0000-6fbe-8b52d198fe76`, four views synced
      as `full_refresh`, first sync completed. All 13 real tables are listed and `should_sync:
      false`.
- [x] **A restricted login.** `posthog_reader` has SELECT on the four views and nothing else;
      PostHog's own probe confirms `available_columns` is EMPTY for `moments`, `word_bank` and
      every other table. Password in `.env`, never in git.
- [x] **Q7 wired** — `phrase_asked` at the save, and `phrase_resurfaced` / `phrase_landed` from
      `recordPhraseOutcome`, which is the one choke point both outcomes pass through.

**The first number out of it**, n=24 and all of it us, so a shape rather than a finding: runs
that ended `answered_on_own` averaged **4.8 turns**; `needed_full_help` averaged **3.6**; the two
`needed_hint` runs averaged **1.5**. Short sessions are the ones that went badly. Which way the
causation runs is exactly what real traffic is for.

### 1.3a Partner and coach in one — the switch (2026-09-10, evening)

Timo's framing, and it reshapes 1.3: *we work with people who half speak Spanish. Questions about
which words to use will come up mid-conversation. The app has to be conversation partner and coach
in one.* So the 7-of-108 measurement below is not a number to admire — the missing piece was never
"correct more often", it was **let the learner call for the coach**.

- [x] **Mid-scene asking now switches to the coach.** The confirm box (*"here's what I heard"*) used
      to answer it. See the CHANGELOG entry for this evening.
- [x] **The coach opens with the words**, not with a question, and resolves a vague *"that"* from
      the scene rather than asking what they meant.
- [x] **Both shapes of asking, not just one (2026-09-11).** The detector only knew admissions
      ("I don't know how to say it") and missed questions ("what is the word, how do I say where
      is the pizza?") — which is the shape a half-fluent learner actually uses, mid-sentence.
      Found by Timo in a real session, one day after the screen it produces was supposedly fixed.
- [x] **The entry is fixed (2026-09-11).** The landing button ran the `stung` engine, so somebody
      who stated the exact sentence they wanted got *"tell me what happened"* and then a choice of
      two scenarios. Neither of the two options considered was needed: `RoomMode` gained an `ask`
      entry that asks one direct question — *what do you want to be able to say?* — so the answer
      IS the thing and no router has to work out what they meant. `strippedAsk` takes the asking
      off the front for people who answer a question with a question. Verified end to end in the
      real UI: `/api/lifeline`, three options with when to use each, the say-it-back, `/api/rescue`,
      and then *use it for real* / *that's all I needed*.
- [ ] **Give the harness a home in the repo.** The scratchpad was wiped between sessions and the
      whole persona harness had to be reinstalled to answer one question. Second time this has
      cost something today.
- [ ] **Coming back from the aside with the phrase.** Going back into the scene able to say it is
      the whole point; the return path has not been measured yet.
- [ ] **Re-measure with the sweep.** Does the switch move help-during-the-scene off 7 of 108, and
      does the conversation now stall because of it?

### 1.3 Are the AI responses actually teaching anyone?

The largest and least defined item, and the only one that could change what the product is.

- [x] **Synthesise a set of runs** — done, and it earned its keep on the first sweep. Four personas
      along two axes (what they can produce; what they do when they cannot), driven through the real
      UI on the typed path. Twelve runs, all reaching the verdict, no console errors. See
      [docs/features/synthetic-runs.md](features/synthetic-runs.md). The harness files still live in
      the scratchpad — **the repo has no test infrastructure to put them in, and that is now the
      blocker for making any of this repeatable by anyone but the session that wrote it.**
- [ ] **Store what the AI said** and analyse it as a corpus rather than judging it one screen at a
      time. Partly already there: `moments.conversation_turns_json` holds every character line and
      every reply of a saved run.
- [ ] **Answer: would this work on people who are not us?** Where does it teach, where does it
      merely feel like teaching, and what would we change.

      First measurement, 12 runs: **help appeared on screen during the conversation in 7 of 108
      scene turns.** For the B1 persona who never admits being stuck it was 0 of 27. Correction is
      almost entirely deferred to the rescue at the end, which is a deliberate design — do not
      interrupt the conversation — and the rescue does it well. The open question is what the
      deferral costs: in one run a learner said `Yo va a cuidar` nine turns running and was
      corrected once, at the end. Nine rehearsals of the error before one correction of it.
      Whether that trade is right is the actual 1.3 question, and it now has a number attached.

> **The bug is fixed (2026-09-10).** It was three bugs, and my first diagnosis of it was wrong.
>
> I had written that the rule against this lived only in `/api/coach`'s first coaching turn. It
> does not — both routes carry it as a general rule. Reproducing it against the live route found
> something else, and the CHANGELOG entry for 2026-09-10 has the detail. In short:
>
> 1. **The scenario turn had no way to help.** Its instruction is hardcoded to `intent=probe,
>    tool=none` and ends by demanding Spanish, and `stuckNote` was only ever appended from the
>    turn AFTER it. Somebody who said "I have no idea how to say that" got a scene and a demand.
> 2. **The stuck detector missed the second admission.** The pattern required "I" and "don't" to
>    be adjacent, so "I **still** don't know how to say it" fell through — and being stuck twice
>    is more stuck, not less.
> 3. **The help arrived for the wrong thing.** Once 1 and 2 were fixed, somebody stuck on *"I'll
>    take care of it"* was handed *"Quisiera un café y un sándwich"*, because the scene was a cafe.
>    Helping confidently with something nobody asked about looks like listening and is not.
>
> Live reproduction: **1—2 of 12 turns asked back before, 0 of 12 after.** The analysis run in this
> section is no longer poisoned by it and can start.
>
> **Then the first sweep found two more in the same detector (2026-09-10, later).** It only ever
> matched a straight apostrophe, so nothing typed on a phone matched at all — the fix above was
> invisible on the device Timo tests on. And once widened, it fired on people merely describing
> their problem, which is exactly what the opening question asks them to do. Both fixed; see the
> CHANGELOG. The lesson worth keeping: **the morning's fix was verified by a harness that shared
> the bug**, because it carried a copy of the same pattern with the same apostrophe.

### 1.4 UI — **done 2026-09-10**

- [x] The card and the account share one row, ~85/15, from `UI.Idee.md`.
- [x] The event card opens a drawer upward with every go in it, each one startable.
- [x] The account moved out of the tray and became a disc that reads as a person.

Built and shipped; see the CHANGELOG entry for the two things the first pass got wrong. Further UI
work is not blocked on anything — open a new item when there is a next scope.

### 1.5 One home, one account — **decided 2026-09-11**

**The finding that forced this.** Nothing in the app links to `/dash`. No `href`, no redirect,
nowhere — checked across the whole repo. It is reachable only by typing the URL. So the intent
router, the event cards, the steps drawer and **the only route to `ask_phrase`** are all built,
all working, and all unreachable for anybody who did not read the source. That also explains 1.3a's
open item: the landing button asks *"didn't know how to say something?"* and runs the wrong engine
because the right one lives on a screen with no door.

Four surfaces today, three after (`/dash` is kept on purpose — see step 2):

| | lines | what it is |
|---|---|---|
| `/` | 6148 | the room: the whole session, and already the entry point |
| `/dash` | 1377 | the router, the event cards, the drawer — unreachable |
| `/dashboard` | 221 | its own comment calls it *"Home… once the funnel is behind them"* |
| `/profile` | 170 | holds the **only sign-out in the app** |

**Direction: `/dash` into the room, not the other way round.** The room is already the entry point
and says so in its own code; `/dash` already hands off with `router.push("/")` twice, so merging
deletes a handoff instead of inventing one; and the OAuth full-page redirect, which wipes component
state and is worked around with a stashed verdict snapshot, lives in the room and is exactly the
kind of thing that breaks silently when it moves hosts.

The prize is not tidiness. **Both screens already drive the same `voice` singleton and disagree
about how.** `/dash` hardcodes `setTranscriptionLanguage("en")`; the room computes it per turn.
Two policies for one object is what produced the language bug on 2026-09-11, and a merge deletes
that class of fault rather than relocating it.

**Decisions (Timo, 2026-09-11):**

- [ ] **The homepage becomes a funnel AND a taster session.** Not just a way in — a small real
      go at speaking, before any account. The App Store is coming, so this screen has to read as
      onboarding, with staying signed-out kept as a genuine option rather than a dead end.

      **One win buys an account, not a subscription** (Timo, 2026-09-11). Master-plan **#18** says
      *one complete win before any paywall*, and that aims it at the wrong door. One good session
      is a weak reason to pay — nobody pays for a thing they have done once. What makes somebody
      pay is habit, and habit is **many** wins. So the single win has a smaller and much more
      winnable job: it earns the right to ask for an account, and the account is what makes the
      second, fifth and twentieth win possible at all.

      That also makes the ask honest instead of a toll gate. Section 1.1 already put it at the
      verdict, where the value is still on screen, and already made it point at practice that
      really is sitting on the device. The taster ends in the same place — the same screen, with a
      genuine way past it.
- [ ] **`/profile` is deleted; `/dashboard` becomes `/account`.** Started 2026-09-11. The route is
      renamed, not just repurposed — Timo's word for it is `/account`, and "dashboard" was the name
      of the job the room does now.
- [x] **The AI chat comes out of `/dashboard`.** Done 2026-09-11, with the merge. `mockChatReplies`
      and the `ChatMessage` type are deliberately kept — #30 is a real plan and that mock is the
      shape it was drawn in — but they have no caller now.

**1.5.0 — the pre-stage, before any of the three (started 2026-09-11).** Two findings made this
smaller than it looked.

*The top of the ladder has never been reached.* `confirmed_real_life`: **0 runs of 37**, over five
weeks. Not rare — `deriveReviewLedgerState`, the function that infers it, has **zero callers** and
is dead code. It IS reachable, by a different door: `/api/events` sets it when somebody reports
back that they went to the real thing and got some of it out. That question is asked on `/dash`.
So the top rung is behind the same missing door as `ask_phrase` — the second feature to fail for
only that reason.

*But that is the wrong win for onboarding anyway.* It takes days: plan an event, go, come back,
report. The win that earns an account on a first visit is the session win, and **that one already
happens** — 26 of 37 runs reached `answered_on_own` or `used_new_situation`. The taster does not
need inventing.

What is missing is not the win. It is the **contrast**. The closing card opens with the learner's
own Spanish sentence, which is the right thing to lead with, and then reports it as *"you got at
least one real reply across clearly"* — a participation note. The sentence they arrived with
(*"I understand a lot but the words disappear"*) and the sentence they left with are never put
next to each other, and that pairing is the only argument for an account that is made entirely out
of the learner's own words.

- [x] **Show the change, not just the result.** The opening answer above the closing line, on the
      after-card. No new data needed — `openingAnswer` was already in state.
- [x] **Stop naming a weekday nothing honours** — **done 2026-09-11, and the claim above was
      wrong.** *"For a signed-in learner that is true"* was written from the design, not the code.
      It was false for every phrase the closing card is actually about. Three separate gates only
      let a phrase into the recall queue if `source === "asked"`, and everything on that card is
      `coach_tool` or `rescue_*` — so the promise was made about exactly the phrases excluded from
      keeping it, on the one screen where we ask for an account.

      Timo's call (2026-09-11): make it true rather than cut it. Every saved phrase is scheduled
      now, `asked` still sorts first, and the pool size never touched the frequency in the first
      place — `pickForScene` returns at most one and skips two scenes in three regardless.
      `supabase/202609110001_phrase_recall_all_sources.sql` catches up the rows that were promised
      a return and never scheduled for one.

      The signed-out half stands: `word_bank.user_id` is not null, so nothing is saved and no day
      arrives. The card says so instead of naming a weekday.

- [x] **A session survives signing in** — **built and walked 2026-09-11.** `RoomSnapshot` carries
      the whole room across the redirect: phase, conversation, intake, rescue, character, every
      scene turn, the line on screen, and `savedMomentId` so the next save does not write a second
      moment. Restore refuses over a live room and past a two-hour TTL, and discards a refused
      snapshot rather than leaving it to fire later. The sign-in button is back in the header at
      every point in the session; the profile link stays hidden, being a plain navigation with no
      stash behind it.

      This was the prerequisite for the taster homepage below: somebody who does a whole go signed
      out and *then* creates an account keeps the go they just did.

      **Still open, and smaller:** give the profile link the same treatment, or point it somewhere
      that does not leave the room. Right now it is the one exit that still costs a session.

Neither of the first two touches `/dash`, so neither blocks or is blocked by the merge below.

**Order, and the reason for it.** Homepage first, dash second, account last:

1. **~~Clean up the homepage.~~ Done 2026-09-11** — as a code split, which is what Timo meant by
   it. Thirteen overlay sheets left `app/page.tsx` for six files in `app/components/`, following the
   `HomePanel` pattern; **6485 → 5950 lines**. Pure motion, verified by a structural fingerprint of
   all fourteen screens against a mock-AI build, which makes the comparison exact and free. See the
   CHANGELOG entry.

   **Still open under this heading**, and it is design rather than code: the landing screen does not
   know who is looking. Signed in you get the same cold funnel, "90 seconds. no signup." included,
   and no way through to your own practice. That is the gap between a funnel and the onboarding the
   App Store needs, and it is the taster-session question above.
2. **~~Fold `/dash`'s parts in — as components, not pasted.~~ Done 2026-09-11.** The cards and the
   drawer became components; the engine became `lib/use-voice-entry.ts` and the derivations
   `lib/use-entry-data.ts`. `/dash` went **1382 → 410 lines** and is now one of two hosts.

   **The landing knows who is looking**, which is what Timo wanted this step for. Signed out with
   nothing on the device is still the funnel, word for word. Anybody else — signed in, or with an
   event planned on this browser — gets their own practice. The orb listens on the homepage exactly
   as it does on `/dash`, and routes into the room's own functions instead of writing a hand-off key
   and navigating.

   **`/dash` stays.** An earlier version of this line said it was worth deleting after step 3.
   That was an assumption, and Timo overruled it with a better reason: it is the manual control for
   the half of the homepage no test can reach. Every check here drives the typed path, because the
   harness aborts the realtime token — so the microphone has no automated cover and cannot get any,
   and voice does not behave like text. Running the same sentence into both screens by hand is the
   only way to tell "the homepage is broken" from "the merge broke it". The four hand-off keys
   (`autoStartKey`, `eventBeatKey`, `stungKey`, `askPhraseKey`) stay with it.

   Also new and worth knowing: the `blocked` phase has a typed way into the router. It was a dead
   end, and building it found a worse fault — see the CHANGELOG.
3. **~~`/dashboard` becomes the account page.~~ Done 2026-09-11 — as `/account`.** `/dashboard`
   and `/profile` merged into one screen and both routes are gone. All seven links repointed. The
   coach chat was cut with them, which is the other decision in this section.

   **Still open, and it is the last thing in 1.5 that costs a learner anything:** the account pill
   is a plain navigation with no snapshot, so it stays hidden while there is work to lose. That
   guard was right when the pill went to a screen nobody needed mid-session; it is wrong now that
   it goes to the only place a learner can sign out. Fixing it is not a one-liner: `stashRoomForAuth`
   exists, but `restoreRoomAfterAuth` is wired to `onAuthStateChange` and a plain back-navigation
   fires no auth event, so the restore needs a mount-time path as well — with its own guard against
   restoring a run that should have stayed closed.

**~~Blocking detail for step 3.~~ Cleared 2026-09-11.** Sign-out, the email and the auth provider
all landed on `/account` before `/profile` was deleted, and every link was repointed. One
correction to what this said: sign-out was in **two** places, not one — the verdict card has had
its own since 1.1, and it stays there, which is the point of it. What `/profile` held alone was the
sign-out you can reach when you are NOT mid-session.

---

## 2. Things that look finished and are not

*The dangerous class. Each of these has working code, user-facing copy, or both — and does nothing.*

- [ ] **The entire return half is inert.** This is the biggest one on the list.
      - `/api/retrieval` has **zero callers** and there is **no `vercel.json`**, so no cron ever
        triggers it.
      - **`app/m/` does not exist**, so the `/m/<id>` link in every retrieval email is a 404.
      - `sendRetrievalEmail` in `lib/persistence.ts` is therefore unreachable.
      - Meanwhile `moments.retrieval_due_at` is written on every save, the closing card promises a
        weekday out loud, and `retrieval_deliveries` / `retrieval_variations` exist in full.
      > "Your words come back on Tuesday" is currently a promise nothing keeps. Either build the
      > cron and the `/m/` page, or stop saying the date.
- [ ] **`lastVoiceFreeze` is never set on the realtime path.** Freeze signals — time to first word,
      hesitations, English leakage — are the evidence behind half the teaching model, and on the
      voice path they are empty. Only the file-upload transcription path fills them.
- [ ] **`MAX_REALTIME_SESSIONS_PER_DAY` defaults to 5 in production**
      ([realtime-token/route.ts:36](app/api/realtime-token/route.ts#L36)). Five voice sessions per
      day per client, for everyone. Fine for a closed test, wrong the moment strangers arrive.

---

## 3. Master plan, genuinely unbuilt

### Phase 4 — the moat *(mostly done now)*
- [x] **#30** Build backward from one real dreaded event — shipped 2026-09-07
- [x] **#51–54** The Speaking Journey — shipped, visible on the closing card
- [x] **#27** Unaided production as the success definition — effectively shipped: the ledger only
      reaches `confirmed_real_life` on `usedTargetChunk && assistanceUsed === "none"`, and the
      journey moves off the ledger. **Needs marking in the plan, not building.**
- [x] **#28** Prove memory in-conversation — largely shipped: `/api/converse` receives settled
      earlier evaluations, and the phrase recall built on 2026-09-07 is the sharpest version of it.
- [ ] **#32 Stop gating memory behind the email box.** **Unblocked 2026-09-07** — the co-founder
      withdrew his objection, so requiring an account is allowed. What is left is the harder half:
      where the ask sits and what it is worth. **Now section 1.1.**

### Phase 1 — one half still deferred
- [ ] **#42 Half B — voice barge-in.** Cutting the coach off by talking over it. Gated on a real
      iPhone echo test on speakerphone at real volume; the failure mode is the coach interrupting
      *itself* and then blaming the learner. Ships behind a flag with a self-interrupt circuit
      breaker when it ships.
- [ ] **All Phase 1 voice behaviour is unvalidated on hardware.** Headless Chromium has no
      microphone — every automated run in this repo only ever proves the typed path.

### Phase 5 — hands-off
- [ ] **#36** True voice-only control ("say 'again' to repeat")
- [ ] **#37** Car-audio survival
- [ ] **#16** Real audio-condition testing — car mics, AirPods, background noise, accents,
      code-switching. Listed as P0 in the review analysis and still the fastest way to lose a voice
      user.

### Phase 6 — money and launch
- [ ] **#17** Boring, obvious billing: trial end date, exact amount, cancellation path
- [ ] **#18** One complete win before any paywall — **restated 2026-09-11:** the win belongs
      before **account creation**, not before the paywall. One session is a poor argument to pay;
      habit is the argument, and habit is many wins, which only exist once there is an account to
      hang them on. See 1.5.
- [ ] **#26** Reposition: *"You understand Spanish. Now practice answering."*

---

## 4. Privacy and data

*All of these come from `docs/user-data.json`, which was written against the live schema. None is
hypothetical.*

- [ ] **There is no delete path.** `deleted_at` exists on `moments` and `events` and **nothing in
      the app ever sets it**. A deletion request today has to be done by hand in Supabase. This is
      the one item here that is a legal obligation rather than a nice-to-have.
- [ ] **No retention policy.** Nothing ages out except `engine_sessions`. Transcripts, conversations
      and events are kept forever by default.
- [ ] **`sessions.device_json` stores the raw User-Agent.** A pure fingerprinting surface; a device
      class ("iPhone, Safari") would serve every use we actually have. Easiest win on this list.
- [ ] **Confirm the Supabase project's region** before anything written claims where data lives.
- [ ] **Write the privacy policy.** `docs/user-data.json` is the inventory it needs — including the
      profiling section, which is `personal_teaching_model_json`.
- [ ] *(Aware, probably fine)* The Supabase session sits in **localStorage**, not an httpOnly
      cookie, because `getSupabaseBrowser` uses supabase-js defaults. Standard setup. It becomes a
      real decision the day a third-party script goes on the page.

---

## 5. From `stuffihavetodo.md`

- [ ] **Implement Google OAuth.** Secrets are in `GoogleOauth_Secrets.md` (gitignored).
- [ ] **A screen for after account creation.** Right now signing up drops you back with no
      acknowledgement of what just changed.
- [ ] **Make it hostable on Vercel.** `docs/VERCEL_SETUP.md` exists — confirm whether this is done
      or still open, and close it either way.

---

## 6. Housekeeping

- [ ] **Three pre-existing TypeScript errors**, untouched for weeks and easy to fix:
      `sessionId` in [retrieval/route.ts:135](app/api/retrieval/route.ts#L135), and `Fetcher` /
      `D1Database` in [worker/index.ts:6](worker/index.ts#L6). They make `npx tsc --noEmit` useless
      as a pass/fail gate, which is the actual cost.
- [ ] **`npm run lint` picks up `.vercel/output`.** Slow and noisy; needs an ignore.
- [x] ~~**One test row sits in production `analytics_events`**~~ — moot: the whole table was
      dropped in 1.2, and the two rows that were actually ours moved to `kept_requests`.
- [ ] **There is no local database.** The dev server talks to **production Supabase**, so every test
      row is a real row. Worth solving before anyone else works on this.
- [ ] **`MAX_OPENAI_REQUESTS_PER_SESSION` is 400 in `.env`** for testing. Production is unaffected,
      but the value should not follow anybody to a deploy.
- [ ] **`UI.Idee.md` is empty.** Its content was built and shipped as 1.4; decide whether the file
      goes or gets refilled with the next UI scope. `app/components/HomePanel.tsx` is untracked but
      is **not** a leftover — it is rendered by the room and by `/dashboard`, and section 1.5 makes
      it the pattern the rest of the merge follows. It needs committing, not deciding.

---

## 7. Decisions, not tasks

*Nobody can build these until somebody chooses.*

- [x] ~~**#32 — may we require an account?**~~ **Settled 2026-09-07: yes.** The co-founder withdrew
      his objection. The remaining question is placement and justification, which is work rather
      than a decision — moved to section 1.1.
- [ ] **How often should a resurfaced phrase fire?** Currently one scene in three
      (`sceneChance` in `lib/phrase-recall.ts`). It is one constant in a pure module, deliberately,
      because nobody has evidence yet.
- [ ] **Does the return half get built, or does the promise get removed?** See section 2. Both are
      defensible; leaving it as it is, is not.

---

## The one thing this list cannot do

The master plan's own last line still holds and is worth repeating here, because everything above
makes it easy to forget:

> Every item makes the product better for users who don't exist yet. **Ship it, then put the link
> in front of strangers.** What they complain about should outrank this document.

Phases 0–3 shipped, and Phase 4's biggest bet with them. The blocker is no longer the build — it is
that **zero strangers have used this**.

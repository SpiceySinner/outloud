# Tracking — what we measure, and what would change our minds

## Why this document exists first

**There is no tracking in this app.** None. `/dash`, the room, the event engine and the phrase
queue have never reported anything, and until 2026-09-10 nothing in the codebase could.

The 644 rows that were sitting in `analytics_events` were **not ours**. They belong to an older
product that shared this Supabase account, written by a tracker that was never in this repo,
between 2026-07-30 and 2026-08-04. Two rows out of 644 were OutLoud's, and they were not
analytics at all — they were kept requests, which now live in `kept_requests`. The table has
been dropped.

So this is a blank page, and the order is deliberate:

> **The tracking is not the work. Deciding what would change our minds is the work.**

Every event below exists because a specific question needs it, and every question below has a
decision attached. If an event cannot be traced to a decision, it does not get added — that rule
is the whole difference between analytics and telemetry theatre.

---

## 0. What the database actually holds (2026-09-10)

Read before arguing about any of the rest, because it sets the scale:

| | |
|---|---|
| accounts | **1** |
| saved runs | **24**, of which **23** were anonymous and unclaimed |
| planned events | 2 |
| word bank | **0 rows, ever** |
| analytics events | 644, all of them from 2026-07-30 to 2026-08-04 |
| feedback | 6 |

Three things follow.

**The claim fix was not theoretical.** 23 of 24 saved runs had no account and could never be
reached by one. That was the whole database of practice, unreachable, until 2026-09-10.

**The word bank has never held a row.** Not a bug we can see — `/api/word-bank` requires an
account and there is one account — but it means the dashboard's "your words", and the entire
phrase-recall feature built on it, have **never run against real data**. Q7 cannot be answered
until it does, and the writer itself is unproven in production.

**There is no traffic.** Every number here is us. Nothing in this document is a measurement of
a product yet; it is preparation for the first time somebody who is not us opens the app.

---

## 1. The seven questions

Each one names the decision it feeds. Nothing here is instrumented today; every number is
currently a guess.

### Q1 — Do people speak at all?

The entire app is a microphone with no vocabulary in front of it. `/dash` teaches what to say in
its header, and if that teaching fails the engines behind it are irrelevant.

**Measure:** arrived at `/dash` → opened the mic → produced any speech.
**Decision it feeds:** if people arrive and never speak, the fix is the header and the first-run
experience, not the router. If they open the mic and say nothing, it is nerves or the prompt, and
the answer is a tap-first path rather than better copy.

### Q2 — Does the router understand them?

**Measure:** the share of routed utterances that come back `unclear`, split by whether anything
was open on the screen.
**Decision it feeds:** a high `unclear` rate on rich input is a prompt problem; a high rate on
short input is a transcription problem, and those have completely different fixes. The read-back
means a miss costs one sentence, so this is about frequency, not damage.

### Q3 — Which intent do people actually want?

On 2026-09-07 we split `talk` into `ask_phrase`, `stung` and `talk` on a hypothesis, and built an
engine for two of them.

**Measure:** the intent distribution.
**Decision it feeds:** where the next build goes. If `ask_phrase` is 2% of traffic, the phrase
half was the wrong bet and the event engine deserves the attention instead. This is the single
most direct "were we right?" number available.

### Q4 — Do they finish a session?

**Measure:** drop-off by phase — intake → attempt → rescue → scene → verdict → closing card.
**Decision it feeds:** session length, the number of turns, how hard the pressure is. Also
whether the closing card is worth building anything else onto, which nothing currently knows.

### Q5 — Does the account ask convert, and does anybody reach it?

The one question this codebase has already had to answer without evidence. On 2026-09-10 the ask
was cut from two places to one, at the verdict, on the argument that the second could only ever be
seen by somebody who had just declined. That argument is sound and the conversion cost is unknown.

**Measure:** reached the verdict → saw the ask → opened the dialog → created an account. And how
many never reach the verdict at all.
**Decision it feeds:** whether the closing-card ask comes back. See `docs/TODO.md` 1.1.

### Q6 — Do they come back?

The product thesis is memory. Everything about the return half assumes people return.

**Measure:** sessions per learner over time, and days between them.
**Decision it feeds:** whether building the inert return half (`docs/TODO.md` section 2) is
urgent or premature. If nobody comes back on their own, an email nobody receives is not the
bottleneck.

### Q7 — Does the aha actually fire?

The phrase somebody asked for, produced days later, unaided, in a scene built for something else.
It is the reason the `talk` build exists.

**Measure:** phrases saved with `source: 'asked'` → resurfaced → `landed_at` set.
**Decision it feeds:** everything. If this number is near zero the feature is a lookup tool with
extra steps, and its own design doc says so. This is the one metric that says the product works.

> Q7 is deliberately **not** a PostHog number. It lives in `word_bank` where the truth is, and it
> is read with SQL. See section 4.

---

## 2. What must never leave for PostHog

`docs/user-data.json` is the inventory of everything we hold. PostHog is a **new third party**,
and the line is drawn hard because this app collects unusually intimate free text — what somebody
could not say to their partner's mother.

**Never sent:**

| | why |
|---|---|
| transcripts, attempts, `original_text`, `outcome_said` | the most personal columns in the database, and none of them answer any question in section 1 |
| the sentence said at the orb | it is research, and research lives in Supabase where it can be joined to the row it belongs to |
| email addresses, `auth.users.id` | identity belongs in Supabase; PostHog gets a pseudonym |
| rescues, evaluations, coach lines | content, not behaviour |
| the raw User-Agent | PostHog derives its own device class; there is no reason to hand it the string as well |

**Sent:** event names, the phase or step, durations, counts, booleans, and enum values from
fixed lists (intents, blockers, ledger states). Nothing free-text, ever.

### Session replay is ON, with the content blanked

Decided 2026-09-10 (Timo). Watching somebody give up is the only way to see **why** they gave
up — a funnel says they left at the rescue, a replay says they sat on it for ninety seconds
first, and those two facts lead to different fixes.

The masking is what makes it keepable, and it is not PostHog's default:

- **`maskAllInputs`** — everything typed. The attempt, the retry, the email box.
- **`maskTextSelector: "*"`** — and every *rendered* string as well, which is the unusual half. A
  DOM recording would otherwise capture the rescue, the coach's lines and the transcript as plainly
  readable text.
- **`maskTextFn`** — `replayText` in `lib/track.ts`, which hands back only our own fixed copy.
- **no request or response bodies** — they would carry the same sentences straight back out.

What still records: layout, length, every click, hover and scroll, and the short list of app copy
in `chromeSelectors` — the buttons and section labels. The result is a replay you can watch for
behaviour and cannot read for content.

> **Masked by default; chrome opts out.** This is the second attempt, and the first one is worth
> knowing about. It was a list of content classes to blank, with `.private` as the escape hatch and
> a note telling whoever added the next panel to use it. Audited **2026-09-11**: `.private` was on
> zero elements and roughly forty content classes were missing from the list — including
> `.then-line`, the learner's own opening sentence quoted back on the closing card, added that same
> morning. The list was a snapshot of one afternoon, exactly as this doc predicted it would be.
>
> A rule you have to remember is not a rule, it is a hope. So the default is inverted: everything
> masks, and `chromeSelectors` names the handful of strings we can vouch for. A panel added tomorrow
> is private without anybody deciding it should be, and a mistake now costs a button you cannot read
> rather than somebody's sentence in a recording.
>
> Where somebody stopped is answered by the event catalogue anyway — `rescue_reached`,
> `verdict_reached`, `session_closed` name the phase precisely. The replay says how long they sat
> there and what they reached for, and neither of those needs their words.

**Identity:** the `distinct_id` is the browser's `outloud-session-id` — the same pseudonym the
database uses, so a PostHog funnel and a SQL query are talking about the same person without an
email ever crossing over. On sign-in we `identify()` against the Supabase user id, never the
address.

**The enforcement is in the type system, not in this document.** `lib/track.ts` exports a closed
catalogue of events and their property shapes. An event that is not in the catalogue does not
compile, and a property that is not declared cannot be attached. A rule written only in prose
survives about three weeks.

---

## 3. PostHog or Supabase?

Both, with a line between them that has a reason.

| | goes to |
|---|---|
| behaviour, funnels, drop-off, retention, replay | **PostHog** — it is built for this and we are not |
| anything that must join to a real row | **Supabase** — the moment, the event, the phrase |
| free text of any kind | **Supabase**, always |

**`analytics_events` is gone** (2026-09-10). It was never OutLoud's, and a second table answering
the same questions as PostHog is how two systems start disagreeing.

**`kept_requests` replaces the one thing it was holding for us.** When the router understands
somebody and there is no engine behind it, the sentence is kept. That is a corpus, not a metric,
and it is free text about somebody's life — so it stays here. A *count* of refusals is a PostHog
number; the sentence behind it never leaves.

### The join: one picture, not two dashboards

PostHog knows behaviour. The database knows truth. Neither is whole on its own, and the join key
already exists: **PostHog's `distinct_id` IS the browser's `outloud-session-id`, which is
`sessions.id`.** That was true from the first line of `lib/track.ts` and it is the reason the
rest of this works.

Four views exist so PostHog can be pointed at the database without the intimate text following:

| view | one row per | carries |
|---|---|---|
| `ph_sessions` | browser | runs saved, runs claimed, first and last seen, events planned |
| `ph_runs` | saved run | blocker, ledger state, turn count, and text **lengths** never text |
| `ph_phrases` | collected phrase | source, due date, resurfaced count, `landed_at`, days to land |
| `ph_events` | planned event | status, beats, beats done, whether they spoke |

**Connected 2026-09-10.** Source `01a08946-7862-0000-6fbe-8b52d198fe76`, queryable as
`postgres.outloud.ph_*`. All four sync as **full_refresh**, not incremental: these are aggregate
views whose existing rows change — a phrase gets `landed_at`, an event's `beats_done` climbs,
a session's `runs_saved` goes up. Incremental only fetches new rows, so it would freeze every one
of those at its first value, and a metric that is silently stale is worse than one that is missing.

**The login can read nothing else.** `posthog_reader` (see
`supabase/202609100002_posthog_reader.sql`) has SELECT on the four views by name and no grant
anywhere else. PostHog's own connection probe is the proof: it enumerates all 17 relations from
the catalogue, and for `moments`, `word_bank`, `sessions` and every other real table it reports
`available_columns` **empty**. Two independent layers — no grant, and RLS enabled with no policy.

Every column is an id, a timestamp, an enum from a fixed list, or a count. **Not one free-text
column in any of them** — no `original_text`, no attempt, no rescue, no outcome sentence, no
Spanish, no email. Connect the PostHog warehouse to these four and nothing else, and section 2
stays true by construction rather than by discipline.

That is what makes a funnel answerable end to end: *of the people who dropped off at the rescue,
how many had ever saved a run before?* is one question across both systems, joined on a
pseudonym, with no address anywhere in it.

## 4. The analyst agent

`.claude/agents/outloud-analyst.md` is a read-only agent for running these questions periodically
against Supabase. It exists because Q6 and Q7 cannot be answered in PostHog — they need SQL over
`word_bank` and `moments`.

It is **read-only by construction**: its tool list contains no write path, and the database it
reads is production, because there is no other one (`docs/TODO.md` section 6).

Run it when you want to know how things are going, not on a schedule. A weekly report nobody acts
on is the same failure as an empty table.

---

## 5. Configuration

Two variables. Without them the tracker is inert and every call is a no-op — the same pattern
`RESEND_API_KEY` and the Supabase keys already use, so a missing key degrades to silence rather
than to a crash.

```
NEXT_PUBLIC_POSTHOG_KEY=phc_...
NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com
```

**US, to match Supabase.** The open question in `docs/user-data.json` about where data lives is
now answered: the Supabase project is **`us-east-2`**. An EU PostHog beside a US database would
be a worse story than either alone — one more region to explain for no benefit, since the
intimate data is all in the one that stays put.

If the data should live in the EU, that is a **Supabase** decision and a migration, and PostHog
should follow it rather than lead. Worth deciding before launch, not after.

The key is a **public** project key — it ships to the browser by design and is not a secret. It is
still in `.env`, which is gitignored.

---

## 6. Why there is no vocabulary to inherit

It is tempting to read the 644 archived rows as prior art — `app_loaded`, `blocker_selected`,
`rescue_completed` all sound like this app. They are not. They describe a different product that
happened to share a database, and the resemblance is the dangerous part: a name that half-fits
is worse than no name, because nobody re-examines it.

One lesson does carry, and it is about shape rather than content. **`step_viewed` was 324 of
those 644 rows.** Half the dataset was one generic event with a `step` string, which can tell you
somebody moved and never what they decided. That is how a catalogue rots: adding a step is always
easier than naming what happened. `lib/track.ts` refuses to offer the shortcut — the catalogue is
closed, and not one property in it is a bare string.

---

## 7. What this cannot tell us

Stated because a dashboard makes everything look answered:

- **Nothing here says whether anybody wants OutLoud.** Zero strangers have used it. Every number
  below launch is us and our friends, and behaves nothing like real traffic.
- **Voice is not measurable this way.** Whether the mic works in a noisy room, whether the coach
  interrupts itself, whether a real iPhone survives an open mic — none of it shows up in a funnel.
  That is `#16` and `#42`, and it needs hardware and hands.
- **Ad blockers eat posthog-js.** A meaningful share of events will simply never arrive, and the
  shortfall is not random — it skews toward exactly the technical users most likely to be early
  adopters. Treat every absolute number as a floor and trust the ratios instead.

# Working on OutLoud

OutLoud is a Spanish speaking coach. Someone says what they want to be able to say, the app builds
a scene around it, they speak it out loud with a character, and a card at the end shows what they
got out on their own. It is heading for the App Store.

This file is the short version of what six weeks of bugs taught us. Most of it is not about React.

---

## Run it

First time here? [README.md](README.md) has the setup — `npm ci`, `cp .env.example .env`, and the
four variables that have to be real before anything works.

```bash
npm run dev          # localhost:3000
npm test             # unit + structure checks. ~1s, no server, no credits.
npm run test:live    # prompt checks against the real model. Needs `npm run dev` running.
npm run lint
npx tsc --noEmit
```

`npx tsc --noEmit` reports **three errors that were already there** and are nobody's fault:
`sessionId` in `app/api/retrieval/route.ts`, and `Fetcher` / `D1Database` in `worker/index.ts`.
Anything beyond those three is yours.

Read `checks/README.md` before writing a check. It is short.

---

## The rules that cost us days

### 1. Fix the scenario, not the sentence

The single most expensive lesson here, and it has Timo's words on it: *"wir optimieren hier nicht
für einzelne Sätze, wir optimieren für das Szenario."*

A bug arrives as an example — one sentence that did the wrong thing. The tempting fix is to add
that sentence's shape to a pattern. It passes. It ships. A week later a real session produces one
more sentence nobody wrote down, and the learner gets the same wrong screen.

**If your fix is a longer list, it is at the wrong altitude.** Find the decision that produced the
outcome and ask what question that decision should be asking. The one that finally worked had two
answers and no tail: *is there any Spanish in this at all?* Spanish however broken is an attempt;
English whatever it says is the learner talking to us.

This happened three times in this repo before it was fixed properly. Do not make it four.

### 2. Deterministic code owns facts. The model owns meaning.

Counts, dates, and facts *about* strings belong in code — a model that counts is a model that will
eventually miscount out loud, to a user.

But *"is this a question"*, *"did this accept the offer"*, *"what language is this"* are meaning
judgments. They belong to the model, or to a deterministic gate that answers one clean question.
**They do not belong to a growing list of words.** See rule 1.

### 3. A check carrying its own copy of the rule proves nothing

It proves two copies agree. Twice in this repo a check pasted the pattern it was checking, the
pattern turned out to be wrong, the copy was wrong identically, and the run was green.

Import the real module. `loadLib("lib/stuck-signal.ts")` in `checks/harness/load.mjs` resolves the
`@/` alias so you can.

### 4. Prove the check against unchanged code first

A green run means your change works, or it means your check cannot fail. Those look the same.

`baselineComparison()` runs your probe against the working tree *and* against git and tells you
whether it can tell them apart. Use it when you are fixing something —
`checks/unit/voice-dump.check.mjs` is the worked example.

### 5. A mock run of a prompt fault proves nothing

`OUTLOUD_MOCK_AI=true` short-circuits the model completely and returns fixtures. It is excellent
for UI work and worthless for prompt work. Prompt changes are verified against the real model on a
running dev server, or they are not verified.

Live checks call `realModelRequired(t)`, which refuses to run against a mock server.

### 6. Nothing automated ever covers voice

Headless Chromium has no microphone. **Every automated check in this repo proves the typed path
only**, and voice does not behave like text — most of the bugs in the CHANGELOG were found by
speaking, not by typing.

There is no browser harness in the repo yet; building one is a task (`check/build-group`). When it
exists it must **abort `/api/realtime-token`**, so that a run cannot half-open a voice session and
report something about a path it never drove. Every previous harness here did that deliberately.

`/dash` exists to drive the same sentence into the voice path by hand. **Never delete it.** It is
the only way to tell "the homepage is broken" from "the merge broke it".

So the manual run is not extra credit — it is the only coverage half this app has.
**[docs/Tests/TEST_RUN.md](docs/Tests/TEST_RUN.md)** is that run, ordered by blast radius rather
than by feature. Work through the blocks your change touches before you call it done, and say in
the PR which ones you ran.

The console is how you see inside the voice path while you do:
`__outloudVoiceDebug(true)` once, then `copy(__outloudVoiceDump())`. Details and the one limitation
are in [docs/TASKS.md](docs/TASKS.md#driving-it-by-hand-from-the-browser-console).

---

## Things that will bite you

**The dev server talks to PRODUCTION Supabase.** There is no local database and no second project
— everyone shares the live one. Every row a check or a manual run writes is a real row next to
real users' data. `/api/aside` is stateless and safe to drive; `/api/coach` writes an
`engine_sessions` row every time. The four rules for working in there are in
[docs/TASKS.md](docs/TASKS.md#working-against-the-production-database), and they are not optional.

**The realtime model is a voice bridge and nothing else.** It transcribes and it speaks. Every
coach line comes from `/api/converse` and the routes beside it. `create_response` and
`interrupt_response` stay `false` everywhere — turning either on makes the bridge start talking
on its own, in a voice nobody wrote.

**No free text may ever leave for PostHog.** Not a learner sentence, not a coach line, not a
transcript. `lib/track.ts` is a closed catalogue: an event that is not in it does not compile, and
no property in it is a bare string, so a sentence cannot be attached by accident. Keep it that way.
Session replay masks everything by default (`maskTextSelector: "*"`); a short hand-checked list
names what may be read.

**A credential never goes in a migration file.** `supabase/` is committed. Secrets live in `.env`,
which is gitignored, and nowhere else.

---

## What we call the screens

One name per surface, so a sentence like "the orb on Home" cannot mean two things. These are the
names to use in conversation, in commit messages and in check names.

| name | what it is | in the code |
|---|---|---|
| **Funnel** | `/` cold — signed out, nothing on this device. "90 seconds. no signup." | `isLanding && showFunnel` |
| **Home** | `/` warm — signed in, or an event planned on this browser. Your own practice, and the orb listens | `isLanding && !showFunnel` |
| **Room** | `/` during a session. Everything below happens here | `!isLanding` |
| **Dash** | `/dash` — the manual voice control. Reachable only by typing the URL, on purpose | its own route |
| **Account** | `/account` — account, sign-out | its own route |

Funnel and Home are the same route and the same component. They are different products: one is a
cold pitch to a stranger, the other is somebody's own practice. Mixing them is a bug that has
happened before.

Inside the Room:

| name | what it is | in the code |
|---|---|---|
| **Opening** | the one question — *what do you want to be able to say?* | `flowPhase === "opening"` |
| **Ask** | the direct entry, where the answer IS the sentence they want | `flowPhase === "ask"` |
| **Coach** | framing, then the scenario turn that builds the scene | `flowPhase === "coach"`, `coachPhase` |
| **Scene** | the roleplay itself, with the character | `flowPhase === "session"` |
| **Aside** | stepping out of the Scene to the coach and back. A room MODE, not an overlay — an overlay closes the mic, so a sheet version would be silent | `asideActive` |
| **Verdict** | the closing card | `flowPhase === "verdict"` |

> **One mismatch worth knowing.** `flowPhase === "session"` is the **Scene**. "Session" in
> conversation means the whole go from Opening to Verdict, so the code's name is narrower than the
> word. Do not rename it casually — it is in `RoomSnapshot` and in saved rows.

---

## Where things are

| | |
|---|---|
| `app/page.tsx` | Funnel, Home and Room, all three. ~6400 lines, one client component. Sorry. |
| `app/components/` | the sheets and cards lifted out of it |
| `app/dash/` | Dash — the manual voice control (410 lines) |
| `app/account/` | Account |
| `app/api/` | 23 routes. `coach`, `converse`, `aside` and `rescue` are the ones with prompts in them. |
| `lib/` | the logic worth testing. Pure where it can be. |
| `checks/` | see `checks/README.md` |
| `docs/TODO.md` | what is actually open, and why. Read before starting anything. |
| `docs/TASKS.md` | who has what, and what has to be in place before you start |
| `docs/Tests/TEST_RUN.md` | the manual run — the only coverage voice has |
| `.env.example` | every variable, with the comment saying what it is for |
| `CHANGELOG.md` | what shipped, what it cost, and what the first diagnosis got wrong |

### The CHANGELOG is not a release note

It is where a fix explains itself: what broke, why the first theory was wrong, what was verified
and how. Several entries say "and my first diagnosis of this was wrong", which is the point of
them. Add an entry when you fix something real, and say what you actually verified — including
"not verified, only real audio exercises this" when that is the truth.

---

## Conventions

- **Comments explain why, not what.** The existing ones carry the failure that produced the line.
  Match that. A comment that restates the code is noise; a comment naming the bug that made the
  line necessary saves the next person a day.
- Prose in code and docs is plain and direct. No exclamation marks, no "simply", no "just".
- TypeScript strict. `npm run lint` and `npx tsc --noEmit` before you say you are done.
- Do not add a dependency to solve something small. The check runner is 70 lines of Node for
  exactly this reason.
- Commit messages say what changed and why.

## Branches

**`main` is what deploys.** Nothing lands there without Timo reviewing it, and only Timo merges.

**One branch per task, one PR per task.** Branch off `main`, not off another task branch:

```bash
git switch main && git pull
git switch -c task/device-class
```

Commit as often as you like inside it — small commits are easier to review than one large one,
and that review is the only gate between your change and the live app. When the task is done, open
the PR and say so.

Independent PRs are the point. If Timo does not get to a review for two days you start the next
branch instead of piling the next task into the same diff, and he reviews in whatever order suits
him rather than in the order you happened to work.

**Keep them short.** `app/page.tsx` is one 6400-line component that most work touches. Two task
branches both editing it will conflict, and the cost is paid by whoever merges second. If your
next task touches a file your open PR already changed, wait for the merge rather than branching
off your own unmerged work.

Never commit to `main`. Never force-push a branch anybody else has pulled. Rebasing your own
unmerged task branch onto `main` is fine and usually the tidy thing to do.

### Names

| task | branch |
|---|---|
| `device_json` device class | `task/device-class` |
| delete path | `task/delete-path` |
| realtime session limit | `task/realtime-limit` |
| retention policy | `task/retention` |
| date the navigation bug | `task/date-nav-bug` |
| store what the AI said | `task/ai-corpus` |
| `account_created` events | `task/account-created-events` |
| unit checks for the pure modules | `check/pure-modules` |
| Playwright and the `build` group | `check/build-group` |
| production-build navigation | `check/build-navigation` |
| room restore | `check/room-restore` |
| screen fingerprint | `check/screen-fingerprint` |
| persona sweep harness | `check/persona-sweep` |

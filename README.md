# OutLoud

A Spanish speaking coach. Someone says what they want to be able to say, the app builds a scene
around it, they speak it out loud with a character, and a card at the end shows what they got out
on their own.

React 19 and Vite (`vinext`), Supabase, OpenAI. Heading for the App Store.

---

## Getting it running

```bash
node -v                  # 22.13 or newer
npm ci
cp .env.example .env     # then fill it in — see below
npm run dev              # localhost:3000
```

`.env.example` lists every variable with the comment explaining what it is for. Four of them have
to be real before anything works at all:

| | |
|---|---|
| `OPENAI_API_KEY` | every AI route. Use your own key, not somebody else's |
| `NEXT_PUBLIC_SUPABASE_URL` | |
| `SUPABASE_SERVICE_ROLE_KEY` | server-side, bypasses RLS. Treat it accordingly |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the browser auth dialog. Without it, signup falls back to email only |

The rest — Resend, Discord, PostHog, the limits — can stay empty while you find your way around.
The app degrades rather than crashing.

> **Two things to know before you run it the first time.**
>
> **The dev server talks to the production database.** There is no local one. Every row you write
> is a real row next to real users' data.
>
> **`.env` is gitignored and stays that way.** It is the only place a credential lives. Not in a
> migration, not in a check, not in `.env.example`.

## Commands

```bash
npm run dev         # localhost:3000
npm test            # unit + structure checks. ~1s, no server, no model, no credits
npm run test:live   # prompt checks against the real model. Needs `npm run dev` running
npm run test:all
npm run lint
npx tsc --noEmit    # must pass with no errors
npm run build && npm run start   # the production build, which behaves differently
```

Prefix anything with `OUTLOUD_MOCK_AI=true` to run against fixtures instead of the model —
deterministic and free, and useless for anything about a prompt.

## Where to read next

| | |
|---|---|
| **[AGENTS.md](AGENTS.md)** | **Start here.** The rules that cost us days, what the screens are called, and the branch workflow. Ten minutes, and it is the difference between finding a bug and re-causing one |
| [docs/TASKS.md](docs/TASKS.md) | who has what, and what has to be in place before you start |
| [docs/TODO.md](docs/TODO.md) | what is actually open, and the file that proves each claim |
| [checks/README.md](checks/README.md) | how the checks work and how to write one |
| [docs/Tests/TEST_RUN.md](docs/Tests/TEST_RUN.md) | the manual run. Voice has no automated cover and cannot get any, so this is not optional extra credit — it is the only coverage half the app has |
| [CHANGELOG.md](CHANGELOG.md) | what shipped, what it cost, and what the first diagnosis got wrong |

## Layout

| | |
|---|---|
| `app/page.tsx` | Funnel, Home and Room, all three. ~6400 lines, one client component |
| `app/components/` | the sheets and cards lifted out of it |
| `app/dash/` | Dash — the manual voice control. Reachable only by typing `/dash` |
| `app/account/` | Account |
| `app/api/` | 23 routes. `coach`, `converse`, `aside` and `rescue` are the ones with prompts in them |
| `lib/` | the logic worth testing. Pure where it can be |
| `checks/` | the checks, run by `npm test` |
| `supabase/` | schema and migrations. Committed, so never a credential |

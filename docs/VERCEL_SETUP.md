# Deploying OutLoud to Vercel

Everything needed to get this app onto Vercel, plus the things that will silently
misbehave if a step is skipped.

## How the build target is chosen

The project can build for two hosts. `vite.config.ts` picks one:

| Condition | Plugin | Used for |
| --- | --- | --- |
| default | `@cloudflare/vite-plugin` | `npm run dev`, Cloudflare Workers |
| `NITRO_PRESET` set, or `VERCEL=1` | `nitro/vite` | Vercel and every other Nitro platform |

Vercel sets `VERCEL=1` in CI by itself, so nothing has to be configured for the
switch to happen. The two plugins own the same server output and cannot both be
active, which is why this is an either/or and not a merge.

To reproduce a Vercel build locally:

```bash
NITRO_PRESET=vercel npx vite build     # -> .vercel/output (Build Output API v3)
```

To run the production server locally (Node instead of Vercel's wrapper):

```bash
NITRO_PRESET=node_server npx vite build
PORT=3222 node --env-file=.env .output/server/index.mjs
```

Note that `npx vite preview` does **not** work with a Nitro build — the RSC plugin
looks for `dist/server/index.js` instead of the Nitro output. Use the node_server
recipe above.

## Vercel project settings

- **Build Command:** `vite build`
- **Output Directory:** leave empty. The build writes `.vercel/output`, which
  Vercel auto-detects as Build Output API v3; an output directory setting would
  be ignored anyway.
- **Install Command:** default (`npm install`)
- **Node.js Version:** 22.x (Vite requires 20.19+ or 22.12+)

Nitro bundles the entire app into a single serverless function
(`__server.func`), so `maxDuration` is shared by every route. It is set to 60s in
`vite.config.ts` — comfortably above what the OpenAI-backed routes need and
inside the Hobby ceiling.

## Environment variables

Set these in the Vercel project (Production **and** Preview).

| Variable | Required | Notes |
| --- | --- | --- |
| `OPENAI_API_KEY` | yes | Everything AI-facing breaks without it. |
| `OPENAI_MODEL` | no | Defaults to `gpt-4.1-mini`. |
| `OPENAI_REALTIME_MODEL`, `OPENAI_REALTIME_VOICE` | no | The voice must match the one the pre-rendered opening line was made with, or the handoff from static audio to live speech is audible. |
| `OPENAI_TRANSCRIBE_MODEL`, `OPENAI_REALTIME_TRANSCRIBE_MODEL`, `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE` | no | Have working defaults. |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server only. Never expose. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Browser auth (sign-in, Google OAuth). |
| `NEXT_PUBLIC_APP_URL` | yes | Production domain. Used to build email links; without it they fall back to the request origin, which on a preview deploy points at the preview URL. |
| `CRON_SECRET` | **yes** | Nothing calls `/api/retrieval` on a schedule yet, but the route is publicly reachable. See the warning below. |
| `RESEND_API_KEY`, `EMAIL_FROM` | not yet | Leave unset until OutLoud has a domain — see Email below. Does not affect Supabase Auth's own confirmation mail. |
| `DISCORD_FEEDBACK_WEBHOOK_URL`, `DISCORD_WEBHOOK_URL` | no | In-app feedback routing. |
| `OUTLOUD_MOCK_AI` | no | Must stay unset in production. |
| `OUTLOUD_REALTIME_ENABLED` | no | |
| `NEXT_PUBLIC_OUTLOUD_MOMENTS_ENABLED` | no | |
| `MAX_ANONYMOUS_MOMENTS_PER_DAY`, `MAX_AUDIO_SECONDS`, `MAX_CONVERSATION_TURNS`, `MAX_COACH_TURNS`, `MAX_OPENAI_REQUESTS_PER_SESSION` | no | Cost guards, all defaulted. |

> **`CRON_SECRET` must have a value.** The guard in `app/api/retrieval/route.ts`
> reads `if (process.env.CRON_SECRET && ...)` — an unset or empty value disables
> the check entirely and leaves `/api/retrieval` publicly callable by anyone. It is
> harmless while email is unconfigured, but it becomes a way for strangers to
> trigger your mail sending the moment Resend is switched on.

## Supabase

Run the migrations in `supabase/` in filename order. The two most recent ones are
required by the current code:

- `202608200001_word_bank_and_accounts.sql` — `moments.user_id` + the `word_bank`
  table, behind the dashboard and profile pages.
- `202608200002_engine_sessions.sql` — the `engine_sessions` table. **Required on
  any serverless host.** The coach and conversation engines used to keep their
  state in a module-level `Map`, which only survives while every request hits the
  same process. Without this table both engines fail on their first `respond`.

Then, in the Supabase dashboard:

1. **Authentication → URL Configuration:** add the production domain as Site URL,
   and add both `https://<domain>/**` and `http://localhost:3000/**` to the
   redirect allow-list.
2. **Google provider:** the authorised redirect URI stays the Supabase callback
   (`https://<project>.supabase.co/auth/v1/callback`) — that is configured in the
   Google Cloud console, not per-deployment. Only the Supabase redirect allow-list
   above needs the new domain.

## Cron

**No cron is configured, deliberately.** `/api/retrieval` exists and works, but it
only selects moments whose email subscription has been verified, and verification
happens through a Resend mail that cannot be sent until OutLoud owns a domain (see
Email below). A scheduled run today would wake up, find nothing, and return
"Email is not configured".

When the domain exists, register the job in **Supabase Cron** (`pg_cron` +
`pg_net`), not in Vercel:

- Vercel throttles crons on the Hobby plan to roughly one run per day regardless
  of the schedule. Retrieval mails become due exactly 24h after a moment is saved,
  so daily granularity means a reminder can land up to a day late.
- Supabase Cron has no such limit, is already part of this stack, and keeps the
  job independent of which host serves the app.

The trade-off is that the schedule then lives as database state rather than in the
repo, and `CRON_SECRET` has to be stored in the Supabase Vault instead of the
Vercel environment.

Whatever ends up calling it, the route accepts both `GET` and `POST` with an
`Authorization: Bearer $CRON_SECRET` header — `GET` because that is how Vercel
Cron and most HTTP schedulers invoke a target.

## Email

There are two independent mail systems in this app, which is easy to miss.

### Supabase Auth (account confirmation)

The create-account dialog calls `supabase.auth.signUp`, and Supabase sends its own
confirmation mail — the "check your inbox to confirm" notice in the UI comes from
this path, not from Resend. Supabase's built-in email service is heavily rate
limited and explicitly not meant for production, so configure **custom SMTP** under
Authentication → Emails before launch, or sign-ups will start silently failing to
receive mail once a handful of people register in the same hour.

### Resend (practice reminders) — currently inactive

Two separate mails, both through Resend:

1. **Verification** (`sendVerificationEmail`) — sent when a learner saves their
   work with an email address. Links to `/api/email-verify`.
2. **Retrieval** (`sendRetrievalEmail`) — sent by the scheduled run, 24h after a
   moment was saved. Links to `/m/<momentId>?token=…`.

Both are no-ops unless `RESEND_API_KEY` *and* `EMAIL_FROM` are set: the functions
return a `not_configured` status, and nothing in the UI reads that status back —
`/api/moments` returns `emailStatus`, but the client ignores it, so a failed or
skipped send is invisible from the app.

**This whole feature is blocked on buying a domain.** Resend only sends to
arbitrary recipients from a domain you have verified via DNS records. Without one
you can send from `onboarding@resend.dev` to your own account address and nowhere
else, and a `*.vercel.app` subdomain cannot be verified because you cannot set DNS
records on it. So: no domain → no Resend → no verified subscriptions → the
retrieval job has nothing to send.

Order to unblock it, once a domain exists:

1. Verify the domain in Resend, set `RESEND_API_KEY` and `EMAIL_FROM`.
2. Build the missing `/m/<momentId>` page. The retrieval mail links there and that
   page does **not** exist in `app/` (only `/`, `/dashboard`, `/profile` do).
   `app/api/moment-review/route.ts` is the API that would feed it, but nothing
   renders it — so switching Resend on first means learners get a "your replay is
   ready" mail whose button 404s.
3. Register the schedule in Supabase Cron (see Cron above).

The rest of the app works fine with none of this configured.

## After the first deploy

Check in this order; each one catches a different class of misconfiguration.

1. `GET /` returns 200 and the opening line is audible → static assets and the
   realtime token route work.
2. Start a session and answer the framing question → proves `engine_sessions` is
   migrated and reachable. A "Coach session expired. Start again." here means the
   migration did not run.
3. Sign in with Google → proves the anon key and the Supabase redirect allow-list.
4. `GET /dashboard` while signed in shows saved words → proves the service-role
   key and the word bank migration.
5. `curl -i https://<domain>/api/retrieval` without a header → must be **401**. A
   200 or 500 here means `CRON_SECRET` is not set.

## Before a public launch

- The **Demo pill** in the header (`app/page.tsx`) opens the verdict card with
  sample data and is a debugging aid. Remove it or gate it behind an env flag.
- `/api/evaluate` labels almost every attempt as `hesitation_pressure`, including
  clean ones. Not a deployment blocker, but it feeds the verdict card.
- Rate limiting (`lib/rate-limit.ts`) still uses an in-process Map. On serverless
  the limit applies per instance rather than globally and resets on cold starts,
  so it is far weaker than the configured number suggests. It fails open, so it
  degrades cost protection rather than breaking the app.

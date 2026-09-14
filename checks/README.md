# checks

Every check that has ever found something in this repo lived in a scratchpad and was deleted
between sessions. Twice the whole thing had to be rebuilt to answer one question. This is where
they live now.

```
npm test          # unit + structure. No server, no model, no credits, about a second.
npm run test:live # needs `npm run dev` in another terminal AND the real model. Costs credits.
npm run test:all
```

Narrow it down while you work:

```
node --experimental-strip-types --disable-warning=ExperimentalWarning checks/run.mjs unit --only scene-turn --verbose
```

`--verbose` prints the cases that passed, not just the ones that did not. Useful when you want to
read what a check actually covers.

## The four groups

| group | needs | what belongs in it |
|---|---|---|
| `unit` | nothing | pure functions. Imports the real module and calls it. |
| `structure` | nothing | facts about the codebase — dead exports, shapes, invariants |
| `live` | dev server + real model | prompt behaviour. The only way to find a prompt fault. |
| `build` | a production build | things that only break once built |

There is no `voice` group and there cannot be. Headless Chromium has no microphone. **Every
automated check in this repo proves the typed path only.** `/dash` is the manual control for the
other half — never delete it, and `docs/Tests/TEST_RUN.md` is the run to work through.

When the `build` group gets its browser driver, it must **abort `/api/realtime-token`**: a run that
half-opens a voice session will report something about a path it never drove.

## Writing one

A check is a file called `<name>.check.mjs` in one of those folders. It exports `about`, an
optional `needs`, and a default function:

```js
import { loadLib } from "../harness/load.mjs";

export const about = "one line, present tense, what holds when this passes";
export const needs = "dev-server";   // omit for unit and structure

const { needsWordsEn } = await loadLib("lib/stuck-signal.ts");

export default async function run(t) {
  t.equal(actual, expected, "what this case means");
  t.ok(condition, "what this case means", "what to print when it is false");
  t.match(modelOutput, /water/i, "for text the model wrote — shape is ours, words are its");
  t.note("context a human needs to read the result; never passes or fails anything");
}
```

`loadLib` resolves the `@/` alias, so you can import the real `lib/` module instead of pasting its
logic into the check. **Do that.** A check carrying its own copy of the rule proves only that two
copies agree — this repo has shipped that twice, and both times the copy was broken in exactly the
same way as the original and the run was green.

## The part that is easy to skip

A check that passes proves one of two things: that your change works, or that the check cannot
fail. Those look identical in a green log.

```js
import { baselineComparison, reportBaseline } from "../harness/load.mjs";

reportBaseline(t, "lib/voice-session.ts", await baselineComparison("lib/voice-session.ts", probe));
```

`probe` is a function that takes the module and returns something comparable. This runs it against
your working tree and against git, and tells you whether your check can tell them apart. When the
file is unchanged it says there is nothing to prove today. When the file IS changed and both
versions answer the same, that is the finding: **your check is not measuring your change.**

Use it whenever you are fixing something. See `unit/voice-dump.check.mjs`.

## Live checks

`realModelRequired(t)` reads `OUTLOUD_MOCK_AI` out of `.env` and stops the check if the server is
serving fixtures. `OUTLOUD_MOCK_AI=true` short-circuits the model completely, so a prompt check
against it is reading a fixture and green means nothing.

It cannot see a flag overridden on the command line when you started the server. If you do that,
you are on your own.

**Routes are not equally safe to drive.** `/api/aside` is stateless and writes nothing.
`/api/coach` writes a real `engine_sessions` row — and the dev server talks to **production**
Supabase, because there is no local database. Every row a check writes is a real row. Say so in
the check's header comment when it writes anything.

# OutLoud — Context & Strategy Handoff

**Who this is for:** Timo (engineering) and any AI coding agent working on OutLoud.
**What this is:** the reasoning behind the product. It explains *why* things are built the way they are, so decisions don't get quietly undone during implementation.
**What this is not:** the task list. That's `outloud-master-build-plan.md` (54 items, phased). Read this first, then that.

---

## 1. THE PRODUCT IN ONE SENTENCE

You talk out loud to an AI coach. It listens to how you actually speak, tells you what's specifically stopping you, puts you in real conversations with real people-shaped characters, and remembers what you couldn't say so it can bring it back with less help until you can.

**The positioning line:** *"You understand Spanish. You just can't speak it."*

---

## 2. THE CUSTOMER

Not beginners. Not the already-conversational. **People who understand Spanish but freeze when they have to produce it.**

More precisely: they catch about 5 of 10 words and reconstruct the rest from context, tone, gestures, and history. That workaround is excellent for *receiving* and useless for *producing* — when it's their turn there's nothing to reconstruct from, so it collapses.

**Two hottest sub-segments:**
1. People dating or married into a Spanish-speaking family. Highest stakes, sharpest pain, most filmable.
2. Heritage speakers / "no sabo kids." 54% of Hispanics who don't speak Spanish have been shamed for it (Pew). #nosabo has 644M+ TikTok views.

**Real quotes from research (use this language, it's theirs):**
- *"terrified that I sounded stupid to them… a mercilessly judging crowd"*
- *"I struggled to find the right words, even though I knew perfectly what to say"*
- *"I understand better than I speak… I make myself small"*
- *"I felt like a fraud"*
- *"everyone started laughing, but me"*

**Words they use:** choppy · stumble · freeze up · it disappears · tongue-tied · not good enough · no sabo
**Words they never use (keep out of all copy):** fluency · proficiency · language acquisition · conversational skills · immersion
**Internal jargon that must never appear in the UI:** moment · freeze · rescue · pass · blocker · intent

**The market split we serve:** roughly half of learners say *"if I know it's a robot it's a demotivator."* The other half say *"the fact that it's clearly AI is precisely what lets me speak without anxiety."* **We build for the second half.** The first half belongs to italki.

---

## 3. THE WEDGE

> **Competitors teach you Spanish. OutLoud figures out why yours doesn't come out, and trains that specific thing until it's gone.**

**Why this is structurally defensible:** Pingo's product is a personalized *lesson plan* — a content business. Ours is a *diagnosis* business — the app watches how you actually fail and builds from that. They can add any feature we have. They can't become a diagnosis product without abandoning the lesson plan 8M people signed up for.

**It is a positioning moat, not a technical one.** It's copyable in a quarter if a competitor decided to. Protection comes from it contradicting their core product, plus speed. That's enough for now.

### Honest audit: what's actually different vs. parity

**Genuinely different (four things):**
1. **The verdict** — 90 seconds of listening, then something specific and true about the user with the evidence quoted back. Pingo asks your goals and builds a plan. Nobody does the diagnosis.
2. **Success = unaided production** — a thing isn't learned until it's produced with no model, frame, transcript, or translation. Competitors' own reviewers say those apps accept wrong answers and mumbles.
3. **Help visibly shrinking over days** — Pingo *says* it remembers your progress. We *prove* it by giving less.
4. **The stated problem drives every session** — their personalization is topics and goals. Ours is your specific failure mode, named on screen every session.

**NOT different, despite feeling like it:**
- Voice conversation with AI (same)
- Hands-free mode (Pingo shipped it first and better — see §4)
- Conversational personalized onboarding (Pingo shipped June 2026)
- Pressure/strictness modes ("Mean Pingo," Aug 2026)
- Corrections, pronunciation feedback, natural voice (all parity)

**Implication for engineering priority:** items 27, 28, and 46 (unaided production, memory proven in-conversation, the verdict) are the product. They must be the *best* parts of the app and must land in **session one**. A Reddit tester will never see day three, so if memory isn't visible inside a single session, our only real differentiator is invisible to everyone who tries it.

**What is NOT the wedge (don't lean on these):**
- Spanish-only — a constraint, not a reason to buy
- Price — can't win a price war against funded competitors
- "Not lessons" — frame as the benefit, never as an absence
- The niche/ICP — that's the *audience* wedge; it gets clicks, it isn't the product difference

---

## 4. COMPETITIVE INTELLIGENCE (verified)

### Pingo AI — biggest direct competitor
Verified from the App Store listing: **15K ratings, 4.6 stars, #73 in Education, claims 8,000,000+ users. $14.99/mo or $99.99/yr. 25+ languages.** Shipping weekly (5.2.3 released two days before this doc).

**What they already shipped that we assumed was ours:**
- **Hands-free mode (March 2026):** *"talk to Pingo even when using other apps or with your screen locked."* More capable than what's in our plan. **This corrects earlier strategy — hands-off is NOT an untapped differentiator.** Still a good marketing line, not a moat.
- **Feedback strictness settings (strict/balanced/light, March 2026)** and **"Mean Pingo" (v5.2.0, Aug 2026)** — their Pressure Mode.
- **Conversational onboarding creating a personalized learning plan (v5.0, June 2026)** — their placement.
- Live subtitles, free chat, streak widget.

**Their confirmed weaknesses (from real reviews on the listing):**
- *"The conversational AI that I expected is not so conversational after all"* — a 3-day-old review describing an inability to go back and forth or debate; the user wanted the AI to push back and take on personas, got grammar rules instead. **This is exactly what full-duplex + real-people behavior fixes.**
- Speech recognition failure: an Arabic learner's pronunciation tool kept hearing German, Dutch, and Korean; they listened back and confirmed they'd said it correctly 15 times; their fluent father agreed. **Same failure pattern as Speak. This is the industry-wide weakness we attack with refuse-to-score-low-confidence-audio.**
- Billing: a paying user couldn't find in-app cancellation, was charged three months, emailed support and got no reply.
- Paywall after one lesson.

**Divergence to lean into:** they added home-screen streak widgets. We explicitly reject streaks. That's a real fork in positioning — don't hedge on it.

### Speak
$1B, $100M+ ARR, genuinely good and loved — **never call them garbage, we lose credibility.** From a 71-review analysis: billing complaints are their #1 cluster (surprise charges, one user's Apple account frozen over ~$130). Repetition is the top *detailed* complaint (3 independent reviewers who tested it and got the same structures back). Paywall after 1–5 lessons across multiple countries.

### ChatGPT Voice — the objection we'll hear most
An infinitely patient amnesiac you must re-prompt every session. A real user described the workaround: *"you'd have to specify that you don't want that"* — every time, forever. Our answer: we remember what you froze on, bring it back until beaten, learn which help unlocks you, and behave like a real person including impatience and misunderstanding.

### Duolingo
Recognition (tapping), not production. Their streak counts attendance. Marketing punching bag only — **never use their owl, logo, green, or name in our branding.**

### ELSA
Scores accent against a native ideal; their reviews rage about it. We judge intelligibility only.

### italki
Not a competitor — an **on-ramp.** Practice with something that has no face until you're brave enough for someone who does. Their reviewers set the bar for correction quality: *"a real teacher catching the specific mistakes I make."*

### The cross-app pattern (75 reviews, 5 apps)
Everyone in this category fails at the same things: praising silence, scoring garbage audio, punishing accents, repetition, and billing traps. **Fixing those is table stakes for trust, not differentiation** — but failing at even one destroys trust in everything else the app says.

---

## 5. PRODUCT DECISIONS AND WHY (do not undo these)

| Decision | Reasoning |
|---|---|
| **One room, no screen navigation** | The previous 13-screen build lost every tester including both founders. Navigation state is also what broke repeatedly across iterations. |
| **No scores, CEFR, percentages, levels** | Fake precision. Brand is honest progress. Ledger + plain language + evidence instead. |
| **No day-streaks, XP, leagues, badges, confetti, mascots** | Duolingo's disease. Our user has a 400-day streak and still can't speak. Also a positioning fork against Pingo. |
| **No lessons, curriculum, or content library** | Serves a customer who lacks *knowledge*. Ours lacks *reps under pressure*. Every "should we add lessons?" answer is no. |
| **Evidence or silence** | Never generate an insight to sound smart. A wrong "I've noticed you struggle with X" destroys trust worse than saying nothing. Omit dimensions with thin evidence. |
| **Never fake confusion on a clean sentence** | The repair loop only triggers on genuinely unclear input. Faking it is the single fastest trust-killer. |
| **Verdict: confirm / correct / BOTH** | Evidence-driven. Confirm when the self-report matches. Correct only when evidence clearly contradicts. "Both" is often the honest answer. **Never manufacture a contradiction to look clever.** |
| **Intelligibility only, never accent** | "Would a native understand you?" not "do you sound native?" This is the #1 rage complaint across ELSA, Speak, and Pingo. |
| **Transcription errors are never the user's mistake** | Every transcript editable before evaluation. Spoken input never flagged for spelling or accent marks. |
| **Natural spoken Spanish, never invented slang** | Shared system-prompt fragment on *every* AI call. LLMs hallucinate regional slang confidently; one native's debunk kills an authenticity brand. |
| **The AI speaks first** | Jarvis is a behavior, not a feature. Also deletes the onboarding form. |
| **Endings, never conclusions** | Sessions end one rung short, with tomorrow named and doubt attached. Retention comes from unfinished business, not notifications (iOS PWA push is unreliable). |
| **Real Talk register behind one-time adult confirmation** | Swearing, insults between friends, crude humor, flirting — with severity/context labels. **Hard floor: no slurs, no explicit sexual generation, nothing involving minors.** |
| **Spanish only** | Expansion trigger is retention or unprompted demand, not ambition. We can't verify quality in languages we don't speak, and it dilutes the marketing. |
| **Full model over mini for realtime** | The differentiator lives in behavioral instruction-following (waiting through silence, ladder timing, honest mishearing) — precisely where mini degrades first. A false negative on the hypothesis costs more than 3× audio tokens at zero users. Blind-test 10 conversations before downgrading. |

---

## 6. HARD BANS (enforce in code and copy)

No scores · CEFR · percentages · levels · XP · day-streaks · leagues · badges · confetti · mascots · lessons · curriculum · content library · flashcard decks · share card · private-link revocation UI · sync-status displays · open-ended free-chat mode · languages other than Spanish · the words *moment / freeze / pass / blocker / intent* anywhere user-facing (including API error strings, which currently leak "moment").

---

## 7. BUILD STATE

Phases 0–3 of the 54-point plan are complete or in progress. Remaining priorities, in order:

1. **Trust fixes** — never praise silence, refuse low-confidence audio, "that's not what I said" transcript repair, separate the four judgments (meaning / grammar / pronunciation / transcription confidence), wire-or-hide Pressure Mode (`pressureMode: false` is hardcoded at three call sites).
2. **Interaction model** — full-duplex with barge-in (Realtime supports VAD and interruption natively; push-to-talk was a design choice, not a limitation), echo cancellation + noise suppression + auto gain, VAD tuning, adaptive fallback to hold-to-talk in noisy conditions, progressive disclosure of controls, English behind a tap.
3. **The stated problem drives everything** — acknowledge the blocker out loud, verdict addresses it, session goal line names it, help form matches the diagnosed gap, in-the-moment callout when they beat it, profile shows that dimension moving.
4. **The three that are the wedge** — unaided production as the success bar, memory proven in-conversation, memory not gated behind the email box.

**Do interaction changes before visual polish** or the polish gets redone.

---

## 8. LAUNCH SEQUENCE

1. Finish the three wedge items (unaided production, memory visible in-session, memory not behind email).
2. Both founders test: 5 full sessions each on real phones — quiet room, car, AirPods, noisy kitchen.
3. Three friends try it (bugs and confusion only; they don't need to want Spanish).
4. **One focused hour** recruiting 5 strangers: reply in r/Spanish threads where people say they can't speak it, comment on #nosabo TikToks, Spanish-learner Discords. Be useful first.
5. Fix the top two complaints. Get five more.
6. **Gate:** do people come back on day three unprompted? No → the product is the problem, not the polish.
7. Turn on Stripe. Charge the people already using it. Build accounts/profiles here — not before.
8. Content (this is where money actually comes from).
9. App Store last, when push notifications and credibility are the specific need.

**Reddit is a one-shot channel.** One honest value-first post. It buys high-quality strangers and honest feedback. It never buys revenue.

**Marketing has the longest lead time of anything on this list.** Content warms up over weeks. Every week spent building instead of posting widens the gap between having a product and having an audience.

---

## 9. PRICING (when it's time)

**Time-based, not credits.** A running meter is poison for an anxious speaker — they'll rush and avoid the freeze, and the freeze *is* the product.

- **Free:** 5 minutes/day forever. Enough for one real session. Fixes the demo-tier complaint that wrecks competitors' reviews.
- **$12/mo:** 20 minutes/day. Effectively unlimited for 95% of users, bounded for us.
- **Top-up:** $5 for 60 extra minutes.
- Bank a few unused days ("you didn't practice Mon–Wed, so today you've got 30 minutes").

**Rules:** never show a countdown mid-session · show remaining time before starting · let a session finish past the line (cutting someone off mid-sentence is brand suicide for an app about not freezing) · never gate the core · billing boring and obvious — trial end date, exact amount, in-app cancellation.

**Cost control matters more than model choice:** cap session length and free sessions/day. One user leaving the mic open for an hour costs more than the full-vs-mini model delta across the entire launch.

---

## 10. WHAT'S STILL UNPROVEN

Stated plainly so nobody mistakes confidence for evidence:

- **That anyone wants OutLoud.** Zero strangers have used it. Zero people have returned on day three. Zero have paid.
- **The repetition wedge** rests on 3 detailed Speak reviews — decent qualitative signal, not a chorus.
- **"Name the character" and "build backward from a dreaded event"** are judgment calls extrapolated from ICP research, not anything a user requested. The second is the highest-upside untested bet in the whole plan.
- **The hands-off/car use case** is inference. Reviews confirm people value short sessions that fit daily life; nobody said "I want to practice in my truck." And Pingo already ships a more capable version.
- **Full-duplex on iOS Safari** hasn't been tested on a real device. Budget for it being harder than it reads.
- **Willingness to pay** at this price, for this customer, is unprovable by research. Only a Stripe charge answers it.

**The bottleneck has never been the thinking.** The strategy is settled and has been for a while. What's missing is five strangers and a link.

---

## 11. THREE RUNTIME CHECKS BEFORE ANY LAUNCH

1. Realtime voice on a real iOS Safari device (mic permission + WebRTC + playback).
2. The email → retrieval → deep link round trip.
3. The Discord feedback webhook ping, with the row confirmed in Supabase.

---

## 12. COMPANION DOCUMENTS

- `outloud-master-build-plan.md` — the 54 numbered items, phased build order, self-audit
- `outloud-v2-complete-spec.md` — full product spec (flows, session mechanics, learning engine, design system)
- `FLOW.md` — screen manifest and navigation map from the design prototype
- `OutLoud room.dc.html` — the interactive design prototype; **visual and behavioral source of truth**, wins over the spec on any tokens/layout/interaction conflict
- `outloud-market-research.md` — customer psychographics with real sourced quotes
- The 75-review competitor analysis (Pingo, Speak, italki, Praktika, Parrot)
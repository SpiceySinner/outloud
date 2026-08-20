/**
 * Timing + copy for the graduated "impatience" nudges shown during the in-app roleplay
 * shared session screen (`components/outloud-redesign-app.tsx`, `screen === "session"`) while the user
 * has not yet replied to the character's line.
 *
 * Scope, deliberately narrow: this is patience-tier-for-timing-purposes only. It is NOT a
 * personality/voice/verbosity system for `who` -- that would be the generalized Human
 * Imperfection Engine the product spec forbids. It maps each `who` chip to one of three
 * patience tiers, and combines that with Pressure Mode to produce three inactivity thresholds
 * (seconds) at which the character nudges, then gets a little impatient, then moves on.
 */

export type PatienceTier = "patient" | "moderate" | "brisk";

/**
 * Common `who` values inferred or reused by the redesigned session/rescue flow. The
 * `DEFAULT_PATIENCE_TIER` fallback below is defensive, not the common
 * path. "Would this happen with a real person?" -- a partner has more slack than a stranger
 * with a line behind them.
 */
const PATIENCE_BY_WHO: Record<string, PatienceTier> = {
  Partner: "patient",
  "Their family": "patient",
  Friend: "moderate",
  Coworker: "moderate",
  Customer: "brisk",
  Stranger: "brisk",
};

const DEFAULT_PATIENCE_TIER: PatienceTier = "moderate";

export function getPatienceTier(who: string): PatienceTier {
  const preset = PATIENCE_BY_WHO[who];
  if (preset) return preset;
  const normalized = who.toLowerCase();
  if (/\b(partner|girlfriend|boyfriend|wife|husband|mom|mother|dad|father|parent|family|sister|brother)\b/.test(normalized)) {
    return "patient";
  }
  if (/\b(waiter|waitress|server|barista|cashier|customer|stranger|driver)\b/.test(normalized)) {
    return "brisk";
  }
  if (/\b(friend|amigo|amiga|coworker|boss|manager|client|teacher|neighbor)\b/.test(normalized)) {
    return "moderate";
  }
  return DEFAULT_PATIENCE_TIER;
}

/** Base inactivity thresholds (seconds), before patience/Pressure Mode adjustment. */
export const IMPATIENCE_BASE_SECONDS = {
  tier1: 3.0,
  tier2: 5.5,
  tier3: 8.5,
} as const;

/** Patient characters wait ~40% longer than base; brisk characters ~25% less; moderate = base. */
const PATIENCE_MULTIPLIER: Record<PatienceTier, number> = {
  patient: 1.4,
  moderate: 1.0,
  brisk: 0.75,
};

/** Pressure Mode tightens every threshold by another ~25% on top of the patience adjustment. */
const PRESSURE_MODE_MULTIPLIER = 0.75;

export type ImpatienceThresholdsSeconds = {
  tier1: number;
  tier2: number;
  tier3: number;
};

/**
 * Relative ordering is the contract, not the exact numbers: Pressure Mode always tightens,
 * patient characters always loosen, brisk characters always tighten, and tier1 < tier2 < tier3
 * always holds because both multipliers are applied uniformly to all three base values.
 */
export function getImpatienceThresholdsSeconds(who: string, pressureModeOn: boolean): ImpatienceThresholdsSeconds {
  const multiplier = PATIENCE_MULTIPLIER[getPatienceTier(who)] * (pressureModeOn ? PRESSURE_MODE_MULTIPLIER : 1);
  return {
    tier1: IMPATIENCE_BASE_SECONDS.tier1 * multiplier,
    tier2: IMPATIENCE_BASE_SECONDS.tier2 * multiplier,
    tier3: IMPATIENCE_BASE_SECONDS.tier3 * multiplier,
  };
}

export type ImpatienceTier = 0 | 1 | 2 | 3;

export function impatienceTierForElapsedSeconds(
  elapsedSeconds: number,
  thresholds: ImpatienceThresholdsSeconds,
): ImpatienceTier {
  if (elapsedSeconds >= thresholds.tier3) return 3;
  if (elapsedSeconds >= thresholds.tier2) return 2;
  if (elapsedSeconds >= thresholds.tier1) return 1;
  return 0;
}

// Warm, in-character nudge lines. A few short variants per tier so repeated turns don't feel
// robotic. The character is a person, not a judge -- never anxious/pressuring/mocking copy.
const TIER1_NUDGES_ES = ["¿necesitas un segundo?", "¿sigues ahí?", "tómate tu tiempo..."];
const TIER2_NUDGES_ES = ["entonces...", "a ver, ¿cómo dirías eso?", "¿y bien?"];
const TIER3_NUDGES_ES = ["bueno, luego me cuentas.", "vale, seguimos luego.", "no pasa nada, lo retomamos después."];

/** Deterministic variant pick (e.g. seeded by turnIndex) so tests and renders are stable. */
export function impatienceNudgeEs(tier: 1 | 2 | 3, variantSeed: number): string {
  const variants = tier === 1 ? TIER1_NUDGES_ES : tier === 2 ? TIER2_NUDGES_ES : TIER3_NUDGES_ES;
  const index = ((variantSeed % variants.length) + variants.length) % variants.length;
  return variants[index];
}

/**
 * Tier 2 does not invent new hint content -- it just points at the conversation step's
 * existing "understand" / "slower" buttons in the redesigned session Spanish panel.
 */
export const TIER2_HELP_SUGGESTION_EN = 'still stuck? try "help me understand" or "slower" above.';

/**
 * Blocker type reused for the tier-3 synthetic freeze evidence -- the same `BlockerType` that
 * already feeds the "handling pressure" skill-profile dimension (lib/skill-profile.ts,
 * `dimensionLabel.hesitation_pressure`) and that `normalizeObservedBlocker`
 * (lib/blocker-taxonomy.ts) already maps free-text "pressure"/"hesitat"/"freeze" evidence onto.
 * This is a timing fact, not an AI judgment -- no new stored field, no new API call.
 */
export const IMPATIENCE_FREEZE_GAP_TYPE = "hesitation_pressure";

export const IMPATIENCE_FREEZE_EVIDENCE_EN =
  "didn't reply within the pacing window; the character moved on before an answer came.";

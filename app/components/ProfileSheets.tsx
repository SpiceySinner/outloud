"use client";

/**
 * What OutLoud has observed, the evidence behind one line of it, and the help ladder.
 *
 * Lifted out of `app/page.tsx` on 2026-09-11, unchanged. The three share a file because they are
 * the same conversation: what the app thinks is in your way, why it thinks so, and what it is
 * willing to hand you about it. `ProfileSheet` and `EvidenceSheet` open each other, and for a long
 * time that was ALL either of them did — a closed loop with no door in, so the surface meant to
 * prove the app remembers your problem could not be reached at all. The after card is the door now.
 *
 * All three are presentational. Every row, every rung and the one-line rationale are computed in
 * the room and handed down finished.
 */

/** Only the fields these sheets render. The rows are derived in `app/page.tsx`. */
type ProfileRow = {
  blocker: string;
  name: string;
  state: string;
  /** A colour class, not a value: `terracotta` for what is being worked on, `sage` for the rest. */
  tone: string;
  evidence?: string;
};

export function ProfileSheet({
  rows,
  onOpenEvidence,
  onOpenJourney,
  onOpenPressure,
}: {
  rows: ProfileRow[];
  /** The index is what selects the evidence line, so it travels with the click. */
  onOpenEvidence: (index: number) => void;
  onOpenJourney: () => void;
  onOpenPressure: () => void;
}) {
  return (
    <section className="room-sheet" aria-label="What OutLoud knows about you">
      <h2>what OutLoud knows about you</h2>
      <div className="skill-list">
        {rows.length === 0 ? (
          <p className="page-body">
            nothing observed yet — one conversation turn and your thing shows up here.
          </p>
        ) : null}
        {rows.map((row, index) => (
          <button key={row.blocker} type="button" onClick={() => onOpenEvidence(index)}>
            <span>{row.name}</span>
            <strong className={row.tone}>{row.state}</strong>
            <em>›</em>
          </button>
        ))}
      </div>
      <div className="teaching-note">keywords unlock you; full answers make you dependent.</div>
      <div className="sheet-split-actions">
        <button type="button" onClick={onOpenJourney}>
          speaking journey
        </button>
        <button type="button" onClick={onOpenPressure}>
          how she speaks
        </button>
      </div>
    </section>
  );
}

/**
 * One observation, and the sentence that earned it.
 *
 * Nullable all the way through: the rows can legitimately be empty before anything has been
 * observed, where the fixed four-row array this replaced always had something to index into.
 */
export function EvidenceSheet({
  row,
  onBack,
}: {
  row: ProfileRow | null;
  onBack: () => void;
}) {
  return (
    <section className="room-sheet" aria-label="Evidence">
      <h2>{row?.name ?? "nothing observed yet"}</h2>
      <div className="evidence-card">
        <p>{row?.evidence || "OutLoud needs one more reply before it keeps this."}</p>
        <small>{row?.state ?? "not enough yet"}</small>
      </div>
      <button className="sheet-link sage-link" type="button" onClick={onBack}>
        why OutLoud thinks this
      </button>
    </section>
  );
}

/** One rung of the help ladder, as the room builds it. */
type LadderRung = {
  name: string;
  label: string;
  sample: string;
};

/**
 * The help ladder, in the order this learner's diagnosis puts it in.
 *
 * The order is not decoration and neither is `rationale`: without a sentence saying why, a
 * reordered ladder just looks arbitrary — two learners see a different order and neither is told
 * why. That sentence is the whole point of #48.
 *
 * This is also the only reliable door to the correction and pronunciation sheets. The chips in the
 * session tool row are gated on a turn having produced something to fix.
 */
export function AssistanceSheet({
  ladder,
  currentRung,
  rationale,
  onFix,
  onPronounce,
}: {
  ladder: LadderRung[];
  /** The lowest rung that can actually offer something beyond waiting. */
  currentRung: string | null;
  rationale: string | null;
  onFix: () => void;
  onPronounce: () => void;
}) {
  return (
    <section className="room-sheet" aria-label="Assistance ladder">
      <h2>a little help</h2>
      <div className="ladder-list">
        {ladder.map((rung) => (
          <button className={rung.name === currentRung ? "is-current" : ""} type="button" key={rung.name}>
            <span>{rung.name}</span>
            <strong>{rung.label}</strong>
            {rung.sample ? <em>{rung.sample}</em> : null}
          </button>
        ))}
      </div>
      {rationale ? <p className="ladder-why">{rationale}</p> : null}
      <div className="sheet-split-actions">
        <button type="button" onClick={onFix}>
          fix the sentence
        </button>
        <button type="button" onClick={onPronounce}>
          say it clearer
        </button>
      </div>
    </section>
  );
}

// Loading the code under check -- from the working tree, and from git history.
//
// The second half is the point. A check that only ever runs against your change can pass because
// the change works, or because the check cannot fail. Those look identical in a green log. Running
// the same check against the version in git tells the two apart, and it is the discipline this
// repo has paid for twice: see AGENTS.md, "prove the check against unchanged code first".
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";
import path from "node:path";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A module as it exists in your working tree. `loadLib("lib/stuck-signal.ts")`. */
export function loadLib(relPath) {
  return import(pathToFileURL(path.join(repoRoot, relPath)).href);
}

const baselineDir = mkdtempSync(path.join(os.tmpdir(), "outloud-baseline-"));
const baselineCache = new Map();

/**
 * The same module as it exists at a git ref -- `HEAD` unless you say otherwise.
 *
 * Written to a temp file and imported there, so `import` caching does not hand you the working-tree
 * copy instead. Its own `@/...` imports still resolve to the working tree: this gives you one file
 * from history, not a second checkout. For "I changed one file, does the check fail without my
 * change?" -- which is what it is for -- that is exactly right.
 */
export async function baseline(relPath, ref = "HEAD") {
  const key = `${ref}:${relPath}`;
  if (baselineCache.has(key)) return baselineCache.get(key);

  let source;
  try {
    source = execFileSync("git", ["show", key], { cwd: repoRoot, encoding: "utf8", maxBuffer: 32e6 });
  } catch {
    throw new Error(`no such file at ${ref}: ${relPath} (new file? then there is no baseline and you should say so)`);
  }

  // `.mts` rather than `.ts`: unambiguously an ES module, so node does not guess from a
  // package.json that is not there and warn about it on every run.
  const file = path.join(baselineDir, `${ref.replace(/[^\w.-]/g, "_")}__${path.basename(relPath, path.extname(relPath))}.mts`);
  writeFileSync(file, source, "utf8");
  const loaded = import(pathToFileURL(file).href);
  baselineCache.set(key, loaded);
  return loaded;
}

/**
 * Does the working-tree file differ from the ref at all -- staged, unstaged or untracked?
 *
 * Asked of git rather than parsed out of `git status`, which also reports renames, deletions and
 * whole untracked directories and would answer this question wrongly for all three.
 */
export function differsFrom(relPath, ref = "HEAD") {
  try {
    execFileSync("git", ["diff", "--quiet", ref, "--", relPath], { cwd: repoRoot, stdio: "ignore" });
    return false;
  } catch {
    return true;
  }
}

/** Everything `git status` calls changed, so a check can say what it was actually run against. */
export function modifiedFiles() {
  const out = execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" });
  return out.split("\n").filter(Boolean).map((line) => line.slice(3));
}

/**
 * Run the same probe against your working tree and against git, and say whether it can tell them
 * apart.
 *
 * This is the rule from AGENTS.md in executable form. A check that passes proves one of two very
 * different things: that your change works, or that the check cannot fail. They look identical in
 * a green log, and this repo has shipped the second one twice.
 *
 * When the file is unchanged there is nothing to prove and it says so. When the file IS changed
 * and the probe gives the same answer both ways, that is the finding: your check is not measuring
 * your change.
 */
export async function baselineComparison(relPath, probe, ref = "HEAD") {
  const modified = differsFrom(relPath, ref);
  const now = await probe(await loadLib(relPath));
  let then = null;
  let missing = null;
  try {
    then = await probe(await baseline(relPath, ref));
  } catch (error) {
    missing = error?.message ?? String(error);
  }
  return {
    modified,
    now,
    then,
    missing,
    differs: missing !== null || JSON.stringify(now) !== JSON.stringify(then),
  };
}

/** Report a `baselineComparison` the same way everywhere. Fails only when the check proves nothing. */
export function reportBaseline(t, relPath, comparison, ref = "HEAD") {
  if (!comparison.modified) {
    t.note(`${relPath} is unchanged from ${ref} — nothing for this check to prove today`);
    return;
  }
  if (comparison.missing) {
    t.note(`${relPath} does not exist at ${ref} (${comparison.missing.slice(0, 60)}…) — it is new, so there is no baseline`);
    return;
  }
  t.ok(
    comparison.differs,
    `this check can tell the working-tree ${relPath} apart from ${ref}`,
    `both versions answer ${JSON.stringify(comparison.now)} under this probe, so a green run above does not prove your change did anything`,
  );
}

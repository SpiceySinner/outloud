// `@/x` is a tsconfig path and node has never heard of it.
//
// Without this, a check cannot import `lib/voice-session.ts` at all, and the tempting way round
// that is to paste the rule into the check -- which is how this repo has twice reported green on
// broken code. So the alias is the load-bearing part of the harness, not a convenience.
//
// The repo root is derived from this file's own location. It used to be hardcoded to one machine.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const base = path.join(repoRoot, specifier.slice(2));
    // The alias is written without an extension. Try the two the repo actually uses, then fall
    // through so a genuinely missing module still reports as missing rather than as a bad alias.
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
      if (existsSync(candidate)) return next(pathToFileURL(candidate).href, context);
    }
  }
  return next(specifier, context);
}

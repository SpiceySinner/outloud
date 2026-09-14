// Talking to a running dev server, and refusing to pretend when it cannot tell you anything.
//
// Two things go wrong here and both look like a pass:
//
//   1. the server is not running -- a check that cannot reach it must SKIP, never quietly succeed
//   2. the server is running with OUTLOUD_MOCK_AI=true -- the model is short-circuited, so a
//      prompt check is measuring a fixture. Green means nothing. This has to be loud.
import { readFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./load.mjs";

export const BASE = process.env.OUTLOUD_CHECK_BASE ?? "http://localhost:3000";

let reachable = null;
export async function devServerUp() {
  if (reachable !== null) return reachable;
  try {
    const response = await fetch(BASE, { signal: AbortSignal.timeout(4000) });
    reachable = response.status < 500;
  } catch {
    reachable = false;
  }
  return reachable;
}

/**
 * Whether the dev server is serving fixtures instead of the model.
 *
 * Read from `.env`, which is what `npm run dev` loads -- one key, by name, never its value and
 * never any other key's. Returns null when the file is unreadable. The one case it misses is a
 * server started with the flag overridden inline on the command line; the live checks say so
 * rather than claiming more certainty than they have.
 */
export function mockAiFlag() {
  try {
    const env = readFileSync(path.join(repoRoot, ".env"), "utf8");
    const line = env.split("\n").find((l) => l.trim().startsWith("OUTLOUD_MOCK_AI="));
    if (!line) return "false";
    return line.slice(line.indexOf("=") + 1).trim() === "true" ? "true" : "false";
  } catch {
    return null;
  }
}

/** Call before any check that judges what the MODEL said. Returns false if you must not continue. */
export function realModelRequired(t) {
  const flag = mockAiFlag();
  if (flag === "true") {
    t.fail(
      "the dev server must be running the real model",
      "OUTLOUD_MOCK_AI=true in .env — the model is short-circuited and this check would be reading a fixture. Set it to false, restart the server, run again.",
    );
    return false;
  }
  if (flag === null) t.note("could not read .env — assuming the real model. If this run was against mocks, it proves nothing.");
  return true;
}

export async function postJson(route, body) {
  const response = await fetch(`${BASE}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, ok: response.ok, json };
}

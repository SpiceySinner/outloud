// What in `lib/` and `app/components/` is exported and never imported?
//
// `deriveReviewLedgerState` was found this way: it infers the top rung of the Speaking Journey and
// has zero callers, which is why `confirmed_real_life` showed 0 runs of 37 and looked like a
// product problem rather than a missing call. Dead code here is not untidiness, it is a feature
// that silently does not exist.
//
// Counts real uses only: the declaration line itself is excluded, and so is anything inside a
// comment or a string -- which is what makes a symbol named in its own doc block look alive.
//
// New dead exports fail this check. If yours is deliberate, add it to `known` WITH the reason,
// so the next person does not have to work out whether it is a leftover.
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "../harness/load.mjs";

export const about = "nothing is exported into the void without a reason written down";

const SEARCH_DIRS = ["app", "lib", "worker", "scripts"];

/** Exported, uncalled, and that is the intention. Reason required. */
const known = {
  mockChatReplies: "kept on purpose — #30 is a real plan and this mock is the shape it was drawn in",
  ChatMessage: "same: the type belonging to mockChatReplies",
};

const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(full);
    } else if (/\.(ts|tsx|mjs)$/.test(entry.name)) {
      files.push(full);
    }
  }
};
for (const dir of SEARCH_DIRS) {
  const full = path.join(repoRoot, dir);
  if (fs.existsSync(full)) walk(full);
}

// Crude on purpose: it only has to stop false ALIVE verdicts. A false DEAD one is caught by the
// compiler the moment anybody acts on it.
const strip = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");

const bodies = new Map(files.map((f) => [f, strip(fs.readFileSync(f, "utf8"))]));
const exportRe = /^export\s+(?:async\s+)?(?:function|const|class|type|interface)\s+([A-Za-z_$][\w$]*)/gm;

export default async function run(t) {
  const dead = [];
  for (const file of files) {
    const inLib = file.includes(`${path.sep}lib${path.sep}`);
    const inComponents = file.includes(`${path.sep}components${path.sep}`);
    if (!inLib && !inComponents) continue;
    const own = bodies.get(file);
    for (const match of own.matchAll(exportRe)) {
      const name = match[1];
      // No `g` flag: `test` on a global regex advances lastIndex, so reusing one across files
      // gives a different answer every other call.
      const word = new RegExp(String.raw`\b${name}\b`);
      const usedElsewhere = [...bodies].some(([other, body]) => other !== file && word.test(body));
      if (!usedElsewhere) {
        dead.push({ name, where: path.relative(repoRoot, file).replace(/\\/g, "/") });
      }
    }
  }

  const unexplained = dead.filter((d) => !(d.name in known));
  t.note(`${files.length} files scanned - ${dead.length} exports nothing imports`);

  // A ratchet, not a gate. Most of these are types and const tuples that only ever feed a type,
  // and failing on all of them today would mean nobody ever runs this. It may go down; it may not
  // go up. If your change raises it, either wire the export up or delete it -- and if it genuinely
  // belongs in the repo unused, add it to `known` with the reason and lower this number by one.
  const ceiling = 91;
  t.ok(
    dead.length <= ceiling,
    `no NEW dead exports (${dead.length} of at most ${ceiling})`,
    `${dead.length - ceiling} more than when this was last swept. See the list with OUTLOUD_DEAD_LIST=1.`,
  );

  if (process.env.OUTLOUD_DEAD_LIST === "1") {
    for (const d of unexplained) t.note(`  ${d.where}  ${d.name}`);
  } else {
    for (const d of unexplained.slice(0, 6)) t.note(`  ${d.where}  ${d.name}`);
    if (unexplained.length > 6) t.note(`  ...and ${unexplained.length - 6} more - OUTLOUD_DEAD_LIST=1 to see them all`);
  }
}

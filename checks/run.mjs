// The runner.
//
//   npm test                 the fast ones: no server, no model, no credits
//   npm run test:live        the slow ones: a running dev server and the real model
//   npm run test:all
//
//   node checks/run.mjs unit --only scenario --verbose
//
// A check is a file named `*.check.mjs` under one of the group folders. It exports `about`, an
// optional `needs`, and a default function that receives the verbs from harness/report.mjs.
// See checks/README.md before adding one -- especially the part about proving it against HEAD.
import { register } from "node:module";
import { readdirSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { repoRoot, modifiedFiles } from "./harness/load.mjs";
import { newRun, printRun } from "./harness/report.mjs";
import { devServerUp, BASE } from "./harness/server.mjs";

register("./harness/alias-hook.mjs", import.meta.url);

const GROUPS = ["unit", "structure", "live", "build"];
const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const onlyIndex = args.indexOf("--only");
const only = onlyIndex === -1 ? null : args[onlyIndex + 1];
const asked = args.filter((a) => GROUPS.includes(a));
const groups = asked.length ? asked : ["unit", "structure"];

const files = [];
for (const group of groups) {
  const dir = path.join(repoRoot, "checks", group);
  if (!existsSync(dir)) continue;
  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith(".check.mjs")) continue;
    if (only && !entry.includes(only)) continue;
    files.push({ group, entry, file: path.join(dir, entry) });
  }
}

if (!files.length) {
  console.log(`no checks matched (groups: ${groups.join(", ")}${only ? `, only: ${only}` : ""})`);
  process.exit(1);
}

const touched = modifiedFiles();
console.log(`${files.length} check${files.length === 1 ? "" : "s"} · ${groups.join(", ")}`);
console.log(touched.length ? `working tree: ${touched.length} modified file(s)` : "working tree: clean");
console.log("");

let failures = 0;
let skipped = 0;

for (const { group, entry, file } of files) {
  const name = `${group}/${entry.replace(".check.mjs", "")}`;
  let mod;
  try {
    mod = await import(pathToFileURL(file).href);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${name}  (would not load)`);
    console.log(`      ${error?.message ?? error}`);
    continue;
  }

  if (mod.needs === "dev-server" && !(await devServerUp())) {
    skipped += 1;
    console.log(`SKIP  ${name}  no dev server at ${BASE} — run \`npm run dev\` in another terminal`);
    continue;
  }

  const run = newRun();
  try {
    await mod.default(run);
  } catch (error) {
    run.fail("the check itself threw", `${error?.message ?? error}`);
  }
  if (!printRun(name, run, { verbose })) failures += 1;
  if (mod.about && verbose) console.log(`      ${mod.about}`);
}

console.log("");
if (skipped) console.log(`${skipped} skipped`);
console.log(failures === 0 ? `all ${files.length - skipped} ran green` : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

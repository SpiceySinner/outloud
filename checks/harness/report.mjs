// The four verbs a check gets, and how a run is printed.
//
// Deliberately tiny and dependency-free. Anyone adding a check should be able to read this file
// in a minute and copy the pattern, rather than learn a framework.
const GREEN = "\u001b[32m";
const RED = "\u001b[31m";
const DIM = "\u001b[2m";
const OFF = "\u001b[0m";
const colour = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (colour ? `${code}${text}${OFF}` : text);

export function newRun() {
  const cases = [];
  const notes = [];

  const record = (pass, label, detail) => {
    cases.push({ pass, label, detail });
    return pass;
  };

  return {
    cases,
    notes,
    /** The workhorse. `t.equal(pick("die zweite"), "B", "an ordinal picks that option")` */
    equal(actual, expected, label) {
      const pass = Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected);
      return record(pass, label, pass ? null : `got ${format(actual)} — wanted ${format(expected)}`);
    },
    ok(condition, label, detail = null) {
      return record(Boolean(condition), label, condition ? null : detail ?? "was falsy");
    },
    /** For model output, where the exact words are the model's business and the shape is ours. */
    match(text, pattern, label) {
      const pass = pattern.test(String(text ?? ""));
      return record(pass, label, pass ? null : `no ${pattern} in ${format(text)}`);
    },
    fail(label, detail) {
      return record(false, label, detail);
    },
    /** Context a human needs to read the result. Not a case; never passes or fails anything. */
    note(text) {
      notes.push(String(text));
    },
  };
}

function format(value) {
  if (typeof value === "string") {
    return JSON.stringify(value.length > 160 ? `${value.slice(0, 160)}…` : value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function printRun(name, run, { verbose = false } = {}) {
  const failed = run.cases.filter((c) => !c.pass);
  const head = failed.length === 0 ? paint(GREEN, "PASS") : paint(RED, "FAIL");
  const score = `${run.cases.length - failed.length}/${run.cases.length}`;
  console.log(`${head}  ${name}  ${paint(DIM, score)}`);
  for (const note of run.notes) console.log(paint(DIM, `      ${note}`));
  for (const c of run.cases) {
    if (c.pass && !verbose) continue;
    console.log(`      ${c.pass ? paint(GREEN, "ok   ") : paint(RED, "WRONG")} ${c.label}`);
    if (c.detail) console.log(paint(DIM, `            ${c.detail}`));
  }
  return failed.length === 0;
}

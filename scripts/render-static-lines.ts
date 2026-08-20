// Renders the fixed coach lines from lib/static-lines.ts to public/audio/lines/ once, so the
// app can play them from disk instead of paying the Realtime model to say the same sentence
// every session.
//
// Usage: npm run render:lines            (skips clips that already exist)
//        npm run render:lines -- --force (re-renders everything)
//
// Uses the same voice as the live session (OPENAI_REALTIME_VOICE, default "marin") so the
// hand-off from pre-rendered clip to live speech is seamless.

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { staticLines, staticLineFileName } from "../lib/static-lines.ts";

const root = resolve(import.meta.dirname, "..");
const outDir = resolve(root, "public/audio/lines");
const force = process.argv.includes("--force");

loadDotEnv(resolve(root, ".env"));

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("OPENAI_API_KEY is not set (checked the environment and .env).");
  process.exit(1);
}

const model = process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts";
const voice = process.env.OPENAI_REALTIME_VOICE ?? "marin";

mkdirSync(outDir, { recursive: true });

const wanted = new Set<string>();
for (const line of staticLines) {
  const fileName = staticLineFileName(line);
  wanted.add(fileName);
  const target = resolve(outDir, fileName);

  if (!force && existsSync(target)) {
    console.log(`skip   ${fileName} (exists)`);
    continue;
  }

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      voice,
      input: line.text,
      response_format: "mp3",
      instructions: instructionsFor(line.language),
    }),
  });

  if (!response.ok) {
    console.error(`failed ${fileName}: ${response.status} ${await response.text()}`);
    process.exit(1);
  }

  writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  console.log(`render ${fileName}  "${line.text}"`);
}

// Drop clips whose text has changed since they were rendered.
for (const existing of readdirSync(outDir)) {
  if (existing.endsWith(".mp3") && !wanted.has(existing)) {
    unlinkSync(resolve(outDir, existing));
    console.log(`remove ${existing} (stale)`);
  }
}

function instructionsFor(language: "en" | "es") {
  const shared = "Warm, brief, calm. A friendly coach speaking to one nervous learner. Natural pace, no drama.";
  return language === "es"
    ? `${shared} Speak natural Latin American Spanish with clear but unexaggerated pronunciation.`
    : `${shared} Speak natural conversational English.`;
}

function loadDotEnv(path: string) {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

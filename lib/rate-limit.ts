import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

/**
 * Per-device daily budget for the OpenAI-backed routes, shared across every scope.
 *
 * Production keeps the strict beta guard. Local development gets a workable number, because 25
 * requests is roughly two full run-throughs -- after that the app cannot be exercised at all for
 * the rest of the day. Fails safe: anything other than an explicit NODE_ENV=development, including
 * an unset value, uses the strict default.
 */
export function openAiRequestsPerDay() {
  return Number(
    process.env.MAX_OPENAI_REQUESTS_PER_SESSION ?? (process.env.NODE_ENV === "development" ? 200 : 25),
  );
}

export function checkRateLimit(request: Request, scope: string, limit: number, windowMs: number) {
  const now = Date.now();
  const key = `${scope}:${hashClientKey(request)}`;
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  if (bucket.count >= limit) {
    return NextResponse.json(
      { error: "Outloud is at its beta usage limit for this device. Try again later." },
      { status: 429 },
    );
  }

  bucket.count += 1;
  return null;
}

function hashClientKey(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const cfConnectingIp = request.headers.get("cf-connecting-ip");
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  return createHash("sha256").update(`${forwardedFor ?? cfConnectingIp ?? "local"}:${userAgent}`).digest("hex");
}


import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const feedbackAnswerSchema = z.object({
  key: z.string().min(1).max(80).optional(),
  screenId: z.string().min(1).max(80).optional(),
  question: z.string().min(1).max(240),
  selected: z.string().max(160).nullable(),
  text: z.string().max(1200),
  skipped: z.boolean(),
});

const requestSchema = z.object({
  path: z.string().min(1).max(180),
  step: z.string().min(1).max(80),
  sessionId: z.string().max(120).nullable(),
  answers: z.array(feedbackAnswerSchema).min(1).max(8),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Feedback did not save." }, { status: 400 });
  }

  const payload = parsed.data;
  const firstAnswer = feedbackAnswerByKey(payload.answers, "disappointment", 0);
  const helpedAnswer = feedbackAnswerByKey(payload.answers, "helped", 1);
  const gotInTheWayAnswer = feedbackAnswerByKey(payload.answers, "gotInTheWay");
  const confusionAnswer = feedbackAnswerByKey(payload.answers, "confusion");
  const bestPartAnswer = feedbackAnswerByKey(payload.answers, "bestPart");
  const finalAnswer =
    feedbackAnswerByKey(payload.answers, "dailyUseIf") ?? payload.answers[payload.answers.length - 1];
  const answersByKey = Object.fromEntries(
    payload.answers
      .filter((answer) => answer.key)
      .map((answer) => [answer.key, feedbackAnswerValue(answer)]),
  );
  const supabase = getSupabaseAdmin();

  const record = {
    id: crypto.randomUUID(),
    route_path: payload.path,
    step: payload.step,
    rating: feedbackAnswerValue(firstAnswer) || "not answered",
    problem:
      feedbackAnswerValue(confusionAnswer) ||
      feedbackAnswerValue(gotInTheWayAnswer) ||
      feedbackAnswerValue(helpedAnswer) ||
      null,
    expected: feedbackAnswerValue(finalAnswer) || null,
    email: null,
    permission_to_include_example: false,
    content_json: {
      answers: payload.answers,
      answersByKey,
    },
    metadata_json: {
      ...payload.metadata,
      sessionId: payload.sessionId,
      timestamp: new Date().toISOString(),
    },
    email_status: "not_configured",
  };

  if (supabase) {
    const { error } = await supabase.from("feedback").insert(record);
    if (error) {
      return NextResponse.json({ error: "Feedback did not save." }, { status: 502 });
    }
  } else {
    return NextResponse.json({ error: "Feedback is not connected yet." }, { status: 503 });
  }

  const webhookUrl = process.env.DISCORD_FEEDBACK_WEBHOOK_URL ?? process.env.DISCORD_WEBHOOK_URL;
  let discord: "sent" | "not_configured" | "failed" = "not_configured";

  if (webhookUrl) {
    try {
      const timestamp = new Date().toISOString();
      const device = discordFieldValue(
        typeof payload.metadata?.device === "string" ? payload.metadata.device : "unknown",
      );
      const answerLines = payload.answers
        .map((answer, index) => {
          const responseText = feedbackAnswerValue(answer) || "blank";
          return `Q${index + 1}: ${answer.question}\nA${index + 1}: ${responseText}`;
        })
        .join("\n\n")
        .slice(0, 3200);
      const content = [
        "🚨 New OutLoud feedback",
        "",
        `Q1 disappointment level: ${feedbackAnswerValue(firstAnswer) || "not answered"}`,
        `Q2 did it help?: ${feedbackAnswerValue(helpedAnswer) || "(blank)"}`,
        `Q2 follow-up what got in the way: ${feedbackAnswerValue(gotInTheWayAnswer) || "(blank)"}`,
        `Q3 confusion point: ${feedbackAnswerValue(confusionAnswer) || "(blank)"}`,
        `Q4 best part: ${feedbackAnswerValue(bestPartAnswer) || "(blank)"}`,
        `Q5 optional open text: ${feedbackAnswerValue(finalAnswer) || "(blank)"}`,
        `Path: ${payload.path}`,
        `Session ID: ${payload.sessionId ?? "none"}`,
        `Time: ${timestamp}`,
      ].join("\n").slice(0, 1900);
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          embeds: [
            {
              title: "OutLoud feedback",
              color: 12862751,
              description: answerLines || "No answer details.",
              fields: [
                { name: "PMF", value: discordFieldValue(record.rating), inline: true },
                { name: "Step", value: discordFieldValue(payload.step), inline: true },
                { name: "Path", value: discordFieldValue(payload.path), inline: true },
                { name: "Session", value: discordFieldValue(payload.sessionId ?? "none"), inline: false },
                { name: "Problem", value: discordFieldValue(record.problem ?? "none"), inline: false },
                { name: "Text", value: discordFieldValue(finalAnswer?.text || "none"), inline: false },
                { name: "Device", value: device, inline: false },
              ],
              timestamp,
            },
          ],
        }),
      });
      discord = response.ok ? "sent" : "failed";
    } catch {
      discord = "failed";
    }
  }

  return NextResponse.json({
    ok: true,
    saved: Boolean(supabase),
    discord,
  });
}

function feedbackAnswerByKey(
  answers: Array<z.infer<typeof feedbackAnswerSchema>>,
  key: string,
  fallbackIndex?: number,
) {
  return answers.find((answer) => answer.key === key) ?? (fallbackIndex === undefined ? undefined : answers[fallbackIndex]);
}

function feedbackAnswerValue(answer: z.infer<typeof feedbackAnswerSchema> | undefined) {
  if (!answer) return "";
  if (answer.skipped) return "(skipped)";
  return answer.text || answer.selected || "";
}

function discordFieldValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "none";
  return trimmed.length > 1000 ? `${trimmed.slice(0, 997)}...` : trimmed;
}

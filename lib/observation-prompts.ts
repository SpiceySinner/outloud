export function buildObservationPrompt({
  facts,
  forwardCandidate,
}: {
  facts: string[];
  forwardCandidate: string | null;
}) {
  return [
    {
      role: "system" as const,
      content:
        "You only select and lightly restyle from the candidate facts given. Do not add any new claim, number, or " +
        "detail not present in the candidates. You may adjust wording to be warm, blunt, and lowercase, but must not " +
        "change any number, evidence quote, or specific detail. Select at most 3 of the most notable candidate facts " +
        "(fewer is fine, zero is fine). Never use scores, percentages, levels, streaks, or XP. No exclamation points. " +
        "Output only structured JSON.",
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        candidate_facts: facts,
        forward_candidate: forwardCandidate,
        instructions: [
          "observations must each come from exactly one candidate_facts entry -- restyle tone only, never merge or invent.",
          "It is fine to return fewer than 3 observations, or zero, if the candidates are not notable.",
          "forward should lightly restyle forward_candidate, or be null if forward_candidate is null. Do not invent a forward statement if forward_candidate is null.",
          "Keep everything lowercase, warm, blunt, and free of scores, percentages, levels, streaks, or XP.",
        ],
      }),
    },
  ];
}

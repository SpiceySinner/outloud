export function backgroundModel() {
  return process.env.OPENAI_BACKGROUND_MODEL ?? process.env.OPENAI_TEXT_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
}

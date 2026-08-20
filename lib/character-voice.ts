import { getPatienceTier } from "@/lib/conversation-pacing";

const DELIVERY_BY_TIER = {
  patient: {
    normal: "warm, relaxed pace, no rush",
    pressure: "warm but direct, a little less pause between thoughts",
  },
  moderate: {
    normal: "natural, conversational pace, clear and even",
    pressure: "slightly quicker, attentive, less spacious",
  },
  brisk: {
    normal: "brisk, efficient pace, still clear",
    pressure: "brisk, efficient, slightly clipped",
  },
} as const;

export function characterVoiceDeliveryStyle(who: string, pressureModeOn: boolean): string {
  const tier = getPatienceTier(who);
  return pressureModeOn ? DELIVERY_BY_TIER[tier].pressure : DELIVERY_BY_TIER[tier].normal;
}

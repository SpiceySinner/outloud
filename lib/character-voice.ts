import { getPatienceTier } from "@/lib/conversation-pacing";

/**
 * Who the voice is when nobody has chosen a character yet.
 *
 * Shared rather than duplicated because it is minted into the realtime token, and both the room
 * and the entry screen mint one. Two copies would drift, and the drift would be a coach who
 * sounds like a different person depending on which screen woke the microphone.
 */
export const defaultConversationContext = {
  who: "an OutLoud Spanish coach",
  dialect: "Latin America",
  tone: "warm",
};

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

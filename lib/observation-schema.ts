import { z } from "zod";

export const postSessionObservationsSchema = z.object({
  observations: z.array(z.string()).min(0).max(3),
  forward: z.string().nullable(),
});

export type PostSessionObservations = z.infer<typeof postSessionObservationsSchema>;

export const postSessionObservationsJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["observations", "forward"],
  properties: {
    observations: {
      type: "array",
      items: { type: "string" },
    },
    forward: { type: ["string", "null"] },
  },
} as const;

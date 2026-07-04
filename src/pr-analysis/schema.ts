import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const DemoStepSchema = z.object({
  id: z.string().describe("Short id like 'step-01'"),
  instruction: z
    .string()
    .describe(
      "Natural-language action a person would take, phrased only in terms of what's visible on screen " +
        "(button labels, headings, field placeholders). Never reference file names, function names, or diff content."
    ),
  expectedOutcome: z
    .string()
    .describe("Natural-language description of what should be visible on screen once this step succeeds."),
  captionText: z.string().describe("Short on-screen caption (<= 12 words) summarizing this step for a video overlay."),
  narrationText: z
    .string()
    .describe("One or two spoken-style sentences narrating this step, for future text-to-speech voiceover."),
  estimatedDurationSec: z
    .number()
    .min(1)
    .max(15)
    .describe("Rough fallback duration in seconds if no video clip can be captured for this step."),
});

export const DemoScriptSchema = z.object({
  meta: z.object({
    prTitle: z.string(),
    prUrl: z.string(),
    featureName: z.string().describe("Short human title for the intro card, e.g. 'Bulk CSV Export'"),
    generatedAt: z.string().describe("ISO 8601 timestamp"),
  }),
  userStory: z.object({
    persona: z.string().describe("e.g. 'A team admin managing monthly billing exports'"),
    narrative: z.string().describe("2-4 sentence 'As a ... I want ... so that ...' style summary"),
  }),
  steps: z.array(DemoStepSchema).min(1).max(8),
});

export type DemoStep = z.infer<typeof DemoStepSchema>;
export type DemoScript = z.infer<typeof DemoScriptSchema>;

export const demoScriptJsonSchema = zodToJsonSchema(DemoScriptSchema, {
  target: "openApi3",
  $refStrategy: "none",
});

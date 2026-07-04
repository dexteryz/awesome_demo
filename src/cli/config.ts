import { z } from "zod";
import { readFileSync } from "node:fs";

const SeedStepSchema = z.object({
  action: z.enum(["navigate", "click", "type", "press_key", "wait_for"]),
  target: z.string().optional(),
  value: z.string().optional(),
  key: z.string().optional(),
});

const ViewportSchema = z.object({ width: z.number(), height: z.number() });

const ModelSettingSchema = z.object({
  model: z.string(),
  maxTokens: z.number().default(4096),
});

export const ConfigSchema = z.object({
  app: z.object({
    name: z.string(),
    baseUrl: z.string(),
    startPath: z.string().default("/"),
    viewport: ViewportSchema.default({ width: 1440, height: 900 }),
  }),
  auth: z
    .object({
      seedSteps: z.array(SeedStepSchema).default([]),
      envVars: z.array(z.string()).default([]),
    })
    .default({ seedSteps: [], envVars: [] }),
  models: z.object({
    prAnalysis: ModelSettingSchema,
    browserAgent: ModelSettingSchema,
  }),
  capture: z
    .object({
      maxRetriesPerStep: z.number().default(3),
      maxTurnsPerStep: z.number().default(12),
      headless: z.boolean().default(true),
      video: ViewportSchema.default({ width: 1280, height: 720 }),
      fallbackStepDurationSec: z.number().default(3),
      tighten: z
        .object({
          enabled: z.boolean().default(true),
          targetStepDurationSec: z.number().default(4),
          minStepDurationSec: z.number().default(2.5),
          removeIdleFrames: z.boolean().default(false),
        })
        .default({}),
    })
    .default({}),
  output: z
    .object({
      runsDir: z.string().default("./runs"),
    })
    .default({}),
  hyperframes: z
    .object({
      outputFile: z.string().default("demo.mp4"),
      hideCaptionsWhenNarrated: z.boolean().default(true),
    })
    .default({}),
  narration: z
    .object({
      enabled: z.boolean().default(false),
    })
    .default({ enabled: false }),
  github: z
    .object({
      repo: z.string().nullable().default(null),
    })
    .default({ repo: null }),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(path: string): Config {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return ConfigSchema.parse(raw);
}

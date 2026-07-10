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
      // Removes the Claude "thinking" dead air by keeping only the windows around real actions
      // (glide, click, result) at true 1x speed, instead of frame-dropping (which eats the cursor
      // glide) or uniform speed-up (which compresses it).
      pace: z
        .object({
          enabled: z.boolean().default(true),
          prerollSec: z.number().default(0.5),
          holdSec: z.number().default(1.4),
          gapMergeSec: z.number().default(0.4),
          minStepDurationSec: z.number().default(2.5),
        })
        .default({}),
      cursor: z
        .object({
          enabled: z.boolean().default(true),
          moveSteps: z.number().default(30),
          moveDurationMs: z.number().default(850),
          clickPauseMs: z.number().default(400),
          typeDelayMs: z.number().default(55),
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
      showIntroCard: z.boolean().default(false),
      showOutroCard: z.boolean().default(false),
    })
    .default({}),
  narration: z
    .object({
      enabled: z.boolean().default(false),
      provider: z.enum(["elevenlabs"]).default("elevenlabs"),
      voiceId: z.string().nullable().default(null),
      modelId: z.string().default("eleven_multilingual_v2"),
      // Word-synced ("karaoke") captions: each word highlights as it's spoken, using ElevenLabs'
      // per-character timing. Falls back to a static subtitle if timing is unavailable.
      wordSync: z.boolean().default(true),
      // Whole-word rewrites applied to the spoken text only (not the on-screen caption), to fix
      // TTS mispronunciations — e.g. { from: "Todos", to: "to-do's" } so it says "to-do"s.
      pronunciations: z
        .array(z.object({ from: z.string(), to: z.string() }))
        .default([]),
    })
    .default({}),
  github: z
    .object({
      repo: z.string().nullable().default(null),
    })
    .default({ repo: null }),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(path: string): Config {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const config = ConfigSchema.parse(raw);

  // Resolve ${ENV_VAR} references in the voice id (same convention as auth seed steps), so the
  // config can point at .env — e.g. "voiceId": "${ELEVENLABS_VOICE_ID}" — keeping the personal id
  // (a secret) out of the checked-in file while staying self-documenting. An unset var resolves to
  // null. Non-secret feature choices like narration.enabled stay in the config directly.
  if (config.narration.voiceId) {
    const resolved = config.narration.voiceId.replace(
      /\$\{([A-Z0-9_]+)\}/g,
      (_, name: string) => process.env[name] ?? ""
    );
    config.narration.voiceId = resolved.length > 0 ? resolved : null;
  }

  return config;
}

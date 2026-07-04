import { z } from "zod";
import { writeFile } from "node:fs/promises";

export const ToolCallLogEntrySchema = z.object({
  turn: z.number(),
  tool: z.string(),
  input: z.unknown(),
  resultSummary: z.string(),
});

export const ManifestStepSchema = z.object({
  id: z.string(),
  status: z.enum(["success", "failed"]),
  attempts: z.number(),
  instruction: z.string(),
  captionText: z.string(),
  narrationText: z.string(),
  clipPath: z.string().nullable(),
  clipDurationMs: z.number().nullable(),
  screenshotBefore: z.string().nullable(),
  screenshotAfter: z.string().nullable(),
  endUrl: z.string(),
  failureReason: z.string().nullable(),
  toolCallLog: z.array(ToolCallLogEntrySchema),
});

export const CaptureManifestSchema = z.object({
  meta: z.object({
    runId: z.string(),
    sourceDemoScriptPath: z.string(),
    startedAt: z.string(),
    finishedAt: z.string(),
    overallStatus: z.enum(["complete", "partial"]),
  }),
  steps: z.array(ManifestStepSchema),
});

export type ToolCallLogEntry = z.infer<typeof ToolCallLogEntrySchema>;
export type ManifestStep = z.infer<typeof ManifestStepSchema>;
export type CaptureManifest = z.infer<typeof CaptureManifestSchema>;

export async function writeManifest(path: string, manifest: CaptureManifest): Promise<void> {
  CaptureManifestSchema.parse(manifest);
  await writeFile(path, JSON.stringify(manifest, null, 2), "utf8");
}

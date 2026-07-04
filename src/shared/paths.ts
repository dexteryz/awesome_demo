import { mkdirSync } from "node:fs";
import { join } from "node:path";

export function makeRunId(label: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
  return `${stamp}_${slug || "run"}`;
}

export interface RunPaths {
  runDir: string;
  demoScriptPath: string;
  manifestPath: string;
  clipsDir: string;
  screenshotsDir: string;
  storageStatePath: string;
  hyperframesProjectDir: string;
  outputVideoPath: string;
  runLogPath: string;
}

export function resolveRunPaths(runsDir: string, runId: string): RunPaths {
  const runDir = join(runsDir, runId);
  const paths: RunPaths = {
    runDir,
    demoScriptPath: join(runDir, "demo-script.json"),
    manifestPath: join(runDir, "manifest.json"),
    clipsDir: join(runDir, "clips"),
    screenshotsDir: join(runDir, "screenshots"),
    storageStatePath: join(runDir, "storage-state.json"),
    hyperframesProjectDir: join(runDir, "hyperframes-project"),
    outputVideoPath: join(runDir, "demo.mp4"),
    runLogPath: join(runDir, "run.log"),
  };
  mkdirSync(paths.runDir, { recursive: true });
  mkdirSync(paths.clipsDir, { recursive: true });
  mkdirSync(paths.screenshotsDir, { recursive: true });
  return paths;
}

import { existsSync } from "node:fs";
import { Command } from "commander";
import { loadConfig } from "./config.js";

// Load .env from the project root if present (Node 22+ native), so ANTHROPIC_API_KEY and any
// DEMO_USER_* login secrets are available without the user having to export them each shell.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

import { makeRunId, resolveRunPaths } from "../shared/paths.js";
import { RunLogger } from "../shared/logger.js";
import { runAnalyze } from "./commands/analyze.js";
import { captureDemo } from "./commands/capture.js";
import { runAssemble } from "./commands/assemble.js";
import { runGenerate } from "./commands/generate.js";
import { narrate } from "../narration/narrate.js";

const program = new Command();

program.name("demo-gen").description("Generate a product demo video from a merged PR").version("0.1.0");

function setupRun(prRef: string, configPath: string) {
  const config = loadConfig(configPath);
  const runId = makeRunId(prRef);
  const paths = resolveRunPaths(config.output.runsDir, runId);
  const logger = new RunLogger(paths.runLogPath);
  logger.info(`Run ${runId} -> ${paths.runDir}`);
  return { config, runId, paths, logger };
}

program
  .command("analyze")
  .description("Turn a PR into a structured demo script (user story + ordered UI steps)")
  .requiredOption("--pr <ref>", "PR URL/number (via gh) or path to a local fixture JSON file")
  .option("--config <path>", "Path to demo-gen.config.json", "./demo-gen.config.json")
  .option("--out <path>", "Where to write demo-script.json (defaults to a new run directory)")
  .action(async (opts) => {
    const { config, paths, logger } = setupRun(opts.pr, opts.config);
    const outPath = opts.out ?? paths.demoScriptPath;
    await runAnalyze({ prRef: opts.pr, config, outPath, logger });
  });

program
  .command("capture")
  .description("Drive the browser through a demo script's steps, recording clips and screenshots")
  .requiredOption("--script <path>", "Path to a demo-script.json produced by `analyze`")
  .option("--config <path>", "Path to demo-gen.config.json", "./demo-gen.config.json")
  .option("--out <path>", "Where to write manifest.json (defaults to a new run directory)")
  .action(async (opts) => {
    const { config, paths, runId, logger } = setupRun(opts.script, opts.config);
    const manifest = await captureDemo({ demoScriptPath: opts.script, config, paths, runId, logger });
    if (opts.out) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(opts.out, JSON.stringify(manifest, null, 2), "utf8");
    }
  });

program
  .command("narrate")
  .description("Synthesize a voice line per step and re-pace each clip to its narration length")
  .requiredOption("--manifest <path>", "Path to a manifest.json produced by `capture`")
  .option("--config <path>", "Path to demo-gen.config.json", "./demo-gen.config.json")
  .action(async (opts) => {
    const config = loadConfig(opts.config);
    // Operate in the run directory the manifest already lives in.
    const { dirname, basename } = await import("node:path");
    const runDir = dirname(opts.manifest);
    const paths = resolveRunPaths(dirname(runDir), basename(runDir));
    const logger = new RunLogger(paths.runLogPath);
    await narrate({ manifestPath: opts.manifest, config, paths, logger });
  });

program
  .command("assemble")
  .description("Turn a capture manifest into a rendered Hyperframes mp4")
  .requiredOption("--manifest <path>", "Path to a manifest.json produced by `capture`")
  .requiredOption("--script <path>", "Path to the demo-script.json the manifest was captured from")
  .option("--config <path>", "Path to demo-gen.config.json", "./demo-gen.config.json")
  .option("--out <path>", "Where to write the final mp4 (defaults to a new run directory)")
  .action(async (opts) => {
    const { config, paths, logger } = setupRun(opts.manifest, opts.config);
    await runAssemble({
      demoScriptPath: opts.script,
      manifestPath: opts.manifest,
      hyperframesProjectDir: paths.hyperframesProjectDir,
      outputVideoPath: opts.out ?? paths.outputVideoPath,
      config,
      logger,
    });
  });

program
  .command("generate")
  .description("Run analyze -> capture -> assemble end to end for a PR")
  .requiredOption("--pr <ref>", "PR URL/number (via gh) or path to a local fixture JSON file")
  .option("--config <path>", "Path to demo-gen.config.json", "./demo-gen.config.json")
  .action(async (opts) => {
    const { config, runId, paths, logger } = setupRun(opts.pr, opts.config);
    await runGenerate({ prRef: opts.pr, config, paths, runId, logger });
  });

try {
  await program.parseAsync(process.argv);
} catch (err) {
  console.error(`\n[demo-gen] ${(err as Error).message}`);
  process.exit(1);
}

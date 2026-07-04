# demo-gen

Generate a product demo video from a merged pull request.

Given a PR, `demo-gen`:

1. **analyze** — reads the PR (title, description, diff, linked issues) with Claude and writes a structured *demo script*: the user story plus an ordered list of natural-language UI steps.
2. **capture** — an autonomous Claude + Playwright agent drives your running app through those steps, looking at each page and deciding what to click/type itself, recording a video clip and screenshots per step.
3. **assemble** — turns the captured clips into a [Hyperframes](https://hyperframes.heygen.com/) composition (intro card → captioned step clips → outro card) and renders it to an `.mp4`.

An optional **narrate** stage (2.5) sits between capture and assemble: it synthesizes a voice line per step via ElevenLabs and re-paces each clip to match its narration length, so audio and picture line up by construction. It's off by default — set `narration.enabled` and a `narration.voiceId` to turn it on.

## Prerequisites

- **Node.js 22+** (`node --version`)
- **ffmpeg** on your `PATH` (`brew install ffmpeg`) — used by Hyperframes to render and to measure clip durations
- **`ANTHROPIC_API_KEY`** — for the PR-analysis and browser-agent Claude calls
- **`gh` CLI** authenticated (`gh auth status`) — only needed when targeting a real GitHub PR (not for local fixture files)
- Playwright's Chromium: `npx playwright install chromium` (run once)

## Install

```bash
npm install
npx playwright install chromium   # once
```

The CLI runs straight from TypeScript source via `tsx` (no build step), so edits take effect immediately. Invoke it with:

```bash
npm run demo-gen -- <command> [options]
```

If you want a shorter command, add a shell alias (adjust the path):

```bash
alias demo-gen='npm run --silent --prefix /path/to/awesome_demos demo-gen --'
```

Provide your API key by exporting it, or putting it in a `.env` file at the project root (auto-loaded, gitignored):

```bash
cp .env.example .env    # then fill in ANTHROPIC_API_KEY
```

## Configure

The tool targets one app at a time via `demo-gen.config.json` in your working directory. Key fields:

- `app.baseUrl` / `app.startPath` — where your app runs and where a demo run begins
- `app.viewport` — capture resolution (default 1280×720; keep it 16:9 to fill the 1920×1080 video without letterboxing)
- `auth.seedSteps` — optional login steps run once before capture (secrets referenced as `${ENV_VAR}`, listed in `auth.envVars`, never stored in the file)
- `models.prAnalysis` / `models.browserAgent` — which Claude model each stage uses
- `capture.maxRetriesPerStep`, `capture.maxTurnsPerStep`, `capture.headless`
- `capture.tighten` — post-processes each captured clip to remove dead air (see below):
  - `targetStepDurationSec` (default 4) — long clips are sped up toward this; clips already shorter are left alone
  - `minStepDurationSec` (default 2.5) — floor; a shorter/collapsed clip holds its last frame to reach it
  - `removeIdleFrames` (default false) — extra `mpdecimate` pass that drops near-duplicate frames; aggressive, best for extremely static UIs
  - `enabled` (default true) — set false to keep raw recordings

See the checked-in `demo-gen.config.json` (configured for the bundled fixture app) as a template.

## Usage

Run the whole pipeline for a PR:

```bash
npm run demo-gen -- generate --pr https://github.com/owner/repo/pull/123
```

`--pr` accepts a GitHub PR URL/number (fetched via `gh`) **or** a path to a local PR fixture JSON file. Each run writes to `runs/<run-id>/` (demo script, manifest, clips, screenshots, the Hyperframes project, `demo.mp4`, and a `run.log`).

The stages can also be run individually — useful for iterating without re-spending on earlier stages:

```bash
npm run demo-gen -- analyze  --pr <ref>          --out demo-script.json
npm run demo-gen -- capture  --script demo-script.json --out manifest.json
npm run demo-gen -- narrate  --manifest manifest.json                 # optional; needs ELEVENLABS_API_KEY + voiceId
npm run demo-gen -- assemble --manifest manifest.json --script demo-script.json --out demo.mp4
```

### Narration (optional)

Set in `demo-gen.config.json`:

```jsonc
"narration": {
  "enabled": true,
  "provider": "elevenlabs",
  "voiceId": "<your ElevenLabs voice id>",   // a cloned voice of yourself, or a stock voice
  "modelId": "eleven_multilingual_v2"
}
```

and put `ELEVENLABS_API_KEY` in your `.env`. When enabled, `generate` runs the narrate stage automatically. Each step's clip is re-timed to its voice line's length (this replaces the fixed `capture.tighten` target for narrated runs). Captions are kept alongside the voice by default; set `hyperframes.hideCaptionsWhenNarrated: true` to drop the on-screen text when narration is present.

## Try it against the bundled fixture

```bash
# 1. start the fixture app (a tiny todo app with a CSV-export feature)
cd examples/sample-app && npm install && node server.js   # http://localhost:4000
# 2. in another shell, from the repo root:
npm run demo-gen -- generate --pr fixtures/sample-pr.json
```

Open the resulting `runs/<run-id>/demo.mp4`.

## How it's structured

- `src/pr-analysis/` — Stage 1: fetch PR (`gh` or fixture) + Claude analysis into a `DemoScript`
- `src/browser-agent/` — Stage 2: the Claude+Playwright control loop, tools, per-step video recording, and the `CaptureManifest`
- `src/composer/` — Stage 3: manifest → Hyperframes `index.html` → rendered mp4
- `src/cli/` — commander entry point, config loader, and the four subcommands
- `examples/sample-app/`, `fixtures/` — a self-contained app + synthetic PR for validating the pipeline end to end

## Pacing / dead air

The browser recording captures the whole agent loop, including the seconds spent waiting on each Claude API call between actions — a motionless page while the model "thinks". For mostly-static SaaS UIs that makes raw clips feel slow. The `capture.tighten` pass fixes this by giving each step a clean, consistent beat (default ~4s), only ever speeding up over-long clips, never slowing anything down. This is also the natural hook for narration: when voice is added, set each step's target duration to its voice-line length instead of a fixed number.

## Notes & limitations

- Failed steps don't abort the run: the step is marked `failed` in the manifest and assembled as a static fallback card, so you still get a watchable video showing where it broke. Inspect `run.log` for details.
- The browser agent can occasionally misclick on ambiguous UIs — that's the trade-off for working across arbitrary apps without hardcoded selectors. Re-running `capture` alone is cheap.

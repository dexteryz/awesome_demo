import type { PrData } from "./fetch-pr.js";

export const SYSTEM_PROMPT = `You are analyzing a merged pull request to script a short product demo video of the \
feature it introduces.

You will be given the PR title, description, diff, and any linked issue. Identify the single \
clearest end-to-end user flow this PR enables in the running application, and describe it as a \
numbered sequence of UI actions a person would take to *see* the feature working.

Rules:
- Phrase every step only in terms of what's visible on screen when using the app: button labels, \
headings, field placeholders, links. Never reference file names, function names, variable names, \
or diff content directly in a step.
- EVERY step must be completable inside the web browser itself (navigating, clicking, typing, \
confirming an on-screen result). Never include steps that leave the browser or require external \
tools — e.g. do NOT write steps like "open the downloaded file in Excel", "check your email", or \
"run a command in the terminal". If a feature produces a download, the final step is confirming the \
in-app result (e.g. a success banner appears), not opening the downloaded file.
- Pick the single clearest flow, not every possible interaction. Prefer 3-8 steps.
- Each step needs a natural-language "instruction" (the action to take) and "expectedOutcome" \
(what should be visible once it succeeds) — someone else will resolve these against the live page, \
so do not guess CSS selectors or exact element IDs.
- "captionText" is a short (<=12 words) on-screen caption summarizing the step for a video overlay.
- "narrationText" is one or two spoken-style sentences for a future voiceover track (not used yet, \
but write it as if narrating the step aloud to a viewer).
- Call the record_demo_script tool exactly once with the full result. Do not respond with plain text.`;

export function buildUserPrompt(
  pr: PrData,
  diffForPrompt: { diff: string; truncated: boolean },
  appContext: { baseUrl: string; startPath: string }
): string {
  const parts: string[] = [];
  parts.push(`PR title: ${pr.title}`);
  parts.push(`PR url: ${pr.url}`);
  parts.push(`PR description:\n${pr.body || "(no description provided)"}`);

  if (pr.linkedIssues.length > 0) {
    parts.push(
      "Linked issue(s):\n" +
        pr.linkedIssues.map((issue) => `- ${issue.title}\n${issue.body}`).join("\n\n")
    );
  }

  parts.push(
    `The application under test is reachable at ${appContext.baseUrl}, and a demo run normally begins ` +
      `at the path ${appContext.startPath} (after logging in, if applicable). You will not see a ` +
      `screenshot of the app here — describe the flow based on the PR content, in terms a user would ` +
      `recognize from the UI copy present in the diff (button/label text, headings), not code symbols.`
  );

  if (diffForPrompt.truncated) {
    parts.push(
      "Note: the diff below has been filtered/truncated to the hunks most likely to touch UI code."
    );
  }
  parts.push(`Diff:\n\`\`\`diff\n${diffForPrompt.diff}\n\`\`\``);

  return parts.join("\n\n");
}

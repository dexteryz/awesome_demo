import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";

const execFileAsync = promisify(execFile);

export interface LinkedIssue {
  title: string;
  body: string;
}

export interface PrData {
  title: string;
  url: string;
  body: string;
  diff: string;
  linkedIssues: LinkedIssue[];
}

interface GhPrViewJson {
  title: string;
  url: string;
  body: string;
  closingIssuesReferences?: { number: number; title: string; body?: string }[];
}

/**
 * Loads PR data either from a local fixture JSON file (path exists on disk) or from a real
 * GitHub PR via the `gh` CLI. Using a fixture bypasses `gh`/network entirely so Stage 1 is
 * testable standalone.
 */
export async function fetchPr(ref: string): Promise<PrData> {
  if (existsSync(ref)) {
    return loadFixture(ref);
  }
  return fetchFromGithub(ref);
}

function loadFixture(path: string): PrData {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return {
    title: raw.title ?? "",
    url: raw.url ?? "",
    body: raw.body ?? "",
    diff: raw.diff ?? "",
    linkedIssues: raw.linkedIssues ?? [],
  };
}

async function fetchFromGithub(ref: string): Promise<PrData> {
  const { stdout: viewJson } = await execFileAsync("gh", [
    "pr",
    "view",
    ref,
    "--json",
    "title,url,body,closingIssuesReferences",
  ]);
  const parsed = JSON.parse(viewJson) as GhPrViewJson;

  const { stdout: diff } = await execFileAsync("gh", ["pr", "diff", ref]);

  const linkedIssues: LinkedIssue[] = [];
  for (const issue of parsed.closingIssuesReferences ?? []) {
    if (issue.body !== undefined) {
      linkedIssues.push({ title: issue.title, body: issue.body });
      continue;
    }
    try {
      const { stdout: issueJson } = await execFileAsync("gh", [
        "issue",
        "view",
        String(issue.number),
        "--json",
        "title,body",
      ]);
      const issueParsed = JSON.parse(issueJson) as { title: string; body: string };
      linkedIssues.push(issueParsed);
    } catch {
      linkedIssues.push({ title: issue.title, body: "" });
    }
  }

  return {
    title: parsed.title,
    url: parsed.url,
    body: parsed.body ?? "",
    diff,
    linkedIssues,
  };
}

const UI_RELEVANT_EXTENSIONS = [".tsx", ".jsx", ".vue", ".html", ".css", ".scss"];
const UI_RELEVANT_PATH_HINTS = ["route", "controller", "page", "view", "component"];

/**
 * Filters a unified diff down to hunks touching files likely to affect the UI, when the full
 * diff exceeds maxChars. Falls back to a simple head-truncation if no file headers are found.
 */
export function truncateDiffForPrompt(diff: string, maxChars = 24000): { diff: string; truncated: boolean } {
  if (diff.length <= maxChars) return { diff, truncated: false };

  const fileBlocks = diff.split(/(?=^diff --git )/m).filter(Boolean);
  if (fileBlocks.length === 0) {
    return { diff: diff.slice(0, maxChars) + "\n...[diff truncated]...", truncated: true };
  }

  const relevant = fileBlocks.filter((block) => {
    const header = block.split("\n", 1)[0].toLowerCase();
    return (
      UI_RELEVANT_EXTENSIONS.some((ext) => header.includes(ext)) ||
      UI_RELEVANT_PATH_HINTS.some((hint) => header.includes(hint))
    );
  });

  const chosen = relevant.length > 0 ? relevant : fileBlocks;
  let result = "";
  for (const block of chosen) {
    if (result.length + block.length > maxChars) break;
    result += block;
  }
  return { diff: result || chosen[0].slice(0, maxChars), truncated: true };
}

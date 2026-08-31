import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const privatePathPatterns = [
  {
    label: "macOS home directory",
    pattern: new RegExp(`(?:^|[^A-Za-z])/${"Users"}/[A-Za-z0-9._-]+/`),
  },
  {
    label: "Linux home directory",
    pattern: new RegExp(`(?:^|[^A-Za-z])/${"home"}/[A-Za-z0-9._-]+/`),
  },
  {
    label: "Windows home directory",
    pattern: new RegExp(`[A-Za-z]:\\\\${"Users"}\\\\[^\\\\]+\\\\`),
  },
  {
    label: "Codex worktree path",
    pattern: new RegExp(["\\.codex", "worktrees"].join("/")),
  },
];

const findings = [];
const requiredCommunityFiles = [
  ".github/CODEOWNERS",
  ".github/workflows/codeql.yml",
  ".github/workflows/dependency-review.yml",
  ".nvmrc",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "SECURITY.md",
  "SUPPORT.md",
  "docs/architecture.md",
  "docs/releasing.md",
];
for (const file of requiredCommunityFiles) {
  if (!existsSync(file)) findings.push(`${file}: required public project metadata is missing`);
}

for (const file of tracked) {
  const content = readFileSync(file).toString("latin1");
  for (const { label, pattern } of privatePathPatterns) {
    if (pattern.test(content)) findings.push(`${file}: ${label}`);
  }
}

for (const workflow of tracked.filter((file) => file.startsWith(".github/workflows/") && file.endsWith(".yml"))) {
  const content = readFileSync(workflow, "utf8");
  for (const match of content.matchAll(/^\s*uses:\s*([^\s#]+).*$/gm)) {
    const action = match[1];
    if (action?.startsWith("./")) continue;
    if (!/@[0-9a-f]{40}$/.test(action ?? "")) {
      findings.push(`${workflow}: GitHub Action is not pinned to a full commit SHA (${action ?? "unknown"})`);
    }
  }
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
if (typeof packageJson.description !== "string" || packageJson.description.trim().length === 0) {
  findings.push("package.json: description is required");
}
if (!Array.isArray(packageJson.keywords) || packageJson.keywords.length === 0) {
  findings.push("package.json: keywords are required");
}

if (findings.length > 0) {
  console.error("Public metadata validation failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(`Public metadata check passed for ${tracked.length} tracked files.`);
}

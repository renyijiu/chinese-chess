import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

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
for (const file of tracked) {
  const content = readFileSync(file).toString("latin1");
  for (const { label, pattern } of privatePathPatterns) {
    if (pattern.test(content)) findings.push(`${file}: ${label}`);
  }
}

if (findings.length > 0) {
  console.error("Tracked files contain workstation-specific metadata:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(`Public metadata check passed for ${tracked.length} tracked files.`);
}

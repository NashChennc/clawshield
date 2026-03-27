import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkgRoot = fileURLToPath(new URL("../..", import.meta.url));
const guardedFiles = [
  "src/entrypoints/scripts/hook-once.ts",
  "src/entrypoints/scripts/persist-eval.ts",
  "src/adapters/openclaw/adapter.ts",
];

const bannedPatterns = [
  /(?:^|[^\w$])eval\s*\(/m,
  /new\s+Function\s*\(/m,
  /vm\.runInThisContext\s*\(/m,
  /vm\.Script\s*\(/m,
  /child_process\.exec\s*\(/m,
];

describe("hook-once hardening", () => {
  it("forbids dynamic code execution APIs in persist path", () => {
    for (const rel of guardedFiles) {
      const abs = path.join(pkgRoot, rel);
      const content = fs.readFileSync(abs, "utf8");
      for (const pattern of bannedPatterns) {
        expect(content).not.toMatch(pattern);
      }
    }
  });
});

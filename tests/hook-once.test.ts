import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkgRoot = fileURLToPath(new URL("..", import.meta.url));
const maxBytes = 8 * 1024 * 1024;

function runEvalOnce(input: string) {
  const script = path.join(pkgRoot, "dist", "entrypoints", "scripts", "hook-once.js");
  return spawnSync(process.execPath, [script], {
    input,
    encoding: "utf8",
    env: { ...process.env, CLAWSHIELD_PROJECT_ROOT: pkgRoot },
  });
}

function readDecision(stdout: string) {
  return JSON.parse(stdout.trim()) as { action: string; rationale?: string };
}

describe("hook-once", () => {
  it("empty stdin yields allow", () => {
    const r = runEvalOnce("");
    expect(r.stdout?.trim()).toBeTruthy();
    const j = readDecision(r.stdout!);
    expect(j.action).toBe("allow");
  });

  it("invalid json is blocked with controlled decision", () => {
    const r = runEvalOnce("{not-json");
    expect(r.stdout?.trim()).toBeTruthy();
    const j = readDecision(r.stdout!);
    expect(j.action).toBe("block");
    expect(j.rationale).toContain("invalid json");
  });

  it("unknown hook is blocked", () => {
    const r = runEvalOnce(
      JSON.stringify({
        hook: "unknown_hook",
        payload: { message: "noop" },
        session_id: "s",
      }),
    );
    expect(r.stdout?.trim()).toBeTruthy();
    const j = readDecision(r.stdout!);
    expect(j.action).toBe("block");
    expect(j.rationale).toContain("allowed hook");
  });

  it("oversized stdin is blocked", () => {
    const payload = {
      hook: "tool_result_persist",
      payload: { message: "a".repeat(maxBytes + 1024) },
      session_id: "s",
    };
    const input = JSON.stringify(payload);
    expect(Buffer.byteLength(input, "utf8")).toBeGreaterThan(maxBytes);
    const r = runEvalOnce(input);
    expect(r.stdout?.trim()).toBeTruthy();
    const j = readDecision(r.stdout!);
    expect(j.action).toBe("block");
    expect(j.rationale).toContain("exceeds");
  });
});

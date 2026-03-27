import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkgRoot = fileURLToPath(new URL("..", import.meta.url));

describe("eval-once", () => {
  it("empty stdin yields allow", () => {
    const script = path.join(pkgRoot, "dist", "eval-once.js");
    const r = spawnSync(process.execPath, [script], {
      input: "",
      encoding: "utf8",
      env: { ...process.env, CLAWSHIELD_PROJECT_ROOT: pkgRoot },
    });
    expect(r.stdout?.trim()).toBeTruthy();
    const j = JSON.parse(r.stdout!.trim()) as { action: string };
    expect(j.action).toBe("allow");
  });
});

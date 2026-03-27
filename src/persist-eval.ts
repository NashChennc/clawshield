import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DecisionDict } from "./core/decision.js";

export type PersistEvalInput = {
  hook: "tool_result_persist";
  payload: Record<string, unknown>;
  sessionId?: string;
};

const evalScriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "eval-once.js");

export function evalPersistBlocking(req: PersistEvalInput, timeoutMs: number, log?: (m: string) => void): DecisionDict | null {
  const stdin = JSON.stringify({
    hook: req.hook,
    payload: req.payload,
    session_id: req.sessionId ?? "openclaw-plugin",
  });
  const env = { ...process.env };
  if (process.env["CLAWSHIELD_PROJECT_ROOT"]) {
    env["CLAWSHIELD_PROJECT_ROOT"] = process.env["CLAWSHIELD_PROJECT_ROOT"];
  }
  const r = spawnSync(process.execPath, [evalScriptPath], {
    input: stdin,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: timeoutMs,
    windowsHide: true,
    env,
  });
  if (r.error) {
    log?.(`[clawshield] eval-once spawn error: ${r.error.message}`);
    return null;
  }
  const out = (r.stdout ?? "").trim();
  if (!out) {
    log?.(`[clawshield] eval-once empty stdout (exit ${r.status}): ${(r.stderr || "").trim()}`);
    return null;
  }
  if (r.status !== 0 && r.status !== null) {
    log?.(`[clawshield] eval-once exit ${r.status} (stderr: ${(r.stderr || "").trim()})`);
  }
  try {
    return JSON.parse(out) as DecisionDict;
  } catch (e) {
    log?.(`[clawshield] eval-once JSON parse error: ${e}`);
    return null;
  }
}

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DecisionDict } from "../../core/models/decision.js";
import { isSafeSanitizedPayload } from "../../core/models/decision-sanitize.js";

export type PersistEvalInput = {
  hook: "tool_result_persist";
  payload: Record<string, unknown>;
  sessionId?: string;
};

const evalScriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "hook-once.js");

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isDecisionDict(v: unknown): v is DecisionDict {
  if (!isRecord(v)) return false;
  const action = v["action"];
  const riskScore = v["risk_score"];
  const confidence = v["confidence"];
  const rationale = v["rationale"];
  const judgeUsed = v["judge_used"];
  const deterministic = v["deterministic"];
  const riskTypes = v["risk_types"];
  const evidence = v["evidence"];
  const policyHits = v["policy_hits"];
  const notes = v["notes"];
  const sanitizedPayload = v["sanitized_payload"];
  if (typeof action !== "string") return false;
  if (typeof riskScore !== "number" || !Number.isFinite(riskScore)) return false;
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return false;
  if (typeof rationale !== "string") return false;
  if (typeof judgeUsed !== "boolean" || typeof deterministic !== "boolean") return false;
  if (!isStringArray(riskTypes) || !isStringArray(evidence) || !isStringArray(policyHits) || !isStringArray(notes)) return false;
  if (sanitizedPayload !== undefined && sanitizedPayload !== null && !isSafeSanitizedPayload(sanitizedPayload)) return false;
  return true;
}

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
    log?.(`[clawshield] hook-once spawn error: ${r.error.message}`);
    return null;
  }
  const out = (r.stdout ?? "").trim();
  if (!out) {
    log?.(`[clawshield] hook-once empty stdout (exit ${r.status}): ${(r.stderr || "").trim()}`);
    return null;
  }
  if (r.status !== 0 && r.status !== null) {
    log?.(`[clawshield] hook-once exit ${r.status} (stderr: ${(r.stderr || "").trim()})`);
  }
  try {
    const parsed = JSON.parse(out) as unknown;
    if (!isDecisionDict(parsed)) {
      log?.("[clawshield] hook-once JSON parse ok but shape invalid");
      return null;
    }
    return parsed;
  } catch (e) {
    log?.(`[clawshield] hook-once JSON parse error: ${e}`);
    return null;
  }
}

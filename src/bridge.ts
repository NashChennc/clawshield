import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

export type ClawShieldPluginConfig = {
  bridgeCommand?: string;
  evalTimeoutMs?: number;
  failClosed?: boolean;
  enablePromptContextEval?: boolean;
};

export type HookEvalRequest = {
  hook: "before_prompt_build" | "before_tool_call" | "after_tool_call" | "tool_result_persist";
  payload: Record<string, unknown>;
  sessionId?: string;
};

export type DecisionDict = {
  action: string;
  risk_score?: number;
  confidence?: number;
  rationale?: string;
  risk_types?: string[];
  evidence?: string[];
  policy_hits?: string[];
  sanitized_payload?: Record<string, unknown> | null;
  judge_used?: boolean;
  deterministic?: boolean;
  notes?: string[];
};

const defaultBridge = "clawshield-openclaw-bridge";

function stableSessionId(sessionKey: string | undefined, sessionId: string | undefined): string {
  const raw = sessionKey ?? sessionId ?? "openclaw-plugin";
  if (raw.length <= 128) return raw;
  return createHash("sha256").update(raw).digest("hex");
}

export function evalHookSync(
  req: HookEvalRequest,
  cfg: ClawShieldPluginConfig,
  log?: (msg: string) => void,
): DecisionDict | null {
  const cmd = cfg.bridgeCommand?.trim() || defaultBridge;
  const timeout = cfg.evalTimeoutMs ?? 120_000;
  const sessionId = req.sessionId ?? "openclaw-plugin";
  const payload = JSON.stringify({
    hook: req.hook,
    payload: req.payload,
    session_id: sessionId,
  });

  const r = spawnSync(cmd, ["hook-eval"], {
    input: payload,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout,
    windowsHide: true,
  });

  if (r.error) {
    log?.(`[clawshield] hook-eval spawn error: ${r.error.message}`);
    return null;
  }
  if (r.status !== 0) {
    log?.(`[clawshield] hook-eval exit ${r.status}: ${(r.stderr || "").trim() || r.stdout}`);
    return null;
  }

  try {
    return JSON.parse(r.stdout) as DecisionDict;
  } catch (e) {
    log?.(`[clawshield] hook-eval JSON parse error: ${e}`);
    return null;
  }
}

export async function evalHook(
  req: HookEvalRequest,
  cfg: ClawShieldPluginConfig,
  ctx: { sessionKey?: string; sessionId?: string },
  log?: (msg: string) => void,
): Promise<DecisionDict | null> {
  const sessionId = stableSessionId(ctx.sessionKey, ctx.sessionId);
  return await Promise.resolve(
    evalHookSync({ ...req, sessionId: sessionId }, cfg, log),
  );
}

export { stableSessionId };

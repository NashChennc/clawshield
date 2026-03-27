import { definePluginEntry, emptyPluginConfigSchema } from "openclaw/plugin-sdk/plugin-entry";
import { OpenClawAdapter, routeHookEval } from "../../adapters/openclaw/adapter.js";
import type { DecisionDict } from "../../core/models/decision.js";
import { getOrCreateSafetyCore } from "../../core/engine/factory.js";
import { coerceHookEvalParams, normalizeOpenclawToolName } from "../../adapters/openclaw/normalize.js";
import { evalPersistBlocking } from "../scripts/persist-eval.js";
import { normalizeToolParams } from "../../adapters/openclaw/tool-params.js";
import { stableSessionId } from "../../infrastructure/state/session-id.js";
import { applyPersistDecision } from "../../executors/interceptors/tool-result.js";
import { parseSanitizedPayloadForParams } from "../../core/models/decision-sanitize.js";

export type ClawShieldPluginConfig = {
  failClosed?: boolean;
  enablePromptContextEval?: boolean;
  persistEvalTimeoutMs?: number;
};

function logLine(log: { info: (m: string) => void }, msg: string) {
  log.info(msg);
}

function mapBeforeToolDecision(
  normalizedParams: Record<string, unknown>,
  decision: DecisionDict | null,
  cfg: ClawShieldPluginConfig,
): { params?: Record<string, unknown>; block?: boolean; blockReason?: string } | void {
  if (!decision) {
    if (cfg.failClosed !== false) return { block: true, blockReason: "ClawShield evaluation failed or threw." };
    return { params: normalizedParams };
  }

  const action = decision.action;
  const rationale = decision.rationale ?? action;
  if (action === "allow") return { params: normalizedParams };
  if (action === "sanitize_then_allow" && decision.sanitized_payload && typeof decision.sanitized_payload === "object") {
    const safePayload = parseSanitizedPayloadForParams(decision.sanitized_payload);
    if (!safePayload) {
      if (cfg.failClosed !== false) return { block: true, blockReason: "Invalid sanitized payload shape from evaluator." };
      return { params: normalizedParams };
    }
    return { params: { ...normalizedParams, ...safePayload } as Record<string, unknown> };
  }
  if (action === "block" || action === "require_confirm") return { block: true, blockReason: rationale };
  return { block: true, blockReason: rationale };
}

async function evaluateHook(
  hook: "before_prompt_build" | "before_tool_call" | "after_tool_call",
  payload: Record<string, unknown>,
  sessionId: string | undefined,
  log?: (m: string) => void,
): Promise<DecisionDict | null> {
  try {
    const core = getOrCreateSafetyCore();
    const adapter = new OpenClawAdapter(core);
    return await routeHookEval(adapter, hook, payload, sessionId);
  } catch (e) {
    log?.(`[clawshield] evaluate error: ${e}`);
    return null;
  }
}

const manifestJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    failClosed: { type: "boolean" },
    enablePromptContextEval: { type: "boolean" },
    persistEvalTimeoutMs: { type: "number", minimum: 1000 },
  },
};

export default definePluginEntry({
  id: "clawshield",
  name: "ClawShield",
  description:
    "Evaluates OpenClaw tool/persist lifecycle and enforces parameter replacement or blocking via embedded TypeScript SafetyCore.",
  configSchema: {
    ...emptyPluginConfigSchema(),
    jsonSchema: manifestJsonSchema,
  },
  register(api) {
    const raw = api.pluginConfig as ClawShieldPluginConfig | undefined;
    const cfg: ClawShieldPluginConfig = {
      failClosed: raw?.failClosed !== false,
      enablePromptContextEval: raw?.enablePromptContextEval !== false,
      persistEvalTimeoutMs: raw?.persistEvalTimeoutMs ?? 120_000,
    };

    api.on("before_prompt_build", async (event, ctx) => {
      if (cfg.enablePromptContextEval) {
        const sessionId = stableSessionId(ctx.sessionKey, ctx.sessionId);
        await evaluateHook(
          "before_prompt_build",
          { prompt: event.prompt, messages: event.messages },
          sessionId,
          (m) => logLine(api.logger, m),
        );
      }
    });

    api.on("before_tool_call", async (event, ctx) => {
      const sessionId = stableSessionId(ctx.sessionKey, ctx.sessionId);
      const toolName = normalizeOpenclawToolName(String(event.toolName ?? ""));
      const params = normalizeToolParams(toolName, coerceHookEvalParams(event.params));
      const decision = await evaluateHook(
        "before_tool_call",
        {
          toolName,
          params,
          runId: event.runId,
          toolCallId: event.toolCallId,
        },
        sessionId,
        (m) => logLine(api.logger, m),
      );
      return mapBeforeToolDecision(params, decision, cfg);
    });

    api.on("after_tool_call", async (event, ctx) => {
      const sessionId = stableSessionId(ctx.sessionKey, ctx.sessionId);
      await evaluateHook(
        "after_tool_call",
        {
          toolName: event.toolName,
          params: event.params,
          runId: event.runId,
          toolCallId: event.toolCallId,
          result: event.result,
          error: event.error,
          durationMs: event.durationMs,
        },
        sessionId,
        (m) => logLine(api.logger, m),
      );
    });

    api.on("tool_result_persist", (event, ctx) => {
      const sessionId = ctx.sessionKey;
      const decision = evalPersistBlocking(
        {
          hook: "tool_result_persist",
          payload: {
            toolName: event.toolName ?? ctx.toolName,
            toolCallId: event.toolCallId ?? ctx.toolCallId,
            message: event.message,
            isSynthetic: event.isSynthetic,
          },
          sessionId: stableSessionId(sessionId, undefined),
        },
        cfg.persistEvalTimeoutMs ?? 120_000,
        (m) => logLine(api.logger, m),
      );
      const patched = applyPersistDecision(event.message, decision);
      if (!patched) return undefined;
      return { message: patched };
    });
  },
});

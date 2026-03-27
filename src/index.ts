import { definePluginEntry, emptyPluginConfigSchema } from "openclaw/plugin-sdk/plugin-entry";
import { OpenClawAdapter, routeHookEval } from "./adapter/openclaw.js";
import type { DecisionDict } from "./core/decision.js";
import { getOrCreateSafetyCore } from "./core/factory.js";
import { coerceHookEvalParams, normalizeOpenclawToolName } from "./openclaw-normalize.js";
import { evalPersistBlocking } from "./persist-eval.js";
import { CLAWSHIELD_PREPEND_SYSTEM_CONTEXT } from "./prompt.js";
import { stableSessionId } from "./session-id.js";
import { applyPersistDecision } from "./tool-result.js";

export type ClawShieldPluginConfig = {
  failClosed?: boolean;
  enablePromptContextEval?: boolean;
  persistEvalTimeoutMs?: number;
};

function logLine(log: { info: (m: string) => void }, msg: string) {
  log.info(msg);
}

function mapBeforeToolDecision(
  event: { params: Record<string, unknown> },
  decision: DecisionDict | null,
  cfg: ClawShieldPluginConfig,
): { params?: Record<string, unknown>; block?: boolean; blockReason?: string } | void {
  if (!decision) {
    if (cfg.failClosed !== false) {
      return { block: true, blockReason: "ClawShield evaluation failed or threw." };
    }
    return;
  }

  const action = decision.action;
  const rationale = decision.rationale ?? action;

  if (action === "allow") {
    return;
  }

  if (action === "sanitize_then_allow" && decision.sanitized_payload && typeof decision.sanitized_payload === "object") {
    const merged = { ...event.params, ...decision.sanitized_payload } as Record<string, unknown>;
    return { params: merged };
  }

  if (action === "block" || action === "require_confirm") {
    return { block: true, blockReason: rationale };
  }

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
    "Injects ClawShield guidance and evaluates tool/prompt lifecycle via embedded TypeScript SafetyCore.",
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
      const extras: { prependSystemContext?: string } = {
        prependSystemContext: CLAWSHIELD_PREPEND_SYSTEM_CONTEXT,
      };

      if (cfg.enablePromptContextEval) {
        const sessionId = stableSessionId(ctx.sessionKey, ctx.sessionId);
        const decision = await evaluateHook(
          "before_prompt_build",
          { prompt: event.prompt, messages: event.messages },
          sessionId,
          (m) => logLine(api.logger, m),
        );
        if (decision && decision.action !== "allow") {
          const note = decision.rationale ?? decision.action;
          extras.prependSystemContext = `${extras.prependSystemContext}\n\n(ClawShield prompt context review: ${note})`;
        }
      }

      return extras;
    });

    api.on("before_tool_call", async (event, ctx) => {
      const sessionId = stableSessionId(ctx.sessionKey, ctx.sessionId);
      const toolName = normalizeOpenclawToolName(String(event.toolName ?? ""));
      const params = coerceHookEvalParams(event.params);
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
      return mapBeforeToolDecision(event, decision, cfg);
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

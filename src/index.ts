import { definePluginEntry, emptyPluginConfigSchema } from "openclaw/plugin-sdk/plugin-entry";
import { evalHook, evalHookSync, type ClawShieldPluginConfig, type DecisionDict } from "./bridge.js";
import { CLAWSHIELD_PREPEND_SYSTEM_CONTEXT } from "./prompt.js";
import { applyPersistDecision } from "./tool-result.js";

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
      return { block: true, blockReason: "ClawShield bridge unavailable or hook-eval failed." };
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

const manifestJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    bridgeCommand: { type: "string" },
    evalTimeoutMs: { type: "number", minimum: 1000 },
    failClosed: { type: "boolean" },
    enablePromptContextEval: { type: "boolean" },
  },
};

export default definePluginEntry({
  id: "clawshield",
  name: "ClawShield",
  description:
    "Injects ClawShield guidance and evaluates tool/prompt lifecycle via clawshield-openclaw-bridge hook-eval.",
  configSchema: {
    ...emptyPluginConfigSchema(),
    jsonSchema: manifestJsonSchema,
  },
  register(api) {
    const raw = api.pluginConfig as ClawShieldPluginConfig | undefined;
    const cfg: ClawShieldPluginConfig = {
      bridgeCommand: raw?.bridgeCommand,
      evalTimeoutMs: raw?.evalTimeoutMs,
      failClosed: raw?.failClosed !== false,
      enablePromptContextEval: raw?.enablePromptContextEval !== false,
    };

    api.on("before_prompt_build", async (event, ctx) => {
      const extras: { prependSystemContext?: string } = {
        prependSystemContext: CLAWSHIELD_PREPEND_SYSTEM_CONTEXT,
      };

      if (cfg.enablePromptContextEval) {
        const decision = await evalHook(
          {
            hook: "before_prompt_build",
            payload: { prompt: event.prompt, messages: event.messages },
          },
          cfg,
          ctx,
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
      const sessionId = ctx.sessionKey ?? ctx.sessionId;
      const decision = await evalHook(
        {
          hook: "before_tool_call",
          payload: {
            toolName: event.toolName,
            params: event.params,
            runId: event.runId,
            toolCallId: event.toolCallId,
          },
          sessionId,
        },
        cfg,
        ctx,
        (m) => logLine(api.logger, m),
      );
      return mapBeforeToolDecision(event, decision, cfg);
    });

    api.on("after_tool_call", async (event, ctx) => {
      const sessionId = ctx.sessionKey ?? ctx.sessionId;
      await evalHook(
        {
          hook: "after_tool_call",
          payload: {
            toolName: event.toolName,
            params: event.params,
            runId: event.runId,
            toolCallId: event.toolCallId,
            result: event.result,
            error: event.error,
            durationMs: event.durationMs,
          },
          sessionId,
        },
        cfg,
        ctx,
        (m) => logLine(api.logger, m),
      );
    });

    api.on(
      "tool_result_persist",
      (event, ctx) => {
        const sessionId = ctx.sessionKey;
        const decision = evalHookSync(
          {
            hook: "tool_result_persist",
            payload: {
              toolName: event.toolName ?? ctx.toolName,
              toolCallId: event.toolCallId ?? ctx.toolCallId,
              message: event.message,
              isSynthetic: event.isSynthetic,
            },
            sessionId,
          },
          cfg,
          (m) => logLine(api.logger, m),
        );
        const patched = applyPersistDecision(event.message, decision);
        if (!patched) return undefined;
        return { message: patched };
      },
    );
  },
});

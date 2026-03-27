import type { DecisionDict } from "../../core/models/decision.js";
import { createEvent } from "../../core/models/event.js";
import type { SafetyCore } from "../../core/engine/safety-core.js";
import { normalizeOpenclawToolName } from "./normalize.js";

export class OpenClawAdapter {
  constructor(private readonly core: SafetyCore) {}

  async beforeToolCall(
    toolName: string,
    payload: Record<string, unknown>,
    sessionId?: string | null,
  ): Promise<DecisionDict> {
    const event = createEvent({
      event_type: "tool_call_attempt",
      risk_stage: "pre_tool",
      summary: `OpenClaw before_tool_call for ${toolName}`,
      provenance: {
        source_type: "openclaw_hook",
        source_name: "before_tool_call",
        trust_level: "medium",
      },
      payload: { content: payload, raw_payload: payload },
      tool_name: toolName,
      session_id: sessionId ?? undefined,
    });
    const r = await this.core.evaluate(event);
    return r.decision.toDict();
  }

  async afterToolCall(
    toolName: string,
    payload: Record<string, unknown>,
    sessionId?: string | null,
  ): Promise<DecisionDict> {
    const event = createEvent({
      event_type: "tool_result",
      risk_stage: "post_tool",
      summary: `OpenClaw after_tool_call for ${toolName}`,
      provenance: {
        source_type: "openclaw_hook",
        source_name: "after_tool_call",
        trust_level: "medium",
      },
      payload: { content: payload, raw_payload: payload },
      tool_name: toolName,
      session_id: sessionId ?? undefined,
    });
    const r = await this.core.evaluate(event);
    return r.decision.toDict();
  }

  async toolResultPersist(payload: Record<string, unknown>, sessionId?: string | null): Promise<DecisionDict> {
    const toolNameRaw = payload["toolName"];
    const toolName = typeof toolNameRaw === "string" ? toolNameRaw : null;
    const event = createEvent({
      event_type: "tool_result",
      risk_stage: "persist",
      summary: "OpenClaw tool_result_persist event",
      provenance: {
        source_type: "openclaw_hook",
        source_name: "tool_result_persist",
        trust_level: "medium",
      },
      payload: { content: payload, raw_payload: payload },
      tool_name: toolName ?? undefined,
      session_id: sessionId ?? undefined,
    });
    const r = await this.core.evaluate(event, JSON.stringify(payload));
    return r.decision.toDict();
  }

  async beforePromptBuild(payload: Record<string, unknown>, sessionId?: string | null): Promise<DecisionDict> {
    const event = createEvent({
      event_type: "prompt_build_context",
      risk_stage: "pre_prompt",
      summary: "OpenClaw before_prompt_build event",
      provenance: {
        source_type: "openclaw_hook",
        source_name: "before_prompt_build",
        trust_level: "medium",
      },
      payload: { content: payload, raw_payload: payload },
      session_id: sessionId ?? undefined,
    });
    const r = await this.core.evaluate(event, JSON.stringify(payload));
    return r.decision.toDict();
  }
}

export function normalizeHookToolName(toolName: string): string {
  return normalizeOpenclawToolName(toolName);
}

export async function routeHookEval(
  adapter: OpenClawAdapter,
  hook: string,
  payload: Record<string, unknown>,
  sessionId: string | undefined,
): Promise<DecisionDict> {
  if (hook === "before_prompt_build") return adapter.beforePromptBuild(payload, sessionId);
  if (hook === "before_tool_call") {
    const t = normalizeHookToolName(String(payload["toolName"] ?? ""));
    let params = payload["params"];
    if (!params || typeof params !== "object" || Array.isArray(params)) params = {};
    return adapter.beforeToolCall(t, params as Record<string, unknown>, sessionId);
  }
  if (hook === "after_tool_call") {
    const toolName = String(payload["toolName"] ?? "");
    const rest: Record<string, unknown> = { ...payload };
    delete rest["toolName"];
    return adapter.afterToolCall(toolName, rest, sessionId);
  }
  if (hook === "tool_result_persist") return adapter.toolResultPersist(payload, sessionId);

  return {
    action: "allow",
    risk_score: 0,
    confidence: 0,
    rationale: `unknown hook ${JSON.stringify(hook)}`,
    risk_types: [],
    evidence: [],
    policy_hits: [],
    judge_used: false,
    deterministic: true,
    notes: [],
  };
}

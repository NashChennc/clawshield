import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { DecisionDict } from "../../core/models/decision.js";

function isToolResultMessage(msg: AgentMessage): msg is Extract<AgentMessage, { role: "toolResult" }> {
  return msg.role === "toolResult";
}

export function applyPersistDecision(message: AgentMessage, decision: DecisionDict | null): AgentMessage | undefined {
  if (!decision) return undefined;

  const action = decision.action;
  const rationale = decision.rationale ?? action;

  if (action === "allow") return undefined;

  if (!isToolResultMessage(message)) {
    return undefined;
  }

  const clone = structuredClone(message) as Extract<AgentMessage, { role: "toolResult" }>;

  if (action === "sanitize_then_allow" && decision.sanitized_payload) {
    const replacement =
      typeof decision.sanitized_payload.content === "string"
        ? decision.sanitized_payload.content
        : JSON.stringify(decision.sanitized_payload);
    clone.content = [{ type: "text", text: replacement }];
    clone.isError = false;
    return clone;
  }

  if (action === "block" || action === "require_confirm") {
    clone.content = [
      {
        type: "text",
        text: `[ClawShield] Not persisted as-is (${action}): ${rationale}`,
      },
    ];
    clone.isError = true;
    return clone;
  }

  return undefined;
}

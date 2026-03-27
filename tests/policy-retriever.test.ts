import { describe, expect, it } from "vitest";
import { createEvent } from "../src/core/models/event.js";
import type { Policy } from "../src/core/policy/schema.js";
import { PolicyRetriever } from "../src/core/policy/retriever.js";

function makePolicy(overrides: Partial<Policy> & Pick<Policy, "id">): Policy {
  return {
    id: overrides.id,
    title: overrides.title ?? `Policy ${overrides.id}`,
    scope: overrides.scope ?? ["tool_call_attempt"],
    trigger: overrides.trigger ?? { keywords: [] },
    risk_type: overrides.risk_type ?? "generic_risk",
    required_evidence: overrides.required_evidence ?? ["evidence"],
    default_action: overrides.default_action ?? "require_confirm",
    severity: overrides.severity ?? "medium",
    rationale: overrides.rationale ?? "test rationale",
    examples: overrides.examples ?? [{ input: "x", expected: "y" }],
    status: overrides.status ?? "active",
    version: overrides.version ?? "1.0.0",
    tags: overrides.tags ?? ["test"],
  };
}

describe("PolicyRetriever", () => {
  it("ranks higher score policy first when multiple policies match", () => {
    const policies: Policy[] = [
      makePolicy({
        id: "policy-high",
        scope: ["tool_call_attempt", "shell", "openclaw_hook"],
        trigger: { keywords: ["customer_records"] },
        risk_type: "sensitive_data_access",
      }),
      makePolicy({
        id: "policy-mid",
        scope: ["tool_call_attempt", "shell"],
        trigger: { keywords: ["customer_records"] },
        risk_type: "other_risk",
      }),
      makePolicy({
        id: "policy-low",
        scope: ["tool_call_attempt"],
        trigger: { keywords: ["irrelevant"] },
        risk_type: "other_risk",
      }),
    ];
    const retriever = new PolicyRetriever(policies);
    const event = createEvent({
      event_type: "tool_call_attempt",
      risk_stage: "pre_tool",
      summary: "read customer_records before processing",
      provenance: { source_type: "openclaw_hook", source_name: "test" },
      payload: { content: { command: "type sandbox/private/customer_records.txt" }, raw_payload: null },
      tool_name: "shell",
      tags: ["customer_records"],
    });

    const retrieved = retriever.retrieve(event, "shell", "openclaw_hook", "pre_tool");
    expect(retrieved.map((r) => r.policy.id)).toEqual(["policy-high", "policy-mid", "policy-low"]);
    expect(retrieved[0]?.score).toBeGreaterThan(retrieved[1]?.score ?? 0);
  });

  it("keeps insertion order for tie scores", () => {
    const policyA = makePolicy({
      id: "policy-a",
      scope: ["tool_call_attempt", "shell"],
      trigger: { keywords: ["marker"] },
      risk_type: "risk_a",
    });
    const policyB = makePolicy({
      id: "policy-b",
      scope: ["tool_call_attempt", "shell"],
      trigger: { keywords: ["marker"] },
      risk_type: "risk_b",
    });
    const retriever = new PolicyRetriever([policyA, policyB]);
    const event = createEvent({
      event_type: "tool_call_attempt",
      risk_stage: "pre_tool",
      summary: "marker seen in input",
      provenance: { source_type: "openclaw_hook", source_name: "test" },
      payload: { content: { command: "echo marker" }, raw_payload: null },
      tool_name: "shell",
    });

    const retrieved = retriever.retrieve(event, "shell", "openclaw_hook", "pre_tool");
    expect(retrieved.map((r) => r.policy.id)).toEqual(["policy-a", "policy-b"]);
    expect(retrieved[0]?.score).toBe(retrieved[1]?.score);
  });
});

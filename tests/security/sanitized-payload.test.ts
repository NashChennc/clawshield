import { describe, expect, it } from "vitest";
import { applyPersistDecision } from "../../src/executors/interceptors/tool-result.js";
import {
  isSafeSanitizedPayload,
  parseSanitizedPayloadForParams,
  stringifySanitizedPayloadForPersist,
} from "../../src/core/models/decision-sanitize.js";
import type { DecisionDict } from "../../src/core/models/decision.js";

function buildDecision(payload: unknown): DecisionDict {
  return {
    action: "sanitize_then_allow",
    risk_score: 0.7,
    confidence: 0.9,
    rationale: "sanitize",
    risk_types: [],
    evidence: [],
    policy_hits: [],
    sanitized_payload: payload as Record<string, unknown>,
    judge_used: true,
    deterministic: false,
    notes: [],
  };
}

describe("sanitized payload guard", () => {
  it("accepts bounded plain JSON object", () => {
    const payload = { content: "safe text", score: 1, tags: ["ok"], nested: { value: true } };
    expect(isSafeSanitizedPayload(payload)).toBe(true);
    expect(parseSanitizedPayloadForParams(payload)).toEqual(payload);
  });

  it("rejects dangerous constructor-like keys", () => {
    expect(isSafeSanitizedPayload({ prototype: { polluted: true } })).toBe(false);
    expect(parseSanitizedPayloadForParams({ constructor: "x" })).toBeNull();
  });

  it("rejects oversized string values", () => {
    const payload = { content: "x".repeat(16_001) };
    expect(isSafeSanitizedPayload(payload)).toBe(false);
    expect(stringifySanitizedPayloadForPersist(payload)).toContain("removed");
  });

  it("returns content field for persist replacement", () => {
    const payload = { content: "sanitized from judge", keep: true };
    expect(stringifySanitizedPayloadForPersist(payload)).toBe("sanitized from judge");
  });

  it("falls back to fixed placeholder for invalid persist payload", () => {
    const message = {
      role: "toolResult",
      content: [{ type: "text", text: "old" }],
      isError: false,
    };
    const patched = applyPersistDecision(message as never, buildDecision({ content: "x".repeat(16_001) }));
    expect(patched).toBeDefined();
    const text = (patched?.content?.[0] as { text?: string } | undefined)?.text ?? "";
    expect(text).toContain("removed");
  });
});

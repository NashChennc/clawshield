import type { Event } from "../event-schema/models.js";
import type { Policy } from "../policy/schema.js";

export type RetrievedPolicy = {
  policy: Policy;
  score: number;
  reasons: string[];
};

export class PolicyRetriever {
  constructor(private readonly policies: Policy[]) {}

  retrieve(
    event: Event,
    toolType?: string | null,
    sourceType?: string | null,
    riskStage?: string | null,
    recentMemoryDiff?: string | null,
    limit = 5,
  ): RetrievedPolicy[] {
    const ranked: RetrievedPolicy[] = [];
    const haystack = [
      event.summary.toLowerCase(),
      event.event_type.toLowerCase(),
      (toolType ?? "").toLowerCase(),
      (sourceType ?? event.provenance.source_type).toLowerCase(),
      (riskStage ?? event.risk_stage).toLowerCase(),
      recentMemoryDiff ? recentMemoryDiff.toLowerCase() : "",
      (event.tags ?? []).join(" ").toLowerCase(),
    ].join(" ");

    for (const policy of this.policies) {
      if (!new Set(["active", "shadow", "candidate"]).has(policy.status)) continue;
      let score = 0;
      const reasons: string[] = [];
      const kwRaw = policy.trigger["keywords"];
      const keywords = Array.isArray(kwRaw) ? kwRaw.map((v) => String(v).toLowerCase()) : [];
      if (keywords.some((k) => haystack.includes(k))) {
        score += 4;
        reasons.push("keyword");
      }
      if (toolType && policy.scope.includes(toolType)) {
        score += 3;
        reasons.push("tool-scope");
      }
      if (policy.scope.includes(event.event_type)) {
        score += 2;
        reasons.push("event-scope");
      }
      if (policy.risk_type.toLowerCase() && haystack.includes(policy.risk_type.toLowerCase())) {
        score += 2;
        reasons.push("risk-type");
      }
      if (sourceType && policy.scope.includes(sourceType)) {
        score += 1;
        reasons.push("source-scope");
      }
      if (riskStage && riskStage === event.risk_stage) {
        score += 1;
        reasons.push("risk-stage");
      }
      if (score > 0) ranked.push({ policy, score, reasons });
    }
    ranked.sort((a, b) => b.score - a.score);
    return ranked.slice(0, limit);
  }
}

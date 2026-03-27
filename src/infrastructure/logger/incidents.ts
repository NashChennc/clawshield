import fs from "node:fs";
import path from "node:path";
import type { Decision } from "../../core/models/decision.js";
import type { Event } from "../../core/models/event.js";
import type { RetrievedPolicy } from "../../core/policy/retriever.js";
import { ensureJsonable, utcNow } from "../../shared/utils/common.js";

export class IncidentLogger {
  constructor(private readonly incidentPath: string) {
    fs.mkdirSync(path.dirname(this.incidentPath), { recursive: true });
  }

  log(
    event: Event,
    decision: Decision,
    retrieved: RetrievedPolicy[],
    judgeOutput?: Record<string, unknown> | null,
  ): Record<string, unknown> {
    const evolution = this.evolutionSuggestion(event, decision, retrieved, judgeOutput);
    const record = {
      timestamp: utcNow(),
      event: JSON.parse(JSON.stringify(event)) as Record<string, unknown>,
      event_summary: event.summary,
      policies_retrieved: retrieved.map((item) => ({
        id: item.policy.id,
        score: item.score,
        reasons: item.reasons,
      })),
      judge_output: judgeOutput,
      final_decision: decision.toDict(),
      why: decision.rationale,
      deterministic: decision.deterministic,
      llm_assisted: decision.judge_used,
      evolution,
    };
    fs.appendFileSync(this.incidentPath, JSON.stringify(ensureJsonable(record)) + "\n", "utf8");
    return record;
  }

  private evolutionSuggestion(
    event: Event,
    decision: Decision,
    retrieved: RetrievedPolicy[],
    judgeOutput: Record<string, unknown> | null | undefined,
  ): Record<string, unknown> {
    const policyHits = retrieved.map((r) => r.policy.id);
    const shouldReview =
      new Set(["block", "require_confirm", "sanitize_then_allow"]).has(decision.action) ||
      (decision.risk_types?.length ?? 0) > 0 ||
      judgeOutput != null;
    const mode = policyHits.length ? "revise_existing" : "new_candidate";
    const reasons: string[] = [];
    if (new Set(["block", "require_confirm", "sanitize_then_allow"]).has(decision.action)) {
      reasons.push("restrictive_decision");
    }
    if (judgeOutput != null) reasons.push("llm_assisted_decision");
    if (policyHits.length) reasons.push("existing_policy_context_present");
    if (event.event_type === "memory_update" || event.event_type === "prompt_build_context") {
      reasons.push("cross_turn_context_risk");
    }
    return { should_review: shouldReview, mode, policy_hits: policyHits, reasons };
  }

  readAll(): Record<string, unknown>[] {
    if (!fs.existsSync(this.incidentPath)) return [];
    const records: Record<string, unknown>[] = [];
    const lines = fs.readFileSync(this.incidentPath, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        records.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        /* skip */
      }
    }
    return records;
  }
}

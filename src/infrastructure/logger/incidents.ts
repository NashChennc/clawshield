import fs from "node:fs";
import path from "node:path";
import type { Decision } from "../../core/models/decision.js";
import type { Event } from "../../core/models/event.js";
import type { RetrievedPolicy } from "../../core/policy/retriever.js";
import { ensureJsonable, utcNow } from "../../shared/utils/common.js";

const MAX_LOG_STRING_CHARS = 16_384;

type TruncationStats = {
  truncated: boolean;
  string_fields: number;
  dropped_chars: number;
};

function truncateLargeStrings(value: unknown, stats: TruncationStats): unknown {
  if (typeof value === "string") {
    if (value.length <= MAX_LOG_STRING_CHARS) return value;
    stats.truncated = true;
    stats.string_fields += 1;
    stats.dropped_chars += value.length - MAX_LOG_STRING_CHARS;
    return `${value.slice(0, MAX_LOG_STRING_CHARS)}...[truncated]`;
  }
  if (Array.isArray(value)) {
    return value.map((item) => truncateLargeStrings(item, stats));
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      output[k] = truncateLargeStrings(v, stats);
    }
    return output;
  }
  return value;
}

export class IncidentLogger {
  private readonly writable: boolean;

  constructor(private readonly incidentPath: string) {
    try {
      fs.mkdirSync(path.dirname(this.incidentPath), { recursive: true });
      this.writable = true;
    } catch (err) {
      this.writable = false;
      console.warn("[IncidentLogger] failed to prepare incident directory, running in degraded mode.", err);
    }
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
    const stats: TruncationStats = { truncated: false, string_fields: 0, dropped_chars: 0 };
    const jsonable = ensureJsonable(record);
    const sanitized = truncateLargeStrings(jsonable, stats) as Record<string, unknown>;
    if (stats.truncated) {
      sanitized["truncated"] = true;
      sanitized["truncation"] = {
        max_string_chars: MAX_LOG_STRING_CHARS,
        truncated_string_fields: stats.string_fields,
        dropped_chars: stats.dropped_chars,
      };
      console.warn("[IncidentLogger] oversized incident payload truncated before persistence.", stats);
    }
    if (this.writable) {
      try {
        fs.appendFileSync(this.incidentPath, JSON.stringify(sanitized) + "\n", "utf8");
      } catch (err) {
        sanitized["persisted"] = false;
        sanitized["persist_error"] = "append_failed";
        console.warn("[IncidentLogger] failed to append incident record, degraded in-memory mode.", err);
      }
    } else {
      sanitized["persisted"] = false;
      sanitized["persist_error"] = "logger_unavailable";
    }
    return sanitized;
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
    try {
      if (!fs.existsSync(this.incidentPath)) return [];
      const records: Record<string, unknown>[] = [];
      const lines = fs.readFileSync(this.incidentPath, "utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        try {
          records.push(JSON.parse(line) as Record<string, unknown>);
        } catch {
          /* skip malformed line */
        }
      }
      return records;
    } catch (err) {
      console.warn("[IncidentLogger] failed to read incidents, returning empty list.", err);
      return [];
    }
  }
}

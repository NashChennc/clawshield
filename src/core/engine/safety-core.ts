import { Decision } from "../models/decision.js";
import { inspectFallbackHeuristics, inspectHardBarrier } from "../evaluation/deterministic.js";
import { SessionStateStore } from "../../infrastructure/state/session-state.js";
import type { Event } from "../models/event.js";
import { eventToDict } from "../models/event.js";
import { IncidentLogger } from "../../infrastructure/logger/incidents.js";
import { GuardJudgeClient } from "../../adapters/llm-judge/client.js";
import { PolicyLoader } from "../policy/loader.js";
import type { Policy } from "../policy/schema.js";
import { PolicyRetriever } from "../policy/retriever.js";

export type EvaluationResult = {
  event: Event;
  decision: Decision;
  incident: Record<string, unknown>;
};

export class SafetyCore {
  private policies: Policy[];
  private retriever: PolicyRetriever;

  constructor(
    private readonly policyLoader: PolicyLoader,
    private readonly incidentLogger: IncidentLogger,
    private readonly judgeClient: GuardJudgeClient,
    private readonly runtimeDir: string,
    private readonly sessionStore: SessionStateStore,
  ) {
    this.policies = this.policyLoader.load();
    this.retriever = new PolicyRetriever(this.policies);
  }

  refreshPolicies(): void {
    this.policies = this.policyLoader.load();
    this.retriever = new PolicyRetriever(this.policies);
  }

  async evaluate(event: Event, recentMemoryDiff?: string | null): Promise<EvaluationResult> {
    const sessionId = event.session_id || "default";
    const currentState = this.sessionStore.toDict(sessionId);
    const retrieved = this.retriever.retrieve(
      event,
      event.tool_name,
      event.provenance.source_type,
      event.risk_stage,
      recentMemoryDiff ?? undefined,
    );
    const hardBarrier = inspectHardBarrier(event, retrieved, this.runtimeDir);
    if (hardBarrier) {
      const incident = this.incidentLogger.log(event, hardBarrier, retrieved);
      this.sessionStore.update(sessionId, eventToDict(event), hardBarrier.toDict());
      return { event, decision: hardBarrier, incident };
    }

    const judgePayload = {
      event: eventToDict(event),
      retrieved_policies: retrieved.map((item) => ({
        id: item.policy.id,
        title: item.policy.title,
        scope: item.policy.scope,
        risk_type: item.policy.risk_type,
        required_evidence: item.policy.required_evidence,
        default_action: item.policy.default_action,
        severity: item.policy.severity,
        rationale: item.policy.rationale,
        tags: item.policy.tags,
        retrieval_reasons: item.reasons,
        retrieval_score: item.score,
      })),
      recent_memory_diff: recentMemoryDiff,
      session_state: currentState,
      judge_instruction: {
        mode: "online_guard",
        policy_role: "Policies are structured context and consistency guidance, not the sole judge.",
        hard_barrier_role: "If a deterministic hard barrier already fired, the caller would have blocked before you.",
      },
    };

    const judgeResult = await this.judgeClient.judge(judgePayload);
    if (judgeResult) {
      const decision = judgeResult.toDecision("Decision from external guard judge.");
      const incident = this.incidentLogger.log(event, decision, retrieved, judgeResult.toDict());
      this.sessionStore.update(sessionId, eventToDict(event), decision.toDict());
      return { event, decision, incident };
    }

    const fallback = inspectFallbackHeuristics(event, retrieved);
    if (fallback) {
      const incident = this.incidentLogger.log(event, fallback, retrieved);
      this.sessionStore.update(sessionId, eventToDict(event), fallback.toDict());
      return { event, decision: fallback, incident };
    }

    const decision = new Decision({
      action: "allow",
      risk_score: 0.15,
      confidence: 0.55,
      rationale: "No hard barrier fired and no guard judge override.",
      risk_types: [],
      evidence: [],
      policy_hits: retrieved.map((i) => i.policy.id),
      judge_used: false,
      deterministic: true,
    });
    const incident = this.incidentLogger.log(event, decision, retrieved);
    this.sessionStore.update(sessionId, eventToDict(event), decision.toDict());
    return { event, decision, incident };
  }
}

export type DecisionDict = {
  action: string;
  risk_score: number;
  confidence: number;
  rationale: string;
  risk_types: string[];
  evidence: string[];
  policy_hits: string[];
  sanitized_payload?: Record<string, unknown> | null;
  judge_used: boolean;
  deterministic: boolean;
  notes: string[];
};

export class Decision {
  action: string;
  risk_score: number;
  confidence: number;
  rationale: string;
  risk_types: string[];
  evidence: string[];
  policy_hits: string[];
  sanitized_payload: Record<string, unknown> | null;
  judge_used: boolean;
  deterministic: boolean;
  notes: string[];

  constructor(
    fields: Omit<DecisionDict, "sanitized_payload" | "risk_types" | "evidence" | "policy_hits" | "notes" | "judge_used" | "deterministic"> & {
      judge_used?: boolean;
      deterministic?: boolean;
      sanitized_payload?: Record<string, unknown> | null;
      risk_types?: string[];
      evidence?: string[];
      policy_hits?: string[];
      notes?: string[];
    },
  ) {
    this.action = fields.action;
    this.risk_score = fields.risk_score;
    this.confidence = fields.confidence;
    this.rationale = fields.rationale;
    this.risk_types = fields.risk_types ?? [];
    this.evidence = fields.evidence ?? [];
    this.policy_hits = fields.policy_hits ?? [];
    this.sanitized_payload = fields.sanitized_payload ?? null;
    this.judge_used = fields.judge_used ?? false;
    this.deterministic = fields.deterministic ?? true;
    this.notes = fields.notes ?? [];
  }

  toDict(): DecisionDict {
    return {
      action: this.action,
      risk_score: this.risk_score,
      confidence: this.confidence,
      rationale: this.rationale,
      risk_types: this.risk_types,
      evidence: this.evidence,
      policy_hits: this.policy_hits,
      sanitized_payload: this.sanitized_payload,
      judge_used: this.judge_used,
      deterministic: this.deterministic,
      notes: this.notes,
    };
  }
}

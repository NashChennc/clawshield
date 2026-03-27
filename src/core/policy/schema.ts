export type Policy = {
  id: string;
  title: string;
  scope: string[];
  trigger: Record<string, unknown>;
  risk_type: string;
  required_evidence: string[];
  default_action: string;
  severity: string;
  rationale: string;
  examples: Array<Record<string, string>>;
  status: string;
  version: string;
  tags: string[];
};

const REQUIRED_KEYS = new Set([
  "id",
  "title",
  "scope",
  "trigger",
  "risk_type",
  "required_evidence",
  "default_action",
  "severity",
  "rationale",
  "examples",
  "status",
  "version",
]);

export function policyFromDict(data: Record<string, unknown>): Policy {
  const missing = [...REQUIRED_KEYS].filter((k) => !(k in data));
  if (missing.length) {
    throw new Error(`Policy missing required fields: ${missing.sort().join(", ")}`);
  }
  return {
    id: String(data.id),
    title: String(data.title),
    scope: data.scope as string[],
    trigger: data.trigger as Record<string, unknown>,
    risk_type: String(data.risk_type),
    required_evidence: data.required_evidence as string[],
    default_action: String(data.default_action),
    severity: String(data.severity),
    rationale: String(data.rationale),
    examples: data.examples as Array<Record<string, string>>,
    status: String(data.status),
    version: String(data.version),
    tags: (data.tags as string[]) ?? [],
  };
}

export function validatePolicyDocument(data: Record<string, unknown>): void {
  if (data.candidate_type === "policy_revision") {
    const required = new Set([
      "candidate_type",
      "target_policy_id",
      "proposed_changes",
      "why",
      "status",
      "version",
      "tags",
    ]);
    const missing = [...required].filter((k) => !(k in data));
    if (missing.length) {
      throw new Error(`Policy revision candidate missing required fields: ${missing.sort().join(", ")}`);
    }
    if (data.candidate_type !== "policy_revision") {
      throw new Error("candidate_type must be policy_revision");
    }
    return;
  }
  policyFromDict(data);
}

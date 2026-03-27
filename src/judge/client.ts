import { Decision } from "../core/decision.js";

function coerceList(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return [value];
  return [String(value)];
}

export function normalizeApiType(value: string | undefined): string {
  const normalized = (value ?? "openai").trim().toLowerCase().replaceAll("-", "_");
  const aliases: Record<string, string> = {
    openai_compatible: "openai",
    compatible: "openai",
    anthropic_messages: "anthropic",
    claude: "anthropic",
  };
  return aliases[normalized] ?? normalized;
}

export function buildEndpoint(apiBase: string, _apiType: string, suffix: string): string {
  const base = apiBase.replace(/\/+$/, "");
  if (base.endsWith(suffix)) return base;
  return `${base}${suffix}`;
}

export type JudgeResultFields = {
  risk_score: number;
  risk_types: unknown;
  evidence: unknown;
  decision: string;
  confidence: number;
  policy_hits: unknown;
  notes: unknown;
};

export class JudgeResult {
  risk_score: number;
  risk_types: string[];
  evidence: string[];
  decision: string;
  confidence: number;
  policy_hits: string[];
  notes: string[];

  constructor(data: JudgeResultFields) {
    this.risk_score = Number(data.risk_score);
    this.risk_types = coerceList(data.risk_types);
    this.evidence = coerceList(data.evidence);
    this.decision = String(data.decision);
    this.confidence = Number(data.confidence);
    this.policy_hits = coerceList(data.policy_hits);
    this.notes = coerceList(data.notes);
  }

  static fromDict(data: Record<string, unknown>): JudgeResult {
    const required = new Set([
      "risk_score",
      "risk_types",
      "evidence",
      "decision",
      "confidence",
      "policy_hits",
      "notes",
    ]);
    const missing = [...required].filter((k) => !(k in data));
    if (missing.length) {
      throw new Error(`Judge response missing required fields: ${missing.sort().join(", ")}`);
    }
    return new JudgeResult(data as unknown as JudgeResultFields);
  }

  toDecision(rationale: string): Decision {
    return new Decision({
      action: this.decision,
      risk_score: this.risk_score,
      confidence: this.confidence,
      rationale,
      risk_types: this.risk_types,
      evidence: this.evidence,
      policy_hits: this.policy_hits,
      judge_used: true,
      deterministic: false,
      notes: this.notes,
    });
  }

  toDict(): Record<string, unknown> {
    return {
      risk_score: this.risk_score,
      risk_types: this.risk_types,
      evidence: this.evidence,
      decision: this.decision,
      confidence: this.confidence,
      policy_hits: this.policy_hits,
      notes: this.notes,
    };
  }
}

export class GuardJudgeClient {
  private apiBase: string | undefined;
  private apiKey: string | undefined;
  private model: string | undefined;
  private apiType: string;
  private apiVersion: string;
  private maxTokens: number;

  constructor(
    apiBase: string | undefined,
    apiKey: string | undefined,
    model: string | undefined,
    options?: {
      apiType?: string | null;
      apiVersion?: string | null;
      maxTokens?: number;
    },
  ) {
    this.apiBase = apiBase;
    this.apiKey = apiKey;
    this.model = model;
    this.apiType = normalizeApiType(options?.apiType ?? undefined);
    this.apiVersion = options?.apiVersion ?? "2023-06-01";
    this.maxTokens = options?.maxTokens ?? 1000;
  }

  configured(): boolean {
    return Boolean(this.apiBase && this.apiKey && this.model);
  }

  async judge(context: Record<string, unknown>): Promise<JudgeResult | null> {
    if (!this.configured()) return null;
    const systemPrompt =
      "You are an OpenClaw runtime safety judge. " +
      "Deterministic hard barriers are handled outside you. " +
      "Use policies as structured context, evidence guidance, and response preference, not as rigid keyword rules. " +
      "Consider event content, session history, recent memory diffs, and policy context together. " +
      "Return JSON only with fields: risk_score, risk_types, evidence, decision, confidence, policy_hits, notes.";
    try {
      const data = await this.requestJson(systemPrompt, context);
      return JudgeResult.fromDict(data);
    } catch {
      return null;
    }
  }

  private async requestJson(systemPrompt: string, context: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.apiType === "anthropic") {
      return this.requestAnthropic(systemPrompt, context);
    }
    return this.requestOpenAiCompatible(systemPrompt, context);
  }

  private async requestOpenAiCompatible(
    systemPrompt: string,
    context: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const url = buildEndpoint(String(this.apiBase), this.apiType, "/chat/completions");
    const payload = {
      model: this.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(context) },
      ],
    };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`judge http ${res.status}`);
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const message = body.choices?.[0]?.message?.content;
    if (typeof message !== "string") throw new Error("missing message content");
    return JSON.parse(message) as Record<string, unknown>;
  }

  private async requestAnthropic(
    systemPrompt: string,
    context: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const url = buildEndpoint(String(this.apiBase), this.apiType, "/messages");
    const payload = {
      model: this.model,
      system: systemPrompt,
      max_tokens: this.maxTokens,
      temperature: 0,
      messages: [{ role: "user", content: JSON.stringify(context) }],
    };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": String(this.apiKey),
        "anthropic-version": this.apiVersion,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`judge http ${res.status}`);
    const body = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
    const content = body.content;
    if (!Array.isArray(content) || !content.length) throw new Error("Anthropic response missing content");
    const textBlocks = content
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string);
    if (!textBlocks.length) throw new Error("Anthropic response missing text block");
    return JSON.parse(textBlocks.join("\n")) as Record<string, unknown>;
  }
}

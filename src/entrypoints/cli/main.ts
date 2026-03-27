#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { buildSafetyCore } from "../../core/engine/factory.js";
import { loadSettings } from "../../infrastructure/config/settings.js";
import { getPackageRoot } from "../../shared/utils/package-root.js";
import { GuardedShell } from "../../executors/wrappers/shell.js";
import { GuardedFileWriter } from "../../executors/wrappers/file-write.js";
import { GuardedWebFetcher } from "../../executors/wrappers/web-fetch.js";
import { createEvent } from "../../core/models/event.js";
import { PolicyLoader } from "../../core/policy/loader.js";
import { IncidentLogger } from "../../infrastructure/logger/incidents.js";
import { GuardJudgeClient } from "../../adapters/llm-judge/client.js";
import { OpenClawAdapter, routeHookEval } from "../../adapters/openclaw/adapter.js";
import { normalizeOpenclawToolName } from "../../adapters/openclaw/normalize.js";

function parseArgv(argv: string[]): { command: string; flags: Record<string, string | boolean> } {
  const command = argv[0] ?? "";
  const flags: Record<string, string | boolean> = {};
  for (let i = 1; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }
  return { command, flags };
}

function flagString(flags: Record<string, string | boolean>, key: string, fallback = ""): string {
  const v = flags[key];
  return typeof v === "string" ? v : fallback;
}

function flagBool(flags: Record<string, string | boolean>, key: string): boolean {
  return flags[key] === true;
}

function projectRootFromEnv(): string {
  return process.env["CLAWSHIELD_PROJECT_ROOT"] ? path.resolve(process.env["CLAWSHIELD_PROJECT_ROOT"]) : getPackageRoot();
}

function buildCore() {
  return buildSafetyCore(loadSettings(projectRootFromEnv()));
}

function exitWithDecision(decision: string): number {
  return decision === "allow" ? 0 : 2;
}

function localPolicyCandidate(incident: Record<string, any>, idx: number): Record<string, unknown> {
  const event = incident["event"] ?? {};
  const toolName = event["tool_name"] || "general";
  const riskTypes = incident["final_decision"]?.["risk_types"] || ["review_needed"];
  return {
    id: `cand-${String(idx).padStart(3, "0")}-${toolName}`,
    title: `Candidate policy from incident ${idx}`,
    scope: [event["event_type"], toolName],
    trigger: { keywords: [riskTypes[0], toolName] },
    risk_type: riskTypes[0],
    required_evidence: ["event.summary", "event.payload", "decision.evidence"],
    default_action: incident["final_decision"]?.["action"] || "require_confirm",
    severity: "medium",
    rationale: "Candidate synthesized from incident review.",
    examples: [{ input: String(event["summary"] ?? ""), expected: incident["final_decision"]?.["action"] || "allow" }],
    status: "candidate",
    version: "0.1.0",
    tags: ["generated", "incident-derived"],
  };
}

function localPolicyRevisionCandidate(incident: Record<string, any>, idx: number): Record<string, unknown> | null {
  const policyHits = incident["evolution"]?.["policy_hits"];
  if (!Array.isArray(policyHits) || !policyHits.length) return null;
  const targetPolicyId = String(policyHits[0]);
  const decision = incident["final_decision"] ?? {};
  const riskTypes = Array.isArray(decision["risk_types"]) ? decision["risk_types"] : ["review_needed"];
  return {
    id: `rev-${String(idx).padStart(3, "0")}-${targetPolicyId}`,
    candidate_type: "policy_revision",
    target_policy_id: targetPolicyId,
    proposed_changes: {
      trigger: { keywords_add: [riskTypes[0], incident["event"]?.["tool_name"] || incident["event"]?.["event_type"]] },
      required_evidence_add: ["session_state.recent_events", "incident.final_decision", "incident.why"],
      examples_add: [{ input: incident["event_summary"], expected: decision["action"] }],
      default_action: decision["action"],
    },
    why: `Incident suggests the existing policy ${targetPolicyId} may need adjustment or broader retrieval coverage.`,
    status: "candidate",
    version: "0.1.0",
    tags: ["generated", "revision", "incident-derived"],
  };
}

async function cmdHookEval(): Promise<number> {
  const raw = fs.readFileSync(0, "utf8");
  if (!raw.trim()) {
    process.stdout.write(
      JSON.stringify({
        action: "allow",
        risk_score: 0,
        confidence: 0,
        rationale: "empty stdin",
        risk_types: [],
        evidence: [],
        policy_hits: [],
        judge_used: false,
        deterministic: true,
        notes: [],
      }),
    );
    return 0;
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch (e) {
    process.stdout.write(
      JSON.stringify({
        action: "block",
        risk_score: 1,
        confidence: 1,
        rationale: `hook-eval invalid json: ${e}`,
        risk_types: ["hook_eval_error"],
        evidence: [],
        policy_hits: [],
        judge_used: false,
        deterministic: true,
        notes: [],
      }),
    );
    return 1;
  }
  const hook = data["hook"];
  const payload = data["payload"];
  const sessionId = data["session_id"];
  if (typeof hook !== "string" || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    process.stdout.write(
      JSON.stringify({
        action: "block",
        risk_score: 1,
        confidence: 1,
        rationale: "hook-eval requires string hook and object payload",
        risk_types: ["hook_eval_error"],
        evidence: [],
        policy_hits: [],
        judge_used: false,
        deterministic: true,
        notes: [],
      }),
    );
    return 1;
  }
  const adapter = new OpenClawAdapter(buildCore());
  const decision = await routeHookEval(
    adapter,
    hook,
    payload as Record<string, unknown>,
    typeof sessionId === "string" ? sessionId : undefined,
  );
  process.stdout.write(JSON.stringify(decision));
  return 0;
}

async function main(): Promise<number> {
  const { command, flags } = parseArgv(process.argv.slice(2));

  if (command === "hook-eval") return cmdHookEval();
  if (command === "shell") {
    const result = await new GuardedShell(buildCore()).run(
      flagString(flags, "command"),
      flagString(flags, "session-id", "openclaw-bridge"),
      flagBool(flags, "execute"),
    );
    process.stdout.write(JSON.stringify(result));
    return exitWithDecision(result.decision);
  }
  if (command === "file-write") {
    const contentFile = flagString(flags, "content-file");
    const content = contentFile ? fs.readFileSync(contentFile, "utf8") : flagString(flags, "content");
    const result = await new GuardedFileWriter(buildCore()).write(
      flagString(flags, "path"),
      content,
      flagString(flags, "session-id", "openclaw-bridge"),
    );
    process.stdout.write(JSON.stringify(result));
    return exitWithDecision(result.decision);
  }
  if (command === "web-fetch") {
    const result = await new GuardedWebFetcher(buildCore()).fetch(
      flagString(flags, "url"),
      flagString(flags, "session-id", "openclaw-bridge"),
      flagBool(flags, "perform-fetch"),
    );
    process.stdout.write(JSON.stringify(result));
    return exitWithDecision(result.decision);
  }
  if (command === "tool-result") {
    const content = flagString(flags, "content");
    const contentFile = flagString(flags, "content-file");
    if (!content && !contentFile) throw new Error("Provide --content or --content-file");
    const payloadContent = contentFile ? fs.readFileSync(contentFile, "utf8") : content;
    const event = createEvent({
      event_type: "tool_result",
      risk_stage: "post_tool",
      summary: flagString(flags, "summary", `Tool result from ${flagString(flags, "source-name", "openclaw")}`),
      provenance: {
        source_type: flagString(flags, "source-type", "web"),
        source_name: flagString(flags, "source-name", "openclaw"),
        trust_level: flagString(flags, "trust-level", "low"),
      },
      payload: { content: { content: payloadContent } },
      tool_name: flagString(flags, "tool-name", "web_fetch"),
      session_id: flagString(flags, "session-id", "openclaw-bridge"),
    });
    const result = await buildCore().evaluate(event);
    const dict = result.decision.toDict();
    process.stdout.write(JSON.stringify(dict));
    return exitWithDecision(dict.action);
  }
  if (command === "incidents") {
    const settings = loadSettings(projectRootFromEnv());
    const incidents = new IncidentLogger(settings.incidentPath).readAll();
    process.stdout.write(`incidents=${incidents.length}\n`);
    for (const item of incidents.slice(-10)) {
      process.stdout.write(
        JSON.stringify({
          timestamp: item["timestamp"],
          summary: item["event_summary"],
          decision: (item["final_decision"] as Record<string, unknown>)?.["action"],
          why: item["why"],
        }) + "\n",
      );
    }
    return 0;
  }
  if (command === "policy-generate") {
    const settings = loadSettings(projectRootFromEnv());
    const incidents = new IncidentLogger(settings.incidentPath).readAll();
    const suspicious = incidents.filter((item) => Boolean((item["evolution"] as Record<string, unknown>)?.["should_review"]));
    const outputDir = path.join(settings.projectRoot, "policies", "local");
    fs.mkdirSync(outputDir, { recursive: true });
    if (!suspicious.length) {
      process.stdout.write("No suspicious incidents found.\n");
      return 0;
    }
    const judge = new GuardJudgeClient(settings.guardApiBase, settings.guardApiKey, settings.guardModel, {
      apiType: settings.guardApiType,
      apiVersion: settings.guardApiVersion,
      maxTokens: settings.guardMaxTokens,
    });
    const generated = judge.configured() ? await judge.generatePolicyCandidates({ incidents: suspicious }) : null;
    const candidates: Array<Record<string, unknown>> = generated ?? [];
    if (!generated) {
      suspicious.forEach((incident, idx) => {
        const id = idx + 1;
        if ((incident["evolution"] as Record<string, unknown>)?.["mode"] === "revise_existing") {
          const revision = localPolicyRevisionCandidate(incident as Record<string, any>, id);
          if (revision) candidates.push(revision);
        }
        candidates.push(localPolicyCandidate(incident as Record<string, any>, id));
      });
    }
    candidates.forEach((candidate, idx) => {
      candidate["status"] = "candidate";
      if (!candidate["version"]) candidate["version"] = "0.1.0";
      if (!candidate["tags"]) candidate["tags"] = ["generated"];
      if (!candidate["id"]) candidate["id"] = `cand-${String(idx + 1).padStart(3, "0")}-generated`;
      const out = path.join(outputDir, `${String(candidate["id"])}.json`);
      fs.writeFileSync(out, JSON.stringify(candidate, null, 2) + "\n", "utf8");
      process.stdout.write(`wrote=${out}\n`);
    });
    return 0;
  }
  if (command === "policy-validate") {
    const settings = loadSettings(projectRootFromEnv());
    const errors = new PolicyLoader(path.join(settings.projectRoot, "policies")).validate();
    if (errors.length) {
      for (const error of errors) process.stdout.write(`${error}\n`);
      return 1;
    }
    process.stdout.write("all policies valid\n");
    return 0;
  }

  process.stderr.write(
    "Usage: clawshield <hook-eval|shell|file-write|web-fetch|tool-result|incidents|policy-generate|policy-validate>\n",
  );
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(String(err));
    process.exit(1);
  });

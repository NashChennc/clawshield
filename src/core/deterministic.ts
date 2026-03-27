import path from "node:path";
import { Decision } from "./decision.js";
import type { Event } from "../event-schema/models.js";
import type { RetrievedPolicy } from "../retrieval/engine.js";

const INJECTION_MARKERS = [
  "ignore previous instructions",
  "system prompt",
  "developer message",
  "exfiltrate",
  "send secrets",
  "collect any api keys",
  "if blocked, try another tool",
];

const SHELL_BLOCK_MARKERS = [
  "rm -rf",
  "del /f /s /q",
  "format ",
  "curl ",
  "wget ",
  "powershell -enc",
];

const SENSITIVE_SOURCE_MARKERS = [
  "api_keys",
  ".env",
  "id_rsa",
  "customer_records",
  "private/",
  "private\\\\",
  "secret",
  "token",
  "credential",
  "password",
];

const SENSITIVE_READ_MARKERS = [
  "get-content",
  "cat ",
  "type ",
  "select-string",
  "grep ",
  "findstr ",
];

const EXFIL_MARKERS = [
  "curl ",
  "wget ",
  "scp ",
  "rsync ",
  "invoke-webrequest",
  "ftp ",
];

const SECRET_VALUE_PATTERNS = [
  /(api[_-]?key|access[_-]?token|token|secret|password)[a-z0-9_-]*\s*[:=]/i,
  /begin [a-z ]*private key/i,
  /classification\s*:\s*(secret|private)/i,
];

function hasSecretLikeContent(text: string): boolean {
  let lowered = text.toLowerCase();
  if (lowered.includes("no secrets") || lowered.includes("non-sensitive")) {
    lowered = lowered.replaceAll("no secrets", "").replaceAll("non-sensitive", "");
  }
  return SECRET_VALUE_PATTERNS.some((p) => p.test(lowered));
}

/** True if resolved target is runtimeDir or nested inside it. */
function isPathInsideRuntime(resolvedTarget: string, resolvedRuntime: string): boolean {
  const rel = path.relative(resolvedRuntime, resolvedTarget);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function inspectHardBarrier(
  event: Event,
  retrieved: RetrievedPolicy[],
  runtimeDir: string,
): Decision | null {
  if (event.event_type === "tool_result") {
    const contentText = String(JSON.stringify(event.payload.content)).toLowerCase();
    for (const marker of INJECTION_MARKERS) {
      if (contentText.includes(marker)) {
        return new Decision({
          action: "sanitize_then_allow",
          risk_score: 0.88,
          confidence: 0.95,
          rationale: "Detected likely indirect prompt injection in tool result.",
          risk_types: ["tool_result_injection"],
          evidence: [marker],
          policy_hits: retrieved.map((item) => item.policy.id),
          sanitized_payload: { content: "[sanitized remote content removed due to injection markers]" },
          notes: ["sanitized remote content"],
        });
      }
    }
  }

  if (event.event_type === "tool_call_attempt" && event.tool_name === "shell") {
    const command = String((event.payload.content as Record<string, unknown>)["command"] ?? "").toLowerCase();
    for (const marker of SHELL_BLOCK_MARKERS) {
      if (command.includes(marker)) {
        return new Decision({
          action: "block",
          risk_score: 0.98,
          confidence: 0.98,
          rationale: "Blocked shell command due to dangerous deterministic marker.",
          risk_types: ["dangerous_exec"],
          evidence: [marker],
          policy_hits: retrieved.map((item) => item.policy.id),
        });
      }
    }
    if (SENSITIVE_SOURCE_MARKERS.some((m) => command.includes(m))) {
      if (EXFIL_MARKERS.some((m) => command.includes(m))) {
        return new Decision({
          action: "block",
          risk_score: 0.97,
          confidence: 0.94,
          rationale:
            "Blocked shell command that appears to access sensitive data and transfer it externally.",
          risk_types: ["sensitive_data_exfiltration"],
          evidence: ["sensitive-source-and-exfil-marker"],
          policy_hits: retrieved.map((item) => item.policy.id),
        });
      }
      if (
        SENSITIVE_READ_MARKERS.some((m) => command.includes(m)) ||
        command.includes("copy ") ||
        command.includes("move ")
      ) {
        return new Decision({
          action: "require_confirm",
          risk_score: 0.8,
          confidence: 0.86,
          rationale: "Shell command appears to access privacy-sensitive local material.",
          risk_types: ["sensitive_data_access"],
          evidence: ["sensitive-source-marker"],
          policy_hits: retrieved.map((item) => item.policy.id),
        });
      }
    }
    if (command.includes("export") || command.includes("copy")) {
      return new Decision({
        action: "require_confirm",
        risk_score: 0.72,
        confidence: 0.75,
        rationale: "Shell action may move or export data and should be confirmed.",
        risk_types: ["intent_action_mismatch"],
        evidence: ["export-or-copy"],
        policy_hits: retrieved.map((item) => item.policy.id),
      });
    }
  }

  if (event.event_type === "tool_call_attempt" && event.tool_name === "file_write") {
    const c = event.payload.content as Record<string, unknown>;
    const target = String(c["path"] ?? "");
    const normalized = path.resolve(target);
    const runtimeResolved = path.resolve(runtimeDir);
    if (path.isAbsolute(target) && !isPathInsideRuntime(normalized, runtimeResolved) && normalized !== runtimeResolved) {
      return new Decision({
        action: "block",
        risk_score: 0.94,
        confidence: 0.96,
        rationale: "Blocked absolute file write outside the isolated runtime directory.",
        risk_types: ["unsafe_file_write"],
        evidence: [target],
        policy_hits: retrieved.map((item) => item.policy.id),
      });
    }
    const text = String(c["content"] ?? "");
    if (hasSecretLikeContent(text)) {
      return new Decision({
        action: "require_confirm",
        risk_score: 0.76,
        confidence: 0.83,
        rationale: "File content appears to include sensitive material.",
        risk_types: ["possible_secret_write"],
        evidence: ["secret-like-content"],
        policy_hits: retrieved.map((item) => item.policy.id),
      });
    }
  }

  if (event.event_type === "tool_call_attempt" && event.tool_name === "web_fetch") {
    const url = String((event.payload.content as Record<string, unknown>)["url"] ?? "").toLowerCase();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return new Decision({
        action: "block",
        risk_score: 0.9,
        confidence: 0.94,
        rationale: "Blocked non-http remote ingest target.",
        risk_types: ["untrusted_remote_ingest"],
        evidence: [url],
        policy_hits: retrieved.map((item) => item.policy.id),
      });
    }
  }

  return null;
}

export function inspectFallbackHeuristics(event: Event, retrieved: RetrievedPolicy[]): Decision | null {
  if (event.event_type === "memory_update" || event.event_type === "prompt_build_context") {
    const contentText = String(JSON.stringify(event.payload.content)).toLowerCase();
    for (const marker of INJECTION_MARKERS) {
      if (contentText.includes(marker)) {
        return new Decision({
          action: "require_confirm",
          risk_score: 0.9,
          confidence: 0.92,
          rationale: "Suspicious content appears to be entering memory or prompt-building context.",
          risk_types: ["memory_or_context_poisoning"],
          evidence: [marker],
          policy_hits: retrieved.map((item) => item.policy.id),
          notes: ["review memory update or prompt context before reuse"],
        });
      }
    }
  }
  if (event.event_type === "user_request") {
    const summary = `${event.summary.toLowerCase()} ${String(JSON.stringify(event.payload.content)).toLowerCase()}`;
    if (EXFIL_MARKERS.some((m) => summary.includes(m)) && SENSITIVE_SOURCE_MARKERS.some((m) => summary.includes(m))) {
      return new Decision({
        action: "require_confirm",
        risk_score: 0.78,
        confidence: 0.8,
        rationale: "User request appears to combine sensitive local data with transfer or export intent.",
        risk_types: ["sensitive_intent_request"],
        evidence: ["sensitive-source-and-transfer-intent"],
        policy_hits: retrieved.map((item) => item.policy.id),
      });
    }
  }
  return null;
}

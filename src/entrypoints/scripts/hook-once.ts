import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OpenClawAdapter, routeHookEval } from "../../adapters/openclaw/adapter.js";
import { buildSafetyCore } from "../../core/engine/factory.js";
import { loadSettings } from "../../infrastructure/config/settings.js";
import { getPackageRoot } from "../../shared/utils/package-root.js";

const MAX_STDIN_BYTES = 8 * 1024 * 1024;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 100_000;
const ALLOWED_HOOKS = new Set(["before_prompt_build", "before_tool_call", "after_tool_call", "tool_result_persist"]);
const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

type JsonLike = null | boolean | number | string | JsonLike[] | { [k: string]: JsonLike };

function failDecision(rationale: string, riskTypes: string[] = ["hook_eval_error"]): Record<string, unknown> {
  return {
    action: "block",
    risk_score: 1,
    confidence: 1,
    rationale,
    risk_types: riskTypes,
    evidence: [],
    policy_hits: [],
    judge_used: false,
    deterministic: true,
    notes: [],
  };
}

function emptyStdinDecision(): Record<string, unknown> {
  return {
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
  };
}

function isJsonLike(value: unknown, depth = 0, state = { nodes: 0 }): value is JsonLike {
  if (depth > MAX_JSON_DEPTH) return false;
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES) return false;
  if (value === null) return true;
  const t = typeof value;
  if (t === "string" || t === "boolean") return true;
  if (t === "number") return Number.isFinite(value as number);
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!isJsonLike(entry, depth + 1, state)) return false;
    }
    return true;
  }
  if (t !== "object") return false;
  const rec = value as Record<string, unknown>;
  for (const [k, v] of Object.entries(rec)) {
    if (BLOCKED_KEYS.has(k)) return false;
    if (!isJsonLike(v, depth + 1, state)) return false;
  }
  return true;
}

async function main(): Promise<number> {
  const raw = fs.readFileSync(0, "utf8");
  if (!raw.trim()) {
    process.stdout.write(JSON.stringify(emptyStdinDecision()));
    return 0;
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_STDIN_BYTES) {
    process.stdout.write(JSON.stringify(failDecision(`hook-eval input exceeds ${MAX_STDIN_BYTES} bytes`)));
    return 1;
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch (e) {
    process.stdout.write(JSON.stringify(failDecision(`hook-eval invalid json: ${e}`)));
    return 1;
  }
  const hook = data["hook"];
  const payload = data["payload"];
  const sessionId = data["session_id"];
  if (typeof hook !== "string" || !ALLOWED_HOOKS.has(hook)) {
    process.stdout.write(JSON.stringify(failDecision("hook-eval requires an allowed hook name")));
    return 1;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    process.stdout.write(JSON.stringify(failDecision("hook-eval requires string hook and object payload")));
    return 1;
  }
  if (!isJsonLike(payload)) {
    process.stdout.write(JSON.stringify(failDecision("hook-eval payload must be JSON-safe data only")));
    return 1;
  }
  if (sessionId !== undefined && (typeof sessionId !== "string" || Buffer.byteLength(sessionId, "utf8") > 512)) {
    process.stdout.write(JSON.stringify(failDecision("hook-eval session_id must be a short string")));
    return 1;
  }
  const root = process.env["CLAWSHIELD_PROJECT_ROOT"]
    ? path.resolve(process.env["CLAWSHIELD_PROJECT_ROOT"])
    : getPackageRoot();
  const settings = loadSettings(root);
  const core = buildSafetyCore(settings);
  const adapter = new OpenClawAdapter(core);
  const decision = await routeHookEval(
    adapter,
    hook,
    payload as Record<string, unknown>,
    typeof sessionId === "string" ? sessionId : undefined,
  );
  process.stdout.write(JSON.stringify(decision));
  return 0;
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]!) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      process.stderr.write(String(e));
      process.exit(1);
    });
}

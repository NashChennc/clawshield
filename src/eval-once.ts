import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OpenClawAdapter, routeHookEval } from "./adapter/openclaw.js";
import { buildSafetyCore } from "./core/factory.js";
import { loadSettings } from "./config/settings.js";
import { getPackageRoot } from "./lib/package-root.js";

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

async function main(): Promise<number> {
  const raw = fs.readFileSync(0, "utf8");
  if (!raw.trim()) {
    process.stdout.write(JSON.stringify(emptyStdinDecision()));
    return 0;
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
  if (typeof hook !== "string" || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    process.stdout.write(JSON.stringify(failDecision("hook-eval requires string hook and object payload")));
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

const isMain =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]!) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      process.stderr.write(String(e));
      process.exit(1);
    });
}

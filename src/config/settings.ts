import fs from "node:fs";
import path from "node:path";
import { getPackageRoot } from "../lib/package-root.js";

export type Settings = {
  projectRoot: string;
  policyDir: string;
  incidentPath: string;
  runtimeDir: string;
  guardApiType: string | undefined;
  guardApiBase: string | undefined;
  guardApiKey: string | undefined;
  guardModel: string | undefined;
  guardApiVersion: string | undefined;
  guardMaxTokens: number;
};

function loadDotenv(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const stripped = line.trim();
    if (!stripped || stripped.startsWith("#") || !stripped.includes("=")) continue;
    const idx = stripped.indexOf("=");
    const key = stripped.slice(0, idx).trim();
    const value = stripped.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function loadSettings(projectRoot?: string): Settings {
  const root = projectRoot ?? getPackageRoot();
  loadDotenv(path.join(root, ".env"));
  const policyDir = path.resolve(root, process.env["CLAWSHIELD_POLICY_DIR"] ?? "policies/base");
  const incidentPath = path.resolve(root, process.env["CLAWSHIELD_INCIDENT_PATH"] ?? "data/incidents/incidents.jsonl");
  const runtimeDir = path.resolve(root, process.env["CLAWSHIELD_RUNTIME_DIR"] ?? "data/runtime");
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(path.dirname(incidentPath), { recursive: true });
  return {
    projectRoot: root,
    policyDir,
    incidentPath,
    runtimeDir,
    guardApiType: process.env["GUARD_API_TYPE"] ?? "openai",
    guardApiBase: process.env["GUARD_API_BASE"],
    guardApiKey: process.env["GUARD_API_KEY"],
    guardModel: process.env["GUARD_MODEL"],
    guardApiVersion: process.env["GUARD_API_VERSION"] ?? "2023-06-01",
    guardMaxTokens: Number(process.env["GUARD_MAX_TOKENS"] ?? "1000"),
  };
}

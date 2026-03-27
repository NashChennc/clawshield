import { loadSettings, type Settings } from "../../infrastructure/config/settings.js";
import { IncidentLogger } from "../../infrastructure/logger/incidents.js";
import { GuardJudgeClient } from "../../adapters/llm-judge/client.js";
import { PolicyLoader } from "../policy/loader.js";
import { SafetyCore } from "./safety-core.js";

export function buildSafetyCore(settings: Settings): SafetyCore {
  return new SafetyCore(
    new PolicyLoader(settings.policyDir),
    new IncidentLogger(settings.incidentPath),
    new GuardJudgeClient(settings.guardApiBase, settings.guardApiKey, settings.guardModel, {
      apiType: settings.guardApiType,
      apiVersion: settings.guardApiVersion,
      maxTokens: settings.guardMaxTokens,
    }),
    settings.runtimeDir,
  );
}

let singleton: SafetyCore | null = null;

export function getOrCreateSafetyCore(): SafetyCore {
  if (!singleton) {
    singleton = buildSafetyCore(loadSettings());
  }
  return singleton;
}

export function resetSafetyCoreForTests(): void {
  singleton = null;
}

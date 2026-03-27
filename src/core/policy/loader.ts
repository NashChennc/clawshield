import fs from "node:fs";
import path from "node:path";
import { policyFromDict, validatePolicyDocument, type Policy } from "./schema.js";

export class PolicyLoader {
  constructor(private readonly policyDir: string) {}

  load(): Policy[] {
    const policies: Policy[] = [];
    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (ent.isFile() && ent.name.endsWith(".json")) {
          const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
          if (raw.candidate_type === "policy_revision") continue;
          policies.push(policyFromDict(raw));
        }
      }
    };
    if (fs.existsSync(this.policyDir)) walk(this.policyDir);
    return policies.sort((a, b) => a.id.localeCompare(b.id));
  }

  validate(): string[] {
    const errors: string[] = [];
    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (ent.isFile() && ent.name.endsWith(".json")) {
          try {
            validatePolicyDocument(JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>);
          } catch (e) {
            errors.push(`${ent.name}: ${e}`);
          }
        }
      }
    };
    if (fs.existsSync(this.policyDir)) walk(this.policyDir);
    return errors;
  }
}

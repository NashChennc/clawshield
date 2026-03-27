import fs from "node:fs";
import path from "node:path";
import { policyFromDict, validatePolicyDocument, type Policy } from "./schema.js";

export class PolicyLoader {
  constructor(private readonly policyDir: string) {}

  private getPolicyFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];

    const files: string[] = [];
    const walk = (currentDir: string) => {
      for (const ent of fs.readdirSync(currentDir, { withFileTypes: true })) {
        const p = path.join(currentDir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (ent.isFile() && ent.name.endsWith(".json")) files.push(p);
      }
    };

    walk(dir);
    return files;
  }

  load(): Policy[] {
    const policies: Policy[] = [];
    for (const p of this.getPolicyFiles(this.policyDir)) {
      try {
        const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
        if (raw.candidate_type === "policy_revision") continue;
        policies.push(policyFromDict(raw));
      } catch (e) {
        console.error(`Failed to load policy file "${p}":`, e);
      }
    }
    return policies.sort((a, b) => a.id.localeCompare(b.id));
  }

  validate(): string[] {
    const errors: string[] = [];
    for (const p of this.getPolicyFiles(this.policyDir)) {
      try {
        validatePolicyDocument(JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>);
      } catch (e) {
        errors.push(`${path.basename(p)}: ${e}`);
      }
    }
    return errors;
  }
}

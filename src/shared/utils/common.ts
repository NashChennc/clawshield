import { randomBytes } from "node:crypto";

export function utcNow(): string {
  return new Date().toISOString();
}

export function genId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

export function ensureJsonable(data: unknown): unknown {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      out[String(k)] = ensureJsonable(v);
    }
    return out;
  }
  if (Array.isArray(data)) {
    return data.map(ensureJsonable);
  }
  return data;
}

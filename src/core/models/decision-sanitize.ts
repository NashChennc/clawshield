import { z } from "zod";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const MAX_DEPTH = 8;
const MAX_NODES = 2_000;
const MAX_KEYS_PER_OBJECT = 200;
const MAX_STRING_LENGTH = 16_000;
const SAFE_KEY_REGEX = /^[A-Za-z0-9_.:-]{1,64}$/;
const BLOCKED_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const INVALID_PERSIST_PLACEHOLDER = "[ClawShield] sanitized payload removed (invalid shape)";

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string().max(MAX_STRING_LENGTH),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string().regex(SAFE_KEY_REGEX), JsonValueSchema),
  ]),
);

const SanitizedPayloadSchema = z.record(z.string().regex(SAFE_KEY_REGEX), JsonValueSchema);

function isSafeKey(key: string): boolean {
  return SAFE_KEY_REGEX.test(key) && !BLOCKED_KEYS.has(key);
}

function checkBounds(value: JsonValue): boolean {
  let nodes = 0;
  const stack: Array<{ value: JsonValue; depth: number }> = [{ value, depth: 1 }];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    nodes += 1;
    if (nodes > MAX_NODES || current.depth > MAX_DEPTH) {
      return false;
    }
    const v = current.value;
    if (typeof v === "string" && v.length > MAX_STRING_LENGTH) {
      return false;
    }
    if (Array.isArray(v)) {
      for (const child of v) {
        stack.push({ value: child, depth: current.depth + 1 });
      }
      continue;
    }
    if (v && typeof v === "object") {
      const entries = Object.entries(v);
      if (entries.length > MAX_KEYS_PER_OBJECT) {
        return false;
      }
      for (const [key, child] of entries) {
        if (!isSafeKey(key)) {
          return false;
        }
        stack.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
  return true;
}

export function isSafeSanitizedPayload(payload: unknown): payload is Record<string, unknown> {
  const parsed = SanitizedPayloadSchema.safeParse(payload);
  if (!parsed.success) return false;
  return checkBounds(parsed.data);
}

export function parseSanitizedPayloadForParams(payload: unknown): Record<string, unknown> | null {
  if (!isSafeSanitizedPayload(payload)) return null;
  return payload as Record<string, unknown>;
}

export function stringifySanitizedPayloadForPersist(payload: unknown): string {
  if (!isSafeSanitizedPayload(payload)) {
    return INVALID_PERSIST_PLACEHOLDER;
  }
  const p = payload as Record<string, unknown>;
  const content = p["content"];
  if (typeof content === "string") {
    return content;
  }
  try {
    return JSON.stringify(p);
  } catch {
    return INVALID_PERSIST_PLACEHOLDER;
  }
}

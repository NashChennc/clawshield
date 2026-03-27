import { createHash } from "node:crypto";

export function stableSessionId(sessionKey: string | undefined, sessionId: string | undefined): string {
  const raw = sessionKey ?? sessionId ?? "openclaw-plugin";
  if (raw.length <= 128) return raw;
  return createHash("sha256").update(raw).digest("hex");
}

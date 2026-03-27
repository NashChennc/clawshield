/**
 * Map common OpenClaw tool ids to ClawShield deterministic tool_name buckets.
 * Mirrors clawshieldpy `bridge.openclaw._normalize_openclaw_tool_name`.
 */
export function normalizeOpenclawToolName(toolName: string): string {
  const key = toolName.trim().toLowerCase();
  const aliases: Record<string, string> = {
    run_terminal_cmd: "shell",
    "run-terminal-cmd": "shell",
    terminal_command: "shell",
    bash: "shell",
    exec: "shell",
    shell_command: "shell",
    write: "file_write",
    file_write: "file_write",
    apply_patch: "file_write",
    web_fetch: "web_fetch",
    fetch: "web_fetch",
  };
  return aliases[key] ?? toolName;
}

export function coerceHookEvalParams(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

import { createEvent } from "../../core/models/event.js";
import type { SafetyCore } from "../../core/engine/safety-core.js";
import { spawnSync } from "node:child_process";

export type ShellResult = {
  decision: string;
  stdout?: string;
  stderr?: string;
  returncode?: number | null;
};

export class GuardedShell {
  constructor(private readonly core: SafetyCore) {}

  async run(command: string, sessionId = "local-demo", execute = false): Promise<ShellResult> {
    const event = createEvent({
      event_type: "tool_call_attempt",
      risk_stage: "pre_tool",
      summary: `Shell execution attempt: ${command.slice(0, 80)}`,
      provenance: {
        source_type: "wrapper",
        source_name: "guarded_shell",
        trust_level: "high",
      },
      payload: { content: { command }, raw_payload: { command } },
      tool_name: "shell",
      session_id: sessionId,
    });
    const result = await this.core.evaluate(event);
    if (result.decision.action !== "allow") {
      return { decision: result.decision.action, stderr: result.decision.rationale };
    }
    if (!execute) {
      return { decision: "allow" };
    }
    const completed = spawnSync(command, { shell: true, encoding: "utf8" });
    return {
      decision: "allow",
      stdout: completed.stdout ?? "",
      stderr: completed.stderr ?? "",
      returncode: completed.status,
    };
  }
}

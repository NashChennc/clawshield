import fs from "node:fs";
import path from "node:path";
import { createEvent } from "../event-schema/models.js";
import type { SafetyCore } from "../core/engine.js";

export type FileWriteResult = {
  decision: string;
  path: string;
  written: boolean;
  message: string;
};

export class GuardedFileWriter {
  constructor(private readonly core: SafetyCore) {}

  async write(pathStr: string, content: string, sessionId = "local-demo"): Promise<FileWriteResult> {
    const event = createEvent({
      event_type: "tool_call_attempt",
      risk_stage: "pre_tool",
      summary: `File write attempt: ${pathStr}`,
      provenance: {
        source_type: "wrapper",
        source_name: "guarded_file_write",
        trust_level: "high",
      },
      payload: {
        content: { path: pathStr, content: content.slice(0, 500) },
        raw_payload: { path: pathStr, content: content.slice(0, 500) },
      },
      tool_name: "file_write",
      session_id: sessionId,
    });
    const result = await this.core.evaluate(event);
    if (result.decision.action !== "allow") {
      return { decision: result.decision.action, path: pathStr, written: false, message: result.decision.rationale };
    }
    const target = pathStr;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
    return { decision: "allow", path: pathStr, written: true, message: "content written" };
  }
}

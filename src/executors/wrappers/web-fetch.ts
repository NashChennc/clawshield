import { createEvent } from "../../core/models/event.js";
import type { SafetyCore } from "../../core/engine/safety-core.js";

export type WebFetchResult = {
  decision: string;
  content: string;
  message: string;
};

export class GuardedWebFetcher {
  constructor(private readonly core: SafetyCore) {}

  async fetch(url: string, sessionId = "local-demo", performFetch = false): Promise<WebFetchResult> {
    const event = createEvent({
      event_type: "tool_call_attempt",
      risk_stage: "pre_tool",
      summary: `Web fetch attempt: ${url}`,
      provenance: {
        source_type: "wrapper",
        source_name: "guarded_web_fetch",
        trust_level: "medium",
      },
      payload: { content: { url }, raw_payload: { url } },
      tool_name: "web_fetch",
      session_id: sessionId,
    });
    const result = await this.core.evaluate(event);
    if (result.decision.action !== "allow" || !performFetch) {
      return { decision: result.decision.action, content: "", message: result.decision.rationale };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      const text = await response.text();
      return { decision: "allow", content: text.slice(0, 4096), message: "fetched" };
    } catch (e) {
      return { decision: "warn", content: "", message: `fetch failed: ${String(e)}` };
    } finally {
      clearTimeout(timer);
    }
  }
}

import fs from "node:fs";
import path from "node:path";

export type SessionState = {
  session_id: string;
  recent_events: Array<Record<string, unknown>>;
  risk_flags: string[];
  counters: Record<string, number>;
};

function safeSessionFileName(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, "_") + ".json";
}

export class SessionStateStore {
  private readonly baseDir: string;
  private readonly writable: boolean;

  constructor(runtimeDir: string) {
    this.baseDir = path.join(runtimeDir, "session_state");
    try {
      fs.mkdirSync(this.baseDir, { recursive: true });
      this.writable = true;
    } catch (err) {
      this.writable = false;
      console.warn("[SessionStateStore] failed to prepare state directory, running in degraded mode.", err);
    }
  }

  private path(sessionId: string): string {
    return path.join(this.baseDir, safeSessionFileName(sessionId));
  }

  load(sessionId: string): SessionState {
    const fallback = { session_id: sessionId, recent_events: [], risk_flags: [], counters: {} };
    const p = this.path(sessionId);
    try {
      if (!fs.existsSync(p)) {
        return fallback;
      }
      const data = JSON.parse(fs.readFileSync(p, "utf8")) as SessionState;
      return {
        session_id: data.session_id ?? sessionId,
        recent_events: Array.isArray(data.recent_events) ? data.recent_events : [],
        risk_flags: Array.isArray(data.risk_flags) ? data.risk_flags : [],
        counters: typeof data.counters === "object" && data.counters ? data.counters : {},
      };
    } catch (err) {
      console.warn("[SessionStateStore] failed to load state, returning default state.", err);
      return fallback;
    }
  }

  save(state: SessionState): void {
    if (!this.writable) return;
    try {
      fs.writeFileSync(this.path(state.session_id), JSON.stringify(state, null, 2) + "\n", "utf8");
    } catch (err) {
      console.warn("[SessionStateStore] failed to persist state update.", err);
    }
  }

  update(sessionId: string, event: Record<string, unknown>, decision: Record<string, unknown>): SessionState {
    const state = this.load(sessionId);
    state.recent_events.push({
      event_type: event.event_type,
      risk_stage: event.risk_stage,
      summary: event.summary,
      tool_name: event.tool_name,
      decision: decision.action,
      risk_types: decision.risk_types ?? [],
    });
    state.recent_events = state.recent_events.slice(-8);
    const riskTypes = (decision.risk_types as string[]) ?? [];
    for (const rt of riskTypes) {
      if (!state.risk_flags.includes(rt)) state.risk_flags.push(rt);
      state.counters[rt] = (state.counters[rt] ?? 0) + 1;
    }
    state.risk_flags = state.risk_flags.slice(-12);
    this.save(state);
    return state;
  }

  toDict(sessionId: string): Record<string, unknown> {
    const s = this.load(sessionId);
    return {
      session_id: s.session_id,
      recent_events: s.recent_events,
      risk_flags: s.risk_flags,
      counters: s.counters,
    };
  }
}

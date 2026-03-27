import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { SessionStateStore } from "../../src/infrastructure/state/session-state.js";

describe("SessionStateStore", () => {
  it("keeps only latest recent events under frequent updates", () => {
    const tmp = fs.mkdtempSync(path.join(tmpdir(), "clawshield-session-"));
    const store = new SessionStateStore(tmp);
    for (let i = 0; i < 20; i++) {
      store.update(
        "session-a",
        { event_type: "evt", risk_stage: "x", summary: `s-${i}`, tool_name: "shell" },
        { action: "allow", risk_types: ["rt"] },
      );
    }
    const state = store.load("session-a");
    expect(state.recent_events).toHaveLength(8);
    expect(state.counters["rt"]).toBe(20);
  });

  it("degrades gracefully when write fails", () => {
    const tmp = fs.mkdtempSync(path.join(tmpdir(), "clawshield-session-"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("ENOSPC");
    });
    try {
      const store = new SessionStateStore(tmp);
      expect(() =>
        store.update("session-b", { event_type: "evt", risk_stage: "x", summary: "s", tool_name: "shell" }, { action: "allow" }),
      ).not.toThrow();
      const state = store.load("session-b");
      expect(state.session_id).toBe("session-b");
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      writeSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("returns default state when reading corrupted file", () => {
    const tmp = fs.mkdtempSync(path.join(tmpdir(), "clawshield-session-"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dir = path.join(tmp, "session_state");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "session-c.json"), "{broken", "utf8");
    try {
      const store = new SessionStateStore(tmp);
      const state = store.load("session-c");
      expect(state.session_id).toBe("session-c");
      expect(state.recent_events).toEqual([]);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

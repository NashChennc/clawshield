import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { Decision } from "../../src/core/models/decision.js";
import { createEvent } from "../../src/core/models/event.js";
import { IncidentLogger } from "../../src/infrastructure/logger/incidents.js";

function makeDecision(): Decision {
  return new Decision({
    action: "allow",
    risk_score: 0.1,
    confidence: 0.9,
    rationale: "test",
  });
}

function makeEvent(summary = "normal event") {
  return createEvent({
    event_type: "user_request",
    risk_stage: "pre_tool",
    summary,
    provenance: { source_type: "user", source_name: "test" },
    payload: { content: { prompt: summary }, raw_payload: null },
  });
}

describe("IncidentLogger", () => {
  it("writes compact jsonl one record per line", () => {
    const tmp = fs.mkdtempSync(path.join(tmpdir(), "clawshield-incident-"));
    const incidentPath = path.join(tmp, "incidents.jsonl");
    const logger = new IncidentLogger(incidentPath);

    logger.log(makeEvent("first"), makeDecision(), []);
    logger.log(makeEvent("second"), makeDecision(), []);

    const text = fs.readFileSync(incidentPath, "utf8");
    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]?.startsWith("{")).toBe(true);
    expect(lines[0]?.includes("\n")).toBe(false);
    expect(lines[1]?.includes("\n")).toBe(false);
  });

  it("truncates oversized payload and warns", () => {
    const tmp = fs.mkdtempSync(path.join(tmpdir(), "clawshield-incident-"));
    const incidentPath = path.join(tmp, "incidents.jsonl");
    const logger = new IncidentLogger(incidentPath);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const giant = "a".repeat(10 * 1024 * 1024);
    try {
      const record = logger.log(makeEvent(giant), makeDecision(), []);
      expect(record["truncated"]).toBe(true);
      const truncation = record["truncation"] as Record<string, unknown>;
      expect((truncation["dropped_chars"] as number) > 0).toBe(true);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("degrades gracefully when append fails", () => {
    const tmp = fs.mkdtempSync(path.join(tmpdir(), "clawshield-incident-"));
    const incidentPath = path.join(tmp, "incidents.jsonl");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const appendSpy = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {
      throw new Error("EACCES");
    });
    try {
      const logger = new IncidentLogger(incidentPath);
      const record = logger.log(makeEvent("io fail"), makeDecision(), []);
      expect(record["persisted"]).toBe(false);
      expect(record["persist_error"]).toBe("append_failed");
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      appendSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("readAll skips malformed lines and survives read errors", () => {
    const tmp = fs.mkdtempSync(path.join(tmpdir(), "clawshield-incident-"));
    const incidentPath = path.join(tmp, "incidents.jsonl");
    fs.writeFileSync(incidentPath, '{"ok":1}\n{broken\n{"ok":2}\n', "utf8");
    const logger = new IncidentLogger(incidentPath);
    const records = logger.readAll();
    expect(records).toHaveLength(2);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const readSpy = vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("EIO");
    });
    try {
      expect(logger.readAll()).toEqual([]);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      readSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});

import { genId, utcNow } from "../../shared/utils/common.js";

export type Provenance = {
  source_type: string;
  source_name: string;
  trust_level?: string;
  raw_ref?: string | null;
  metadata?: Record<string, unknown>;
};

export type EventPayload = {
  content: Record<string, unknown>;
  raw_payload?: Record<string, unknown> | null;
};

export type Event = {
  event_type: string;
  risk_stage: string;
  summary: string;
  provenance: Provenance;
  payload: EventPayload;
  session_id?: string | null;
  run_id?: string | null;
  tool_name?: string | null;
  event_id?: string;
  timestamp?: string;
  tags?: string[];
};

export function createEvent(partial: {
  event_type: string;
  risk_stage: string;
  summary: string;
  provenance: Provenance;
  payload?: EventPayload;
  session_id?: string | null;
  run_id?: string | null;
  tool_name?: string | null;
  event_id?: string;
  timestamp?: string;
  tags?: string[];
}): Event {
  return {
    event_type: partial.event_type,
    risk_stage: partial.risk_stage,
    summary: partial.summary,
    provenance: partial.provenance,
    payload: partial.payload ?? { content: {}, raw_payload: null },
    session_id: partial.session_id,
    run_id: partial.run_id,
    tool_name: partial.tool_name,
    event_id: partial.event_id ?? genId("evt"),
    timestamp: partial.timestamp ?? utcNow(),
    tags: partial.tags ?? [],
  };
}

export function eventToDict(ev: Event): Record<string, unknown> {
  return JSON.parse(JSON.stringify(ev)) as Record<string, unknown>;
}

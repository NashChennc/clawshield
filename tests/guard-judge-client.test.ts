import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./setup.js";
import { GuardJudgeClient } from "../src/adapters/llm-judge/client.js";

const base = "https://api.example.com/v1";

function createClient(): GuardJudgeClient {
  return new GuardJudgeClient(base, "test-key", "test-model");
}

describe("GuardJudgeClient network failures", () => {
  it.each([500, 429, 502, 503])("returns null on http %i", async (status) => {
    server.use(http.post(`${base}/chat/completions`, () => new HttpResponse(null, { status })));
    const client = createClient();
    const result = await client.judge({ event: {} });
    expect(result).toBeNull();
  });

  it("returns null when fetch throws network error", async () => {
    server.use(
      http.post(`${base}/chat/completions`, () => {
        throw new TypeError("network timeout");
      }),
    );
    const client = createClient();
    const result = await client.judge({ event: {} });
    expect(result).toBeNull();
  });
});

describe("GuardJudgeClient malformed model output", () => {
  it("returns null when response body is not json", async () => {
    server.use(http.post(`${base}/chat/completions`, () => HttpResponse.text("not-json-body")));
    const client = createClient();
    const result = await client.judge({ event: {} });
    expect(result).toBeNull();
  });

  it("returns null when message content is not valid json", async () => {
    server.use(
      http.post(`${base}/chat/completions`, () =>
        HttpResponse.json({
          choices: [{ message: { content: "{broken json" } }],
        }),
      ),
    );
    const client = createClient();
    const result = await client.judge({ event: {} });
    expect(result).toBeNull();
  });

  it("returns null when decision payload misses required fields", async () => {
    server.use(
      http.post(`${base}/chat/completions`, () =>
        HttpResponse.json({
          choices: [{ message: { content: JSON.stringify({ decision: "allow" }) } }],
        }),
      ),
    );
    const client = createClient();
    const result = await client.judge({ event: {} });
    expect(result).toBeNull();
  });
});

describe("GuardJudgeClient generatePolicyCandidates failures", () => {
  it("returns null when top-level policies is missing", async () => {
    server.use(
      http.post(`${base}/chat/completions`, () =>
        HttpResponse.json({
          choices: [{ message: { content: JSON.stringify({ foo: [] }) } }],
        }),
      ),
    );
    const client = createClient();
    const result = await client.generatePolicyCandidates({ incidents: [] });
    expect(result).toBeNull();
  });

  it("returns null when policies is not an array", async () => {
    server.use(
      http.post(`${base}/chat/completions`, () =>
        HttpResponse.json({
          choices: [{ message: { content: JSON.stringify({ policies: { id: "x" } }) } }],
        }),
      ),
    );
    const client = createClient();
    const result = await client.generatePolicyCandidates({ incidents: [] });
    expect(result).toBeNull();
  });

  it("returns null when body cannot be parsed as json", async () => {
    server.use(http.post(`${base}/chat/completions`, () => HttpResponse.text("html error page")));
    const client = createClient();
    const result = await client.generatePolicyCandidates({ incidents: [] });
    expect(result).toBeNull();
  });

  it("returns null when message content is invalid json", async () => {
    server.use(
      http.post(`${base}/chat/completions`, () =>
        HttpResponse.json({
          choices: [{ message: { content: "not-json" } }],
        }),
      ),
    );
    const client = createClient();
    const result = await client.generatePolicyCandidates({ incidents: [] });
    expect(result).toBeNull();
  });
});

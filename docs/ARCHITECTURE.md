# Architecture & Security Guarantees

## Architecture Outline

- **Core Engine**: TypeScript `SafetyCore` evaluates hook payloads against policy and guard signals.
- **Hook Integration**: OpenClaw lifecycle hooks route data into the evaluator with hook-specific handling.
- **Sync Bridge**: `tool_result_persist` uses a one-shot subprocess to preserve synchronous contract.
- **State & Logging**: Runtime/session state and incidents are persisted through infrastructure services.

## Runtime Components

- **Plugin entry**: `src/entrypoints/plugin/index.ts` registers lifecycle hooks and delegates to the OpenClaw adapter.
- **OpenClaw adapter**: `src/adapters/openclaw/adapter.ts` maps hook payloads to internal event models and routes decisions back.
- **SafetyCore**: `src/core/engine/safety-core.ts` is the evaluation orchestrator; `src/core/engine/factory.ts` wires policies, judge, and storage services.
- **Policy subsystem**: `src/core/policy/loader.ts`, `src/core/policy/retriever.ts`, `src/core/policy/schema.ts`.
- **Deterministic fences**: `src/core/evaluation/deterministic.ts` applies hard rules before/alongside model-based guard judgment.
- **Guard client**: `src/adapters/llm-judge/client.ts` performs optional online risk judgment.
- **Persistence**: incidents in `src/infrastructure/logger/incidents.ts`, session state in `src/infrastructure/state/session-state.ts`.

## Hook Workflow

1. **`before_tool_call` / `after_tool_call`**
   - Runs in the same Node process through `await SafetyCore.evaluate`.
   - `before_tool_call` can sanitize, replace, require confirm, or block parameters.
2. **`tool_result_persist`**
   - Runs as a synchronous hook.
   - Uses `spawnSync` to invoke `dist/entrypoints/scripts/hook-once.js`.
   - Sends `{ hook, payload, session_id }` through stdin and receives decision JSON on stdout.
3. **`before_prompt_build`**
   - Optional context-risk evaluation and incident logging.
   - Does not inject additional prompt instructions.

## Execution Flow (Detailed)

1. Hook enters plugin entry (`src/entrypoints/plugin/index.ts`).
2. Payload normalization and tool argument shaping run in:
   - `src/adapters/openclaw/normalize.ts`
   - `src/adapters/openclaw/tool-params.ts`
3. Adapter builds internal evaluation event (`src/core/models/event.ts`) and invokes `SafetyCore`.
4. `SafetyCore` retrieves policy and evaluates:
   - deterministic rules (`src/core/evaluation/deterministic.ts`)
   - optional judge result (`src/adapters/llm-judge/client.ts`)
5. Final decision model is produced (`src/core/models/decision.ts`, `src/core/models/decision-sanitize.ts`).
6. Infrastructure layer persists state and incidents.
7. Adapter converts decision back to hook-compatible return payload.

## Decision Semantics

- `allow`: continue execution.
- `block`: deny execution.
- `require_confirm`: treated as block by the gateway path.
- `sanitize_then_allow`: merge `sanitized_payload` and continue.

## Synchronous Persist Path (`tool_result_persist`)

- Entry script: `src/entrypoints/scripts/hook-once.ts`
- Caller script: `src/entrypoints/scripts/persist-eval.ts`
- Result interception: `src/executors/interceptors/tool-result.ts`
- Guarantees:
  - Parent process sends JSON request over stdin.
  - Child process returns JSON decision over stdout.
  - No JS source text from tool output is executed.

## Security Guarantees for `hook-once`

- **No Code Execution**: `hook-once` is a routing/evaluation subprocess, not a string code evaluator.
- **JSON-only IPC**: Plugin and subprocess communicate strictly with structured JSON over stdin/stdout.
- **Input Validation**: Unknown hooks, invalid payload shape, and oversized payloads are rejected.
- **Dynamic API Ban**: `eval`, `new Function`, `vm.runInThisContext`, and `vm.Script` are prohibited in this path.

## File Guide

### By Responsibility

- **Entry points**
  - `src/entrypoints/plugin/index.ts`
  - `src/entrypoints/cli/main.ts`
  - `src/entrypoints/scripts/hook-once.ts`
  - `src/entrypoints/scripts/persist-eval.ts`
- **Adapters**
  - `src/adapters/openclaw/adapter.ts`
  - `src/adapters/openclaw/normalize.ts`
  - `src/adapters/openclaw/tool-params.ts`
  - `src/adapters/llm-judge/client.ts`
- **Core domain**
  - `src/core/engine/safety-core.ts`
  - `src/core/engine/factory.ts`
  - `src/core/evaluation/deterministic.ts`
  - `src/core/policy/loader.ts`
  - `src/core/policy/retriever.ts`
  - `src/core/policy/schema.ts`
  - `src/core/models/event.ts`
  - `src/core/models/decision.ts`
  - `src/core/models/decision-sanitize.ts`
- **Executors**
  - `src/executors/interceptors/tool-result.ts`
  - `src/executors/wrappers/shell.ts`
  - `src/executors/wrappers/file-write.ts`
  - `src/executors/wrappers/web-fetch.ts`
- **Infrastructure & shared**
  - `src/infrastructure/config/settings.ts`
  - `src/infrastructure/logger/incidents.ts`
  - `src/infrastructure/state/session-id.ts`
  - `src/infrastructure/state/session-state.ts`
  - `src/shared/utils/package-root.ts`
  - `src/shared/utils/common.ts`

### By Common Debug Scenario

- **Tool call was blocked unexpectedly**:
  - `src/core/evaluation/deterministic.ts`
  - `src/core/engine/safety-core.ts`
  - `src/adapters/openclaw/adapter.ts`
- **Sanitization result is not what you expected**:
  - `src/adapters/openclaw/tool-params.ts`
  - `src/core/models/decision-sanitize.ts`
- **`tool_result_persist` behavior is inconsistent**:
  - `src/entrypoints/scripts/hook-once.ts`
  - `src/entrypoints/scripts/persist-eval.ts`
  - `src/executors/interceptors/tool-result.ts`
- **Policy not loaded / policy mismatch**:
  - `src/core/policy/loader.ts`
  - `src/core/policy/retriever.ts`
  - `src/infrastructure/config/settings.ts`

## Related Docs

- Operations and configuration: [`USER-GUIDE.md`](./USER-GUIDE.md)
- Top-level project entry: [`../README.md`](../README.md)
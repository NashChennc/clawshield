# openclaw-plugin-clawshield

OpenClaw plugin with an **embedded TypeScript ClawShield `SafetyCore`**: enforces tool-parameter replacement/blocking in lifecycle hooks and evaluates context in-process. `tool_result_persist` uses a **Node `hook-once` subprocess** so synchronous hooks still run the full core (including optional guard LLM).

**中文说明：** 见 [docs/README.md](docs/README.md)。

## Prerequisites

- Node.js 22+
- OpenClaw >= 2026.3.24 (peer dependency)
- Optional: set `GUARD_*` env vars for the online guard judge (OpenAI-compatible or Anthropic APIs)

## Build & test

```bash
npm install
npm run build
npm test
```

## Install into OpenClaw

```bash
openclaw plugins install /absolute/path/to/this/package
```

Enable the plugin in your OpenClaw configuration if required (see `openclaw plugins --help`).

## Plugin config (`pluginConfig` for id `clawshield`)

| Key | Description |
|-----|-------------|
| `failClosed` | Block tool calls when evaluation fails (default: true) |
| `enablePromptContextEval` | Run `before_prompt_build` through SafetyCore for context risk logging (default: true; no prompt text injection) |
| `persistEvalTimeoutMs` | Timeout for `tool_result_persist` hook-once subprocess in ms (default: 120000) |

## Security guarantees for `hook-once`

- `hook-once` is a one-shot evaluator process for hook routing, not a JavaScript string evaluator.
- IPC between plugin and subprocess is JSON-only (`stdin` JSON request, `stdout` JSON decision).
- Inputs are validated as data-only payloads; unknown hooks and oversized payloads are rejected.
- Dynamic code execution APIs are prohibited in the persist path (`eval`, `new Function`, `vm.runInThisContext`, `vm.Script`).

## CLI bridge commands

This package now exposes a Node CLI:

```bash
clawshield hook-eval < input.json
clawshield shell --command "ls -la"
clawshield tool-result --content-file ./result.txt
```


## Source layout

The `src/` tree follows layered architecture:

- `entrypoints/`: CLI, plugin entry, one-off scripts
- `adapters/`: external integrations (OpenClaw, guard LLM)
- `core/`: domain engine, evaluation rules, policy, models
- `executors/`: guarded tool wrappers and result interceptors
- `infrastructure/`: config, state persistence, incident logging
- `shared/`: stateless utility helpers

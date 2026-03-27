# User Guide

This guide focuses on operations: installation, runtime configuration, and CLI usage.
For internals and security boundaries, see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Installation

From the project root:

```bash
npm install
npm run build
openclaw plugins install /absolute/path/to/this/package
```

Enable the plugin in your OpenClaw configuration if required.

## Plugin Configuration

When configuring plugin id `clawshield`, set options under `pluginConfig`:

| Key | Description | Default |
|-----|-------------|---------|
| `failClosed` | Block tool calls when evaluation fails or returns an unparseable result. | `true` |
| `enablePromptContextEval` | Evaluate `before_prompt_build` for context risk logging (no prompt injection). | `true` |
| `persistEvalTimeoutMs` | Timeout for the `tool_result_persist` `hook-once` subprocess in milliseconds. | `120000` |

## Environment Variables

You can place these in a root `.env` file (do not commit secrets):

| Variable | Description | Default |
|----------|-------------|---------|
| `CLAWSHIELD_POLICY_DIR` | Directory containing policy JSON files. | `<packageRoot>/policies/base` |
| `CLAWSHIELD_INCIDENT_PATH` | JSONL output path for incidents. | `<packageRoot>/data/incidents/incidents.jsonl` |
| `CLAWSHIELD_RUNTIME_DIR` | Root directory for runtime/session state. | `<packageRoot>/data/runtime` |
| `CLAWSHIELD_PROJECT_ROOT` | Optional root used by `hook-once` to resolve relative paths. | (not set) |
| `GUARD_API_TYPE` | Guard provider type (OpenAI-compatible or Anthropic). | (not set) |
| `GUARD_API_BASE` | Guard API base URL. | (not set) |
| `GUARD_API_KEY` | Guard API secret key. | (not set) |
| `GUARD_MODEL` | Guard model name. | (not set) |
| `GUARD_API_VERSION` | Extra provider parameter (for example, Anthropic version). | (not set) |
| `GUARD_MAX_TOKENS` | Max guard response tokens. | (not set) |

## CLI Commands

```bash
# Evaluate a hook payload from stdin JSON
clawshield hook-eval < input.json

# Run shell command through guarded wrapper
clawshield shell --command "ls -la"

# Evaluate tool result from file content
clawshield tool-result --content-file ./result.txt
```

## Related Docs

- Documentation index: [`README.md`](./README.md)
- Internal design and guarantees: [`ARCHITECTURE.md`](./ARCHITECTURE.md)

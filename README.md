# openclaw-plugin-clawshield

OpenClaw plugin with an embedded TypeScript ClawShield `SafetyCore`.
It enforces tool-parameter sanitization or blocking in lifecycle hooks and runs context evaluation in-process.
The plugin no longer depends on the Python `clawshield-openclaw-bridge`.

## Features

- Embedded TypeScript `SafetyCore` for policy retrieval, deterministic hard fences, and incident logging.
- Optional online guard model via `GUARD_*` environment variables (OpenAI-compatible or Anthropic).
- Full evaluation support for synchronous `tool_result_persist` via the `hook-once` subprocess.

## Prerequisites

- Node.js 22+
- OpenClaw >= 2026.3.24 (peer dependency)

## Quick Start

```bash
npm install
npm run build
openclaw plugins install /absolute/path/to/this/package
```

Enable the plugin in OpenClaw configuration if required (see `openclaw plugins --help`).

## Documentation

- Documentation hub: [`docs/README.md`](docs/README.md)
- Usage and configuration: [`docs/USER-GUIDE.md`](docs/USER-GUIDE.md)
- Architecture and security: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Development

```bash
npm test
```

Source layout (`src/`):

- `entrypoints/`: plugin entry, CLI, one-off scripts
- `adapters/`: external integrations (OpenClaw, guard model APIs)
- `core/`: evaluation engine, rules, policy, domain models
- `executors/`: guarded tool wrappers and result interceptors
- `infrastructure/`: config, state persistence, incident logging
- `shared/`: stateless utilities

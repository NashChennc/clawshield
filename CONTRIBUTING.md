# Contributing Guide

## Build & Test

Ensure you are using Node.js 22+.

```bash
npm install
npm run build
npm test
````

*Note: The `prepare` script will automatically run `npm run build`. Tests are executed using `vitest`.*

## Source Layout

The `src/` tree follows a layered architecture to maintain clear boundaries:

  - **`entrypoints/`**: CLI bridge commands, main plugin entry, and one-off scripts (e.g., `hook-once`).
  - **`adapters/`**: External integrations (anti-corruption layer for OpenClaw and the Guard LLM Judge).
  - **`core/`**: Domain engine, evaluation rules, policy loading, and domain models.
  - **`executors/`**: Guarded tool wrappers and result interceptors.
  - **`infrastructure/`**: Configuration management, state persistence, and incident logging.
  - **`shared/`**: Stateless utility helpers.

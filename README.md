# openclaw-plugin-clawshield

OpenClaw plugin that replaces workspace Markdown injection from `clawshield attach-openclaw`: it prepends ClawShield runtime guidance in `before_prompt_build` and evaluates tool/prompt lifecycle hooks via the Python bridge `clawshield-openclaw-bridge hook-eval`.

## Prerequisites

- Node.js 22+
- ClawShield Python package (`clawshieldpy`) installed so `clawshield-openclaw-bridge` is on `PATH`
- OpenClaw >= 2026.3.24 (peer dependency)

## Build

```bash
npm install
npm run build
```

## Install into OpenClaw

```bash
openclaw plugins install /absolute/path/to/this/package
```

Enable the plugin in your OpenClaw configuration if required by your version (see `openclaw plugins --help`).

## Plugin config (`pluginConfig` for id `clawshield`)

| Key | Description |
|-----|-------------|
| `bridgeCommand` | Override executable (default: `clawshield-openclaw-bridge`) |
| `evalTimeoutMs` | Hook-eval timeout (default: 120000) |
| `failClosed` | Block tool calls when the bridge fails (default: true) |
| `enablePromptContextEval` | Run `before_prompt_build` through SafetyCore (default: true) |

## Legacy Markdown injection

To append snippets to `BOOTSTRAP.md` / `TOOLS.md` / `AGENTS.md` as before:

```bash
clawshield attach-openclaw --legacy-bootstrap
```

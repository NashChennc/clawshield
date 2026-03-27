# ClawShield OpenClaw 插件说明

## 作用

在 **OpenClaw** 内通过官方插件钩子接入 **ClawShield**：本仓库包含完整 **TypeScript `SafetyCore`**（策略检索、确定性硬栅栏、可选 `GUARD_*` 守护模型、会话状态与 incident 日志），**不再依赖** Python `clawshield-openclaw-bridge`。

## 工作流程

1. `before_tool_call` / `after_tool_call` 在 **同一 Node 进程** 内 `await SafetyCore.evaluate`，并在 `before_tool_call` 对参数执行强制规范化与替换（或阻断）。
2. `tool_result_persist` 为 **同步**钩子：插件通过 **`spawnSync`** 启动同包内的 **`dist/entrypoints/scripts/hook-once.js`**，stdin 传入 `{ hook, payload, session_id }`，子进程跑完完整评估后 **stdout 仅输出裁决 JSON**（与原先阻塞式 `hook-eval` 语义一致）。
3. 策略 JSON 默认从包内 **`policies/base`** 加载（可用 `CLAWSHIELD_POLICY_DIR` 覆盖）。守护模型密钥仅通过环境变量传入，勿写入 stdin。

## `hook-once` 安全保证

- `hook-once` 是一次性评估子进程，不执行任何来自 `tool_result` 的字符串代码。
- 进程间通信严格使用 JSON（stdin 请求 / stdout 裁决），不传递可执行脚本片段。
- 子进程会校验 hook 白名单、payload 数据形状与输入体积；非法输入返回受控失败裁决。
- 在关键路径中禁止使用动态执行 API（`eval`、`new Function`、`vm.runInThisContext`、`vm.Script`）。

## 环境与目录（与 Python 版对齐）

| 变量 | 含义 |
|------|------|
| `CLAWSHIELD_POLICY_DIR` | 策略目录（默认 `<packageRoot>/policies/base`） |
| `CLAWSHIELD_INCIDENT_PATH` | incidents JSONL 路径（默认 `<packageRoot>/data/incidents/incidents.jsonl`） |
| `CLAWSHIELD_RUNTIME_DIR` | 运行时与会话状态根目录（默认 `<packageRoot>/data/runtime`） |
| `CLAWSHIELD_PROJECT_ROOT` | 可选；`hook-once` 子进程用于解析上述相对路径的根（测试或自定义布局时使用） |
| `GUARD_API_TYPE` / `GUARD_API_BASE` / `GUARD_API_KEY` / `GUARD_MODEL` | 在线守护模型（OpenAI 兼容或 Anthropic） |
| `GUARD_API_VERSION` / `GUARD_MAX_TOKENS` | Anthropic 等补充参数 |

仓库根目录可放 `.env`（非提交项）；加载方式与 Python `Settings.load` 类似（首行已存在的环境变量不覆盖）。

## 钩子

| 钩子 | 行为 |
|------|------|
| `before_prompt_build` | 可选执行 prompt context 风险评估并写 incident；不注入系统说明 |
| `before_tool_call` | `allow` / `block` / `require_confirm`（网关按阻断处理）/ `sanitize_then_allow`（合并 `sanitized_payload`） |
| `after_tool_call` | 返回后的研判与状态落盘 |
| `tool_result_persist` | 持久化前同步改写工具结果消息；内部走 **hook-once** |

## 配置（`pluginConfig`，插件 id：`clawshield`）

- **`failClosed`**：评估抛错或返回不可解析结果时是否阻断工具（默认 true）。
- **`enablePromptContextEval`**：是否在 `before_prompt_build` 跑 SafetyCore 并记录评估（默认 true，不注入提示）。
- **`persistEvalTimeoutMs`**：`tool_result_persist` 子进程超时毫秒数（默认 120000）。

安装与构建见仓库根目录 [README.md](../README.md)。

## 当前源码分层（`src/`）

- `entrypoints/`：CLI、插件入口、一次性脚本
- `adapters/`：OpenClaw 与 LLM Judge 适配（防腐层）
- `core/`：核心引擎、评估规则、策略、领域模型
- `executors/`：工具执行包装与结果拦截
- `infrastructure/`：配置、状态持久化、incident 日志
- `shared/`：无状态通用工具

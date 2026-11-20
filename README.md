# Antigravity Codex Plugin (`codex-worker`)

A lightweight, native **Google Antigravity** plugin that delegates coding, debugging, review, and research tasks to your local **OpenAI Codex CLI** (`codex exec` / `codex exec resume`) through a thin forwarding subagent (`codex-worker`).

Designed specifically for Antigravity's native strengths — **no app-server broker, no job queue daemon, no timeout workarounds, and only 1 slash command (`/codex`)**.

## Why This Architecture?

Instead of porting Claude Code's heavy daemon/broker stack, this plugin leans directly on Antigravity's native primitives:

- **Native Subagent UI observability**: `codex-worker` streams `codex exec` output live into the Subagent UI card (reasoning summaries, shell commands, outputs, diffs, token usage) while keeping the main conversation clean.
- **Lossless result relay**: Uses `codex exec -o <file>` to capture Codex's exact final answer and appends it together with the `Codex session id` at the end of output, so the subagent always relays the complete answer verbatim even on long runs.
- **1 Subagent ⇄ 1 Codex Thread (Parallel & Resumable)**:
  - Spawn multiple `codex-worker` subagents in parallel in one main conversation — each runs an independent Codex thread in its own Subagent UI card.
  - Follow up on an existing thread via `send_message` to the idle `codex-worker` subagent — it automatically runs `codex exec resume <session-id>` inside the **same Subagent UI card**.
  - Resume from another conversation with `--resume <session-id>`, or take over in your terminal via `codex resume <session-id>`.
- **Zero polling, no 120s kill limit**: Long-running Codex tasks automatically transition into Antigravity background tasks and wake `codex-worker` via Reactive Wakeup on exit.

## Structure

```text
antigravity-codex-plugin/
├── plugin.json             # Antigravity plugin manifest
├── assets/logo.svg         # Plugin icon
├── agents/codex-worker.md  # Thin forwarding subagent (model: flash; tools: run_command, manage_task)
├── scripts/run-codex.mjs   # Zero-dependency Node wrapper around codex exec / resume
├── skills/codex/SKILL.md   # Single /codex slash command
└── rules/AGENTS.md         # Main-agent delegation, concurrency, resume, and result-handling rules
```

## Available Models

| Display Name | Model ID | Alias | Notes |
| :--- | :--- | :--- | :--- |
| **GPT-6.1 Terra** | `gpt-6.1-terra` | `terra` | Default (`CODEX_WORKER_DEFAULT_MODEL` overrides) |
| **GPT-6.2 Sol** | `gpt-6.2-sol` | `sol` | — |
| **GPT-6.2 Astra** | `gpt-6.2-astra` | `astra` | — |
| **GPT-6 Luna** | `gpt-6-luna` | `luna` | Lightweight / fast |

Any other explicit model ID is passed directly through to `codex exec -m <model>`. Pass `--model default` to defer to `~/.codex/config.toml`.

## Requirements

- [OpenAI Codex CLI](https://developers.openai.com/codex/cli/) installed and authenticated (`npm install -g @openai/codex && codex login`).
- Node.js 18+.

## Install

Copy or clone into Antigravity's global plugins directory (`~/.gemini/config/plugins/codex`):

```bash
git clone https://github.com/Theigrams/antigravity-codex-plugin.git ~/.gemini/config/plugins/codex
rm -rf ~/.gemini/config/plugins/codex/.git
```

Or validate with the Antigravity CLI:

```bash
agy plugin validate --strict ~/.gemini/config/plugins/codex
```

Antigravity automatically discovers `~/.gemini/config/plugins/codex/` — the `codex-worker` subagent and `/codex` slash command are available on the next turn.

## Usage Examples

### Natural language or `/codex`

```text
/codex investigate why the integration tests fail and apply the smallest safe fix
/codex --read-only review my uncommitted git changes for race conditions
/codex --model gpt-6-luna --effort low summarize how scripts/run-codex.mjs works
/codex --model sol --effort xhigh redesign the retry logic
/codex --worktree refactor the parser in an isolated git worktree
```

### Multiple parallel Codex threads

Simply ask the main agent to fan out across multiple `codex-worker` subagents in parallel:

```text
派两个 codex-worker 并行处理：一个用 GPT-6.1 Terra 排查认证模块 bug，另一个用 GPT-6 Luna 补全解析器单元测试。
```

### Resuming an existing Codex thread

- **Same conversation**: just ask the main agent to follow up with that worker (it sends a `send_message` to the idle `codex-worker`, which automatically runs `codex exec resume <session-id>` in the same Subagent UI card).
- **New conversation**: `/codex --resume <session-id> now add regression tests`.
- **In terminal**: `codex resume <session-id>`.

## License

MIT

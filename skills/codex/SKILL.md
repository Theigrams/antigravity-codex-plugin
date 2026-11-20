---
name: codex
description: >-
  Delegate coding, debugging, research, or code-review tasks to the local OpenAI Codex CLI via the codex-worker subagent.
  Supports parallel multi-subagent runs, in-place thread resume via send_message, and selectable models (GPT-6.2 Sol, GPT-6.2 Astra, GPT-6.1 Terra, GPT-6 Luna).
  Use when the user runs /codex or asks to delegate work to Codex.
---

# Codex Worker (`/codex`)

Delegate tasks to the local OpenAI Codex CLI through the dedicated `codex-worker` subagent (`invoke_subagent`), keeping the main thread clean while letting the user inspect Codex's full live execution inside Antigravity's Subagent UI.

## Available Models

| Display Name | Model ID | Short Alias | Notes |
| :--- | :--- | :--- | :--- |
| **GPT-6.1 Terra** | `gpt-6.1-terra` | `terra` | Default model |
| **GPT-6.2 Sol** | `gpt-6.2-sol` | `sol` | — |
| **GPT-6.2 Astra** | `gpt-6.2-astra` | `astra` | — |
| **GPT-6 Luna** | `gpt-6-luna` | `luna` | Lightweight / fast |

Any other explicit model ID is also passed through unchanged. Reasoning effort (`--effort low|medium|high|xhigh|max|ultra`) is optional and defaults to the user's `~/.codex/config.toml`.

## Supported Flags

`[--model <id|sol|astra|terra|luna>] [--effort <low|medium|high|xhigh|max|ultra>] [--read-only|--write] [--resume <session-id>|--resume-last] [--worktree] [--cwd <dir>] <task>`

## Step 1: Parse Intent and Decide Fresh vs Resume

- Resolve any model/effort mention (flag or natural language, e.g. "用 GPT-6.1 Terra" → `--model gpt-6.1-terra`, "用 GPT-6 Luna" → `--model gpt-6-luna`, "GPT-6.2 Sol" → `--model gpt-6.2-sol`, "GPT-6.2 Astra" → `--model gpt-6.2-astra`).
- Determine workspace root from `--cwd <dir>` or the active workspace directory. Always forward `--cwd "<workspace>"`.
- If the request is pure diagnosis, research, or code review without file edits, add `--read-only`. Otherwise default to `--write` (`workspace-write`).
- If the user did not supply any task text, ask what Codex should do.

## Step 2: Launch or Resume `codex-worker`

### A. Continuing an existing `codex-worker` in THIS conversation (preferred for thread reuse)
- If this conversation already spawned a `codex-worker` subagent for this task/thread, call **`send_message`** to that exact subagent's `conversationId` instead of spawning a new one.
- `codex-worker` remembers its own `Codex session id` and will automatically run `codex exec resume <session-id>` inside the **same Subagent UI card**.

### B. Starting a new Codex thread (or running multiple threads in parallel)
- Call `invoke_subagent`:
  - `TypeName`: `"codex-worker"`
  - `Model`: `"flash"`
  - `Role`: short descriptive label with the model so it is easy to identify in the Subagent UI, e.g. `Codex: Fix auth race (gpt-6.1-terra)`
  - `Prompt`: include `--cwd "<workspace>"`, any resolved flags (`--model`, `--effort`, `--read-only`/`--write`, `--resume <id>`, `--worktree`), and the user's task text verbatim.
- **Parallel subagents**: When a task splits cleanly into independent pieces (e.g. investigating two modules or implementing independent parts), you may invoke **multiple `codex-worker` subagents in parallel** in the same turn — each owns its own isolated Codex thread and Subagent UI card. If concurrent workers will edit files in the same repo, consider passing `Workspace: "share"` on `invoke_subagent` or `--worktree` to avoid edit collisions.

### C. Waiting Reactively
- Do NOT poll `manage_subagents` or sleep while `codex-worker` is running.
- Let Antigravity notify you automatically via Reactive Wakeup when the subagent finishes (you may tell the user briefly which subagent(s) were launched so they can open the Subagent UI card to watch progress live).

## Step 3: Present Result Verbatim

- When `codex-worker` replies, present Codex's answer faithfully — preserving file paths, line numbers, findings, evidence boundaries, and the trailing `Codex session id` / `codex resume` command.
- If the task was a read-only code review or analysis, **STOP after presenting the output** and do not modify files unless the user asks you to.
- If Codex failed or exited with an error, report the error verbatim and do NOT silently substitute your own implementation unless the user asks you to take over.

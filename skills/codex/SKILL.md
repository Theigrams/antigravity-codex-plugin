---
name: codex
description: >-
  Delegate coding, debugging, research, or code-review tasks to the local OpenAI Codex CLI via the codex-worker subagent.
  Supports parallel multi-subagent runs, in-place thread resume via send_message, and selectable models (GPT-6.2 Sol, GPT-6.2 Astra, GPT-6.1 Terra, GPT-6 Luna).
  Use when the user runs /codex or asks to delegate work to Codex.
---

# Codex Worker (`/codex`)

Delegate tasks to the local OpenAI Codex CLI through the dedicated `codex-worker` subagent (`invoke_subagent`), keeping the main thread clean while letting the user inspect Codex's full live execution inside Antigravity's Subagent UI.

## Available Models & Smart Selection

Choose the model based on the task (always respecting an explicit user choice; default to **`gpt-6.2-sol`** in general cases):

| Display Name | Model ID | Alias | Intelligence | Cost | Speed | Best For |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **GPT-6.2 Astra** | `gpt-6.2-astra` | `astra` | Highest | Highest | Standard | Hardest architectural design, subtle deep root-cause debugging, high-risk refactors, complex reasoning |
| **GPT-6.2 Sol** *(Default)* | `gpt-6.2-sol` | `sol` | Slightly below Astra | Very cheap | Standard | **General default** — best cost/performance for almost all coding, debugging, review, and research tasks |
| **GPT-6.1 Terra** | `gpt-6.1-terra` | `terra` | Much lower than Sol | Slightly cheaper than Sol | **Very fast** | Fast, well-specified directive/command execution, quick mechanical edits, latency-sensitive simple tasks |
| **GPT-6 Luna** | `gpt-6-luna` | `luna` | Lowest | **Negligible** | Slower than Terra | Non-urgent, simple/bulk background tasks where cost should be near-zero and latency doesn't matter |

Selection rules:
- If the user specifies a model (in flags or natural language), always honor it.
- Otherwise, default to **`gpt-6.2-sol`**.
- Escalate to **`gpt-6.2-astra`** only for genuinely hard, subtle, or high-stakes tasks.
- Use **`gpt-6.1-terra`** for fast, straightforward instruction execution where speed matters more than deep reasoning.
- Use **`gpt-6-luna`** only for simple, non-urgent tasks where minimizing cost is the primary goal.
- Any other explicit model ID is passed through unchanged. Reasoning effort (`--effort low|medium|high|xhigh|max|ultra`) is optional and defaults to `~/.codex/config.toml`.

## Supported Flags

`[--model <id|sol|astra|terra|luna>] [--effort <low|medium|high|xhigh|max|ultra>] [--read-only|--write] [--resume <session-id>|--resume-last] [--worktree] [--cwd <dir>] <task>`

## Step 1: Parse Intent and Choose Model

- If the user explicitly names a model or effort (flag or natural language, e.g. "用 GPT-6.2 Astra" → `--model gpt-6.2-astra`, "用 GPT-6.2 Sol" → `--model gpt-6.2-sol`, "用 GPT-6.1 Terra" → `--model gpt-6.1-terra`, "用 GPT-6 Luna" → `--model gpt-6-luna`), pass it through.
- Otherwise pick the model using the **Available Models & Smart Selection** rules above (defaulting to **`gpt-6.2-sol`** for general tasks).
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
  - `Role`: short descriptive label with the model so it is easy to identify in the Subagent UI, e.g. `Codex: Fix auth race (gpt-6.2-sol)`
  - `Prompt`: include `--cwd "<workspace>"`, any resolved flags (`--model`, `--effort`, `--read-only`/`--write`, `--resume <id>`, `--worktree`), and the user's task text verbatim.
- **Parallel subagents**: When a task splits cleanly into independent pieces (e.g. investigating two modules or implementing independent parts), you may invoke **multiple `codex-worker` subagents in parallel** in the same turn — each owns its own isolated Codex thread and Subagent UI card. If concurrent workers will edit files in the same repo, consider passing `Workspace: "share"` on `invoke_subagent` or `--worktree` to avoid edit collisions.

### C. Waiting Reactively
- Do NOT poll `manage_subagents` or sleep while `codex-worker` is running.
- Let Antigravity notify you automatically via Reactive Wakeup when the subagent finishes (you may tell the user briefly which subagent(s) were launched so they can open the Subagent UI card to watch progress live).

## Step 3: Present Result Verbatim

- When `codex-worker` replies, present Codex's answer faithfully — preserving file paths, line numbers, findings, evidence boundaries, and the trailing `Codex session id` / `codex resume` command.
- If the task was a read-only code review or analysis, **STOP after presenting the output** and do not modify files unless the user asks you to.
- If Codex failed or exited with an error, report the error verbatim and do NOT silently substitute your own implementation unless the user asks you to take over.

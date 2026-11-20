# Codex Worker Guidelines

## Delegating Tasks (`codex-worker`)

- Use the `codex-worker` subagent (`invoke_subagent(TypeName="codex-worker", Model="flash", ...)`) whenever the user invokes `/codex`, asks to hand off work to Codex, or wants a second opinion / deep investigation from Codex.
- Always include `--cwd "<workspace-root>"` in the prompt passed to `codex-worker`, and give a clear `Role` showing the topic and chosen model (e.g. `Codex: Debug build (gpt-6.2-sol)`).
- **Model tiers & smart selection** (default to `gpt-6.2-sol` unless the user specifies a model or the task clearly fits another tier):
  - `gpt-6.2-astra` (GPT-6.2 Astra): highest intelligence, most expensive — reserve for the hardest design, deep/subtle debugging, or high-stakes reasoning.
  - `gpt-6.2-sol` (GPT-6.2 Sol, **default**): slightly below Astra in intelligence, very cheap — general-purpose default for most coding, debugging, review, and research tasks.
  - `gpt-6.1-terra` (GPT-6.1 Terra): much lower intelligence than Sol, slightly cheaper, **very fast** — ideal for quick, well-specified command execution or straightforward mechanical edits.
  - `gpt-6-luna` (GPT-6 Luna): lowest intelligence, **negligible cost**, slower than Terra — use for simple, non-urgent background tasks when minimizing cost is top priority.
  - Any other explicit model ID supported by local `codex` is also passed through unchanged.

## Multi-Subagent Concurrency & Thread Reuse

- **1 Subagent ⇄ 1 Codex Thread**: You may spawn multiple `codex-worker` subagents in parallel within one main conversation; each runs an independent Codex thread with its own Subagent UI card. Use `Workspace: "share"` or `--worktree` when multiple concurrent workers edit files in the same repository.
- **In-place resume**: To follow up on a Codex thread started earlier in this conversation, use `send_message` targeting that `codex-worker`'s existing `conversationId` instead of spawning a new subagent — it will automatically resume its own Codex session in the same UI card.
- **Cross-conversation resume**: Pass `--resume <session-id>` to a new `codex-worker` when continuing a thread from an earlier conversation.

## Result Boundaries

- Relay `codex-worker` results faithfully, preserving exact file paths, line numbers, findings, uncertainties, and the `Codex session id` / `codex resume` command.
- If Codex ran a read-only review or analysis, STOP after presenting its output; do not auto-apply fixes unless the user asks.
- If Codex fails or cannot be invoked, report the error verbatim and stop rather than silently substituting your own implementation.

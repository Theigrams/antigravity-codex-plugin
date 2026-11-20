#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const DEFAULT_MODEL = "gpt-6.1-terra";
const MODEL_ALIASES = new Map([
  ["sol", "gpt-6.2-sol"],
  ["gpt-6.2-sol", "gpt-6.2-sol"],
  ["gpt 6.2 sol", "gpt-6.2-sol"],
  ["astra", "gpt-6.2-astra"],
  ["gpt-6.2-astra", "gpt-6.2-astra"],
  ["gpt 6.2 astra", "gpt-6.2-astra"],
  ["terra", "gpt-6.1-terra"],
  ["gpt-6.1-terra", "gpt-6.1-terra"],
  ["gpt 6.1 terra", "gpt-6.1-terra"],
  ["luna", "gpt-6-luna"],
  ["gpt-6-luna", "gpt-6-luna"],
  ["gpt 6 luna", "gpt-6-luna"]
]);

const VALID_SANDBOXES = new Set(["read-only", "workspace-write", "danger-full-access"]);
const VALID_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node scripts/run-codex.mjs [options] [prompt...]",
      "  node scripts/run-codex.mjs [options] <<'CODEX_PROMPT'",
      "    <prompt>",
      "  CODEX_PROMPT",
      "",
      "Options:",
      "  --cwd, -C <dir>        Working directory (default: current directory)",
      `  --model, -m <model>    Model ID or alias (default: ${DEFAULT_MODEL}; pass 'default' to use ~/.codex/config.toml)`,
      "                         Aliases: sol -> gpt-6.2-sol, astra -> gpt-6.2-astra,",
      "                                  terra -> gpt-6.1-terra, luna -> gpt-6-luna",
      "  --effort <level>       Reasoning effort (low|medium|high|xhigh|max|ultra)",
      "  --write                Writable sandbox: workspace-write (default for fresh runs)",
      "  --read-only            Read-only sandbox: read-only",
      "  --sandbox <mode>       Explicit sandbox (read-only|workspace-write|danger-full-access)",
      "  --resume <session-id>  Resume an existing Codex thread by session ID",
      "  --resume-last          Resume the most recent Codex thread in --cwd",
      "  --worktree             Run in an isolated managed Git worktree",
      "  --ephemeral            Do not persist the Codex session to disk",
      "  --skip-git-repo-check  Allow running outside a Git repository",
      "  --help, -h             Show this help message"
    ].join("\n")
  );
}

function parseCliArgs(argv) {
  const options = {
    cwd: null,
    model: null,
    modelExplicit: false,
    effort: null,
    sandbox: null,
    resume: null,
    resumeLast: false,
    worktree: false,
    ephemeral: false,
    skipGitRepoCheck: false,
    help: false
  };
  const positionals = [];

  function takeValue(index, flag) {
    if (index + 1 >= argv.length) {
      throw new Error(`Missing value for ${flag}.`);
    }
    return argv[index + 1];
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--cwd" || arg === "-C") {
      options.cwd = takeValue(i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--cwd=")) {
      options.cwd = arg.slice("--cwd=".length);
      continue;
    }
    if (arg === "--model" || arg === "-m") {
      options.model = takeValue(i, arg);
      options.modelExplicit = true;
      i += 1;
      continue;
    }
    if (arg.startsWith("--model=")) {
      options.model = arg.slice("--model=".length);
      options.modelExplicit = true;
      continue;
    }
    if (arg === "--effort") {
      options.effort = takeValue(i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--effort=")) {
      options.effort = arg.slice("--effort=".length);
      continue;
    }
    if (arg === "--read-only") {
      options.sandbox = "read-only";
      continue;
    }
    if (arg === "--write") {
      options.sandbox = "workspace-write";
      continue;
    }
    if (arg === "--sandbox" || arg === "-s") {
      options.sandbox = takeValue(i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--sandbox=")) {
      options.sandbox = arg.slice("--sandbox=".length);
      continue;
    }
    if (arg === "--resume" || arg === "--resume-thread" || arg === "--thread") {
      options.resume = takeValue(i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--resume=")) {
      options.resume = arg.slice("--resume=".length);
      continue;
    }
    if (arg === "--resume-last") {
      options.resumeLast = true;
      continue;
    }
    if (arg === "--worktree") {
      options.worktree = true;
      continue;
    }
    if (arg === "--ephemeral") {
      options.ephemeral = true;
      continue;
    }
    if (arg === "--skip-git-repo-check") {
      options.skipGitRepoCheck = true;
      continue;
    }
    if (arg === "--fresh" || arg === "--wait" || arg === "--background") {
      // Caller-side routing flags; harmless if forwarded.
      continue;
    }
    positionals.push(arg);
  }

  return { options, positionals };
}

function resolveModel(rawModel, isResume) {
  if (rawModel == null) {
    // Default to gpt-6.1-terra for fresh runs; on resume, keep the explicit default
    // unless overridden by CODEX_WORKER_DEFAULT_MODEL or --model default.
    const envDefault = process.env.CODEX_WORKER_DEFAULT_MODEL;
    if (envDefault !== undefined) {
      const trimmed = envDefault.trim();
      return !trimmed || trimmed.toLowerCase() === "default" ? null : normalizeModelName(trimmed);
    }
    return isResume ? DEFAULT_MODEL : DEFAULT_MODEL;
  }
  const trimmed = String(rawModel).trim();
  if (!trimmed || trimmed.toLowerCase() === "default") {
    return null;
  }
  return normalizeModelName(trimmed);
}

function normalizeModelName(value) {
  const key = value.trim().toLowerCase().replace(/\s+/g, " ");
  return MODEL_ALIASES.get(key) ?? value.trim();
}

function normalizeEffort(rawEffort) {
  if (rawEffort == null || String(rawEffort).trim() === "") {
    return null;
  }
  const normalized = String(rawEffort).trim().toLowerCase();
  if (!VALID_EFFORTS.has(normalized)) {
    throw new Error(
      `Unsupported --effort "${rawEffort}". Expected one of: ${[...VALID_EFFORTS].join(", ")}.`
    );
  }
  return normalized;
}

function isInsideGitRepo(dir) {
  let current = path.resolve(dir);
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return true;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return false;
    }
    current = parent;
  }
}

function readPrompt(positionals) {
  const joined = positionals.join(" ").trim();
  if (joined && joined !== "-") {
    return joined;
  }
  if (!process.stdin.isTTY) {
    return fs.readFileSync(0, "utf8").trim();
  }
  return "";
}

function resolveWorkingDirectory(rawCwd) {
  const target = rawCwd ? path.resolve(process.cwd(), rawCwd) : process.cwd();
  let stats;
  try {
    stats = fs.statSync(target);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Working directory does not exist: ${target}`);
    }
    throw error;
  }
  if (!stats.isDirectory()) {
    throw new Error(`Working directory is not a directory: ${target}`);
  }
  return target;
}

async function main() {
  const { options, positionals } = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  if (options.resume && options.resumeLast) {
    throw new Error("Choose either --resume <session-id> or --resume-last, not both.");
  }

  const isResume = Boolean(options.resume || options.resumeLast);
  const cwd = resolveWorkingDirectory(options.cwd);
  const model = resolveModel(options.modelExplicit ? options.model : null, isResume);
  const effort = normalizeEffort(options.effort);
  const prompt = readPrompt(positionals);

  if (!prompt) {
    throw new Error("Provide a task prompt as an argument or via stdin.");
  }

  if (options.sandbox && !VALID_SANDBOXES.has(options.sandbox)) {
    throw new Error(
      `Unsupported --sandbox "${options.sandbox}". Expected one of: ${[...VALID_SANDBOXES].join(", ")}.`
    );
  }

  const skipGitCheck = options.skipGitRepoCheck || !isInsideGitRepo(cwd);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-worker-"));
  const outFile = path.join(tmpDir, "last-message.txt");

  const args = ["exec"];
  if (isResume) {
    args.push("resume");
    if (model) {
      args.push("-m", model);
    }
    if (effort) {
      args.push("-c", `model_reasoning_effort=${effort}`);
    }
    if (options.sandbox) {
      args.push("-c", `sandbox_mode="${options.sandbox}"`);
    }
    if (options.worktree) {
      args.push("--worktree");
    }
    if (options.ephemeral) {
      args.push("--ephemeral");
    }
    if (skipGitCheck) {
      args.push("--skip-git-repo-check");
    }
    args.push("-o", outFile);
    if (options.resumeLast) {
      args.push("--last");
    } else {
      args.push(options.resume);
    }
    args.push("-");
  } else {
    const sandbox = options.sandbox ?? "workspace-write";
    if (model) {
      args.push("-m", model);
    }
    if (effort) {
      args.push("-c", `model_reasoning_effort=${effort}`);
    }
    args.push("-s", sandbox);
    args.push("-C", cwd);
    if (options.worktree) {
      args.push("--worktree");
    }
    if (options.ephemeral) {
      args.push("--ephemeral");
    }
    if (skipGitCheck) {
      args.push("--skip-git-repo-check");
    }
    args.push("-o", outFile);
    args.push("-");
  }

  let capturedSessionId = options.resume || null;
  let scanBuffer = "";

  function inspectForSessionId(text) {
    if (capturedSessionId) {
      return;
    }
    scanBuffer = (scanBuffer + text).slice(-2048);
    const match = scanBuffer.match(/(?:^|\r?\n)session id:\s*([0-9a-fA-F-]{8,})\b/);
    if (match) {
      capturedSessionId = match[1];
    }
  }

  const exitCode = await new Promise((resolve) => {
    const child = spawn("codex", args, {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const forwardSignal = (signal) => {
      if (!child.killed) {
        child.kill(signal);
      }
    };
    process.on("SIGINT", forwardSignal);
    process.on("SIGTERM", forwardSignal);

    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      inspectForSessionId(chunk.toString("utf8"));
    });

    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      inspectForSessionId(chunk.toString("utf8"));
    });

    child.on("error", (error) => {
      process.off("SIGINT", forwardSignal);
      process.off("SIGTERM", forwardSignal);
      if (error?.code === "ENOENT") {
        process.stderr.write(
          "Codex CLI ('codex') was not found in PATH. Install it with 'npm install -g @openai/codex' and run 'codex login'.\n"
        );
        resolve(127);
        return;
      }
      process.stderr.write(`Failed to launch codex: ${error.message}\n`);
      resolve(1);
    });

    child.on("close", (code, signal) => {
      process.off("SIGINT", forwardSignal);
      process.off("SIGTERM", forwardSignal);
      if (signal) {
        resolve(1);
        return;
      }
      resolve(code ?? 1);
    });

    child.stdin.on("error", () => {
      // Ignore EPIPE if codex exits before consuming stdin.
    });
    child.stdin.end(`${prompt}\n`);
  });

  let finalMessage = "";
  try {
    if (fs.existsSync(outFile)) {
      finalMessage = fs.readFileSync(outFile, "utf8").trim();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  if (finalMessage) {
    process.stdout.write("\n===== CODEX FINAL RESPONSE =====\n");
    process.stdout.write(`${finalMessage}\n`);
    process.stdout.write("================================\n");
  }
  if (capturedSessionId) {
    process.stdout.write(`Codex session id: ${capturedSessionId}\n`);
    process.stdout.write(`Resume in terminal: codex resume ${capturedSessionId}\n`);
  }

  process.exitCode = exitCode;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

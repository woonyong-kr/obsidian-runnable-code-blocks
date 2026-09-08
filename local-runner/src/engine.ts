import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { CONTAINER_PROFILES, type ContainerProfile } from "./profiles";

const exec = promisify(execFile);
const OUTPUT_LIMIT = 64_000;
const TIMEOUT_MS = 15_000;

export interface EngineResult {
  durationMs: number;
  exitCode: number;
  provider: string;
  stderr: string;
  stdout: string;
  failureReason?: "timeout" | "output-limit" | "out-of-memory" | "process-exit";
}

export interface ExecutionEngine {
  availableLanguages(): Promise<string[]>;
  prepare(languages: readonly string[]): Promise<void>;
  run(language: string, code: string, signal?: AbortSignal): Promise<EngineResult>;
  version(): Promise<string>;
}

export class DockerEngine implements ExecutionEngine {
  readonly #binary: string;

  constructor(binary = "docker") {
    this.#binary = binary;
  }

  async version(): Promise<string> {
    const { stdout } = await exec(this.#binary, ["version", "--format", "{{.Server.Version}}"], {
      timeout: 3_000
    });
    const version = stdout.trim();
    if (!version) throw new Error("Docker engine is not running.");
    return `Docker ${version}`;
  }

  async availableLanguages(): Promise<string[]> {
    await this.version();
    const entries = await Promise.all([...CONTAINER_PROFILES.values()].map(async (profile) =>
      await imageAvailable(this.#binary, profile) ? profile.language : null
    ));
    return entries.filter((language): language is string => language !== null).sort();
  }

  async prepare(languages: readonly string[]): Promise<void> {
    await this.version();
    const images = new Set<ContainerProfile["image"]>();
    for (const language of languages) {
      const profile = CONTAINER_PROFILES.get(language);
      if (profile === undefined) throw new Error(`Unsupported language: ${language}`);
      images.add(profile.image);
    }
    for (const image of images) {
      await exec(this.#binary, ["pull", image], { maxBuffer: 2_000_000, timeout: 10 * 60_000 });
    }
  }

  async run(language: string, code: string, signal?: AbortSignal): Promise<EngineResult> {
    throwIfCancelled(signal);
    const profile = CONTAINER_PROFILES.get(language);
    if (profile === undefined) throw new EngineNotReadyError(`Unsupported language: ${language}`);
    if (!await imageAvailable(this.#binary, profile)) {
      throw new EngineNotReadyError(`Image is not prepared. Run: local-runner prepare ${language}`);
    }
    const name = `rcb-${randomUUID()}`;
    const started = performance.now();
    throwIfCancelled(signal);
    let result: Omit<EngineResult, "durationMs" | "provider">;
    try {
      // Create before attach: cancellation cannot race Docker's asynchronous container creation.
      await exec(this.#binary, ["create", ...containerArguments(name, profile).slice(2)], { timeout: 5_000 });
      if (signal?.aborted !== true) {
        const child = spawn(this.#binary, ["start", "--attach", "--interactive", name], { stdio: ["pipe", "pipe", "pipe"] });
        result = await collectProcess(child, code, name, this.#binary, signal, Math.max(1, TIMEOUT_MS - (performance.now() - started)));
        throwIfCancelled(signal);
        if (result.exitCode !== 0 && result.failureReason === undefined) {
          let outOfMemory = false;
          try {
            const state = await exec(this.#binary, ["inspect", "--format", "{{.State.OOMKilled}}", name], { timeout: 1_000 });
            outOfMemory = state.stdout.trim() === "true";
          } catch { /* A missing diagnostic must not prevent container cleanup. */ }
          result.failureReason = outOfMemory ? "out-of-memory" : "process-exit";
          if (outOfMemory) result.stderr += "\nExecution exceeded the container memory limit (512 MiB).";
          else if (!result.stderr.trim()) result.stderr = `Process exited with code ${String(result.exitCode)} before producing diagnostics.`;
        }
      } else {
        result = { exitCode: 137, stderr: "", stdout: "" };
      }
    } finally {
      await removeContainer(this.#binary, name);
    }
    throwIfCancelled(signal);
    return { ...result, durationMs: performance.now() - started, provider: `Local container · ${profile.image}` };
  }
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw new ExecutionCancelledError();
}

export class ExecutionCancelledError extends Error {
  constructor() { super("Execution cancelled; container removed."); this.name = "ExecutionCancelledError"; }
}

async function removeContainer(binary: string, name: string): Promise<void> {
  // Await Docker's acknowledgement. A failed cleanup must never become a successful cancellation.
  try {
    await exec(binary, ["rm", "--force", name], { timeout: 3_000 });
  } catch (error) {
    if (!String((error as { stderr?: string }).stderr).includes("No such container")) throw error;
  }
}

export class EngineNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineNotReadyError";
  }
}

export function containerArguments(name: string, profile: ContainerProfile): string[] {
  return [
    "run", "--rm", "--interactive",
    "--name", name,
    "--network", "none",
    "--read-only",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--pids-limit", "64",
    "--ulimit", "nofile=256:256",
    "--ulimit", "nproc=64:64",
    "--cpus", "1",
    "--memory", "512m",
    "--memory-swap", "512m",
    "--user", "65534:65534",
    "--env", "HOME=/tmp",
    "--workdir", "/tmp",
    "--tmpfs", "/tmp:rw,exec,nodev,nosuid,size=96m",
    "--entrypoint", "/bin/sh",
    profile.image,
    "-ceu", profile.command
  ];
}

async function imageAvailable(binary: string, profile: ContainerProfile): Promise<boolean> {
  try {
    await exec(binary, ["image", "inspect", profile.image], { timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}

async function collectProcess(
  child: ChildProcessWithoutNullStreams,
  code: string,
  containerName: string,
  binary: string,
  signal?: AbortSignal,
  timeoutMs = TIMEOUT_MS
): Promise<Omit<EngineResult, "durationMs" | "provider">> {
  let stdout = "";
  let stderr = "";
  let outputExceeded = false;
  let timedOut = false;
  let settled = false;
  let termination: Promise<void> | undefined;
  const append = (current: string, chunk: Buffer): string => {
    const remaining = OUTPUT_LIMIT - current.length;
    if (remaining <= 0) return current;
    return current + chunk.toString("utf8").slice(0, remaining);
  };
  const terminate = () => {
    termination ??= removeContainer(binary, containerName).finally(() => { child.kill("SIGKILL"); });
    // Keep rejection handled while the process closes; it is rethrown below.
    void termination.catch(() => undefined);
  };
  const abort = () => terminate();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
  child.stdout.on("data", (chunk: Buffer) => {
    stdout = append(stdout, chunk);
    if (stdout.length + stderr.length >= OUTPUT_LIMIT) {
      outputExceeded = true;
      terminate();
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = append(stderr, chunk);
    if (stdout.length + stderr.length >= OUTPUT_LIMIT) {
      outputExceeded = true;
      terminate();
    }
  });
  child.stdin.on("error", () => { /* Early cancellation can close stdin before source is written. */ });
  child.stdin.end(code);
  if (signal?.aborted === true) terminate();
  try {
    return await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code_) => {
        if (settled) return;
        settled = true;
        if (signal?.aborted === true) {
          resolve({ exitCode: 137, stderr, stdout });
          return;
        }
        if (timedOut) {
          resolve({ exitCode: 124, failureReason: "timeout", stderr: `${stderr}\nExecution timed out after 15 seconds (compilation included). Simplify the code or try again when the server is less busy.`, stdout });
          return;
        }
        if (outputExceeded) stderr += "\n[output truncated at 64000 characters]";
        resolve({ exitCode: code_ ?? 137, ...(outputExceeded ? {failureReason: "output-limit" as const} : {}), stderr, stdout });
      });
    });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    await termination;
  }
}

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
    const profile = CONTAINER_PROFILES.get(language);
    if (profile === undefined) throw new EngineNotReadyError(`Unsupported language: ${language}`);
    if (!await imageAvailable(this.#binary, profile)) {
      throw new EngineNotReadyError(`Image is not prepared. Run: local-runner prepare ${language}`);
    }
    const name = `rcb-${randomUUID()}`;
    const started = performance.now();
    const child = spawn(this.#binary, containerArguments(name, profile), { stdio: ["pipe", "pipe", "pipe"] });
    const result = await collectProcess(child, code, name, this.#binary, signal);
    return {
      ...result,
      durationMs: performance.now() - started,
      provider: `Local container · ${profile.image}`
    };
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
    "--ulimit", "nofile=64:64",
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
  signal?: AbortSignal
): Promise<Omit<EngineResult, "durationMs" | "provider">> {
  let stdout = "";
  let stderr = "";
  let outputExceeded = false;
  let settled = false;
  const append = (current: string, chunk: Buffer): string => {
    const remaining = OUTPUT_LIMIT - current.length;
    if (remaining <= 0) return current;
    return current + chunk.toString("utf8").slice(0, remaining);
  };
  const terminate = () => {
    child.kill("SIGKILL");
    void exec(binary, ["rm", "--force", containerName], { timeout: 3_000 }).catch(() => undefined);
  };
  const abort = () => terminate();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(terminate, TIMEOUT_MS);
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
  child.stdin.end(code);
  try {
    return await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code_) => {
        if (settled) return;
        settled = true;
        if (signal?.aborted === true) {
          reject(new Error("Execution aborted."));
          return;
        }
        if (outputExceeded) stderr += "\n[output truncated at 64000 characters]";
        resolve({ exitCode: code_ ?? 137, stderr, stdout });
      });
    });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

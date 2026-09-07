import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface LocalRunnerConfig {
  port: number;
  token: string;
}

const configDirectory = join(homedir(), ".config", "runnable-code-blocks");
const configFile = join(configDirectory, "local-runner.json");

export async function loadOrCreateConfig(environment: NodeJS.ProcessEnv = process.env): Promise<LocalRunnerConfig> {
  const environmentToken = environment.RCB_LOCAL_RUNNER_TOKEN?.trim();
  if (environmentToken !== undefined && environmentToken.length >= 32) {
    return { port: normalizePort(environment.RCB_LOCAL_RUNNER_PORT), token: environmentToken };
  }
  try {
    const stored = JSON.parse(await readFile(configFile, "utf8")) as unknown;
    if (isConfig(stored)) return stored;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code !== "ENOENT") throw error;
  }
  const config = { port: normalizePort(environment.RCB_LOCAL_RUNNER_PORT), token: randomBytes(32).toString("base64url") };
  await mkdir(configDirectory, { recursive: true, mode: 0o700 });
  await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(configFile, 0o600);
  return config;
}

function isConfig(value: unknown): value is LocalRunnerConfig {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.port === "number"
    && Number.isInteger(record.port)
    && record.port > 0
    && record.port <= 65_535
    && typeof record.token === "string"
    && record.token.length >= 32;
}

function normalizePort(value: string | undefined): number {
  const port = value === undefined ? 17_171 : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Invalid local runner port.");
  return port;
}

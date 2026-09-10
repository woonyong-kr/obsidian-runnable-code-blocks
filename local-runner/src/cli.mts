#!/usr/bin/env node
import { DockerEngine } from "./engine.mjs";
import { loadOrCreateConfig } from "./config.mjs";
import { CONTAINER_PROFILES } from "./profiles.mjs";
import { loadPublicRunnerConfig } from "./public-config.mjs";
import { createPublicRunnerServer } from "./public-server.mjs";
import { createRunnerServer, tokenFingerprint } from "./server.mjs";

const RUNNER_VERSION = "0.1.0";
const command = process.argv[2] ?? "start";
const engine = new DockerEngine(process.env.RCB_CONTAINER_ENGINE ?? "docker");

if (command === "prepare") {
  const requested = process.argv.slice(3);
  const languages = requested.length === 0 || requested.includes("all")
    ? [...CONTAINER_PROFILES.keys()]
    : requested;
  await engine.prepare(languages);
  process.stdout.write(`Prepared: ${languages.join(", ")}\n`);
} else if (command === "list") {
  process.stdout.write(`${[...CONTAINER_PROFILES.keys()].join("\n")}\n`);
} else if (command === "start") {
  const config = await loadOrCreateConfig();
  const server = createRunnerServer({ engine, runnerVersion: RUNNER_VERSION, token: config.token });
  server.listen(config.port, "127.0.0.1", () => {
    process.stdout.write(`Runnable Code Blocks Local Runner ${RUNNER_VERSION}\n`);
    process.stdout.write(`Endpoint: http://127.0.0.1:${String(config.port)}\n`);
    process.stdout.write(`Pairing token: ${config.token}\n`);
    process.stdout.write(`Token fingerprint: ${tokenFingerprint(config.token)}\n`);
  });
} else if (command === "serve-public") {
  const config = loadPublicRunnerConfig();
  const server = createPublicRunnerServer({
    allowedOrigins: config.allowedOrigins,
    engine,
    globalLimitPerHour: config.globalLimitPerHour,
    hostname: config.hostname,
    languages: config.languages,
    maxConcurrent: config.maxConcurrent,
    perIpLimitPerMinute: config.perIpLimitPerMinute,
    runnerVersion: RUNNER_VERSION
  });
  server.listen(config.port, "127.0.0.1", () => {
    process.stdout.write(`Runnable Code Blocks Public Gateway ${RUNNER_VERSION}\n`);
    process.stdout.write(`Tunnel origin: http://127.0.0.1:${String(config.port)}\n`);
    process.stdout.write(`Public hostname: https://${config.hostname}\n`);
    process.stdout.write(`Allowed origins: ${config.allowedOrigins.join(", ")}\n`);
  });
} else {
  throw new Error("Usage: local-runner [start|serve-public|list|prepare [language...|all]]");
}

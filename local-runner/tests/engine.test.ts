// @vitest-environment node
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DockerEngine } from "../src/engine.mjs";

const directories: string[] = [];
afterEach(async () => { vi.useRealTimers(); for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });

const installedImages = [
  "python@sha256:7415fbc3c9e4979cc717d92377ab2bc7b2b4a2af1ac03cc52b5f3f88efedaf3a",
  "docker.io/gmazzo/kotlin@sha256:5b19a73f0ede1f5b103921c3a48ae3035d3fe7cbcde15c3eee039a9a0a3aacfb",
  "unrelated/repository@sha256:6ea5548706b60ac0a602eaf48af74792cbab012d90e811ca8db6184b16b5c3d6",
  "eclipse-temurin@<none>"
];

it("shares capability discovery across clients, matches pinned digests and expires its short cache", async () => {
  vi.useFakeTimers({toFake: ["Date"]});
  const fixture = await fakeImageInventory(installedImages);
  const engine = new DockerEngine(fixture.binary);
  const results = await Promise.all(Array.from({length: 6}, async () => await engine.availableLanguages()));
  for (const result of results) expect(result).toEqual(["kotlin", "python"]);
  expect((await fixture.events()).filter(value => ["listing", "inspect", "version"].includes(value))).toEqual(["listing"]);
  await fixture.images([]);
  expect(await engine.availableLanguages()).toEqual(["kotlin", "python"]);
  vi.setSystemTime(Date.now() + 2_001);
  expect(await engine.availableLanguages()).toEqual([]);
  expect((await fixture.events()).filter(value => value === "listing")).toHaveLength(2);
});

it("does not cache a failed Docker inventory lookup", async () => {
  const fixture = await fakeImageInventory(installedImages, true);
  const engine = new DockerEngine(fixture.binary);
  await expect(engine.availableLanguages()).rejects.toThrow("Docker temporarily unavailable");
  expect(await engine.availableLanguages()).toEqual(["kotlin", "python"]);
});

describe("container cancellation lifecycle", { timeout: 10_000 }, () => {
  it("cleans a container created after cancellation without starting user code", async () => {
    const fixture = await fakeDocker({ pauseCreate: true });
    const controller = new AbortController();
    const pending = new DockerEngine(fixture.binary).run("python", "while True: pass", controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "ExecutionCancelledError" });
    await vi.waitFor(async () => expect(await fixture.events()).toContain("creating"), { timeout: 5_000 });
    controller.abort();
    await fixture.release("create");
    await rejected;
    expect(await fixture.events()).not.toContain("start");
    expect(await fixture.events()).toContain("removed");
  });

  it("waits for removal acknowledgement before returning cancellation", async () => {
    const fixture = await fakeDocker({ pauseRemove: true });
    const controller = new AbortController();
    let settled = false;
    const pending = new DockerEngine(fixture.binary).run("python", "while True: pass", controller.signal).finally(() => { settled = true; });
    const rejected = expect(pending).rejects.toMatchObject({ name: "ExecutionCancelledError" });
    await vi.waitFor(async () => expect(await fixture.events()).toContain("start"), { timeout: 5_000 });
    controller.abort();
    await vi.waitFor(async () => expect(await fixture.events()).toContain("removing"), { timeout: 5_000 });
    expect(settled).toBe(false);
    await fixture.release("remove");
    await rejected;
    expect(await fixture.events()).toContain("removed");
  });

  it("surfaces cleanup failure instead of claiming the container stopped", async () => {
    const fixture = await fakeDocker({ failRemove: true });
    const controller = new AbortController();
    const pending = new DockerEngine(fixture.binary).run("python", "while True: pass", controller.signal);
    const rejected = expect(pending).rejects.not.toMatchObject({ name: "ExecutionCancelledError" });
    await vi.waitFor(async () => expect(await fixture.events()).toContain("start"), { timeout: 5_000 });
    controller.abort();
    await rejected;
    expect(await fixture.events()).not.toContain("removed");
  });
});

it("reports the compilation deadline and removes the container when a process produces no output", async () => {
  const fixture = await fakeDocker({});
  const result = await new DockerEngine(fixture.binary).run("kotlin", 'fun main() { println("hello") }');
  expect(result).toMatchObject({ exitCode: 124, failureReason: "timeout", stdout: "" });
  expect(result.stderr).toContain("15 seconds (compilation included)");
  expect(await fixture.events()).toContain("removed");
}, 20_000);

it.each([true, false])("distinguishes confirmed OOM from an unexplained nonzero exit (OOM=%s)", async oom => {
  const fixture = await fakeDocker({exitCode: 137, oom});
  const result = await new DockerEngine(fixture.binary).run("kotlin", "source");
  expect(result).toMatchObject({exitCode: 137, failureReason: oom ? "out-of-memory" : "process-exit"});
  expect(result.stderr).toContain(oom ? "memory limit (512 MiB)" : "code 137");
  expect(await fixture.events()).toContain("removed");
});

async function fakeImageInventory(images: string[], failOnce = false) {
  const path = await mkdtemp(join(tmpdir(), "rcb-image-inventory-"));
  directories.push(path);
  const binary = join(path, "docker");
  const events = join(path, "events");
  const writeImages = async (value: string[]) => { await writeFile(join(path, "images"), value.join("\n")); };
  await writeImages(images);
  await writeFile(events, "");
  if (failOnce) await writeFile(join(path, "fail-once"), "");
  // Inventory/cache behavior should not depend on booting a Node VM inside the
  // production two-second Docker deadline. Keep a real executable boundary.
  await writeFile(binary, `#!/bin/sh
cd -- "$(dirname -- "$0")" || exit 2
[ "$1" = image ] && [ "$2" = ls ] || exit 2
printf 'listing\\n' >> events
if [ -f fail-once ]; then
  rm fail-once
  printf 'Docker temporarily unavailable\\n' >&2
  exit 1
fi
cat images
`, { mode: 0o700 });
  return { binary, images: writeImages, events: async () => (await readFile(events, "utf8")).split("\n") };
}

async function fakeDocker(options: { pauseCreate?: boolean; pauseRemove?: boolean; failRemove?: boolean; exitCode?: number; oom?: boolean }) {
  const path = await mkdtemp(join(tmpdir(), "rcb-cancel-engine-"));
  directories.push(path);
  const binary = join(path, "docker");
  const events = join(path, "events");
  await writeFile(events, "");
  await writeFile(binary, `#!${process.execPath}
const fs = require('node:fs');
const dir = ${JSON.stringify(path)}, options = ${JSON.stringify(options)};
const log = value => fs.appendFileSync(dir + '/events', value + '\\n');
const wait = name => new Promise(resolve => { const timer = setInterval(() => { if (fs.existsSync(dir + '/' + name)) { clearInterval(timer); resolve(); } }, 10); });
(async () => {
  const command = process.argv[2];
  if (command === 'version') { log('version'); process.stdout.write('29.4'); return; }
  if (command === 'create') { log('creating'); if (options.pauseCreate) await wait('create'); fs.writeFileSync(dir + '/container', 'exists'); log('created'); return; }
  if (command === 'inspect') { process.stdout.write(String(options.oom === true)); return; }
  if (command === 'start') { log('start'); if (options.exitCode) { process.exitCode = options.exitCode; return; } process.stdin.resume(); setInterval(() => {}, 1000); return; }
  if (command === 'rm') {
    log('removing'); if (options.failRemove) { process.stderr.write('Docker daemon unavailable'); process.exitCode = 1; return; }
    if (options.pauseRemove) await wait('remove');
    fs.rmSync(dir + '/container', {force:true}); log('removed'); return;
  }
})().catch(e => { console.error(e); process.exitCode=1; });
`, { mode: 0o700 });
  return { binary, events: async () => (await readFile(events, "utf8")).split("\n"), release: async (name: string) => { await writeFile(join(path, name), ""); } };
}

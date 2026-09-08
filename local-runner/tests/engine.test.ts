// @vitest-environment node
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DockerEngine } from "../src/engine";

const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });

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
  if (command === 'image') return;
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

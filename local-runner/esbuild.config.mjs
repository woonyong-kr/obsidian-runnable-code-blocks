import esbuild from "esbuild";
import { chmod, mkdir } from "node:fs/promises";

await mkdir("local-runner/dist", { recursive: true });
await esbuild.build({
  bundle: true,
  entryPoints: ["local-runner/src/cli.ts"],
  format: "esm",
  minify: true,
  outfile: "local-runner/dist/runnable-code-blocks-local-runner.mjs",
  platform: "node",
  target: "node22"
});
await chmod("local-runner/dist/runnable-code-blocks-local-runner.mjs", 0o755);

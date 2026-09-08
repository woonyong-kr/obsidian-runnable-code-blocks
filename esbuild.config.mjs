import esbuild from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { reactRuntimePlugin } from "./scripts/react-runtime-plugin.mjs";

import { previewWorkerPlugin } from "./scripts/preview-worker-plugin.mjs";

const production = process.argv[2] === "production";
const shared = {
  bundle: true,
  logLevel: "info",
  minify: production,
  plugins: [reactRuntimePlugin(), previewWorkerPlugin()],
  sourcemap: production ? false : "inline",
  target: "es2022",
  treeShaking: true,
};

await esbuild.build({
  ...shared,
  entryPoints: ["src/main.ts"],
  external: ["obsidian", "electron"],
  format: "cjs",
  outfile: "main.js",
  platform: "node",
});

await rm("dist-site", { recursive: true, force: true });
await mkdir("dist-site", { recursive: true });
await esbuild.build({
  ...shared,
  entryPoints: ["site/main.ts"],
  format: "esm",
  outfile: "dist-site/main.js",
  platform: "browser",
});
await Promise.all([
  copyFile("site/index.html", "dist-site/index.html"),
  copyFile("THIRD_PARTY_NOTICES.md", "dist-site/THIRD_PARTY_NOTICES.txt"),
  copyFile("styles.css", "dist-site/plugin.css"),
  copyFile("site/styles.css", "dist-site/styles.css"),
]);

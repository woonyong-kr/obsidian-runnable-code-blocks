import esbuild from "esbuild";
import { isBuiltin } from "node:module";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { reactRuntimePlugin } from "./scripts/react-runtime-plugin.mjs";

import { previewWorkerPlugin } from "./scripts/preview-worker-plugin.mjs";

const production = process.argv[2] === "production";
const thirdPartyNotices = await readFile("THIRD_PARTY_NOTICES.md", "utf8");
const shared = {
  bundle: true,
  logLevel: "info",
  minify: production,
  plugins: [reactRuntimePlugin(), previewWorkerPlugin()],
  sourcemap: production ? false : "inline",
  target: "es2022",
  treeShaking: true,
};

const pluginBuild = await esbuild.build({
  ...shared,
  entryPoints: ["src/main.ts"],
  external: ["obsidian", "electron"],
  format: "cjs",
  outfile: "main.js",
  platform: "node",
  metafile: true,
  banner: { js: `/*!\n${thirdPartyNotices.replaceAll("*/", "* /")}\n*/` },
});
for (const [path, input] of Object.entries(pluginBuild.metafile.inputs)) {
  if (path.startsWith("local-runner/") || input.imports.some(({ external, path }) => external && isBuiltin(path))) {
    throw new Error(`Node-only code must not enter the Obsidian plugin: ${path}`);
  }
}

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

// Validate the restricted host entry independently of the general-purpose demo.
const privateWebBuild = await esbuild.build({
  ...shared,
  entryPoints: ["src/private-web-adapter.ts"],
  format: "esm",
  platform: "browser",
  write: false,
  metafile: true,
});
for (const input of Object.keys(privateWebBuild.metafile.inputs)) {
  if (/src\/(?:main|provider-catalog|runner-composition|remote-runner-factory)\.ts$|runners\/(?:wandbox|dartpad|swiftfiddle|kotlin-playground|local-companion)-/u.test(input)) {
    throw new Error(`Restricted web adapter imports a disallowed provider: ${input}`);
  }
}

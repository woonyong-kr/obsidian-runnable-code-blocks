import esbuild from "esbuild";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { restrictReactDOM } from "./restrict-react-dom.mjs";

const VIRTUAL_MODULE = "virtual:react-runtime";
const VIRTUAL_NAMESPACE = "runnable-code-blocks-react-runtime";
const require = createRequire(import.meta.url);
const runtimeEntry = fileURLToPath(new URL("./react-runtime-entry.ts", import.meta.url));

let runtimeBundle;

export function reactRuntimePlugin() {
  return {
    name: "react-runtime",
    setup(build) {
      build.onResolve({ filter: /^virtual:react-runtime$/ }, () => ({
        namespace: VIRTUAL_NAMESPACE,
        path: VIRTUAL_MODULE
      }));
      build.onLoad({ filter: /.*/, namespace: VIRTUAL_NAMESPACE }, async () => ({
        contents: `export default ${JSON.stringify(await bundledReactRuntime())};`,
        loader: "js"
      }));
    }
  };
}

export function reactRuntimeVitePlugin() {
  const resolvedId = `\0${VIRTUAL_MODULE}`;
  return {
    name: "react-runtime",
    resolveId(id) {
      return id === VIRTUAL_MODULE ? resolvedId : null;
    },
    async load(id) {
      return id === resolvedId
        ? `export default ${JSON.stringify(await bundledReactRuntime())};`
        : null;
    }
  };
}

async function bundledReactRuntime() {
  runtimeBundle ??= Promise.all([
    esbuild.build({
      bundle: true,
      define: {
        "process.env.NODE_ENV": JSON.stringify("production")
      },
      entryPoints: [runtimeEntry],
      format: "iife",
      logLevel: "silent",
      minify: true,
      platform: "browser",
      plugins: [{
        name: "restricted-react-dom",
        setup(build) {
          let restricted = false;
          build.onLoad({ filter: /[/\\]react-dom[/\\]cjs[/\\]react-dom-client\.production\.js$/ }, async ({ path }) => {
            const contents = restrictReactDOM(await readFile(path, "utf8"));
            restricted = true;
            return { contents, loader: "js" };
          });
          build.onEnd(() => {
            if (!restricted) throw new Error("The restricted ReactDOM runtime was not included.");
          });
        }
      }],
      target: "es2022",
      write: false
    }),
    readFile(require.resolve("react/package.json"), "utf8")
  ]).then(([result, packageJson]) => {
    const output = result.outputFiles?.[0];
    if (output === undefined) throw new Error("React runtime bundle was not generated.");
    const metadata = JSON.parse(packageJson);
    if (typeof metadata.version !== "string") throw new Error("React package version is missing.");
    return { source: output.text, version: metadata.version };
  });
  return await runtimeBundle;
}

import type { CodeRunner, RunContext, RunResult } from "../contracts";
import { appendElement } from "../dom";
import { OUTPUT_LIMITS } from "../output-buffer";

type PreviewLanguage = "css" | "html" | "react" | "web" | "web-ts";

const STATIC_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "connect-src 'none'",
  "font-src data:",
  "form-action 'none'",
  "img-src data: blob:",
  "media-src data: blob:",
  "object-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  "worker-src 'none'"
].join("; ");

const INTERACTIVE_CSP = STATIC_CSP.replace("script-src 'none'", "script-src 'unsafe-inline'");

const CSS_SPECIMEN = String.raw`
<style>
  :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px; background: #f5f6f8; color: #202124; }
  .preview { display: grid; min-height: 220px; place-items: center; }
  .preview-card { width: min(100%, 360px); padding: 24px; border: 1px solid #d9dce1; border-radius: 12px; background: #fff; box-shadow: 0 12px 32px rgb(31 35 40 / 10%); }
  .preview-eyebrow { color: #59616b; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .preview-title { margin: 8px 0 6px; font-size: 22px; }
  .preview-copy { margin: 0 0 20px; color: #59616b; line-height: 1.55; }
  .preview-button { border: 1px solid #c7cbd1; border-radius: 8px; padding: 9px 14px; background: #fff; color: #202124; font: inherit; font-weight: 700; }
  @media (prefers-color-scheme: dark) {
    body { background: #1e1f22; color: #dfe1e5; }
    .preview-card { border-color: #43454a; background: #2b2d30; box-shadow: 0 12px 32px rgb(0 0 0 / 28%); }
    .preview-eyebrow, .preview-copy { color: #a8adb5; }
    .preview-button { border-color: #4c4f55; background: #393b40; color: #dfe1e5; }
  }
</style>
<main class="preview">
  <article class="preview-card">
    <span class="preview-eyebrow">CSS playground</span>
    <h1 class="preview-title">Style a real component</h1>
    <p class="preview-copy">Your CSS is applied after this neutral specimen.</p>
    <button class="preview-button" type="button">Continue</button>
  </article>
</main>`;

const INTERACTIVE_BASE_STYLE = String.raw`<style>
  :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, sans-serif; }
  body { margin: 0; padding: 24px; }
</style>`;

const CONSOLE_BRIDGE = String.raw`${INTERACTIVE_BASE_STYLE}<script>
(() => {
  const entryLimit = ${OUTPUT_LIMITS.entries};
  const characterLimit = ${OUTPUT_LIMITS.characters};
  const marker = ${JSON.stringify(OUTPUT_LIMITS.marker)};
  let entries = 0;
  let characters = 0;
  let truncated = false;
  const format = (value) => {
    if (typeof value === "string") return value;
    if (typeof value === "undefined") return "undefined";
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  };
  const send = (type, message) => {
    if (truncated) return;
    if (entries >= entryLimit || characters + message.length > characterLimit) {
      truncated = true;
      parent.postMessage({ sender: "runnable-code-blocks-preview", type: "warn", message: marker }, "*");
      return;
    }
    entries += 1;
    characters += message.length;
    parent.postMessage({ sender: "runnable-code-blocks-preview", type, message }, "*");
  };
  for (const level of ["log", "info", "warn", "error"]) {
    const original = console[level].bind(console);
    console[level] = (...values) => {
      send(level, values.map(format).join(" "));
      original(...values);
    };
  }
  window.addEventListener("error", (event) => send("error", event.error?.stack || event.message));
  window.addEventListener("unhandledrejection", (event) => send("error", format(event.reason)));
  window.addEventListener("DOMContentLoaded", () => send("ready", "Preview ready"), { once: true });
})();
</script>`;

const HEIGHT_REPORTER = String.raw`
(() => {
  let queued = false;
  const report = () => {
    queued = false;
    const root = document.documentElement;
    const body = document.body;
    const height = Math.max(
      1,
      root.scrollHeight,
      root.offsetHeight,
      body?.scrollHeight ?? 0,
      body?.offsetHeight ?? 0
    );
    parent.postMessage({ sender: "runnable-code-blocks-preview", type: "resize", height }, "*");
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    setTimeout(report, 0);
  };
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(schedule);
    observer.observe(document.documentElement);
    if (document.body) observer.observe(document.body);
  }
  new MutationObserver(schedule).observe(document.documentElement, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true
  });
  addEventListener("DOMContentLoaded", schedule, { once: true });
  addEventListener("load", schedule, { once: true });
  schedule();
  setTimeout(schedule, 50);
  setTimeout(schedule, 250);
})();`;

const REACT_ROOT = '<div id="root"></div>';

const REACT_MODULES = String.raw`
const require = (specifier) => {
  if (specifier === "react") return runtime.React;
  if (specifier === "react-dom") return runtime.ReactDOM;
  if (specifier === "react-dom/client") return runtime.ReactDOMClient;
  throw new Error(
    "Unsupported import: " + specifier + ". run-react includes React and ReactDOM; use one self-contained example."
  );
};`;

export class BrowserPreviewRunner implements CodeRunner {
  readonly environment = "browser" as const;
  readonly language: PreviewLanguage;

  constructor(language: PreviewLanguage) {
    this.language = language;
  }

  async availability() {
    if (typeof document === "undefined") {
      return { available: false, detail: "Preview에는 DOM이 필요합니다." };
    }
    return this.language === "react" || this.language === "web" || this.language === "web-ts"
      ? {
          available: true,
          detail: "Interactive code runs in an isolated frame. Network requests, external resources, popups, form submission, top navigation, and same-origin access are blocked."
        }
      : {
          available: true,
          detail: "script, network, top navigation 및 same-origin 접근이 차단된 iframe에서 렌더링합니다."
        };
  }

  async run(code: string, context?: RunContext): Promise<RunResult> {
    context?.signal?.throwIfAborted();
    if (this.language === "react") {
      const [{ getVersion, transform }, { default: reactRuntime }] = await Promise.all([import("sucrase"), import("virtual:react-runtime")]);
      context?.signal?.throwIfAborted();
      const started = performance.now();
      const provider = `React ${reactRuntime.version} · Sucrase ${getVersion()} → interactive browser sandbox`;
      try {
        const compiled = compileReactModule(code, transform);
        const application = reactApplication(compiled, reactRuntime.source);
        return {
          ...previewResult(
            secureDocument(application, INTERACTIVE_CSP, CONSOLE_BRIDGE),
            "isolated",
            provider
          ),
          durationMs: performance.now() - started
        };
      } catch (error) {
        return {
          durationMs: performance.now() - started,
          environment: "browser",
          exitCode: 1,
          provider,
          stderr: error instanceof Error ? error.message : String(error),
          stdout: ""
        };
      }
    }
    if (this.language === "web") {
      return previewResult(
        secureDocument(code, INTERACTIVE_CSP, CONSOLE_BRIDGE),
        "isolated",
        "Interactive browser sandbox"
      );
    }
    if (this.language === "web-ts") {
      const { getVersion, transform } = await import("sucrase");
      context?.signal?.throwIfAborted();
      const started = performance.now();
      const provider = `Sucrase ${getVersion()} → interactive browser sandbox`;
      try {
        const html = transpileTypeScriptScripts(code, transform);
        return {
          ...previewResult(secureDocument(html, INTERACTIVE_CSP, CONSOLE_BRIDGE), "isolated", provider),
          durationMs: performance.now() - started
        };
      } catch (error) {
        return {
          durationMs: performance.now() - started,
          environment: "browser",
          exitCode: 1,
          provider,
          stderr: error instanceof Error ? error.message : String(error),
          stdout: ""
        };
      }
    }
    if (this.language === "css") {
      const html = `${CSS_SPECIMEN}<style>${escapeClosingStyle(code)}</style>`;
      return previewResult(secureDocument(html, STATIC_CSP), "blocked", "Sandboxed CSS preview");
    }
    return previewResult(secureDocument(code, STATIC_CSP), "blocked", "Sandboxed HTML preview");
  }
}

function compileReactModule(code: string, transform: typeof import("sucrase").transform): string {
  return transform(code, {
    disableESTransforms: true,
    jsxRuntime: "classic",
    production: true,
    transforms: ["typescript", "jsx", "imports"]
  }).code;
}

function reactApplication(compiled: string, runtimeSource: string): string {
  const runtime = escapeClosingScript(runtimeSource);
  const application = escapeClosingScript(compiled);
  return `${REACT_ROOT}<script>${runtime}</script><script>
(() => {
  const runtime = globalThis.__RCB_REACT_RUNTIME__;
  if (!runtime) throw new Error("React runtime failed to initialize.");
  const React = runtime.React;
  const module = { exports: {} };
  const exports = module.exports;
  ${REACT_MODULES}
  ${application}
  const exported = module.exports;
  const Component = exported.default || exported.App;
  if (typeof Component !== "function" && typeof Component !== "object") {
    throw new Error("run-react requires an exported default component or a named App export.");
  }
  const container = document.querySelector("#root");
  if (!container) throw new Error("React preview root is missing.");
  runtime.ReactDOMClient.createRoot(container).render(React.createElement(Component));
})();
</script>`;
}

function previewResult(
  html: string,
  scripts: NonNullable<RunResult["preview"]>["scripts"],
  provider: string
): RunResult {
  return {
    durationMs: 0,
    environment: "browser",
    exitCode: 0,
    provider,
    preview: { html, kind: "html", scripts },
    stderr: "",
    stdout: ""
  };
}

function secureDocument(html: string, policy: string, prefix = ""): string {
  const document_ = new DOMParser().parseFromString(html, "text/html");
  const nonce = createNonce();
  const security = appendElement(document_.head, "meta");
  security.setAttribute("http-equiv", "Content-Security-Policy");
  security.setAttribute(
    "content",
    policy.replace("script-src 'none'", `script-src 'nonce-${nonce}'`)
  );
  if (prefix !== "") {
    const trusted = new DOMParser().parseFromString(
      `<!doctype html><html><head>${prefix}</head><body></body></html>`,
      "text/html"
    );
    document_.head.prepend(security, ...trusted.head.childNodes);
  } else {
    document_.head.prepend(security);
  }
  const heightReporter = appendElement(document_.body, "script");
  heightReporter.setAttribute("nonce", nonce);
  heightReporter.textContent = HEIGHT_REPORTER;
  return `<!doctype html>${document_.documentElement.outerHTML}`;
}

function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

function transpileTypeScriptScripts(html: string, transform: typeof import("sucrase").transform): string {
  const document_ = new DOMParser().parseFromString(html, "text/html");
  const scripts = document_.querySelectorAll<HTMLScriptElement>('script[type="text/typescript"]');
  for (const script of scripts) {
    script.textContent = transform(script.textContent, {
      disableESTransforms: true,
      production: true,
      transforms: ["typescript"]
    }).code;
    script.type = "text/javascript";
  }
  if (scripts.length === 0) {
    throw new Error('run-web-ts requires at least one <script type="text/typescript"> block.');
  }
  return `<!doctype html>${document_.documentElement.outerHTML}`;
}

function escapeClosingStyle(css: string): string {
  return css.replace(/<\/style/giu, "<\\/style");
}

function escapeClosingScript(javascript: string): string {
  return javascript.replace(/<\/script/giu, "<\\/script");
}

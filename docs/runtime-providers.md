# Runtime provider architecture

The stable public contract is the Markdown fence `run-<language>`. Environment and provider selection are implementation details behind `CodeRunner`.

## Composition

```text
Markdown fence
  → supported-languages catalog
  → runner-composition
  → browser / local / remote adapter order
  → availability preflight
  → one execution result
```

- Static web and Obsidian compose the same remote and browser-native adapters. A static host may additionally opt into a project-owned personal compiler gateway without exposing the authenticated localhost companion.
- New Obsidian installs default to `private-first`: browser, optional local companion, then remote. Existing remote-first settings remain valid; static hosts use the reusable web adapter to add an explicitly configured personal compiler before remote providers.
- A compile error, runtime exception, non-zero exit, or empty stdout is a completed execution result and never triggers fallback.

## Fallback state machine

| Provider outcome | Meaning | Try next adapter? |
| --- | --- | --- |
| Availability false | No source submitted | Yes |
| `ProviderUnavailableError("not-started")` | Rejection is known to precede execution | Yes |
| `ProviderUnavailableError("unknown")` | Request may have executed but its result is unknown | No |
| `RunResult` with any exit code | Execution completed | No |
| Unexpected adapter exception | Adapter contract failure | No |

This conservative boundary prevents a remote timeout, lost connection, or ambiguous HTTP failure from being followed by a second execution with the same side effects. Only authentication/path/rate-limit rejection and explicitly recognized pre-execution infrastructure rejection are classified `not-started`.

## Provider map

| Adapter | Languages | Boundary |
| --- | --- | --- |
| `wandbox-runner.ts` | JavaScript, TypeScript, Python, SQL, Java, C, C++, Go, Rust, C#, Ruby, PHP, R, Scala, Lua, Shell | Source sent to `wandbox.org` |
| `kotlin-playground-runner.ts` | Kotlin | Source sent to `api.kotlinlang.org` |
| `swiftfiddle-runner.ts` | Swift | Source sent to `runner.swift-playground.com` |
| `dartpad-runner.ts` | Dart | `stable.api.dartpad.dev` compiles source; returned JavaScript runs in a temporary sandboxed `dartpad.dev/frame.html` |
| `javascript-runner.ts` | JavaScript | Fresh local Web Worker |
| `typescript-runner.ts` | TypeScript | Bundled TypeScript transpiler → fresh Web Worker |
| `browser-preview-runner.ts` | HTML, CSS, Web, Web TypeScript, React JSX/TSX | Static or interactive sandboxed iframe with restrictive CSP; React and ReactDOM are bundled at build time |
| `local-companion-runner.ts` | Python, SQL, Kotlin, Java, C, C++, Go, Rust, C#, Swift, Ruby, PHP, R, Dart, Lua, Shell | Authenticated `127.0.0.1` companion; source remains on the desktop |
| `personal-compiler-runner.ts` | Same explicitly prepared container languages | HTTPS static-site gateway; exact Origin/Host allowlist, quotas, idempotency, and sanitized results |

External providers are public services, not project infrastructure. They may change endpoints, compiler names, CORS, limits, or availability without a release from this project. They provide convenience execution, not an uptime guarantee. DartPad's old arbitrary-code embed protocol is not used; its supported compile API and execution frame are separate adapter steps.

## Community runtime boundary

The Community Plugin does not download an SDK, package manager, compiler, interpreter, or daemon. Plugin runtime source does not access the filesystem, spawn child processes, mutate `PATH`, or write outside the Obsidian vault. The separately downloaded companion owns all process execution, remains disabled by default, binds only to loopback, and requires an Obsidian SecretStorage token.

The companion accepts source text only and never accepts a host path. It runs explicitly prepared digest-pinned images as non-root with a read-only root filesystem, temporary writable work directory, disabled network, dropped capabilities, and CPU, memory, PID, execution-time, concurrency, source-size, and output limits. It never installs a compiler into the host or changes the host `PATH`.

The optional public gateway is a separate process and protocol boundary. It has no browser-visible bearer token, accepts only configured static-site origins, and must remain on loopback behind a dedicated outbound tunnel. It shares the sandboxed container engine but never publishes the private companion endpoint or returns image digests. Its request UUID makes one transport retry idempotent; capacity and rate-limit rejections are known not to have started execution.

## Adapter maintenance contract

Provider churn should remain a narrow patch:

1. Change endpoint, compiler selection, request serialization, and response parsing only in the affected `src/runners/*-runner.ts` file.
2. Preserve `CodeRunner`, `RunResult`, and `ProviderUnavailableError` semantics.
3. Add or update the focused mocked contract test in `tests/remote-runners.test.ts`.
4. Run `npm run verify`, followed by the explicit provider smoke command for that language.
5. Change `src/supported-languages.ts` only when the public support claim or adapter mapping changes.

Shared UI and Markdown parsing must not import provider-specific request schemas. `scripts/verify-release.mjs` checks the adapter inventory, 24-fence documentation, network-origin allowlist, forbidden runtime Node imports, bundle ceiling, and version alignment.

## Adding a language

A supported language requires all of the following:

- one canonical ID and `run-<id>` fence in `src/supported-languages.ts`;
- syntax highlighting in `src/editor.ts`;
- at least one executable adapter;
- a deterministic sample in `src/language-examples.ts`;
- mocked adapter and composition tests;
- a successful build and, where applicable, live smoke evidence;
- README and release-verifier coverage.

Do not claim “all languages.” The project currently supports the exact 24-fence catalog documented in the README.


<details>
<summary>Community scanner findings and why some APIs remain</summary>

The [Community plugin page](https://community.obsidian.md/plugins/runnable-code-blocks) combines source analysis with release checks. A source finding is not proof that the installed plugin uses that API.

| Finding | Runtime boundary and handling |
| --- | --- |
| Node imports and bare timers in `local-runner/src` | These belong to the separately started Node.js companion. Its explicit ESM (`.mts`) source has an independent NodeNext type check without browser globals. The plugin build rejects any companion or Node built-in import. The companion artifact has its own release. |
| Extra release files | Plugin releases from 0.7.3 contain only `main.js`, `manifest.json`, and `styles.css`. Third-party notices are embedded in `main.js`; optional companion files are distributed separately. |
| CSS `:has()` | Replaced with a lifecycle-managed host class and `:focus-within`, retaining hover, keyboard, and touch access to source editing. |
| Dynamic script creation in bundled ReactDOM | From 0.7.5, the build removes ReactDOM’s script-resource implementations and replaces them with an explicit unsupported-operation error. This covers `preinit`, `preinitModule`, and rendered script elements. The reviewed upstream source hash is checked before applying the restriction. Components, hooks, events, and portals remain supported; the Worker, sanitizer, and CSP remain additional boundaries. See `scripts/restrict-react-dom.mjs` and the browser regressions. |
| `document.createElement` and canvas type checks | These run in explicit browser ESM modules with a browser-only type check. Obsidian’s main-window DOM extensions are unavailable in isolated preview documents and the Worker DOM realm; native constructors refer to that isolated realm. |
| Clipboard access | Only the explicit Copy button writes the edited code to its window's clipboard. The plugin never reads clipboard contents. |

Unavailable scanner checks and normal runtime disclosures are not reported as passed checks. Please include the individual finding and affected file when reporting a scanner result.

</details>

## Publish runnable notes on a website

The browser adapter recognizes ordinary rendered Markdown:

```html
<pre><code class="language-run-python">print("Hello")</code></pre>
```

It shares the fence parser, language catalog, runner composition, editor, and output UI with the Obsidian plugin. A static host can use browser-native and named remote adapters only, or explicitly configure the separate personal-compiler gateway for prepared container languages. The reusable `createStaticWebRunnerRegistry` adapter keeps that provider policy outside the renderer, so another Wiki can supply its own endpoint without forking the editor or runner code. The gateway never exposes the authenticated localhost companion and can be offline without disabling JavaScript, TypeScript, HTML, CSS, Web, Web TypeScript, or React examples. The deployed adapter is available as a [live 24-fence demo](https://woonyong-choi.github.io/obsidian-runnable-code-blocks/).


## Hosts with changeable provider configuration

Pass a function to `createStaticWebRunnerRegistry` when a host can repair its endpoint without recreating the editor:

```typescript
const fetchForHost = window.fetch.bind(window);
const registry = createStaticWebRunnerRegistry(() => ({
  fetch: fetchForHost,
  personalCompilerEndpoint: configuredEndpoint,
  remoteExecutionEnabled: false,
}));
```

Keep the fetch function stable in real integrations. The options are read again for availability and execution. Invalid personal-compiler configuration makes that provider unavailable; built-in browser runners remain available. After changing the endpoint, call the mounted block's `refreshAvailability()`. A successful preflight never submits source: only `run()` does. Keep `remoteExecutionEnabled: false` when public third-party fallback is forbidden. A static options object retains its eager endpoint validation. Host DOM mounting, localization, lazy loading, and deployment remain host-owned.

The shared adapter is ready for hosts to replace direct runner composition. Each host should validate its endpoint recovery, lazy mounting, Stop acknowledgement, and disabled-public-provider policy before updating its pinned adapter.

### Restricted website bundle

Hosts that prohibit public third-party providers and the localhost companion should import `createPrivateWebRunnerRegistry` from `src/private-web-adapter.ts`, rather than the general `web-adapter` entry. It accepts a static object or a function returning `{ fetch, personalCompilerEndpoint }`. Browser-supported fences always select their built-in runner; other prepared languages use only the configured personal compiler. There is no fallback chain in this entry.

It shares browser/personal factories and policy refresh with the plugin. The build independently bundles this entry and rejects public-provider, general-composition, and localhost-companion dependencies. Malformed or absent endpoints remain recoverable provider-unavailable states without preventing browser examples from mounting.

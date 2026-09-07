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
- New Obsidian installs default to `private-first`: browser, optional local companion, then remote. Existing remote-first settings remain valid; the static adapter stays remote-first because it has no local companion.
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
| `local-companion-runner.ts` | Python, SQL, Kotlin, Java, C, C++, Go, Rust, C#, Swift, Ruby, PHP, R, Scala, Dart, Lua, Shell | Authenticated `127.0.0.1` companion; source remains on the desktop |
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

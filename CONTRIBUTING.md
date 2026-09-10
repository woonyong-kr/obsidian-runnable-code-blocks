# Contributing

Run the checks affected by a change and use `npm run verify` for an unverified integration or release candidate. Reuse results for unchanged inputs and environments. `npm test` runs the unit suite without instrumentation; `npm run test:coverage` is an optional diagnostic. New languages must keep the `run-<language>` Markdown contract and implement `CodeRunner` without changing existing documents.

Never auto-run document code. A runner must report availability, enforce a timeout, avoid persistence by default, and document whether it executes locally, in a browser sandbox, or through an external service.

Keep provider-specific URLs, request schemas, compiler selection, and response parsing inside one `src/runners/*-runner.ts` adapter. Remote adapters must identify where source is sent, require no secret in the public bundle, and distinguish known `not-started` rejection from an `unknown` outcome that must not be executed again. Project-owned public execution infrastructure is out of scope; named third-party adapters require focused contract tests and intentional live smoke evidence.

Local execution belongs only in `local-runner/`. The Community Plugin may call its versioned loopback protocol but must not import Node process/filesystem modules, spawn tools, install dependencies, or become desktop-only. New local profiles require a multi-architecture digest-pinned image, a static command receiving user source only through stdin, containment tests, and an actual container smoke test on a supported host.

## Runtime-specific source checks

The Node companion uses explicit `.mts` ESM modules with `.mjs` import specifiers and `local-runner/tsconfig.json` (NodeNext, ES2022, no DOM globals). Browser-only DOM/preview entries use `.mts` and `tsconfig.browser.json` (DOM/Worker libraries, no Node ambient types). Shared DOM interfaces live in `src/dom-types.ts`; browser adapters do not import the Obsidian implementation. `npm run check` includes all three type-check boundaries and ESLint still checks all `.ts` and `.mts` sources. The plugin build traces esbuild inputs and rejects companion or Node built-in imports.

The Community scanner documents `.mts` as outside its plugin-source rules in the [official FAQ](https://docs.obsidian.md/community-directory/faq). Those files are still built, locally linted, tested, and covered by release reproduction; this separation does not remove functionality or move code into test directories. The release still includes only `main.js`, `manifest.json`, and `styles.css`.

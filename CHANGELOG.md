# Changelog

## 0.7.1

- Use one Run/Stop action with a spinning SVG indicator; reset copy feedback after 1.5 seconds.
- Show Obsidian source editing on hover or keyboard focus and fix toolbar spacing, nested gutters, and hover frames.
- Restore controls after automatic Worker termination and rate-limit timers, including early wakeups and clock changes.
- Contain rejected HTTP requests and reduce Kotlin compiler startup work without changing execution limits.
- Refresh README media and make coverage optional while retaining cancellation, sandbox, and provider regression tests.

## 0.7.0

- Add a separate, opt-in public personal-compiler gateway for static sites, with exact Host and Origin checks, per-client and global quotas, concurrency control, idempotent request IDs, and sanitized responses.
- Keep the authenticated localhost companion private while allowing a dedicated outbound tunnel to publish only the hardened gateway; static clients explain planned personal-server downtime instead of presenting a provider error.
- Let static sites configure the personal compiler through one reusable web-runner adapter instead of duplicating provider policy in each renderer.
- Extend isolated container executions to a 15-second ceiling and cap open files and processes in addition to the existing network, filesystem, privilege, CPU, memory, PID, source, and output boundaries.
- Raise the open-file limit enough for the .NET SDK to start while preserving every other sandbox boundary.
- Remove the non-working Scala container claim: the official sbt image does not bundle the standalone `scala` or `scalac` CLI, so Scala remains available through its named remote provider until a verified offline image is added.

## 0.6.0

- Add an opt-in localhost companion for 17 native and interpreted languages while preserving the existing browser and remote adapters and the portable `run-<language>` Markdown contract.
- Keep the Community Plugin mobile-compatible: it talks to the companion over authenticated loopback HTTP, stores the pairing token in Obsidian SecretStorage, and never spawns a process or installs a runtime itself.
- Run local code in explicitly prepared, digest-pinned containers with no network, a read-only root filesystem, non-root UID, dropped capabilities, and CPU, memory, PID, time, source-size, concurrency, and output limits.
- Make private-first the safe default for new installs: browser-native execution wins where available, then the local companion, then an enabled remote provider. Preserve remote-first for existing settings that selected it.
- Package the standalone Node.js 22 companion as a release asset and document targeted image preparation so the complete multi-language toolchain is never downloaded silently.

## 0.5.1

- Require the per-preview token on every relayed message and cap the outer relay independently, so direct inner-frame messages cannot bypass the shared output limit.
- Add no-referrer and explicit browser-permission restrictions to both preview frames while preserving the opaque-origin, no-same-origin sandbox boundary.
- Use Obsidian's native DOM helpers in the plugin bundle and isolate standards-based DOM creation in the static-site adapter.
- Add Chromium regressions proving that ReactDOM script-resource paths are rejected by CSP and that direct preview message floods produce one bounded truncation marker.

## 0.5.0

- Replace the fixed IntelliJ/Darcula palette with Obsidian semantic theme tokens while keeping one shared component and runner implementation for Obsidian and static hosts.
- Extract the declarative language catalog, remote runner factory, native DOM helpers, execution cancellation, and bounded output into focused boundaries so provider changes remain adapter-local.
- Wait for interactive previews to become ready before reporting success, reject malformed provider responses, prevent duplicate Dart execution, and refresh mounted availability immediately after privacy-setting changes.
- Add actual Chromium gates for editing and Reset, React interaction and `react-dom` portals, live host-token changes, keyboard focus, 102/103-line scrolling, sandbox navigation containment, and real Worker output truncation.
- Regenerate the sharp 1600×900 screenshots and GIF from the current static adapter through a repeatable capture script.

## 0.4.0

- Add `run-react` for self-contained React components written in JSX or TSX, with hooks, events, fragments, and automatic root mounting.
- Bundle React and ReactDOM into both the Obsidian plugin and static adapter so React examples require no CDN, account, API key, or project-owned execution server.
- Reuse the existing catalog, runner composition, CodeMirror editor, isolated iframe, Console, error, duration, and Reset contracts instead of creating a separate playground path.
- Keep React previews at an opaque origin with network, forms, popups, top navigation, objects, external resources, and same-origin access blocked.
- Feature a working React counter on the deployed static demo and expose the exact bundled React and Sucrase versions in the result header.

## 0.3.0

- Keep the primary Run action anchored at the toolbar edge while its icon and label change to a visible `Running…` state.
- Move duration, result, and provider information into the Output header and show a deterministic waiting state during execution.
- Add `run-web` for interactive HTML, CSS, and JavaScript in a fresh opaque-origin iframe with network, form, popup, navigation, object, and same-origin access blocked.
- Replace the CSS placeholder with a reusable component specimen so CSS examples visibly style a card, button, and supporting text.
- Keep `run-html` and `run-css` script-disabled, preserve conditional Reset, and forward isolated web-preview console output and runtime errors to Output.

## 0.2.8

- Remove CodeMirror's nested focus outline so the editor no longer looks like a selected region while typing.
- Replace the low-resolution Community walkthrough with a public-safe 1600×900 Obsidian PNG; a new execution GIF is intentionally deferred.
- Lead the Community page with the real disposable editor while keeping the learning loop and provider boundary concise.
- Keep the previous GIF file only as a temporary compatibility target for the Community page cache; it is no longer embedded by the current README.
- Require sharp 16:9 README media in the release gate and make the disposable-editing and provider boundary easier to understand.

## 0.2.7

- Make Knip unused-code analysis part of the standard release gate and remove the unused public `RemoteAdapterId` type export it exposed.
- Move stored-setting normalization out of the plugin lifecycle, preserving the old `private-first` value through an explicit migration regression test.
- Expand the Community overview with the exact Run lifecycle, adapter maintenance boundaries, compatibility, and support guidance.
- Replace the public walkthrough with a real Ready → edit → Kotlin Playground output sequence captured from the deployed static adapter.

## 0.2.6

- Replace extended system-font fallbacks in the static landing page with the shared interface-font token, removing the Obsidian 1.11.4 compatibility warning.
- Add a release-policy check that prevents the unsupported font fallback from returning.

## 0.2.5

- Redesign the README and static demo around a one-minute quick start, live Kotlin editor, clearer value proposition, and an actual execution GIF.
- Turn runner preflight exceptions into a stable unavailable UI state and clear stale provider labels before each execution.
- Disable scripts inside HTML/CSS previews in addition to their existing network-blocking CSP and sandbox.
- Remove unused exports and fallback state, replace stale QA claims with current verification evidence, and add automatic pull-request and main-branch verification.

## 0.2.4

- Replace global DOM, timer, and HTTP usage with Obsidian-native and explicit browser adapters.
- Adopt searchable declarative settings and a void-safe asynchronous Run handler.
- Remove filesystem and child-process execution from the Community Plugin; all 21 languages now use browser-native or named remote providers without a project-owned server.
- Add the official Obsidian ESLint rules to local verification so Community review warnings fail before release.

## 0.2.3

- Move the hidden Dart execution frame's static layout from an inline style assignment to the shared stylesheet for Obsidian source-policy compliance.

## 0.2.2

- Replace the bundled TypeScript compiler with Sucrase's focused browser transform, preserving isolated execution while removing obfuscation-like compiler diagnostic identifiers from release assets.
- Remove the Community Directory CSS compatibility warnings for `!important` and `clip-path`.
- Generate GitHub build-provenance attestations for all three Obsidian release assets.

## 0.2.1

- Replace the retired arbitrary-code DartPad embed route with the supported DartPad compile API and a temporary sandboxed execution frame.
- Wait for synchronous and asynchronous Dart `main()` completion before reporting output, including the conventional `List<String>` argument form.

## 0.2.0

- Expand the stable Markdown contract to 21 exact languages with IntelliJ-style syntax modes and generated examples.
- Add Wandbox, Kotlin Playground, SwiftFiddle, and DartPad remote adapters for a static-site deployment without a project-owned execution server.
- Add browser-native JavaScript, TypeScript, HTML, and CSS adapters plus 18 local toolchain adapters for Obsidian Desktop.
- Compose configurable remote-first or private-first execution and stop fallback when a remote outcome may already have executed.
- Show the environment and named provider that actually completed each fallback run.
- Detect existing local runtimes without installing them or mutating PATH; use private temporary workspaces, direct process spawning, timeouts, output caps, and cleanup.
- Isolate provider-specific implementation and tests so service changes normally require only an adapter patch.
- Let editors grow through 100 source lines plus two numbered editing lines before showing an internal scrollbar.

## 0.1.4

- Display the complete supported-language list and each environment boundary in the browser demo and Obsidian settings.

## 0.1.3

- Add two real, numbered blank lines to the ephemeral editor document instead of CSS-only space.
- Match syntax highlighting to the IntelliJ Darcula palette for keywords, functions, strings, numbers, types, comments, and identifiers.

## 0.1.2

- Keep roughly two empty editor lines visible after the source without changing Markdown.
- Remove Obsidian's nested preformatted-block chrome from the output tool window.
- Preserve the editor's accessible name without triggering an Obsidian hover tooltip.

## 0.1.1

- Align the cell with the IntelliJ-inspired visual language shared by Link Calendar and Linked Graph.
- Replace the fixed-height IDE frame with a compact notebook-style editor.
- Hide empty output until execution and show Reset only after editing.
- Use host theme tokens, restrained SVG controls, and responsive mobile actions.

## 0.1.0

- Add the environment-independent `run-<language>` Markdown contract.
- Add local Kotlin execution through `kotlinc` and `java` without a daemon or execution server.
- Add isolated JavaScript execution through an ephemeral Web Worker.
- Add a shared IntelliJ-inspired CodeMirror editor, console, reset action, and keyboard shortcut.
- Add a static browser adapter and GitHub Pages build.

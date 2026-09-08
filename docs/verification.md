# Verification evidence

This page separates current source checks from dated provider observations. Source verification is not proof that the same files have been released or approved by the Community directory. Provider smoke results do not promise third-party uptime.

The full remote sample sweep passed for all 18 CLI-backed language samples on 2026-09-05. The first Rust request timed out with an unknown outcome and correctly stopped without a fallback or duplicate submission; a separate retry passed with Wandbox `rust-1.82.0`.

## Automated verification

The latest follow-up candidate `0e89664` passed the full `npm run verify` on 2026-09-08: 171 unit tests and 24 Chromium E2E tests, plus type/lint, Knip, build, release/media policy checks, and package dry run. Its single-button manual/automatic termination and recovery scenarios also passed all 12 Chromium/Firefox/WebKit cases. The six cross-browser hover/focus cases passed separately. Earlier counts below are retained as dated evidence.

`npm run verify` passed on 2026-09-08 for source commit `2cf76a9` (the next release candidate, still carrying manifest version 0.7.0):

- TypeScript strict checking and ESLint, including `eslint-plugin-obsidianmd` Community rules;
- Knip dead-code and dependency analysis;
- 171 covered unit tests and 22 Chromium end-to-end tests;
- fresh-build Chromium E2E checks for editing and Reset, React interaction, host theme tokens, keyboard focus, the 102/103-line scroll boundary, preview navigation containment, ReactDOM script-resource CSP rejection, bounded direct preview relays, and real Worker output truncation;
- coverage exceeds the enforced 80% statement/line, 70% branch, and 75% function thresholds;
- both production bundles remain below the reviewed 5 MB release ceiling;
- release-policy checks for the runnable fence and adapter inventory, digest-pinned container profiles, and media hashes;
- npm package dry run contains only the 8 declared files.

Additional repository checks passed:

- `npm audit`: 0 known vulnerabilities;
- Knip: 0 unused files, dependencies, exports, or exported types;
- `git diff --check`: no whitespace errors.

## Local companion verification

- The authenticated HTTP boundary rejects missing tokens, invalid language IDs, and source bodies above 256 KB before execution.
- The client accepts only `http://127.0.0.1` and `http://localhost`, stores no token in plugin data, and treats an ambiguous post-submission failure as unknown so fallback cannot duplicate side effects.
- Docker Desktop 29.4.0 executed the pinned Alpine Shell profile and returned `local-ok` with exit code 0; no `rcb-*` container remained afterward.
- The pinned Java profile compiled and returned `java-local-ok` with empty stderr.
- The pinned Kotlin/JVM profile compiled and returned `kotlin-local-ok`; an initial Jansi warning exposed a missing explicit tmpfs execution flag, which was corrected and directly re-tested with clean output.
- The remaining profile commands and security flags are covered structurally, but their large images are downloaded only when a user explicitly runs `prepare <language>` rather than as part of plugin installation or CI.

## Browser verification

The following provider observations were recorded on 2026-09-05. They are not a fresh availability check:

- the live Kotlin block reached an enabled Run state through Kotlin Playground 2.4.10;
- **Run** exposed `aria-busy=true`, a spinner with `Running…`, and `Waiting for result…` before returning `Hello from Community!` and naming Kotlin Playground 2.4.10 in Output;
- all 18 CLI-capable remote samples passed through current Wandbox, Kotlin Playground, and SwiftFiddle providers;
- HTML rendered a native button and CSS styled the specimen button to `rgb(53, 116, 240)` with both frames retaining an empty sandbox token and `script-src 'none'`;
- `run-web` and `run-web-ts` each changed a real button from `Clicked 0 times` to `Clicked 1 times`; TypeScript named Sucrase 3.35.1 and both forwarded the click log into Output;
- `run-react` compiled the featured TSX module with bundled React 19.2.8 and Sucrase 3.35.1, mounted it in the same isolated preview, and changed its real button from `Clicked 0 times` to `Clicked 1 times` without browser warnings or errors;
- ReactDOM's bundled script-resource path attempted one request inside the opaque preview; Chromium rejected it with CSP, returned no response, and left the host document unchanged;
- an invalid React component produced a visible compile failure before opening a preview, and Reset restored the original TSX source while hiding Output;
- the interactive frames exposed only `sandbox="allow-scripts"`, without `allow-same-origin`, and retained CSP blocks for network, forms, popups, top navigation, and objects;
- an accidental Korean edit was removed by Reset, which restored the Markdown source and hid both Reset and Output;
- desktop and the host-constrained 375 CSS pixel mobile viewport had no horizontal document overflow;
- light and dark media produced the intended host surfaces, reduced motion computed `animation-name: none`, and a 200% page scale retained matching document client and scroll widths;
- Dart returned `dart-ok` through DartPad and its isolated execution frame;
- the mobile editor preserved numbered lines, syntax highlighting, and an accessible Run control;
- the public-safe Ready, edit, Running, provider output, and interactive Web frames were normalized without stretching to 1600 × 900 and assembled into the current GIF;
- the landing page mounts one featured React runner at startup and defers the complete 24-fence catalog until its disclosure is opened.

## Native UI verification — 2026-09-08

The local candidate was installed in a separate public sample vault with receipt and asset-hash verification. In Obsidian 1.13.7 on macOS, Canvas execution, Stop, a fresh execution, and Copy succeeded. Actions use SVG icons with accessible names; measured controls were 30×30 CSS pixels with 8 pixels above and 9 below including the toolbar divider. Light/dark themes and zoom were inspected. A host CSS override of the primary action was corrected so Run retains the host accent and secondary actions remain subdued.

The nested editor gutter fix (`00ad7ba`) removes Obsidian's inherited 24-pixel folding margin. Before the fix, the host-style regression failed; afterward, all four focused layout tests and static checks passed. Native light/dark checks measured a zero-pixel gap and equal active-row top edges and backgrounds, including a keyboard move to line 7. Code padding is 8 pixels and editor vertical padding is 7/9 pixels. The standalone server bundle hash remained unchanged.

The existing 360/1280-pixel browser tests now check actual control spacing, SVG presence, accessible names, copying, and horizontal overflow. These browser viewports do not constitute physical mobile-app verification. A WebGL watchdog failure occurred during an earlier combined run; subsequent isolated and full runs passed, but its original cause remains unconfirmed. No timeout assertion was relaxed to pass it.

## Toolbar and focus follow-up — 2026-09-08

The Obsidian adapter supplies an optional source-edit callback to the shared UI. Its SVG action comes before Copy and Run, delegates to Obsidian's existing source-edit handler, and appears on hover or keyboard focus without shifting controls. Touch devices keep it visible. The duplicated native hover frame is suppressed only around Runnable blocks. Editor highlighting is focus-only; the inherited permanent scrollbar gutter is reset so short lines span the full editor width.

Copy feedback returns from the check to Copy after 1.5 seconds, and its timer is cleared on edits and disposal. A single execution button changes from Run to a spinning Stop action while a request or preview is active. The same button cancels execution. Both manual termination and automatic Worker shutdown restore Run; the trusted frame forwards its existing stopped acknowledgement for watchdog and resource-limit termination too. Error output remains visible, and cancellation acknowledgement/unknown-result contracts remain intact.

Native sample-vault checks confirmed the action order, delegated source editing, timed Copy reset, single-button execution/cancellation, successful Canvas restart, and no captured app errors. The browser regression suite exercises actual Worker termination and recovery rather than only checking icon labels.

## Community scan boundaries

The public [Community scorecard](https://community.obsidian.md/plugins/runnable-code-blocks#scorecard) was inspected on 2026-09-08. It reported Caution for the released 0.7.0, while asset attestation, byte-for-byte main.js reproduction, and the dependency vulnerability scan passed. The local candidate has not yet replaced that release.

- Node imports belong to the separately operated `local-runner/src` server, not the Obsidian main.js bundle. The plugin remains usable without this optional server. Do not add desktop-only guards to a standalone Node process merely to silence a plugin-oriented rule.
- The two asynchronous HTTP request listeners now share an explicit rejection boundary. A regression test requires a bounded 500 response without internal error details and a successful subsequent request; strict void-return Promise linting passes for both servers and the boundary.
- Browser DOM adapters and opaque preview frames do not have Obsidian's prototype helpers. Their native DOM creation must stay within the host-specific boundary.
- Dynamic script creation and additional companion/license release files remain explicit review items. Their presence is not silently dismissed as a false positive, and preserving sandbox and license requirements takes precedence over hiding a warning.

## Reviewed failure paths

- A rejected runner preflight now becomes a stable `Unavailable` state instead of an unhandled promise rejection.
- CodeMirror's nested focus outline is suppressed so keyboard focus does not resemble a selected editor region; focused controls keep their visible focus ring.
- A new run clears the previous provider heading before an error result is rendered.
- HTML/CSS preview frames block scripts with both a sandbox and `script-src 'none'` CSP.
- Interactive Web frames allow inline scripts only inside a fresh opaque-origin iframe; TypeScript transform errors return before a frame opens.
- React JSX/TSX uses the same opaque-origin iframe and CSP, imports no runtime packages from the network, and rejects packages other than bundled React and ReactDOM.
- Every inner-to-host relay is source-, origin-, and token-validated; the outer frame applies its own entry and character cap before forwarding output.
- Remote fallback continues only after a known `not-started` result; an unknown outcome never executes the same code again.
- Runtime source does not import Node filesystem or child-process modules.

## Remaining external limits

Wandbox, Kotlin Playground, SwiftFiddle, and DartPad are independent public services. Their endpoints, compiler inventory, limits, CORS behavior, and availability can change without a plugin release. Browser JavaScript and TypeScript execution shadows common direct network globals and terminates its Worker after a timeout, but generated code can still reach browser capabilities; the Worker is not a security sandbox. Interactive previews execute author code in a terminable Worker and apply sanitized DOM updates in an opaque-origin frame. Canvas 2D/WebGL/WebGL2 stay on native OffscreenCanvas surfaces in that Worker; bounded ImageBitmap frames carry pixels to the display. Browser tests verify native readback, shader output, resize, incremental drawing, hostile transport bounds, and actual Worker closure/restart. Every runnable block must still be treated as executable content from the note.

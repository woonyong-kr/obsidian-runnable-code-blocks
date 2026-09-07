# Verification evidence

This page records checks for the current source tree. Provider smoke results are time-dependent and do not promise third-party uptime.

The full remote sample sweep passed for all 18 CLI-backed language samples on 2026-09-05. The first Rust request timed out with an unknown outcome and correctly stopped without a fallback or duplicate submission; a separate retry passed with Wandbox `rust-1.82.0`.

## Automated verification

`npm run verify` passed for version 0.6.0:

- TypeScript strict checking and ESLint, including `eslint-plugin-obsidianmd` Community rules;
- Knip dead-code and dependency analysis;
- the complete covered unit suite;
- fresh-build Chromium E2E checks for editing and Reset, React interaction, host theme tokens, keyboard focus, the 102/103-line scroll boundary, preview navigation containment, ReactDOM script-resource CSP rejection, bounded direct preview relays, and real Worker output truncation;
- coverage exceeds the enforced 80% statement/line, 70% branch, and 75% function thresholds;
- both production bundles remain below the reviewed 5 MB release ceiling;
- release-policy check: 24 runnable fences, 9 plugin adapters, and 16 digest-pinned local container profiles;
- npm package dry run contains only the 7 declared release files.

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

The generated static adapter was served from `dist-site/` and inspected in a real browser:

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

Wandbox, Kotlin Playground, SwiftFiddle, and DartPad are independent public services. Their endpoints, compiler inventory, limits, CORS behavior, and availability can change without a plugin release. Browser JavaScript and TypeScript execution shadows common direct network globals and terminates its Worker after a timeout, but generated code can still reach browser capabilities; the Worker is not a security sandbox. Interactive DOM previews use a restrictive opaque-origin frame, but code that blocks the renderer event loop cannot be force-stopped from that same renderer. Every runnable block must therefore be treated as trusted executable content from the note.

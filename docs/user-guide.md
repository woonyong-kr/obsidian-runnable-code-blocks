# Runnable Code Blocks user guide

[Back to the overview](../README.md)

## Try it in 60 seconds

1. Open **Settings → Community plugins → Browse** and search for **Runnable Code Blocks**.
2. Select **Install**, then **Enable**.
3. Create a normal note and paste this entire fenced block:

````markdown
```run-javascript
console.log("Hello from Obsidian!");
```
````

4. Open **Reading view**, or move the cursor out of the fence in **Live Preview**. Select the play icon (**Run**). You should see:

```text
Hello from Obsidian!
```

5. Change the greeting in the embedded editor and run again. Use **Copy code** to keep the new source, or **Reset** to restore the Markdown version.

This JavaScript example needs no account or separate server on a new installation: the default order tries the built-in Worker first. To prevent any remote submission, turn off **Remote execution** in plugin settings. Older installations can retain their chosen provider order.

Prefer to try it without installation? Open the [live browser editor](https://woonyong-choi.github.io/obsidian-runnable-code-blocks/). Its host may choose a different provider order; check the environment label before running.

## Everyday controls

| Action | What happens |
| --- | --- |
| Play icon / Run | Executes the current editor contents. Inside the editor, `Cmd/Ctrl + Enter` does the same. |
| Spinning icon / Stop | Select the same button again to stop execution or close an interactive preview. |
| Copy icon | Copies the edited code; the confirmation check returns to the copy icon automatically. |
| Edit source | In Obsidian Live Preview, opens the original fence. Appears on hover or keyboard focus, and stays available on touch screens. |
| Reset | Discards temporary edits and restores the Markdown source. |
| Execution details | Reveals the provider, timing, and extra diagnostics below the result. |

The embedded editor does not save changes back to the note. Copy a useful result into the original Markdown before closing it. Stopping a container waits for the server's cleanup acknowledgement; an unknown cleanup result is reported as unknown.

## Three ways to use it

- **Practice while reading:** change an input in a JavaScript example and compare the printed result.
- **Explain an interactive interface:** use `run-web` for HTML/CSS/JavaScript or `run-react` for a small JSX/TSX component.
- **Study compiled languages:** use an optional desktop companion for prepared languages, or allow the named remote provider when sending that source is acceptable.

<details>
<summary>Copyable Web and React examples</summary>

For a clickable browser component, keep HTML, CSS, and JavaScript together in `run-web`:

````markdown
```run-web
<button id="counter">Clicked 0 times</button>
<script>
  let count = 0;
  const button = document.querySelector("#counter");
  button.addEventListener("click", () => {
    button.textContent = `Clicked ${++count} times`;
    console.log(button.textContent);
  });
</script>
```
````

Use `run-web-ts` and `<script type="text/typescript">` for the same component with TypeScript. Plain `run-typescript` remains an isolated console program, so existing notes do not silently gain DOM access.

For a React documentation-style component, use one self-contained JSX or TSX module:

````markdown
```run-react
import { useState } from "react";

export default function Counter() {
  const [count, setCount] = useState<number>(0);

  return (
    <button onClick={() => setCount((value) => value + 1)}>
      Clicked {count} times
    </button>
  );
}
```
````

`run-react` bundles React and ReactDOM with the plugin, accepts JSX and TSX in the same fence, automatically mounts the default component, and preserves the same Run, Console, error, Reset, and sandbox behavior. React and `react-dom/client` imports are available; arbitrary packages and relative multi-file imports are intentionally rejected so the note remains deterministic and server-free.

</details>

## Supported languages

Version **0.7.8** recognizes these 24 exact fence names. The columns show available choices, not execution order. A new Obsidian installation tries **built-in browser → enabled local companion → allowed remote provider**. Existing Remote-first settings remain respected.

| Fence | Built-in browser runtime | Optional desktop companion | Remote provider, when selected |
| --- | --- | --- | --- |
| `run-javascript` | Web Worker | — | Wandbox |
| `run-typescript` | Transpile → Web Worker | — | Wandbox |
| `run-python` | — | Python container | Wandbox |
| `run-sql` | — | SQLite container | Wandbox |
| `run-html` | Script-free HTML preview | — | — |
| `run-css` | CSS preview | — | — |
| `run-web` | HTML/CSS/JS in a Worker preview | — | — |
| `run-web-ts` | HTML/CSS/TypeScript in a Worker preview | — | — |
| `run-react` | Bundled React JSX/TSX in a Worker preview | — | — |
| `run-kotlin` | — | Kotlin/JVM container | Kotlin Playground |
| `run-java` | — | Java container | Wandbox |
| `run-c` | — | GCC container | Wandbox |
| `run-cpp` | — | GCC container | Wandbox |
| `run-go` | — | Go container | Wandbox |
| `run-rust` | — | Rust container | Wandbox |
| `run-csharp` | — | .NET SDK container | Wandbox |
| `run-swift` | — | Swift container | SwiftFiddle |
| `run-ruby` | — | Ruby container | Wandbox |
| `run-php` | — | PHP container | Wandbox |
| `run-r` | — | R container | Wandbox |
| `run-scala` | — | — | Wandbox |
| `run-dart` | — | Dart container | DartPad compile → isolated frame |
| `run-lua` | — | Lua container | Wandbox |
| `run-shell` | — | Alpine `sh` container | Wandbox |

“Remote” sends the current code to the named provider. “Local companion” needs Node.js 22, a Docker-compatible engine, and a prepared language image; it is not installed automatically. The browser runtime is bundled with the plugin. Public providers can change or become unavailable independently of the plugin.

## Desktop, mobile, and offline use

Requires **Obsidian 1.13.0+**. The plugin supports desktop and mobile; the separately started container companion is desktop-only.

| Where execution happens | Desktop | Mobile | Internet |
| --- | --- | --- | --- |
| Built-in JavaScript, TypeScript, HTML, CSS, Web, Web TS, React | Supported | Supported | Not required after installation |
| Local companion | Optional | Not supported | Needed to prepare images; prepared execution stays local |
| Named remote providers | When enabled | When enabled | Required |

Current native screenshots and the 0.7.3 popout checks use desktop Obsidian 1.13.7. A fresh mobile-hardware check is not included in that release evidence. Browser or device capabilities can also limit Canvas/WebGL availability.

## Settings

Open **Settings → Community plugins → Runnable Code Blocks**:

- **Local runner** — opt into the separately installed desktop companion.
- **Local runner endpoint** — accepts only `http://127.0.0.1` or `http://localhost`.
- **Pairing token** — stored in Obsidian SecretStorage rather than plugin data.
- **Remote execution** — allow or block source submission to named providers.
- **Provider order** — choose Browser/local → Remote or Remote → Browser/local.
- **Supported languages** — inspect the complete runtime map from the same catalog used by the plugin.

Older `kotlinCompilerPath` or `javaPath` settings migrate to local-only execution unless you have explicitly chosen the current execution controls. Pair the local companion before running these blocks; an unavailable local runner does not enable remote submission. The plugin no longer invokes host compiler paths directly.

## Optional local runner

The local runner is useful when a public provider is unavailable or source should remain on the desktop. It requires Node.js 22 and a running Docker-compatible engine. Download `runnable-code-blocks-local-runner.mjs` from the [separate companion release](https://github.com/woonyong-kr/obsidian-runnable-code-blocks/releases/tag/companion-0.7.8), then prepare only the languages you need:

```bash
node runnable-code-blocks-local-runner.mjs list
node runnable-code-blocks-local-runner.mjs prepare kotlin java cpp
node runnable-code-blocks-local-runner.mjs start
```

Copy the printed token into the plugin settings and enable **Local runner**. The service binds only to `127.0.0.1`; it is not a public backend and must never be exposed through port forwarding or a reverse proxy. Full setup, isolation controls, image references, and troubleshooting are documented in [Local runner](../local-runner/README.md).

The plugin release contains only the three Obsidian installation files. The companion remains optional, uses the existing HTTP protocol, and is never installed or started by the plugin. An already paired 0.7.2 companion keeps working; updating the plugin does not require replacing its process, settings, or token.

## Troubleshooting

- **Run is unavailable:** hover or focus the status text to see which provider preflight failed. Public providers can be temporarily unavailable.
- **Only seven fences work after disabling remote execution:** this is expected. JavaScript, TypeScript, HTML, CSS, Web, Web TypeScript, and React are browser-native.
- **A React import is rejected:** `run-react` deliberately includes only React and ReactDOM. Keep the example self-contained instead of importing arbitrary npm or relative modules.
- **Edits disappeared after Reset or reopening the note:** this is intentional. Change the Markdown source when you want to keep an example.
- **A program failed but no fallback ran:** compile errors, runtime failures, and unknown remote outcomes are completed attempts, so the plugin avoids executing the same code twice.
- **An interactive preview times out only in a popout:** update to 0.7.3 or later. Earlier versions listened for preview messages in the main window even when the block was in another window.

- **A plain code block appears:** use an exact `run-` fence from the table, enable the plugin, and switch to Reading view or move out of the fence in Live Preview.
- **Copy is unavailable:** focus the Obsidian window and try again, or select the code and use the keyboard copy command.
- **A window was minimized and the preview stopped:** update to 0.7.3 or later; it distinguishes hidden-window suspension from an unresponsive Worker.

## Privacy and execution details

Run only code you trust. Code executes after **Run** or its keyboard shortcut. Check the environment label; **Remote execution** is enabled by default, even though new installations prefer a built-in or configured local runner first. Turning Remote execution off keeps those browser/local choices available.

The Community Plugin does not access the filesystem, spawn local processes, install runtimes, or modify `PATH`. The optional companion is a separate program. A failed or uncertain execution is never automatically repeated on another provider.

<details>
<summary>Isolation, resource limits, and provider fallback</summary>

Code runs only after **Run** or the keyboard shortcut. Treat every runnable block as executable code.

- Remote execution is enabled, while private-first is the default for new Obsidian installs. Browser-native execution is used first, then an enabled local companion, then a remote provider.
- Existing settings that explicitly chose remote-first keep that order. Remote execution can be disabled without disabling browser or local execution.
- JavaScript and transpiled TypeScript run in a fresh disposable Web Worker with a five-second timeout. Common direct network globals are shadowed, but the Worker is a lifecycle boundary rather than a security sandbox; run only code you trust.
- HTML and CSS render in an opaque sandboxed iframe. Their authored scripts remain blocked by a restrictive Content Security Policy; only the nonce-bound internal height reporter can run so the result can expand without an internal scrollbar. CSS is applied to a reusable card, button, and text specimen.
- Interactive `run-web` documents run inline JavaScript in a dedicated Worker and render HTML/CSS through a restricted DOM bridge in a fresh opaque-origin iframe. `run-web-ts` transpiles `<script type="text/typescript">` blocks before using the same sandbox.
- `run-react` transpiles a self-contained JSX or TSX module with Sucrase and mounts its default export with bundled React and ReactDOM. Only `react`, `react-dom`, and `react-dom/client` imports are available; no package is downloaded while running a note.
- All interactive previews block Fetch/XHR/WebSocket calls, subresource loading, forms, popups, top navigation, objects, and same-origin access. A per-run token authenticates every relayed message, the outer frame enforces the same output cap independently, and both frame layers use a no-referrer policy.
- Interactive preview JavaScript runs in a dedicated Worker with Worker DOM. Stop terminates that Worker; a two-second heartbeat also terminates synchronous loops and microtask starvation. The opaque frame only applies bounded, sanitized DOM updates and displays rendering results.
- Canvas 2D, WebGL, and WebGL2 render on native OffscreenCanvas surfaces inside the Worker. Readback, resizing, input, and incremental drawing are supported. At most 8 canvases, 2048 pixels per side, 1 megapixel per canvas, and 4 megapixels total are allowed. Presentation is capped at 30 frames/second with one bitmap in flight per canvas. Browser/GPU context availability still applies; arbitrary synchronous layout APIs are outside Worker DOM's supported surface.
- The container engine includes compilation in its 15-second deadline. Timeouts return exit code 124 and an explicit diagnostic; confirmed container OOM and unexplained process exits have separate optional `failureReason` metadata. A failed execution is never automatically repeated. HTTP cancellation reports success only after the server confirms container removal.
- For compatible local companions and personal compilers, **Stop** waits for cleanup acknowledgement. An unknown cleanup result is not shown as confirmed cancellation.
- Kotlin Playground, Wandbox, SwiftFiddle, and DartPad receive source only when their adapter is selected.
- The Community Plugin does not access the filesystem, spawn local processes, install runtimes, or modify `PATH`. The optional companion is a separately installed release asset and uses only the local container engine.

A fallback occurs only when execution is known not to have started. Compilation errors, program failures, timeouts with an unknown remote outcome, and non-zero exits never cause the same code to run again through another provider. See [runtime provider architecture](runtime-providers.md) for the full contract.

</details>

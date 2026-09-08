# Execution cancellation and preview isolation

This change keeps public fences and the optional `RunContext` API compatible. It changes the two owned HTTP gateways and the HTML/CSS/React preview implementation. It does not install an Obsidian release, change Wiki content, or replace the personal execution service.

## HTTP execution

`POST /v1/cancel` uses the original request UUID with no source body. The UI first stops waiting, then reports the independently bounded cancellation acknowledgement. It says the container was removed only after confirmation. A new Run, Reset, or dispose invalidates old acknowledgements. Offline servers and old third-party providers cannot provide that confirmation; the UI never invents it.

The Docker lifecycle is create → attach/start → awaited force removal. This closes the race where killing `docker run` before creation finished could leave a container behind. The execution budget includes container creation. Output, network, non-root, PID, memory, CPU, and filesystem restrictions remain. See [Docker force removal](https://docs.docker.com/reference/cli/docker/container/rm/) and `local-runner/README.md` for the protocol.

## Interactive previews

User JavaScript now runs in a dedicated Worker. A trusted iframe renders bounded DOM messages using Worker DOM 0.36.0. Stop calls the native Worker termination API; a fresh challenge/response watchdog terminates an unresponsive Worker after two seconds. The controller runs on the frame thread, so synchronous loops, native regular-expression work, and endless Promise microtasks cannot block it. This is an architectural change, not loop-source instrumentation. See the [Worker termination contract](https://html.spec.whatwg.org/multipage/workers.html#dom-worker-terminate).

The iframe keeps an opaque origin and a nonce-only script policy. Author code is inert JSON data in that document and is only passed to the Worker. Network access and nested workers are blocked. Scripts/iframes/objects/metadata and executable attributes from DOM messages are rejected. Only DOM attributes, text, child lists, selected form properties, events, and bounding rectangles are accepted; generic host method calls, storage and canvas executors are disabled. Message sizes/rates, stored strings, node counts and output are bounded before the rendering library consumes them. One native event is relayed once, fixing Worker DOM's duplicate React click delivery.

Worker DOM supports the DOM subset used by the learning examples, including React state, portals and basic form/DOM events. It is not a complete browser DOM: Canvas/WebGL and arbitrary synchronous layout/browser APIs are not supported. Static HTML/CSS previews remain script-blocked. React, TypeScript and Worker DOM runtime imports happen only on their corresponding Run action. The owned WN web entry does not load third-party compiler providers such as DartPad.

## Verification ownership

- Public HTTP tests: acknowledgement after cleanup, cancellation before submission, failed cleanup, changed client IP, idempotent retries and existing origin/quota boundaries.
- Process-boundary tests: cancellation during creation, delayed removal acknowledgement, failed Docker cleanup. These use a real child-process fixture, not an in-memory engine substitute.
- Client/UI tests: source-free cancellation with the same UUID, no automatic execution retry after abort/deadline, confirmed/unknown/completed results and stale acknowledgements.
- Real-browser tests: actual Worker close events and restart after manual stop; automatic termination of synchronous, Promise and native-regex loops; React click and portal behavior; TypeScript DOM events; resource/script isolation and bounded output.
- Replaced the old executable-HTML string assertions with inert author-data checks and browser behavior. Removed the release check demanding `unsafe-inline` for interactive author code. The standalone iframe entry is bundled as text and tested in browsers, so it is excluded from Node-only coverage; coverage thresholds are unchanged.

Before implementation, the three new public cancellation cases failed, the source-free client cancellation case failed, and the real React infinite-loop test froze its frame and failed under an external process watchdog. After implementation, an isolated real Docker probe observed a running Python process, received `cancelled`, verified the container no longer existed, rejected reuse of the cancelled UUID, and executed a fresh job successfully. Test logs and deployment receipts identify the tested revisions; a mock or successful HTTP status alone does not establish process termination.

Third-party license terms are included in `THIRD_PARTY_NOTICES.md`.

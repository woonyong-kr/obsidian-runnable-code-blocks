# Runnable Code Blocks Local Runner

This optional desktop companion executes selected `run-<language>` blocks in disposable, digest-pinned containers. It binds only to `127.0.0.1`, requires a bearer token, accepts source text instead of host paths, disables container networking, and applies CPU, memory, PID, time, and output limits.

It is not installed by the Obsidian Community Plugin. Docker Desktop, Colima with Docker CLI compatibility, or another local Docker engine must already be running.

```bash
node runnable-code-blocks-local-runner.mjs list
node runnable-code-blocks-local-runner.mjs prepare kotlin java cpp
node runnable-code-blocks-local-runner.mjs start
```

Copy the printed pairing token into **Settings → Runnable Code Blocks → Pairing token**, enable **Local runner**, and keep the process running while executing local blocks. The generated token is stored at `~/.config/runnable-code-blocks/local-runner.json` with owner-only permissions.

`prepare` downloads only the explicitly requested images. `prepare all` is supported but intentionally not automatic because the complete toolchain set is large.

## Optional public gateway for a static site

The authenticated companion above remains a loopback-only Obsidian service and must not be published. Static-site owners may instead start the separate public gateway, which reuses only the container engine and exposes a narrower token-free browser contract:

```bash
RCB_PUBLIC_RUNNER_HOST=runner.example.com \
RCB_PUBLIC_RUNNER_ORIGINS=https://example.github.io \
node runnable-code-blocks-local-runner.mjs serve-public
```

The gateway still listens on `127.0.0.1` (port `17172` by default). Publish that listener only through a dedicated outbound tunnel. Do not reuse the companion port, its token, or its configuration file.

The public boundary enforces an exact hostname and HTTPS Origin allowlist, a 32 KB source limit, two concurrent jobs, six runs per client per minute, 120 runs globally per hour, UUID idempotency keys, and sanitized provider responses. Containers retain disabled networking, digest-pinned images, a read-only root filesystem, non-root execution, dropped capabilities, 15-second execution time, and resource limits. The limits can be lowered or selectively adjusted with `RCB_PUBLIC_RUNNER_*` environment variables; keep them conservative on a personal machine.

Only explicitly prepared images appear in `/v1/capabilities`. When the machine or tunnel is offline, the static client leaves browser-native examples available and explains that compiled-language execution is temporarily unavailable on the personal compiler.

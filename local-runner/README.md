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

# Runnable Code Blocks demo

Public-safe source captures, the deterministic GIF recipe, built output, and historical release evidence belong to this plugin repository. Versioned source captures stay under `captures/source/`; normalized 1600×900 frames stay under `captures/frames/`.

Run `npm run demo:capture` to build the current static adapter, capture fresh 1600×900 Chromium frames, rebuild the GIF, and copy the reviewed media candidates into `docs/assets/`. Run `npm run demo:build` when only the existing frames need to be reassembled. Capture uses its own ephemeral localhost port and updates `docs/release-media.json` hashes only after successful assembly. `demo/dist/` is untracked build output; the public GIF is stored once under `docs/assets/`. The current sequence shows Ready → edit → execution → React interaction and copy → interactive Web.

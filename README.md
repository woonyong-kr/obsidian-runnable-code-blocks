<img src="docs/assets/product-icon.svg" alt="" width="48" height="48" />

# Runnable Code Blocks

Edit and run code without leaving your notes.

**[Install in Obsidian](https://community.obsidian.md/plugins/runnable-code-blocks) · [Try the live editor](https://woonyong-choi.github.io/obsidian-runnable-code-blocks/) · [User guide](docs/user-guide.md)**

Available now: **0.7.8** · Obsidian **1.13.0+** · Desktop and mobile. See [release notes](CHANGELOG.md) for shipped changes and the [roadmap](ROADMAP.md) for work in progress and plans.

## Install and try

1. In **Settings → Community plugins → Browse**, find **Runnable Code Blocks**.
2. Select **Install**, then **Enable**.
3. Paste this block in a note, switch to Reading view, and select **Run**:

````markdown
```run-javascript
console.log("Hello from Obsidian!");
```
````

The result appears below the code. Edit the example and run again; **Copy** keeps your edited code, while **Reset** restores the original.

Seven browser fences work without an account or server. Other languages use an optional local companion or a named remote provider. Remote execution is enabled by default; disable it in settings to prevent remote submission.

Manual installation: download `main.js`, `manifest.json`, and `styles.css` from [Releases](https://github.com/woonyong-kr/obsidian-runnable-code-blocks/releases/latest) into `.obsidian/plugins/runnable-code-blocks/`, then reload Obsidian.

![Runnable Code Blocks walkthrough](docs/assets/runnable-code-blocks-demo.gif)

Browser demo, September 9, 2026 (0.7.3); the illustrated controls are unchanged in 0.7.8.

## Help and development

[User guide](docs/user-guide.md) · [Report a problem](https://github.com/woonyong-kr/obsidian-runnable-code-blocks/issues) · [Community page](https://community.obsidian.md/plugins/runnable-code-blocks) · [Contributing](CONTRIBUTING.md)

[MIT](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)

import { describe, expect, it, vi } from "vitest";

describe("Obsidian SVG adapter", () => {
  it("passes separate class tokens to Obsidian when rendering run icons", async () => {
    vi.resetModules();
    const { appendSvgElement } = await import("../src/dom");
    const host = document.createElement("div");
    const parent = Object.assign(host, {
      createSvg(name: string, options: { cls?: string | string[] }) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", name);
        const classes = options.cls;
        if (typeof classes === "string" && /\s/.test(classes)) {
          throw new DOMException("SVG class must be a single DOM token", "InvalidCharacterError");
        }
        if (classes) svg.classList.add(...(Array.isArray(classes) ? classes : [classes]));
        host.appendChild(svg);
        return svg;
      }
    });
    const icon = appendSvgElement(parent, "svg", "rcb__button-icon rcb__button-icon--run");
    expect(icon.classList.contains("rcb__button-icon")).toBe(true);
    expect(icon.classList.contains("rcb__button-icon--run")).toBe(true);
    expect(parent.firstElementChild).toBe(icon);
    expect(appendSvgElement(parent, "path").classList.length).toBe(0);
  });
});

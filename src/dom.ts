import type { DomAdapter, ElementOptions } from "./dom-types";
export type { DomAdapter, ElementOptions } from "./dom-types";

const OBSIDIAN_DOM_ADAPTER: DomAdapter = {
  appendElement: (parent, name, options = {}) => parent.createEl(name, {
    cls: options.className,
    text: options.text
  }),
  appendSvgElement: (parent, name, className) => parent.createSvg(name, {
    cls: className?.split(/\s+/).filter(Boolean)
  })
};

let activeDomAdapter = OBSIDIAN_DOM_ADAPTER;

export function configureDomAdapter(adapter: DomAdapter): void {
  activeDomAdapter = adapter;
}

export function appendElement<K extends keyof HTMLElementTagNameMap>(
  parent: Node,
  name: K,
  options: ElementOptions = {}
): HTMLElementTagNameMap[K] {
  return activeDomAdapter.appendElement(parent, name, options);
}

export function appendSvgElement<K extends keyof SVGElementTagNameMap>(
  parent: Node,
  name: K,
  className?: string
): SVGElementTagNameMap[K] {
  return activeDomAdapter.appendSvgElement(parent, name, className);
}

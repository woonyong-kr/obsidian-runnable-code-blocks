export interface ElementOptions {
  className?: string;
  text?: string;
}

export interface DomAdapter {
  appendElement<K extends keyof HTMLElementTagNameMap>(
    parent: Node,
    name: K,
    options?: ElementOptions
  ): HTMLElementTagNameMap[K];
  appendSvgElement<K extends keyof SVGElementTagNameMap>(
    parent: Node,
    name: K,
    className?: string
  ): SVGElementTagNameMap[K];
}


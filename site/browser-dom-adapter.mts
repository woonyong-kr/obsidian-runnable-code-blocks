import type { DomAdapter } from "../src/dom-types";

function ownerDocument(parent: Node): Document {
  return parent.nodeType === Node.DOCUMENT_NODE
    ? parent as Document
    : parent.ownerDocument ?? document;
}

export const BROWSER_DOM_ADAPTER: DomAdapter = {
  appendElement: (parent, name, options = {}) => {
    const element = ownerDocument(parent).createElement(name);
    if (options.className !== undefined) element.className = options.className;
    if (options.text !== undefined) element.textContent = options.text;
    parent.appendChild(element);
    return element;
  },
  appendSvgElement: (parent, name, className) => {
    const element = ownerDocument(parent).createElementNS("http://www.w3.org/2000/svg", name);
    if (className !== undefined) element.setAttribute("class", className);
    parent.appendChild(element);
    return element;
  }
};

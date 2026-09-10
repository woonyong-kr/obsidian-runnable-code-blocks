import { appendElement, configureDomAdapter } from "../src/dom";
import { LANGUAGE_EXAMPLES } from "../src/language-examples";
import { SUPPORTED_LANGUAGES } from "../src/supported-languages";
import { createStaticWebRunnerRegistry, enhanceRunnableCodeBlocks } from "../src/web-adapter";
import { BROWSER_DOM_ADAPTER } from "./browser-dom-adapter.mjs";

configureDomAdapter(BROWSER_DOM_ADAPTER);

const languageList = document.querySelector<HTMLElement>("[data-supported-languages]");
const languageCount = document.querySelector<HTMLElement>("[data-supported-language-count]");
if (languageCount !== null) languageCount.textContent = String(SUPPORTED_LANGUAGES.length);
if (languageList !== null) {
  for (const language of SUPPORTED_LANGUAGES) {
    const item = appendElement(languageList, "li", { className: "rcb-site__language" });

    const identity = appendElement(item, "div");
    const name = appendElement(identity, "strong");
    name.textContent = language.label;
    const fence = appendElement(identity, "code");
    fence.textContent = language.fence;

    const environments = appendElement(item, "span");
    environments.textContent = language.runtime;
  }
}

const featuredTestCase = document.querySelector<HTMLElement>("[data-featured-test-case]");
const featuredExample = LANGUAGE_EXAMPLES.find(({ language }) => language === "react");
if (featuredTestCase !== null && featuredExample !== undefined) {
  appendExample(featuredTestCase, featuredExample, true);
}

const testCases = document.querySelector<HTMLElement>("[data-language-test-cases]");
if (testCases !== null) {
  for (const example of LANGUAGE_EXAMPLES) {
    appendExample(testCases, example, false);
  }
}

const registry = createStaticWebRunnerRegistry({
  fetch: window.fetch.bind(window),
  personalCompilerEndpoint: document.documentElement.dataset.personalCompilerEndpoint,
  remoteExecutionEnabled: true
});

if (featuredTestCase !== null) enhanceRunnableCodeBlocks(featuredTestCase, registry);

const allExamples = document.querySelector<HTMLDetailsElement>(".rcb-site__all-examples");
let mountedAllExamples = false;
allExamples?.addEventListener("toggle", () => {
  if (!allExamples.open || mountedAllExamples || testCases === null) return;
  mountedAllExamples = true;
  enhanceRunnableCodeBlocks(testCases, registry);
});

function appendExample(
  parent: HTMLElement,
  example: (typeof LANGUAGE_EXAMPLES)[number],
  featured: boolean
): void {
  const language = SUPPORTED_LANGUAGES.find(({ id }) => id === example.language);
  if (language === undefined) return;
  const section = appendElement(parent, "section", {
    className: featured ? "rcb-site__lesson rcb-site__lesson--featured" : "rcb-site__lesson"
  });
  if (!featured) {
    const title = appendElement(section, "h2");
    title.textContent = `${language.label} · ${language.runtime}`;
    const description = appendElement(section, "p");
    description.append("Expected · ");
    const expected = appendElement(description, "code");
    expected.textContent = example.expected;
  }
  const pre = appendElement(section, "pre");
  const code = appendElement(pre, "code");
  code.className = `language-${language.fence}`;
  code.textContent = example.code;
}

import { describe, expect, it } from "vitest";
import { fenceForLanguage, parseRunnableFence } from "../src/contracts";
import {
  SUPPORTED_LANGUAGES
} from "../src/supported-languages";

describe("runnable fence contract", () => {
  it("parses the same run-language syntax used by Obsidian and web adapters", () => {
    expect(parseRunnableFence("run-kotlin")).toBe("kotlin");
    expect(parseRunnableFence(" RUN-JavaScript ")).toBe("javascript");
    expect(parseRunnableFence("kotlin")).toBeNull();
    expect(parseRunnableFence("run-")).toBeNull();
    expect(parseRunnableFence("run-kotlin metadata")).toBeNull();
  });

  it("creates only valid canonical fences", () => {
    expect(fenceForLanguage("Kotlin")).toBe("run-kotlin");
    expect(() => fenceForLanguage("bad language")).toThrow("Invalid runnable language");
  });

  it.each([
    ["run-javascript", "javascript"], ["run-cpp", "cpp"],
    ["run-csharp", "csharp"], ["run-web-ts", "web-ts"], ["run-react", "react"],
  ])("keeps the public fence %s compatible", (fence, id) => {
    expect(parseRunnableFence(fence)).toBe(id);
    expect(SUPPORTED_LANGUAGES.find(language => language.id === id)?.fence).toBe(fence);
  });
});

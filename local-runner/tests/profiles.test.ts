// @vitest-environment node
import { describe, expect, it } from "vitest";
import { containerArguments } from "../src/engine";
import { CONTAINER_PROFILES } from "../src/profiles";

describe("container profiles", () => {
  it("pins every image by digest and keeps code out of Docker arguments", () => {
    expect(CONTAINER_PROFILES.size).toBe(16);
    for (const profile of CONTAINER_PROFILES.values()) {
      expect(profile.image).toMatch(/@sha256:[0-9a-f]{64}$/u);
      const arguments_ = containerArguments("rcb-test", profile);
      expect(arguments_).toContain("none");
      expect(arguments_).toContain("--read-only");
      expect(arguments_).toContain("no-new-privileges");
      expect(arguments_).toContain("ALL");
      expect(arguments_.join(" ")).not.toContain("user-authored-code");
    }
  });

  it("covers the native and interpreter language set without duplicate profiles", () => {
    expect([...CONTAINER_PROFILES.keys()].sort()).toEqual([
      "c", "cpp", "csharp", "dart", "go", "java", "kotlin", "lua", "php",
      "python", "r", "ruby", "rust", "shell", "sql", "swift"
    ]);
  });
});

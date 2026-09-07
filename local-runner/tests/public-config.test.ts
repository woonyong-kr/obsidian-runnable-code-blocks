// @vitest-environment node
import { describe, expect, it } from "vitest";
import { loadPublicRunnerConfig } from "../src/public-config";

describe("public runner configuration", () => {
  it("requires an explicit hostname and origin allowlist", () => {
    expect(() => loadPublicRunnerConfig({})).toThrow("RCB_PUBLIC_RUNNER_HOST");
    expect(() => loadPublicRunnerConfig({ RCB_PUBLIC_RUNNER_HOST: "runner.woonyong.com" }))
      .toThrow("RCB_PUBLIC_RUNNER_ORIGINS");
  });

  it("normalizes bounded public gateway settings", () => {
    expect(loadPublicRunnerConfig({
      RCB_PUBLIC_RUNNER_GLOBAL_LIMIT_PER_HOUR: "90",
      RCB_PUBLIC_RUNNER_HOST: "RUNNER.WOONYONG.COM",
      RCB_PUBLIC_RUNNER_LANGUAGES: "java,kotlin,java",
      RCB_PUBLIC_RUNNER_MAX_CONCURRENT: "2",
      RCB_PUBLIC_RUNNER_ORIGINS: "https://woonyong-kr.github.io,http://127.0.0.1:4000",
      RCB_PUBLIC_RUNNER_PER_IP_LIMIT_PER_MINUTE: "5",
      RCB_PUBLIC_RUNNER_PORT: "17172"
    })).toEqual({
      allowedOrigins: ["https://woonyong-kr.github.io", "http://127.0.0.1:4000"],
      globalLimitPerHour: 90,
      hostname: "runner.woonyong.com",
      languages: ["java", "kotlin"],
      maxConcurrent: 2,
      perIpLimitPerMinute: 5,
      port: 17_172
    });
  });

  it("rejects insecure non-loopback origins", () => {
    expect(() => loadPublicRunnerConfig({
      RCB_PUBLIC_RUNNER_HOST: "runner.woonyong.com",
      RCB_PUBLIC_RUNNER_ORIGINS: "http://woonyong-kr.github.io"
    })).toThrow("Invalid public runner origin");
  });
});

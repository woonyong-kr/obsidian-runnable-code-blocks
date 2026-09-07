export interface PublicRunnerConfig {
  allowedOrigins: string[];
  globalLimitPerHour: number;
  hostname: string;
  languages: string[] | null;
  maxConcurrent: number;
  perIpLimitPerMinute: number;
  port: number;
}

export function loadPublicRunnerConfig(environment: NodeJS.ProcessEnv = process.env): PublicRunnerConfig {
  const hostname = normalizeHostname(environment.RCB_PUBLIC_RUNNER_HOST);
  const allowedOrigins = normalizeOrigins(environment.RCB_PUBLIC_RUNNER_ORIGINS);
  return {
    allowedOrigins,
    globalLimitPerHour: integer(environment.RCB_PUBLIC_RUNNER_GLOBAL_LIMIT_PER_HOUR, 120, 1, 10_000),
    hostname,
    languages: normalizeLanguages(environment.RCB_PUBLIC_RUNNER_LANGUAGES),
    maxConcurrent: integer(environment.RCB_PUBLIC_RUNNER_MAX_CONCURRENT, 2, 1, 8),
    perIpLimitPerMinute: integer(environment.RCB_PUBLIC_RUNNER_PER_IP_LIMIT_PER_MINUTE, 6, 1, 120),
    port: integer(environment.RCB_PUBLIC_RUNNER_PORT, 17_172, 1, 65_535)
  };
}

function normalizeHostname(value: string | undefined): string {
  const hostname = value?.trim().toLowerCase();
  if (hostname === undefined || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(hostname)) {
    throw new Error("RCB_PUBLIC_RUNNER_HOST must be a public DNS hostname.");
  }
  return hostname;
}

function normalizeOrigins(value: string | undefined): string[] {
  if (value === undefined) throw new Error("RCB_PUBLIC_RUNNER_ORIGINS is required.");
  const origins = [...new Set(value.split(",").map((entry) => normalizeOrigin(entry.trim())))];
  if (origins.length === 0) throw new Error("RCB_PUBLIC_RUNNER_ORIGINS must contain at least one HTTPS origin.");
  return origins;
}

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  const localDevelopment = url.protocol === "http:"
    && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if ((!localDevelopment && url.protocol !== "https:") || url.origin !== value || url.username || url.password) {
    throw new Error(`Invalid public runner origin: ${value}`);
  }
  return url.origin;
}

function normalizeLanguages(value: string | undefined): string[] | null {
  if (value === undefined || value.trim() === "" || value.trim() === "all") return null;
  const languages = [...new Set(value.split(",").map((entry) => entry.trim().toLowerCase()))];
  if (languages.length === 0 || languages.some((language) => !/^[a-z][a-z0-9-]*$/u.test(language))) {
    throw new Error("RCB_PUBLIC_RUNNER_LANGUAGES contains an invalid language.");
  }
  return languages;
}

function integer(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Expected an integer between ${String(minimum)} and ${String(maximum)}.`);
  }
  return parsed;
}

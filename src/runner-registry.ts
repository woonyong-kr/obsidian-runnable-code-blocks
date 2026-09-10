import type { CodeRunner, RunnerAvailability, RunnerEnvironment } from "./contracts";

export type RunnerFactory = () => CodeRunner;

export class RunnerRegistry {
  readonly #factories = new Map<string, RunnerFactory>();

  register(language: string, factory: RunnerFactory): this {
    const key = language.trim().toLowerCase();
    if (!/^[a-z][a-z0-9+#-]*$/.test(key)) {
      throw new Error(`Invalid runner language: ${language}`);
    }
    this.#factories.set(key, factory);
    return this;
  }

  languages(): string[] {
    return [...this.#factories.keys()].sort();
  }

  create(language: string): CodeRunner | null {
    return this.#factories.get(language.trim().toLowerCase())?.() ?? null;
  }
}

export class UnavailableRunner implements CodeRunner {
  readonly environment;
  readonly language;
  readonly #detail;
  readonly #reason;

  constructor(language: string, environment: RunnerEnvironment, detail: string, reason?: RunnerAvailability["reason"]) {
    this.language = language;
    this.environment = environment;
    this.#detail = detail;
    this.#reason = reason;
  }

  async availability() {
    return { available: false, detail: this.#detail, reason: this.#reason };
  }

  async run(): Promise<never> {
    throw new Error(this.#detail);
  }
}

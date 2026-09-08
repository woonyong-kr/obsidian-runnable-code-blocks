declare module "virtual:react-runtime" {
  const runtime: Readonly<{ source: string; version: string }>;
  export default runtime;
}

declare module "virtual:preview-worker-runtime" {
  const runtime: Readonly<{ main: string; worker: string }>;
  export default runtime;
}
declare module "@ampproject/worker-dom/dist/amp-production/main.mjs" {
  export function upgrade(root: HTMLElement, source: Promise<string[]>, config: Record<string, unknown>): Promise<unknown>;
}

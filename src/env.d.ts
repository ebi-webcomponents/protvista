/**
 * Ambient module declarations for non-code assets bundled into the
 * viewer.
 *
 * `default-config.yaml` is imported as a raw string via Vite's
 * `?raw` suffix (`import yaml from './default-config.yaml?raw'`) and
 * then parsed at runtime by `loadConfig`. Keeping the YAML text at
 * the edge lets `js-yaml` stay lazy-loaded: a JSON-only adopter who
 * overrides `viewerConfig` with a parsed object never pulls it in.
 *
 * Declared per-path (rather than as a broad `*.yaml?raw`) so a stray
 * import of an unexpected YAML file doesn't silently resolve to
 * `string` and slip past review.
 */
declare module '*.yaml?raw' {
  const content: string;
  export default content;
}

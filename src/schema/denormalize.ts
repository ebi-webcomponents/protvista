/**
 * Write a customized layout back into authored config form.
 *
 * The viewer's source of truth is the config: reordering a row moves it in
 * `config.rows`, hiding a track sets the same `hidden` field an author could
 * have written. This module closes the loop — it takes the authored config
 * the viewer loaded and the (possibly rearranged) normalized rows it is
 * rendering, and produces the authored config that would reproduce the
 * current view. That is what `getConfig()` returns and what the "Copy config"
 * control puts on the clipboard, so a user who imports data and arranges it
 * can save the arrangement and load it back.
 *
 * This is deliberately **not** a general denormalizer. Normalization is lossy
 * in the reverse direction (it resolves the rendering cascade, fills in
 * labels, wraps standalone tracks, and strips `extends`), so reconstructing a
 * config from `NormalizedConfig` alone would emit a fully-explicit dump that
 * looks nothing like the input. Instead we start from the authored object and
 * apply only what customize mode can change — row order, track order, and
 * `hidden` — leaving every other authored field, including `extends` and the
 * author's own comments-free structure, exactly as written.
 */
import type { NormalizedRow } from './normalize';
import type {
  GroupConfig,
  ProtvistaViewerConfig,
  TopLevelEntry,
  TrackConfig,
} from './types';
import { isGroupConfig } from './discriminate';

/** Reorder `items` to match `order`, appending anything `order` omits. */
function orderById<T extends { id: string }>(
  items: readonly T[],
  order: readonly string[]
): T[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  const out: T[] = [];
  for (const id of order) {
    const item = byId.get(id);
    if (item && !seen.has(id)) {
      out.push(item);
      seen.add(id);
    }
  }
  for (const item of items) if (!seen.has(item.id)) out.push(item);
  return out;
}

/**
 * Set or clear `hidden` on a copy of an authored entry. Visible is the
 * default, so a revealed row drops the field entirely rather than carrying an
 * explicit `hidden: false` — the exported config reads as if the user had
 * simply never hidden it.
 */
function withHidden<T extends { hidden?: boolean }>(entry: T, hidden: boolean): T {
  const next = { ...entry };
  if (hidden) next.hidden = true;
  else delete next.hidden;
  return next;
}

/**
 * The authored config that reproduces the current view.
 *
 * @param authored — the config the viewer loaded (post-`extends`, pre-normalize).
 * @param rows     — the normalized rows as currently arranged.
 */
export function applyLayoutToConfig(
  authored: ProtvistaViewerConfig,
  rows: readonly NormalizedRow[]
): ProtvistaViewerConfig {
  const byId = new Map<string, TopLevelEntry>(
    authored.rows.map((entry) => [entry.id, entry])
  );

  const arranged: TopLevelEntry[] = [];
  for (const row of rows) {
    const entry = byId.get(row.id);
    // A normalized row with no authored counterpart can only come from a
    // caller mixing configs; there is nothing to write it back into.
    if (!entry) continue;
    byId.delete(row.id);

    if (isGroupConfig(entry)) {
      const group: GroupConfig = withHidden(entry, !!row.hidden);
      group.tracks = orderById(
        entry.tracks,
        row.tracks.map((t) => t.id)
      ).map((track) => {
        const to = row.tracks.find((t) => t.id === track.id);
        return withHidden(track, !!to?.hidden);
      });
      arranged.push(group);
    } else {
      // A standalone row *is* its single track; its `hidden` is the row's.
      arranged.push(withHidden(entry as TrackConfig, !!row.hidden));
    }
  }

  // Anything the rows never mentioned keeps its authored position at the end
  // rather than being silently dropped — losing a track the user cannot see
  // would be far worse than an unexpected ordering. Shallow-copied (like the
  // `withHidden` entries above) so a caller mutating the returned config can't
  // reach back into the retained authored baseline.
  for (const entry of authored.rows) {
    if (byId.has(entry.id)) arranged.push({ ...entry } as TopLevelEntry);
  }

  return { ...authored, rows: arranged };
}

/**
 * Serialize a config as YAML, matching the authoring format the docs and
 * examples use. `js-yaml` is lazy-imported (as in `parse.ts`) so pages that
 * never export a config don't download the dumper.
 */
export async function configToYaml(
  config: ProtvistaViewerConfig
): Promise<string> {
  const mod = await import('js-yaml');
  // Both CJS (`mod.default.dump`) and ESM (`mod.dump`) need to resolve —
  // same tolerance as `parseYaml` in `parse.ts`.
  type YamlModule = {
    dump: (value: unknown, opts?: Record<string, unknown>) => string;
  };
  const yaml: YamlModule =
    typeof (mod as { dump?: unknown }).dump === 'function'
      ? (mod as unknown as YamlModule)
      : (mod as unknown as { default: YamlModule }).default;
  return yaml.dump(config, {
    // Key order is meaningful to a reader (`id` before `tracks`), and the
    // authored object already carries it — don't let the dumper sort it away.
    sortKeys: false,
    // Long label/URL templates are far easier to read unwrapped than folded
    // across lines, and folding a `{accession}` template mid-placeholder is
    // a classic source of confusing diffs.
    lineWidth: -1,
    noRefs: true,
  });
}

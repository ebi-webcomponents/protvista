/**
 * Playground page controller.
 *
 * Wires the CodeMirror editor to a live `<protvista-uniprot>` preview:
 * edits are debounced, validated through the shipped config validator
 * (`lint.ts`), rendered as gutter markers + a screen-reader-friendly
 * error list, and — when the config is valid — pushed into a freshly
 * mounted preview element. The whole session (preset or custom text +
 * accession) round-trips through the URL hash for shareable links.
 *
 * The bare import below is what registers `<protvista-uniprot>` — the
 * `@customElement` decorator runs on module evaluation. It is load-bearing,
 * not decorative: deleting it leaves the preview an undefined tag. The
 * package no longer claims `"sideEffects": false`, so bundlers keep it.
 * The playground page also imports the component from its own `<script>`,
 * which is redundant but harmless (ESM evaluates the module once).
 */
import '../protvista-uniprot.js';
import { parseConfigText } from '../schema/parse.js';
import { isPlainObject } from '../schema/shape.js';
import { MAX_FETCH_TEXT_BYTES } from '../schema/fetch-text.js';
import {
  parseSequenceText,
  sequenceDisplayLabel,
  type ResolvedSequence,
} from '../schema/sequence.js';
import { createEditor, type PlaygroundEditor } from './editor.js';
import { createDiagnosticsView } from './diagnostics-view.js';
import { lintConfig, memoizedExtendsFetcher, type LintResult } from './lint.js';
import { initSplitter } from './splitter.js';
import {
  KIND_FOR_SHAPE,
  answersFor,
  basename,
  createLocalFileStore,
  findLocalReferences,
  guessShape,
  inferFormat,
  isFastaFile,
  isLocalSequenceReference,
  isPreflightDuplicate,
  localDataDiagnostics,
  mayNameLocalFile,
  referenceFor,
  relabelRuntime,
  sniffFormat,
  withLocalFiles,
  type LocalDataResult,
  type LocalFile,
  type RuntimeDetail,
} from './local-files.js';
import {
  appendTrack,
  attachToTrack,
  listTargetTracks,
  rowIdFor,
  rowLabelFor,
  sequenceTargetSummary,
  setSequence,
  starterSequenceConfig,
  type DataValue,
  type EditResult,
} from './config-edit.js';
import {
  createLocalDataControl,
  formatSize,
  residueCount,
  type ReadFile,
  type SequenceTarget,
} from './local-data-control.js';
import type { DataFormat } from '../schema/types.js';
import {
  COMMUNITY_PRESETS,
  PRESETS,
  DEV_PRESETS,
  DEFAULT_PRESET_ID,
  getPreset,
  isDevPreset,
  type Preset,
} from './presets.js';
import { configFileName } from './format.js';
import {
  readHash,
  writeHash,
  accessionFromSearch,
  DEFAULT_ACCESSION,
  type PlaygroundState,
} from './url-state.js';

const DEBOUNCE_MS = 400;

/** Minimal structural view of the preview element's writable inputs. */
type PreviewElement = HTMLElement & {
  viewerConfig?: string | object;
  accession?: string;
};

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`playground: missing #${id}`);
  return el as T;
};

const presetSelect = $<HTMLSelectElement>('preset');
const accessionInput = $<HTMLInputElement>('accession');
const runButton = $<HTMLButtonElement>('run');
const errorSummary = $<HTMLElement>('error-summary');
const errorList = $<HTMLUListElement>('errors');
const previewHost = $<HTMLElement>('preview');
const previewStale = $<HTMLElement>('preview-stale');
const editorHost = $<HTMLElement>('editor');
const presetDesc = $<HTMLElement>('preset-desc');

/**
 * Says why the accession input is disabled while the config declares
 * `sequence:`. Built here rather than in the page markup so every page that
 * hosts the controller gets it; linked to the input by `aria-describedby`
 * only while it applies.
 */
const accessionHint = document.createElement('span');
accessionHint.id = 'accession-hint';
accessionHint.className = 'accession-hint';
accessionHint.hidden = true;
accessionHint.textContent = 'Not used: this config sets sequence:';
accessionInput.insertAdjacentElement('afterend', accessionHint);

/**
 * Disable the accession input for a `sequence:` config, which shows its own
 * protein: an accession is not used there, and passing one is an error.
 */
function syncAccessionInput(declaresSequence: boolean): void {
  accessionInput.disabled = declaresSequence;
  accessionHint.hidden = !declaresSequence;
  if (declaresSequence) {
    accessionInput.setAttribute('aria-describedby', accessionHint.id);
  } else {
    accessionInput.removeAttribute('aria-describedby');
  }
}

/** Id of the preset currently loaded; used to keep shared links short. */
let activePresetId = DEFAULT_PRESET_ID;
// Declared here so the pipeline functions below can reference it; assigned
// exactly once in the bootstrap at the end of the file (hence `let`).
// eslint-disable-next-line prefer-const
let editor: PlaygroundEditor;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
/** Monotonic stamp so a slow async run can't apply over a newer one. */
let updateSeq = 0;
/** Snapshot of what the preview currently shows, to detect staleness. */
let lastRendered: { text: string; accession: string; files: number } | null =
  null;
/**
 * What the mounted preview was rendered with, for reading its events: the
 * track keys whose loaded file the pre-flight failed to decode (the
 * preview's own report of the same failure is skipped), and the files it was
 * handed (their `blob:` URLs are put back to `./name`). Captured at mount, so
 * live validation of later edits cannot change how the preview's events,
 * which arrive asynchronously, are read.
 */
let mounted: {
  preflightFailed: ReadonlySet<string>;
  files: readonly LocalFile[];
} = { preflightFailed: new Set(), files: [] };

/** Files the user loaded — read in this browser, never uploaded. */
const store = createLocalFileStore();

// ── Preset picker ─────────────────────────────────────────────
// The dev playground (`/protvista/playground?dev`) surfaces an extra "Edge cases"
// group of tricky proteins for eyeballing odd/rich rendering — otherwise it is
// the same page. A shared link to a dev preset auto-enables the mode so the
// picker always contains the active preset.
const CUSTOM_OPTION = 'custom';
const restoredForMode = readHash();
const isDev =
  new URLSearchParams(window.location.search).has('dev') ||
  (restoredForMode?.preset != null && isDevPreset(restoredForMode.preset));

function addPresetOptions(
  parent: HTMLElement,
  presets: readonly Preset[]
): void {
  for (const preset of presets) {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.label;
    parent.append(option);
  }
}

if (isDev) {
  const examples = document.createElement('optgroup');
  examples.label = 'Config examples';
  addPresetOptions(examples, PRESETS);
  presetSelect.append(examples);
  const edge = document.createElement('optgroup');
  edge.label = 'Edge cases (dev) — default config, tricky proteins';
  addPresetOptions(edge, DEV_PRESETS);
  presetSelect.append(edge);
  document.title = `${document.title} — dev examples`;
} else {
  addPresetOptions(presetSelect, PRESETS);
}
if (COMMUNITY_PRESETS.length > 0) {
  const community = document.createElement('optgroup');
  community.label = 'Community views';
  addPresetOptions(community, COMMUNITY_PRESETS);
  // In dev mode, keep the edge cases last.
  presetSelect.insertBefore(
    community,
    isDev ? presetSelect.lastElementChild : null
  );
}

const customOption = document.createElement('option');
customOption.value = CUSTOM_OPTION;
customOption.textContent = 'Custom (edited)';
customOption.hidden = true;
presetSelect.append(customOption);

// ── Diagnostics footer (owns the summary line + error list) ───
const diagnosticsView = createDiagnosticsView(errorSummary, errorList);

// ── Live preview ──────────────────────────────────────────────
function renderPreview(
  configText: string,
  accession: string | undefined,
  parsed?: unknown,
  local?: LocalDataResult
): void {
  previewHost.textContent = '';
  mounted = {
    preflightFailed: local?.preflightFailed ?? new Set(),
    files: store.list(),
  };
  const element = document.createElement('protvista-uniprot') as PreviewElement;
  // Property set (not attribute) before connection so the mount-time
  // pipeline parses the raw YAML/JSON string directly. `setConfig()` would
  // also work now that it re-inits properly, but a fresh element per Run is
  // what a playground wants: it clears any error panel, tooltip, or
  // structure-viewer state left over from the previous config.
  //
  // With files loaded, the parsed config goes in instead, its references to
  // them pointed at their `blob:` URLs — the editor text (and so the share
  // link) keeps naming `./hits.csv`.
  element.viewerConfig =
    parsed !== undefined && store.list().length > 0
      ? (withLocalFiles(parsed, store) as object)
      : configText;
  // No accession for a `sequence:` config: it shows its own protein, and an
  // accession beside it is an error.
  if (accession) element.setAttribute('accession', accession);
  previewHost.append(element);
}

// Runtime/data failures (bad URL, unreachable service) bubble here as
// `protvista-error` with detail
// `{ phase, severity, message, source, issues, context }` (see `_report` in
// protvista-uniprot.ts). Surface them alongside config diagnostics — they can
// arrive after a config that itself validated cleanly. For a loaded file, the
// event names the `blob:` URL the preview fetched: put the file's `./name`
// back, and skip a decode failure the pre-flight has already listed.
previewHost.addEventListener('protvista-error', (event) => {
  const raw = (event as CustomEvent<RuntimeDetail>).detail;
  if (isPreflightDuplicate(raw, mounted.preflightFailed)) return;
  const detail = relabelRuntime(raw, mounted.files);
  diagnosticsView.appendRuntime(
    detail?.issues,
    detail?.phase,
    detail?.message,
    detail?.severity === 'warning' ? 'warning' : undefined
  );
});

// ── Update pipeline ───────────────────────────────────────────
function accessionValue(): string {
  return accessionInput.value.trim() || DEFAULT_ACCESSION;
}

function currentState(): PlaygroundState {
  const accession = accessionValue();
  const text = editor.getText();
  const preset = getPreset(activePresetId);
  return preset && text === preset.config
    ? { preset: activePresetId, accession }
    : { config: text, accession };
}

/** The banner's own text, from the page markup. */
const staleText = [...previewStale.childNodes];
/** The text that replaces it while the preview is held back, if any. */
let staleReason: string | undefined;

/**
 * Toggle the "preview is out of date, press Run" indicator. With a `reason`,
 * the banner says that instead: pressing Run would not help, and the banner
 * says what would. The text changes only when the reason does, so the live
 * region is not re-announced on every edit.
 */
function setStale(stale: boolean, reason?: string): void {
  previewStale.hidden = !stale;
  previewHost.classList.toggle('stale', stale);
  if (reason === staleReason) return;
  staleReason = reason;
  if (reason === undefined) previewStale.replaceChildren(...staleText);
  else previewStale.textContent = reason;
}

/**
 * Why the preview is held back although the config is valid: its own
 * `sequence:` names a local file that no loaded sequence file answers.
 */
function heldBackReason(result: ValidateResult): string | undefined {
  if (!result?.local?.sequenceMissing) return undefined;
  const missing = basename(localSequenceRef(result.parsed) ?? '');
  return `Load ${missing} to see the preview — the config's sequence: names it.`;
}

/** Reflect edited/pristine state in the preset picker. */
function syncPicker(text: string): void {
  const preset = getPreset(activePresetId);
  const pristine = !!preset && text === preset.config;
  presetSelect.value = pristine ? activePresetId : CUSTOM_OPTION;
  presetDesc.textContent = pristine ? (preset?.description ?? '') : '';
}

/** Each `extends:` base is fetched once per page, not on every lint. */
const extendsFetcher = memoizedExtendsFetcher();

async function computeSafe(
  text: string,
  accession: string
): Promise<LintResult> {
  try {
    return await lintConfig(text, accession, { extendsFetcher });
  } catch (error) {
    // Validation is not supposed to throw, but never let an unexpected
    // failure silently freeze the pipeline — surface it as an error.
    return {
      diagnostics: [
        {
          from: 0,
          to: 0,
          severity: 'error',
          code: 'internal',
          message: `Internal validation error: ${(error as Error).message}`,
        },
      ],
      declaresSequence: false,
    };
  }
}

/** The validated snapshot, or `null` when a newer run superseded this one. */
type ValidateResult = {
  text: string;
  accession: string;
  valid: boolean;
  /** The parsed config, when local files made parsing it worthwhile. */
  parsed?: unknown;
  /** The config sets `sequence:`, so the preview gets no accession. */
  declaresSequence: boolean;
  /** `store.version` at validation time. */
  files: number;
  /** The pre-flight of the loaded files, when it ran. */
  local?: LocalDataResult;
} | null;

/**
 * Shared validation step for both pipeline entry points: cancel any
 * pending debounced run, stamp a generation, validate the current text,
 * bail if a newer run superseded us, then push gutter markers, the error
 * list, and the shareable URL. Never touches the preview — that is the
 * caller's decision (only `run()` mounts it).
 */
async function validateCurrent(): Promise<ValidateResult> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
  const seq = ++updateSeq;
  const text = editor.getText();
  const accession = accessionValue();
  syncPicker(text);

  const files = store.version;
  const lint = await computeSafe(text, accession);
  const { diagnostics: configDiagnostics, declaresSequence } = lint;
  if (seq !== updateSeq) return null;
  syncAccessionInput(declaresSequence);
  // Only the config's own errors make it invalid. A data problem in a loaded
  // file renders that track empty, as a hosted viewer would. The one data
  // problem that still holds the preview back, a missing sequence file, is
  // `run()`'s to handle (`sequenceMissing`).
  const valid = !configDiagnostics.some((d) => d.severity === 'error');

  // The config the lint parsed, not a second parse of the same text.
  let parsed: unknown;
  let local: LocalDataResult | undefined;
  if (
    valid &&
    lint.parsed !== undefined &&
    (store.list().length > 0 || mayNameLocalFile(text, lint.parsed))
  ) {
    parsed = lint.parsed;
    try {
      local = await localDataDiagnostics(text, parsed, store);
    } catch {
      // A throw here leaves the data unchecked.
    }
    if (seq !== updateSeq) return null;
  }

  const diagnostics = [...configDiagnostics, ...(local?.diagnostics ?? [])];
  editor.setDiagnostics(diagnostics);
  diagnosticsView.showConfig(diagnostics);
  writeHash(currentState());
  return { text, accession, valid, parsed, declaresSequence, files, local };
}

/**
 * Live validation only. Deliberately does NOT touch the preview: mounting
 * `<protvista-uniprot>` is heavy (Nightingale/Mol*), so re-mounting on
 * every keystroke can exhaust memory. The preview updates only in `run()`.
 */
async function refreshDiagnostics(): Promise<void> {
  const result = await validateCurrent();
  if (!result) return;
  setStale(
    !lastRendered ||
      result.text !== lastRendered.text ||
      result.accession !== lastRendered.accession ||
      result.files !== lastRendered.files,
    heldBackReason(result)
  );
}

/**
 * Explicit "Run": validate, then (re)mount the preview when the config is
 * valid. This is the ONLY path that mounts `<protvista-uniprot>`.
 *
 * One data problem also holds it back: the config's own `sequence:` names a
 * local file that isn't loaded (`sequenceMissing`). Unlike a missing track
 * file, which costs one track, that preview could only show the whole-viewer
 * `cannot-resolve-sequence` panel — and its request would send the private
 * file name to the docs host. The `local-file-missing` row and the preview's
 * banner say what to load.
 */
async function run(): Promise<ValidateResult> {
  const result = await validateCurrent();
  if (!result) return null;
  if (result.valid && !result.local?.sequenceMissing) {
    renderPreview(
      result.text,
      result.declaresSequence ? undefined : result.accession,
      result.parsed,
      result.local
    );
    lastRendered = {
      text: result.text,
      accession: result.accession,
      files: result.files,
    };
    setStale(false);
  } else {
    // Keep the last valid preview mounted but flagged out of date — saying
    // what to load when a missing sequence file is what holds it back.
    setStale(true, result.valid ? heldBackReason(result) : undefined);
  }
  return result;
}

function scheduleRefresh(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void refreshDiagnostics(), DEBOUNCE_MS);
}

// ── Controls ──────────────────────────────────────────────────
// Typing only re-validates (cheap). The preview is mounted by `run()`.
runButton.addEventListener('click', () => void run());

// Cmd/Ctrl+Enter runs, like most editors/playgrounds. A capture-phase
// listener so it fires even while the CodeMirror editor has focus.
document.addEventListener(
  'keydown',
  (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void run();
    }
  },
  true
);

/**
 * A new preset or accession starts over: the status line's word on the last
 * file loaded (and any snippet to paste) is about what came before. The
 * loaded files stay, listed, for the new config to name.
 */
function clearDataStatus(): void {
  control.setStatus('');
  control.setSnippet('');
}

// Selecting a preset is a deliberate "show me this" → render once.
presetSelect.addEventListener('change', () => {
  const preset = getPreset(presetSelect.value);
  if (!preset) return; // "Custom" is not selectable directly.
  activePresetId = preset.id;
  accessionInput.value = preset.accession;
  editor.setText(preset.config);
  clearDataStatus();
  void run();
});

// Accession changes fire once on blur/enter → render once.
accessionInput.addEventListener('change', () => {
  clearDataStatus();
  void run();
});

// ── Local data files ──────────────────────────────────────────
// A picked or dropped file is read in this browser and never uploaded. The
// config names it as a hosted config would (`data: ./hits.csv`); the preview
// is pointed at a `blob:` copy at render time (see `renderPreview`).
const control = createLocalDataControl({
  button: $<HTMLButtonElement>('load-data'),
  input: $<HTMLInputElement>('data-file'),
  panel: $<HTMLElement>('data-attach'),
  status: $<HTMLElement>('data-status'),
  snippet: $<HTMLElement>('data-snippet'),
  list: $<HTMLElement>('data-files'),
  dropTarget: $<HTMLElement>('config-pane'),
  overlay: $<HTMLElement>('drop-overlay'),
  onFile: loadFile,
  onRemove(ref) {
    const name = store.get(ref)?.name ?? ref;
    store.remove(ref);
    control.showFiles(store.list());
    control.setStatus(`Removed ${name}.`);
    void refreshDiagnostics();
  },
});

async function parseEditor(): Promise<unknown> {
  try {
    return await parseConfigText(editor.getText());
  } catch {
    return undefined;
  }
}

function registerFile(file: ReadFile, ref: string, format: DataFormat): void {
  store.register({
    ref,
    name: file.name,
    size: file.size,
    format,
    text: file.text,
  });
  control.showFiles(store.list());
}

/** Render with the file in place, then say how it went. */
async function runWithFile(
  file: ReadFile,
  ref: string,
  note: string
): Promise<void> {
  const result = await run();
  const as = ref === `./${file.name}` ? '' : ` as ${ref}`;
  let outcome: string;
  if (!result) {
    // A newer validation (an edit made meanwhile) superseded this run, and
    // the preview was not re-rendered.
    outcome = 'Press Run to see it in the preview.';
  } else if (!result.valid) {
    outcome = 'Fix the config problems listed below, then press Run.';
  } else if (result.local?.sequenceMissing) {
    outcome = heldBackReason(result)!;
  } else if (result.local?.failedRefs.has(ref)) {
    outcome = "It couldn't be read — see the problem listed below.";
  } else {
    const count = result.local?.counts.get(ref);
    const how = 'read in your browser, never uploaded.';
    outcome =
      count === undefined
        ? `It was ${how}`
        : `${count} record${count === 1 ? '' : 's'} — ${how}`;
  }
  control.setStatus(`${note}Loaded ${file.name}${as}. ${outcome}`);
}

/**
 * A file was read. When the config already names it — by the reference it
 * would get, or by a path with its name (`./data/hits.csv`, as in a pasted
 * Starter Kit config) — it answers to that reference and the preview runs
 * with no edit. Otherwise the attach form asks where it goes.
 *
 * A FASTA file, or any file the config's own `sequence:` names (a headerless
 * `seq.txt`, say: the config says what it is), becomes the sequence.
 */
async function loadFile(file: ReadFile, skipped: number): Promise<void> {
  control.setSnippet('');
  const note =
    skipped > 0 ? `Load one file at a time — loaded ${file.name} only. ` : '';
  // A reference registered to another file is not this one's; see answersFor.
  const answers = answersFor(file, store);
  const parsed = await parseEditor();
  const own = localSequenceRef(parsed);
  if (
    isFastaFile(file.name, file.text) ||
    (own !== undefined && answers(own))
  ) {
    await loadSequenceFile(file, note);
    return;
  }
  // A tab-separated export saved as `.csv` is offered as `tsv`, so the new
  // track reads it the way its header is written.
  const byName = inferFormat(file.name);
  const inferred = sniffFormat(file.text, byName);

  const matching = findLocalReferences(parsed).filter((r) => answers(r.value));
  const distinct = [...new Set(matching.map((r) => r.value))];
  if (distinct.length === 1) {
    const [ref] = distinct;
    const format = matching[0].format ?? inferFormat(ref) ?? inferred;
    if (format) {
      registerFile(file, ref, format);
      await runWithFile(file, ref, note);
      return;
    }
  }

  const targets = listTargetTracks(parsed);
  const choice = await control.ask({
    file,
    inferred,
    ...(inferred !== byName && inferred !== undefined
      ? {
          reason:
            `Its header looks ${inferred === 'tsv' ? 'tab' : 'comma'}-separated, ` +
            `so it is read as ${inferred}.`,
        }
      : {}),
    options: targets.map((t) => ({ value: t.path, label: t.label })),
    selected: targets.find((t) => answers(t.ref))?.path,
  });
  if (!choice) {
    control.setStatus(`${note}${file.name} was not loaded.`);
    return;
  }

  // The text may have changed while the form was open.
  const text = editor.getText();
  const current = await parseEditor();
  const target = choice.target
    ? listTargetTracks(current).find((t) => t.path === choice.target)
    : undefined;
  if (choice.target && !target) {
    control.setStatus(
      `${note}Track ${choice.target} is no longer in the config — ` +
        `${file.name} was not loaded.`
    );
    return;
  }
  // The chosen track already names a path with this file's name: answer it.
  // When the format chosen is not the one the config reads it with, say so
  // in the config, so the share link (and a hosted viewer) reads it the same.
  if (target && answers(target.ref)) {
    const ref = target.ref;
    const stated = findLocalReferences(current).find(
      (r) => r.trackPath === target.path
    );
    const reads = stated?.format ?? inferFormat(ref);
    const edit =
      stated?.adapter === undefined && reads !== choice.format
        ? await attachToTrack(text, current, target, {
            url: ref,
            format: choice.format,
          })
        : undefined;
    await finishLoad(file, ref, choice.format, edit, note);
    return;
  }

  const ref = referenceFor(
    file.name,
    new Map(store.list().map((f) => [f.ref, f.name]))
  );
  // The shorthand when the extension says the format; otherwise `format:`.
  const value: DataValue =
    inferFormat(ref) === choice.format
      ? ref
      : { url: ref, format: choice.format };
  const edit: EditResult = target
    ? await attachToTrack(text, current, target, value)
    : await appendTrack(text, current, {
        id: rowIdFor(file.name, current),
        label: rowLabelFor(file.name),
        // A format that declares its records (BED) gets that shape.
        kind: KIND_FOR_SHAPE[guessShape(file.text, choice.format)],
        data: value,
      });
  await finishLoad(file, ref, choice.format, edit, note);
}

/**
 * Register the file under `ref`, apply the config edit (if any), and run. An
 * edit that could not be made leaves the file loaded and shows the snippet
 * to paste.
 */
async function finishLoad(
  file: ReadFile,
  ref: string,
  format: DataFormat,
  edit: EditResult | undefined,
  note: string
): Promise<void> {
  registerFile(file, ref, format);
  if (edit !== undefined) {
    if ('error' in edit) {
      control.setStatus(`${note}Loaded ${file.name} as ${ref}. ${edit.error}`);
      control.setSnippet(edit.snippet);
      void refreshDiagnostics();
      return;
    }
    editor.setText(edit.text);
  }
  await runWithFile(file, ref, note);
}

// ── A FASTA file: the config's sequence ───────────────────────

/** The config's own top-level `sequence:`, when it names a local file. */
function localSequenceRef(parsed: unknown): string | undefined {
  const value = isPlainObject(parsed) ? parsed.sequence : undefined;
  return isLocalSequenceReference(value) ? value.trim() : undefined;
}

/** What each choice in the "use as sequence" form would change. */
function sequenceConsequences(
  parsed: unknown,
  ref: string
): {
  consequences: Record<SequenceTarget, string[]>;
  defaultTarget: SequenceTarget;
  thisDisabled?: string;
} {
  const summary = sequenceTargetSummary(parsed);
  const keep: string[] = [`Sets sequence: ${ref}`];
  if (summary.accession !== undefined) {
    keep.push(`Removes accession: ${summary.accession}`);
  }
  const { replaces } = summary;
  if (replaces && 'reference' in replaces) {
    keep.push(`Replaces ${replaces.reference}`);
  } else if (replaces && 'inline' in replaces) {
    keep.push(
      replaces.residues === undefined
        ? 'Replaces the inline sequence'
        : `Replaces the inline sequence (${residueCount(replaces.residues)})`
    );
  }
  keep.push('Keeps the tracks');
  if (summary.needsUniprot > 0) {
    const n = summary.needsUniprot;
    keep.push(
      `${n} track${n === 1 ? ' needs' : 's need'} UniProt data and would be ` +
        'listed as errors'
    );
  }
  if (summary.extends) {
    keep.push(
      'Keeps extends: — anything the base adds that needs UniProt is listed after Run'
    );
  }
  return {
    consequences: {
      this: keep,
      new: [
        `Replaces the editor text with a config holding only sequence: ${ref}`,
        'Undo with Ctrl/Cmd+Z in the editor',
      ],
    },
    defaultTarget:
      !summary.parses || summary.needsUniprot > 0 || summary.extends
        ? 'new'
        : 'this',
    ...(summary.parses
      ? {}
      : { thisDisabled: "The config doesn't parse — fix it first." }),
  };
}

/**
 * A FASTA file was read. It is parsed — as the element would parse it from
 * the reference it gets — before anything changes: a file the element would
 * reject is not loaded, and the status quotes the element's own message.
 *
 * When the config's `sequence:` already names it, it answers to that
 * reference with no edit (a pasted `examples/sequence-only` config, or a
 * reload). Otherwise a form asks whether to set this config's `sequence:` or
 * start a new sequence-only config. Either way the editor only ever names the
 * file; the residues and header reach the preview at render time.
 */
async function loadSequenceFile(file: ReadFile, note: string): Promise<void> {
  if (file.size > MAX_FETCH_TEXT_BYTES) {
    control.setStatus(
      `${note}${file.name} is ${formatSize(file.size)} — a sequence file can ` +
        `be at most ${formatSize(MAX_FETCH_TEXT_BYTES)}, the most a hosted ` +
        'viewer fetches.'
    );
    return;
  }
  const parsed = await parseEditor();
  const own = localSequenceRef(parsed);
  const named = own !== undefined && answersFor(file, store)(own);
  const ref = named
    ? own
    : referenceFor(
        file.name,
        new Map(store.list().map((f) => [f.ref, f.name]))
      );

  const read = parseSequenceText(file.text, ref);
  if (!read.ok) {
    // An earlier copy is only "in use" while the config names it.
    const earlier = named && store.get(ref)?.kind === 'sequence';
    control.setStatus(
      `${note}${file.name} wasn't loaded: ${read.message}` +
        (earlier ? ' The copy loaded earlier is still in use.' : '')
    );
    return;
  }

  if (named) {
    registerSequence(file, ref, read.value);
    await runWithSequence(file, ref, read.value, note, false);
    return;
  }

  const label = sequenceDisplayLabel(read.value);
  const length = residueCount(read.value.residues.length);
  const target = await control.askSequence({
    file,
    summary: read.value.header
      ? `${label} — ${length}.`
      : `No FASTA header — shown as "${label}". ${length}.`,
    ...sequenceConsequences(parsed, ref),
  });
  if (!target) {
    control.setStatus(`${note}${file.name} was not loaded.`);
    return;
  }

  // The text may have changed while the form was open.
  const edit: EditResult =
    target === 'new'
      ? { text: await starterSequenceConfig(ref) }
      : await setSequence(editor.getText(), await parseEditor(), ref);
  registerSequence(file, ref, read.value);
  if ('error' in edit) {
    control.setStatus(`${note}Loaded ${file.name} as ${ref}. ${edit.error}`);
    control.setSnippet(edit.snippet);
    void refreshDiagnostics();
    return;
  }
  editor.setText(edit.text);
  await runWithSequence(file, ref, read.value, note, target === 'new');
}

function registerSequence(
  file: ReadFile,
  ref: string,
  sequence: ResolvedSequence
): void {
  store.register({
    kind: 'sequence',
    ref,
    name: file.name,
    size: file.size,
    text: file.text,
    sequence,
  });
  control.showFiles(store.list());
}

/** Render with the sequence in place, then say how it went. */
async function runWithSequence(
  file: ReadFile,
  ref: string,
  sequence: ResolvedSequence,
  note: string,
  replaced: boolean
): Promise<void> {
  const result = await run();
  const as = ref === `./${file.name}` ? '' : ` ${ref}`;
  const loaded =
    `${note}Loaded ${file.name} as the sequence${as} ` +
    `(${sequenceDisplayLabel(sequence)}, ${residueCount(sequence.residues.length)})`;
  const outcome = !result
    ? '. Press Run to see it in the preview.'
    : !result.valid
      ? '. Fix the config problems listed below, then press Run.'
      : ' — read in your browser, never uploaded.';
  control.setStatus(
    loaded +
      outcome +
      (replaced
        ? ' The previous config was replaced — press Ctrl/Cmd+Z in the editor to undo.'
        : '')
  );
}

// Theming is now a config concern — set `theme.labelColor` in the config
// (the component applies it as a --protvista-* token). No separate control.

// ── Bootstrap ─────────────────────────────────────────────────
function initialState(): { text: string; accession: string; presetId: string } {
  const restored = readHash();
  if (restored?.config != null) {
    return {
      text: restored.config,
      accession: restored.accession ?? DEFAULT_ACCESSION,
      // Mark as custom so an edited link doesn't masquerade as a preset.
      presetId: CUSTOM_OPTION,
    };
  }
  // An id we do not know still falls back to the default preset — a shared
  // link should show *something* — but say so rather than silently rendering a
  // different viewer than the link asked for. `presets.spec.ts` keeps the docs'
  // own `#preset=` links honest; this covers a hand-typed or stale one.
  if (restored?.preset && !getPreset(restored.preset)) {
    console.warn(
      `Unknown preset "${restored.preset}" — falling back to ${DEFAULT_PRESET_ID}.`
    );
  }
  const preset =
    (restored?.preset && getPreset(restored.preset)) ||
    getPreset(DEFAULT_PRESET_ID)!;
  // A bare `?accession=` query seeds the accession when the hash carries no
  // state of its own (a full shareable link lives in the hash and wins).
  const queryAccession = restored
    ? null
    : accessionFromSearch(window.location.search);
  // A `#preset=` link without `&accession=` decodes with no accession, so it
  // opens the preset's own protein rather than the default one.
  return {
    text: preset.config,
    accession: restored?.accession ?? queryAccession ?? preset.accession,
    presetId: preset.id,
  };
}

const start = initialState();
activePresetId = start.presetId;
accessionInput.value = start.accession;
editor = createEditor({
  parent: editorHost,
  doc: start.text,
  ariaLabel: 'ProtVista configuration editor (YAML or JSON)',
  onChange: scheduleRefresh,
});
// Render the initial preview once on load (the label colour keeps the
// viewer's default until the user changes the picker).
void run();

// Make the divider between the editor and preview panes draggable.
initSplitter($<HTMLElement>('panels'), $<HTMLElement>('splitter'));

// ── Share & export ────────────────────────────────────────────
// Copy link shares the URL hash (which already holds the whole state);
// Download config saves the editor text byte-for-byte with an extension
// that matches format detection.
const shareStatus = $<HTMLElement>('share-status');

$<HTMLButtonElement>('copy-link').addEventListener('click', () => {
  void navigator.clipboard.writeText(location.href).then(
    () => {
      shareStatus.textContent = 'Link copied';
    },
    () => {
      shareStatus.textContent = 'Could not copy the link';
    },
  );
});

$<HTMLButtonElement>('download-config').addEventListener('click', () => {
  const text = editor.getText();
  const url = URL.createObjectURL(new Blob([text]));
  const link = document.createElement('a');
  link.href = url;
  link.download = configFileName(text);
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoke on the next tick: some browsers still resolve the blob URL
  // while handling the click.
  setTimeout(() => URL.revokeObjectURL(url), 0);
});

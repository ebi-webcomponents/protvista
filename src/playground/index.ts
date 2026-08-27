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
import type { ValidationIssue } from '../schema/index.js';
import { createEditor, type PlaygroundEditor } from './editor.js';
import { createDiagnosticsView } from './diagnostics-view.js';
import { computeDiagnostics, type PlaygroundDiagnostic } from './lint.js';
import { initSplitter } from './splitter.js';
import {
  PRESETS,
  DEV_PRESETS,
  DEFAULT_PRESET_ID,
  getPreset,
  isDevPreset,
  type Preset,
} from './presets.js';
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
  viewerConfig?: string;
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
let lastRendered: { text: string; accession: string } | null = null;

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

const customOption = document.createElement('option');
customOption.value = CUSTOM_OPTION;
customOption.textContent = 'Custom (edited)';
customOption.hidden = true;
presetSelect.append(customOption);

// ── Diagnostics footer (owns the summary line + error list) ───
const diagnosticsView = createDiagnosticsView(errorSummary, errorList);

// ── Live preview ──────────────────────────────────────────────
function renderPreview(configText: string, accession: string): void {
  previewHost.textContent = '';
  const element = document.createElement('protvista-uniprot') as PreviewElement;
  // Property set (not attribute) before connection so the mount-time
  // pipeline parses the raw YAML/JSON string directly. `setConfig()` would
  // also work now that it re-inits properly, but a fresh element per Run is
  // what a playground wants: it clears any error panel, tooltip, or
  // structure-viewer state left over from the previous config.
  element.viewerConfig = configText;
  element.setAttribute('accession', accession);
  previewHost.append(element);
}

// Runtime/data failures (bad URL, unreachable service) bubble here as
// `protvista-error` with detail `{ phase, issues, context }` (see
// `reportError` in protvista-uniprot.ts). Surface them alongside config
// diagnostics — they can arrive after a config that itself validated cleanly.
previewHost.addEventListener('protvista-error', (event) => {
  const { detail } = event as CustomEvent<{
    phase?: string;
    issues?: ValidationIssue[];
  }>;
  diagnosticsView.appendRuntime(detail?.issues, detail?.phase);
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

/** Toggle the "preview is out of date, press Run" indicator. */
function setStale(stale: boolean): void {
  previewStale.hidden = !stale;
  previewHost.classList.toggle('stale', stale);
}

/** Reflect edited/pristine state in the preset picker. */
function syncPicker(text: string): void {
  const preset = getPreset(activePresetId);
  const pristine = !!preset && text === preset.config;
  presetSelect.value = pristine ? activePresetId : CUSTOM_OPTION;
  presetDesc.textContent = pristine ? (preset?.description ?? '') : '';
}

async function computeSafe(
  text: string,
  accession: string
): Promise<PlaygroundDiagnostic[]> {
  try {
    return await computeDiagnostics(text, accession);
  } catch (error) {
    // Validation is not supposed to throw, but never let an unexpected
    // failure silently freeze the pipeline — surface it as an error.
    return [
      {
        from: 0,
        to: 0,
        severity: 'error',
        code: 'internal',
        message: `Internal validation error: ${(error as Error).message}`,
      },
    ];
  }
}

/** The validated snapshot, or `null` when a newer run superseded this one. */
type ValidateResult = { text: string; accession: string; valid: boolean } | null;

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

  const diagnostics = await computeSafe(text, accession);
  if (seq !== updateSeq) return null;

  editor.setDiagnostics(diagnostics);
  const valid = diagnosticsView.showConfig(diagnostics);
  writeHash(currentState());
  return { text, accession, valid };
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
      result.accession !== lastRendered.accession
  );
}

/**
 * Explicit "Run": validate, then (re)mount the preview when the config is
 * valid. This is the ONLY path that mounts `<protvista-uniprot>`.
 */
async function run(): Promise<void> {
  const result = await validateCurrent();
  if (!result) return;
  if (result.valid) {
    renderPreview(result.text, result.accession);
    lastRendered = { text: result.text, accession: result.accession };
    setStale(false);
  } else {
    // Keep the last valid preview mounted but flagged out of date.
    setStale(true);
  }
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

// Selecting a preset is a deliberate "show me this" → render once.
presetSelect.addEventListener('change', () => {
  const preset = getPreset(presetSelect.value);
  if (!preset) return; // "Custom" is not selectable directly.
  activePresetId = preset.id;
  accessionInput.value = preset.accession;
  editor.setText(preset.config);
  void run();
});

// Accession changes fire once on blur/enter → render once.
accessionInput.addEventListener('change', () => void run());

// Theming is now a config concern — set `theme.labelColor` in the config
// (the component applies it as a --protvista-* token). No separate control.

// ── Bootstrap ─────────────────────────────────────────────────
function initialState(): { text: string; accession: string; presetId: string } {
  const restored = readHash();
  if (restored?.config != null) {
    return {
      text: restored.config,
      accession: restored.accession,
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

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
 * The `<protvista-uniprot>` custom element is registered by the
 * component `<script>` entry in playground.html (the same pattern the
 * demo/bench pages use). Registration must NOT rely on the bare import
 * below alone: the package declares `"sideEffects": false`, so a bundler
 * is free to tree-shake a side-effect-only import out of the production
 * build. The import is kept so the element is also defined when this
 * module is loaded in isolation (dev server, tests), but the HTML entry
 * is the guarantee.
 */
import '../protvista-uniprot';
import type { ValidationIssue } from '../schema';
import { createEditor, type PlaygroundEditor } from './editor';
import { createDiagnosticsView } from './diagnostics-view';
import { computeDiagnostics, type PlaygroundDiagnostic } from './lint';
import { initSplitter } from './splitter';
import { PRESETS, DEFAULT_PRESET_ID, getPreset } from './presets';
import {
  readHash,
  writeHash,
  DEFAULT_ACCESSION,
  type PlaygroundState,
} from './url-state';

const DEBOUNCE_MS = 400;
/** Default of `--protvista-group-label-bg` (see docs/theming.md). */
const DEFAULT_LABEL_BG = '#b2f5ff';

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
const labelColor = $<HTMLInputElement>('label-color');
const labelReset = $<HTMLButtonElement>('label-reset');
const errorSummary = $<HTMLElement>('error-summary');
const errorList = $<HTMLUListElement>('errors');
const previewHost = $<HTMLElement>('preview');
const previewStale = $<HTMLElement>('preview-stale');
const editorHost = $<HTMLElement>('editor');

/** Id of the preset currently loaded; used to keep shared links short. */
let activePresetId = DEFAULT_PRESET_ID;
let editor: PlaygroundEditor;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
/** Monotonic stamp so a slow async run can't apply over a newer one. */
let updateSeq = 0;
/** Snapshot of what the preview currently shows, to detect staleness. */
let lastRendered: { text: string; accession: string } | null = null;

// ── Preset picker ─────────────────────────────────────────────
const CUSTOM_OPTION = 'custom';
for (const preset of PRESETS) {
  const option = document.createElement('option');
  option.value = preset.id;
  option.textContent = preset.label;
  presetSelect.append(option);
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
  // pipeline parses the raw YAML/JSON string directly. Recreating the
  // element per render sidesteps the component's intentional decision
  // not to re-init on a `viewerConfig` change (see protvista-uniprot.ts).
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
  presetSelect.value =
    preset && text === preset.config ? activePresetId : CUSTOM_OPTION;
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

type ValidateResult =
  | { superseded: true }
  | { superseded: false; text: string; accession: string; valid: boolean };

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
  if (seq !== updateSeq) return { superseded: true };

  editor.setDiagnostics(diagnostics);
  const valid = diagnosticsView.showConfig(diagnostics);
  writeHash(currentState());
  return { superseded: false, text, accession, valid };
}

/**
 * Live validation only. Deliberately does NOT touch the preview: mounting
 * `<protvista-uniprot>` is heavy (Nightingale/Mol*), so re-mounting on
 * every keystroke can exhaust memory. The preview updates only in `run()`.
 */
async function refreshDiagnostics(): Promise<void> {
  const result = await validateCurrent();
  if (result.superseded) return;
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
  if (result.superseded) return;
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

// ── Row-label panel colour ────────────────────────────────────
// Recolours the left side panel (group + track labels) via the
// `--protvista-*-label-bg` CSS design tokens (docs/theming.md) — a display
// concern, NOT config. The picked colour is the group-label background;
// the track labels get a slightly lighter tint of it, mirroring the
// default hierarchy (#b2f5ff group / #d9faff track). Tokens are set on the
// (stable) preview host, so they apply live (custom properties inherit)
// and survive preview re-mounts; they are intentionally left out of the
// shareable config/URL.
const LABEL_TOKENS = [
  '--protvista-group-label-bg',
  '--protvista-track-label-bg',
];

/** Mix a `#rrggbb` colour toward white by `amount` (0..1). */
function tint(hex: string, amount: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number): number => {
    const c = (value >> shift) & 0xff;
    return Math.round(c + (255 - c) * amount);
  };
  const mixed = (channel(16) << 16) | (channel(8) << 8) | channel(0);
  return `#${mixed.toString(16).padStart(6, '0')}`;
}

function applyLabelColor(): void {
  const color = labelColor.value;
  const { style } = previewHost;
  style.setProperty('--protvista-group-label-bg', color);
  style.setProperty('--protvista-track-label-bg', tint(color, 0.35));
}
labelColor.addEventListener('input', applyLabelColor);
labelReset.addEventListener('click', () => {
  labelColor.value = DEFAULT_LABEL_BG;
  for (const token of LABEL_TOKENS) previewHost.style.removeProperty(token);
});

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
  const preset =
    (restored?.preset && getPreset(restored.preset)) ||
    getPreset(DEFAULT_PRESET_ID)!;
  return {
    text: preset.config,
    accession: restored?.accession ?? preset.accession,
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

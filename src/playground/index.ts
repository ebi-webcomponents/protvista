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
import { createEditor, type PlaygroundEditor } from './editor';
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
const shareButton = $<HTMLButtonElement>('share');
const shareStatus = $<HTMLElement>('share-status');
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

// ── Diagnostics list ──────────────────────────────────────────
function renderErrors(
  diagnostics: readonly { message: string; code?: string }[]
): boolean {
  errorSummary.textContent =
    diagnostics.length === 0
      ? 'No problems — config is valid.'
      : `${diagnostics.length} problem${diagnostics.length === 1 ? '' : 's'} found:`;
  errorList.replaceChildren(
    ...diagnostics.map((diagnostic) => {
      const item = document.createElement('li');
      item.textContent = diagnostic.message;
      if (diagnostic.code) item.dataset.code = diagnostic.code;
      return item;
    })
  );
  return diagnostics.length === 0;
}

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
// `reportError` in protvista-uniprot.ts). Surface the real issue messages
// alongside config diagnostics, and reflect them in the summary — they can
// arrive after a config that itself validated cleanly.
previewHost.addEventListener('protvista-error', (event) => {
  const detail = (
    event as CustomEvent<{
      phase?: string;
      issues?: { message: string; code?: string }[];
    }>
  ).detail;
  const issues =
    detail?.issues && detail.issues.length > 0
      ? detail.issues
      : [{ message: 'A track failed to load its data.', code: 'runtime' }];
  for (const issue of issues) {
    const item = document.createElement('li');
    item.dataset.code = issue.code ?? 'runtime';
    item.textContent = detail?.phase
      ? `[${detail.phase}] ${issue.message}`
      : issue.message;
    errorList.append(item);
  }
  const count = errorList.childElementCount;
  errorSummary.textContent = `${count} problem${count === 1 ? '' : 's'} found:`;
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

/**
 * Live validation only — gutter markers, error list, shareable URL, and
 * the staleness flag. Deliberately does NOT touch the preview: mounting
 * `<protvista-uniprot>` is heavy (Nightingale/Mol*), so re-mounting on
 * every keystroke can exhaust memory. The preview updates only in `run()`.
 */
async function refreshDiagnostics(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
  const seq = ++updateSeq;
  const text = editor.getText();
  const accession = accessionValue();
  syncPicker(text);

  const diagnostics = await computeSafe(text, accession);
  if (seq !== updateSeq) return; // superseded by a newer edit

  editor.setDiagnostics(diagnostics);
  renderErrors(diagnostics);
  setStale(
    !lastRendered ||
      text !== lastRendered.text ||
      accession !== lastRendered.accession
  );
  writeHash(currentState());
}

/**
 * Explicit "Run": validate, then (re)mount the preview when the config is
 * valid. This is the ONLY path that mounts `<protvista-uniprot>`.
 */
async function run(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
  const seq = ++updateSeq;
  const text = editor.getText();
  const accession = accessionValue();
  syncPicker(text);

  const diagnostics = await computeSafe(text, accession);
  if (seq !== updateSeq) return;

  editor.setDiagnostics(diagnostics);
  const valid = renderErrors(diagnostics);
  if (valid) {
    renderPreview(text, accession);
    lastRendered = { text, accession };
    setStale(false);
  } else {
    // Keep the last valid preview mounted but flagged out of date.
    setStale(true);
  }
  writeHash(currentState());
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

shareButton.addEventListener('click', async () => {
  writeHash(currentState());
  try {
    await navigator.clipboard.writeText(window.location.href);
    shareStatus.textContent = 'Link copied to clipboard.';
  } catch {
    shareStatus.textContent = 'Copy failed — the shareable link is in the address bar.';
  }
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
// Render the initial preview once on load.
void run();

// Make the divider between the editor and preview panes draggable.
initSplitter($<HTMLElement>('panels'), $<HTMLElement>('splitter'));

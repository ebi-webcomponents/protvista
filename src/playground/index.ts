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
/** Monotonic stamp so a slow async update() can't apply over a newer one. */
let updateSeq = 0;

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
function currentState(): PlaygroundState {
  const accession = accessionInput.value.trim() || DEFAULT_ACCESSION;
  const text = editor.getText();
  const preset = getPreset(activePresetId);
  return preset && text === preset.config
    ? { preset: activePresetId, accession }
    : { config: text, accession };
}

async function update(): Promise<void> {
  // A direct update() supersedes any pending debounced one (e.g. the
  // preset picker calls setText — which arms the debounce — then update()
  // synchronously): cancel it so we don't mount/fetch the preview twice.
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
  // Stamp this run. `computeDiagnostics` is async (YAML awaits the js-yaml
  // chunk), so an older run could otherwise resume after a newer one and
  // apply stale results over it.
  const seq = ++updateSeq;
  const text = editor.getText();
  const accession = accessionInput.value.trim() || DEFAULT_ACCESSION;

  // Reflect edited/pristine state in the picker.
  const preset = getPreset(activePresetId);
  presetSelect.value =
    preset && text === preset.config ? activePresetId : CUSTOM_OPTION;

  let diagnostics: PlaygroundDiagnostic[];
  try {
    diagnostics = await computeDiagnostics(text);
  } catch (error) {
    // Validation is not supposed to throw, but never let an unexpected
    // failure silently freeze the pipeline — surface it as an error.
    diagnostics = [
      {
        from: 0,
        to: 0,
        severity: 'error',
        code: 'internal',
        message: `Internal validation error: ${(error as Error).message}`,
      },
    ];
  }
  if (seq !== updateSeq) return; // a newer update() has superseded this one

  editor.setDiagnostics(diagnostics);
  const valid = renderErrors(diagnostics);
  if (valid) {
    renderPreview(text, accession);
    previewStale.hidden = true;
    previewHost.classList.remove('stale');
  } else {
    // Keep the last valid preview mounted, but flag it as out of date so a
    // broken edit can't look like it rendered successfully.
    previewStale.hidden = false;
    previewHost.classList.add('stale');
  }

  writeHash(currentState());
}

function scheduleUpdate(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void update(), DEBOUNCE_MS);
}

// ── Controls ──────────────────────────────────────────────────
presetSelect.addEventListener('change', () => {
  const preset = getPreset(presetSelect.value);
  if (!preset) return; // "Custom" is not selectable directly.
  activePresetId = preset.id;
  accessionInput.value = preset.accession;
  editor.setText(preset.config);
  void update();
});

accessionInput.addEventListener('change', () => void update());

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
  onChange: scheduleUpdate,
});
void update();

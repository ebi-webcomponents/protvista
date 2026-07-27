/**
 * Thin CodeMirror 6 wrapper for the playground config editor.
 *
 * Keeps all CodeMirror imports in one module so the rest of the
 * playground (URL state, presets, lint mapping) stays framework-free
 * and unit-testable under jsdom. The editor renders the gutter markers
 * for diagnostics; the diagnostics themselves are computed elsewhere
 * (`lint.ts`) and pushed in via {@link PlaygroundEditor.setDiagnostics}
 * so there is one validation path shared with the live preview.
 */
import { EditorView, basicSetup } from 'codemirror';
import { Compartment } from '@codemirror/state';
import { yaml } from '@codemirror/lang-yaml';
import { json } from '@codemirror/lang-json';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { detectFormat } from './format.js';

/** Language compartment so YAML/JSON highlighting can be swapped live. */
const languageConf = new Compartment();

const languageFor = (text: string) =>
  detectFormat(text) === 'json' ? json() : yaml();

export interface PlaygroundEditor {
  readonly view: EditorView;
  getText(): string;
  /** Replace the whole document (used when loading a preset or link). */
  setText(text: string): void;
  /** Render diagnostics in the gutter; empty array clears them. */
  setDiagnostics(diagnostics: readonly Diagnostic[]): void;
}

export function createEditor(options: {
  parent: HTMLElement;
  doc: string;
  ariaLabel: string;
  onChange: () => void;
}): PlaygroundEditor {
  const view = new EditorView({
    parent: options.parent,
    doc: options.doc,
    extensions: [
      basicSetup,
      languageConf.of(languageFor(options.doc)),
      lintGutter(),
      EditorView.lineWrapping,
      // Announce the editor to assistive tech (WCAG label requirement).
      EditorView.contentAttributes.of({ 'aria-label': options.ariaLabel }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) options.onChange();
      }),
    ],
  });

  return {
    view,
    getText: () => view.state.doc.toString(),
    setText(text) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        effects: languageConf.reconfigure(languageFor(text)),
      });
    },
    setDiagnostics(diagnostics) {
      view.dispatch(setDiagnostics(view.state, [...diagnostics]));
    },
  };
}

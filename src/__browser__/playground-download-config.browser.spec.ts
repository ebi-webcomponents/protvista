/**
 * The playground's Download config button: it saves the editor text byte for
 * byte, as `config.yaml` or `config.json` to match format detection, from a
 * mouse click or from the keyboard.
 *
 * `URL.createObjectURL` is watched to capture the Blob, and the anchor's
 * `click` is replaced to capture the file name without starting a real
 * download.
 *
 * The controller wires the button once, when it is imported, so this needs a
 * page of its own (see `playground-page.ts`).
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  type MockInstance,
} from 'vitest';
import { userEvent } from 'vitest/browser';

import {
  byId,
  closePlayground,
  editorText,
  openPlayground,
  setEditorText,
} from './playground-page.js';

/**
 * Non-ASCII text and trailing spaces, so "byte for byte" is a real check: a
 * trim, a Unicode normalisation or a re-encoding would each change the bytes.
 *
 * The fixtures also use Windows line endings, as a pasted file might. The
 * editor (CodeMirror, with no `lineSeparator` set) turns each `\r\n` into
 * `\n` as the text goes in, so the editor never holds a `\r` and the button
 * cannot be handed one: what these pin is that a CRLF config saves with LF
 * line endings, as the editor shows it. The saved bytes are compared with
 * that expected text, worked out here, as well as with the editor's.
 */
const YAML =
  '# Démo — hélice α, ✓ 日本語  \r\naccession: P05067  \r\nrows:\r\n  - id: notes\r\n    label: Notes ✓ \r\n';
const JSON_TEXT =
  '{\r\n  "accession": "P05067",  \r\n  "label": "Protéine β — ✓"\r\n}  \r\n';

/** `text` with its Windows line endings as the editor stores them. */
const asStored = (text: string) => text.replace(/\r\n/g, '\n');

interface Saved {
  download: string;
  href: string;
}

let createObjectURL: MockInstance<typeof URL.createObjectURL>;
let revokeObjectURL: MockInstance<typeof URL.revokeObjectURL>;
let anchorClick: MockInstance<HTMLAnchorElement['click']>;
const saved: Saved[] = [];

beforeAll(async () => {
  await openPlayground({});
});

beforeEach(() => {
  saved.length = 0;
  createObjectURL = vi.spyOn(URL, 'createObjectURL');
  revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL');
  anchorClick = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function (this: HTMLAnchorElement) {
      saved.push({ download: this.download, href: this.href });
    });
});

afterEach(() => {
  createObjectURL.mockRestore();
  revokeObjectURL.mockRestore();
  anchorClick.mockRestore();
});

afterAll(closePlayground);

/**
 * Put `text` in the editor, and check that it holds it as {@link asStored}
 * says: every character kept, and LF line endings only.
 */
function setEditorFixture(text: string): void {
  setEditorText(text);
  expect(editorText()).not.toContain('\r');
  expect(editorText()).toBe(asStored(text));
}

/**
 * The one Blob the button saved: it is `expected`, byte for byte, which is
 * also what the editor holds.
 */
async function expectSaved(name: string, expected: string): Promise<void> {
  expect(saved).toHaveLength(1);
  expect(saved[0].download).toBe(name);
  expect(createObjectURL).toHaveBeenCalledTimes(1);
  const blob = createObjectURL.mock.calls[0][0] as Blob;
  expect(blob).toBeInstanceOf(Blob);
  expect(createObjectURL.mock.results[0].value).toBe(saved[0].href);

  expect(await blob.text()).toBe(expected);
  expect(await blob.text()).toBe(editorText());
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
    new TextEncoder().encode(expected)
  );
  // The blob URL is released once the click has been handled.
  await vi.waitFor(() =>
    expect(revokeObjectURL).toHaveBeenCalledWith(saved[0].href)
  );
}

describe('playground: Download config', () => {
  it('saves YAML as config.yaml, byte for byte, from a mouse click', async () => {
    setEditorFixture(YAML);
    // What the editor holds: the non-ASCII text and trailing spaces survive.
    expect(editorText()).toContain('# Démo — hélice α, ✓ 日本語  \n');
    expect(editorText()).toContain('label: Notes ✓ \n');

    await userEvent.click(byId('download-config'));

    await expectSaved('config.yaml', asStored(YAML));
  });

  it('saves JSON as config.json, byte for byte, from the keyboard', async () => {
    setEditorFixture(JSON_TEXT);
    expect(editorText()).toContain('"label": "Protéine β — ✓"\n');
    expect(editorText()).toContain('}  \n');

    byId('download-config').focus();
    await userEvent.keyboard('{Enter}');

    await expectSaved('config.json', asStored(JSON_TEXT));
  });
});

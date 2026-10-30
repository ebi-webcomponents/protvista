/**
 * The playground's Copy link button: it copies `location.href`, whose hash
 * decodes to the config in the editor, even when pressed straight after an
 * edit (before the debounced validation has rewritten the hash), and says
 * what happened in the polite status next to it.
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
  type MockInstance,
} from 'vitest';
import { userEvent } from 'vitest/browser';

import { decodeState } from '../playground/url-state.js';
import {
  byId,
  closePlayground,
  editorText,
  openPlayground,
  setEditorText,
} from './playground-page.js';

/** Every text handed to `navigator.clipboard.writeText`, in order. */
const copied: string[] = [];
let writeText: MockInstance<Clipboard['writeText']>;

const shareStatus = () => byId('share-status');
const copyLink = () => byId<HTMLButtonElement>('copy-link');

beforeAll(async () => {
  await openPlayground({ hash: '#preset=small-protein' });
  // The first validation writes the full hash, accession included.
  await vi.waitFor(() => expect(location.hash).toContain('accession='), {
    timeout: 5000,
  });
  writeText = vi
    .spyOn(navigator.clipboard, 'writeText')
    .mockImplementation(async (text: string) => {
      copied.push(text);
    });
});

beforeEach(() => {
  copied.length = 0;
  shareStatus().textContent = '';
});

afterAll(closePlayground);

describe('playground: Copy link', () => {
  it('reports in a polite status region', () => {
    expect(shareStatus().getAttribute('role')).toBe('status');
    expect(shareStatus().getAttribute('aria-live')).toBe('polite');
  });

  it('copies the link to the config in the editor when pressed from the keyboard', async () => {
    const edited = '# Édité — keyboard\naccession: P69905\n';
    setEditorText(edited);
    copyLink().focus();
    await userEvent.keyboard('{Enter}');

    await vi.waitFor(() =>
      expect(shareStatus().textContent).toBe('Link copied')
    );
    expect(copied).toEqual([location.href]);
    expect(decodeState(new URL(copied[0]).hash)?.config).toBe(edited);
    expect(editorText()).toBe(edited);
  });

  it('copies the edited config when clicked straight after an edit', async () => {
    const edited = 'accession: Q99999\n';
    setEditorText(edited);
    // No wait: the click lands well inside the 400 ms validation debounce.
    copyLink().click();

    await vi.waitFor(() =>
      expect(shareStatus().textContent).toBe('Link copied')
    );
    expect(copied).toHaveLength(1);
    expect(copied[0]).toBe(location.href);
    expect(decodeState(new URL(copied[0]).hash)?.config).toBe(edited);
  });

  it('says so when the clipboard refuses the link', async () => {
    writeText.mockRejectedValueOnce(
      new DOMException('Denied', 'NotAllowedError')
    );
    copyLink().focus();
    await userEvent.keyboard('{Enter}');

    await vi.waitFor(() =>
      expect(shareStatus().textContent).toBe('Could not copy the link')
    );
    expect(copied).toEqual([]);
  });
});

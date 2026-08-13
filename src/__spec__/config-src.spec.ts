import { afterEach, describe, expect, it, vi } from 'vitest';

// jsdom lacks browser observers that the Nightingale elements imported by
// protvista-uniprot register at module load time.
vi.hoisted(() => {
  class ObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  Object.assign(globalThis, {
    ResizeObserver: ObserverStub,
    IntersectionObserver: ObserverStub,
    MutationObserver: globalThis.MutationObserver ?? ObserverStub,
  });
});

import ProtvistaUniprot from '../protvista-uniprot';
import defaultConfig from '../config';

const validConfig = {
  categories: [
    {
      name: 'MY_CATEGORY',
      label: 'My category',
      trackType: 'nightingale-track-canvas',
      tracks: [],
    },
  ],
};

const mockFetch = (response: Partial<Response>) => {
  const fetchMock = vi.fn().mockResolvedValue(response as Response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('loadExternalConfig', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const load = (url: string) => new ProtvistaUniprot().loadExternalConfig(url);

  it('returns a validated config on success', async () => {
    mockFetch({ ok: true, json: async () => validConfig });
    await expect(load('https://example.org/config.json')).resolves.toEqual(
      validConfig
    );
  });

  it('returns undefined and logs on HTTP error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch({ ok: false, status: 404 });
    await expect(load('https://example.org/missing.json')).resolves.toBe(
      undefined
    );
    expect(error).toHaveBeenCalled();
  });

  it('returns undefined and logs every problem on invalid config', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch({ ok: true, json: async () => ({ categories: 'nope' }) });
    await expect(load('https://example.org/bad.json')).resolves.toBe(undefined);
    expect(error).toHaveBeenCalledOnce();
    expect(String(error.mock.calls[0][0])).toContain('/categories');
  });

  it('returns undefined and logs on network failure', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(load('https://example.org/config.json')).resolves.toBe(
      undefined
    );
    expect(error).toHaveBeenCalled();
  });
});

type TestableInstance = {
  configSrc?: string;
  config?: unknown;
  _init(): Promise<void>;
};

const createInstance = () =>
  new ProtvistaUniprot() as unknown as TestableInstance;

describe('_init config resolution', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('falls back to the built-in config when nothing is provided', async () => {
    const instance = createInstance();
    await instance._init();
    expect(instance.config).toBe(defaultConfig);
  });

  it('uses the config fetched from configSrc', async () => {
    mockFetch({ ok: true, json: async () => validConfig });
    const instance = createInstance();
    instance.configSrc = 'https://example.org/config.json';
    await instance._init();
    expect(instance.config).toEqual(validConfig);
  });

  it('falls back to the built-in config when configSrc is invalid', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch({ ok: true, json: async () => ({}) });
    const instance = createInstance();
    instance.configSrc = 'https://example.org/bad.json';
    await instance._init();
    expect(instance.config).toBe(defaultConfig);
  });
});

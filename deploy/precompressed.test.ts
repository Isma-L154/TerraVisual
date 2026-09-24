import { acceptsBrotli, fetchAsset } from './precompressed';

const PLAIN = 'plain wasm bytes';
const COMPRESSED = 'brotli bytes';

/** An asset server holding the analyzer in both forms. */
function assets(
  files: Record<string, string> = { '/analyzer.wasm': PLAIN, '/analyzer.wasm.br': COMPRESSED },
) {
  return {
    fetch: async (request: Request) => {
      const body = files[new URL(request.url).pathname];
      return body === undefined
        ? new Response('not found', { status: 404 })
        : new Response(body, { headers: { 'Content-Type': 'application/wasm' } });
    },
  };
}

const request = (path: string, acceptEncoding?: string) =>
  new Request(`https://terravisual.example${path}`, {
    headers: acceptEncoding ? { 'Accept-Encoding': acceptEncoding } : {},
  });

describe('which clients get brotli', () => {
  it.each([
    ['gzip, deflate, br', true],
    ['br', true],
    ['BR;q=0.5', true],
    ['gzip, br;q=0', false],
    ['gzip, deflate', false],
    [null, false],
  ])('%s → %s', (header, expected) => {
    expect(acceptsBrotli(header)).toBe(expected);
  });
});

describe('serving the analyzer', () => {
  it('sends the build’s compressed bytes to a client that accepts brotli', async () => {
    const { response, encoded } = await fetchAsset(request('/analyzer.wasm', 'gzip, br'), assets());

    expect(encoded).toBe(true);
    expect(await response.text()).toBe(COMPRESSED);
    expect(response.headers.get('Content-Encoding')).toBe('br');
    expect(response.headers.get('Content-Type')).toBe('application/wasm');
    expect(response.headers.get('Vary')).toBe('Accept-Encoding');
  });

  it('sends the plain file to a client that does not, and still varies', async () => {
    const { response, encoded } = await fetchAsset(request('/analyzer.wasm', 'gzip'), assets());

    expect(encoded).toBe(false);
    expect(await response.text()).toBe(PLAIN);
    expect(response.headers.get('Content-Encoding')).toBeNull();
    expect(response.headers.get('Vary')).toBe('Accept-Encoding');
  });

  // A build without the compressed copy must degrade, not break the analyzer.
  it('falls back to the plain file when the compressed one is missing', async () => {
    const { response, encoded } = await fetchAsset(
      request('/analyzer.wasm', 'br'),
      assets({ '/analyzer.wasm': PLAIN }),
    );

    expect(encoded).toBe(false);
    expect(await response.text()).toBe(PLAIN);
  });

  it('leaves every other path alone', async () => {
    const { response, encoded } = await fetchAsset(
      request('/index.html', 'br'),
      assets({ '/index.html': '<html>' }),
    );

    expect(encoded).toBe(false);
    expect(response.headers.get('Vary')).toBeNull();
  });
});

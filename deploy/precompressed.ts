/**
 * Serving the analyzer already compressed (#69).
 *
 * The build compresses it at brotli quality 11; the edge, compressing on the
 * fly, managed far less (2.54 MB against the build's 1.93 MB), so NFR-5 was
 * being checked against a number nobody was served. Sending the build's bytes
 * makes the budget the transfer.
 */

type Assets = { fetch(request: Request): Promise<Response> };

/** Paths the build also writes as `<path>.br`. */
const PRECOMPRESSED = new Set(['/analyzer.wasm']);

/** True when the client lists `br` without refusing it (`br;q=0`). */
export function acceptsBrotli(acceptEncoding: string | null): boolean {
  if (!acceptEncoding) return false;
  return acceptEncoding.split(',').some((token) => {
    const [coding, ...params] = token.trim().toLowerCase().split(';');
    if (coding !== 'br') return false;
    const quality = params.map((param) => param.trim()).find((param) => param.startsWith('q='));
    return quality === undefined || Number(quality.slice(2)) > 0;
  });
}

/**
 * The asset for a request, and whether its body is already encoded. An encoded
 * body must be returned with `encodeBody: 'manual'`, or the runtime would
 * compress it a second time.
 */
export async function fetchAsset(
  request: Request,
  assets: Assets,
): Promise<{ response: Response; encoded: boolean }> {
  const url = new URL(request.url);
  if (!PRECOMPRESSED.has(url.pathname)) {
    return { response: await assets.fetch(request), encoded: false };
  }

  if (acceptsBrotli(request.headers.get('Accept-Encoding'))) {
    const compressed = await assets.fetch(
      new Request(new URL(`${url.pathname}.br`, url), { method: request.method }),
    );
    if (compressed.ok) {
      const headers = new Headers(compressed.headers);
      headers.set('Content-Type', 'application/wasm');
      headers.set('Content-Encoding', 'br');
      headers.set('Vary', 'Accept-Encoding');
      return { response: new Response(compressed.body, { status: 200, headers }), encoded: true };
    }
  }

  // Both variants live at one URL, so a cache must key on the encoding.
  const plain = await assets.fetch(request);
  const headers = new Headers(plain.headers);
  headers.set('Vary', 'Accept-Encoding');
  return {
    response: new Response(plain.body, { status: plain.status, headers }),
    encoded: false,
  };
}

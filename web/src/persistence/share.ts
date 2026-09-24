/**
 * Sharing a workspace by link, without a server. The workspace is compressed
 * into the URL fragment, which is never sent in an HTTP request, so a link's
 * contents reach no server. Anyone holding the link has the code.
 */

import { normalisePath } from '../workspace/paths';
import { LIMITS } from '../workspace/workspace';

const PREFIX = '#w=';

/** Small enough to survive chat clients and URL handlers unchanged. */
export const MAX_SHARE_BYTES = 32 * 1024;

/**
 * A short link can decompress a thousandfold. Nothing larger than a workspace
 * may hold is worth expanding, and JSON escaping at most doubles the text.
 */
const MAX_DECOMPRESSED_BYTES = LIMITS.maxTotalBytes * 2;

class TooLarge extends Error {}

type ShareFailure =
  | { reason: 'too-large'; bytes: number }
  | { reason: 'unsupported' }
  | { reason: 'failed'; message: string };

type EncodeResult = { ok: true; fragment: string } | ({ ok: false } & ShareFailure);

type DecodeResult =
  | { ok: true; files: Record<string, string> }
  | { ok: false; reason: 'absent' | 'malformed' | 'too-large' | 'unsupported' };

type Payload = { v: 1; files: Record<string, string> };

export function canShare(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

export async function encodeWorkspace(files: Record<string, string>): Promise<EncodeResult> {
  if (!canShare()) return { ok: false, reason: 'unsupported' };

  try {
    const payload: Payload = { v: 1, files };
    const compressed = await compress(new TextEncoder().encode(JSON.stringify(payload)));

    if (compressed.byteLength > MAX_SHARE_BYTES) {
      return { ok: false, reason: 'too-large', bytes: compressed.byteLength };
    }
    return { ok: true, fragment: PREFIX + toBase64Url(compressed) };
  } catch (error) {
    return { ok: false, reason: 'failed', message: error instanceof Error ? error.message : '' };
  }
}

/**
 * Decodes a fragment chosen by whoever wrote the link. Every step validates,
 * and any failure yields no workspace rather than part of one.
 */
export async function decodeFragment(fragment: string): Promise<DecodeResult> {
  if (!fragment.startsWith(PREFIX)) return { ok: false, reason: 'absent' };
  if (!canShare()) return { ok: false, reason: 'unsupported' };

  const encoded = fragment.slice(PREFIX.length);
  if (encoded.length === 0) return { ok: false, reason: 'absent' };
  // Refused before decompressing, so a huge link is never expanded into memory.
  if (encoded.length > MAX_SHARE_BYTES * 2) return { ok: false, reason: 'too-large' };

  try {
    const json = new TextDecoder().decode(
      await decompress(fromBase64Url(encoded), MAX_DECOMPRESSED_BYTES),
    );
    const parsed: unknown = JSON.parse(json);
    if (!isPayload(parsed)) return { ok: false, reason: 'malformed' };

    const files: Record<string, string> = {};
    for (const [rawPath, content] of Object.entries(parsed.files)) {
      if (typeof content !== 'string') return { ok: false, reason: 'malformed' };
      // Paths from a link are confined exactly like paths from disk.
      files[normalisePath(rawPath)] = content;
    }

    if (Object.keys(files).length === 0) return { ok: false, reason: 'malformed' };
    return { ok: true, files };
  } catch (error) {
    return { ok: false, reason: error instanceof TooLarge ? 'too-large' : 'malformed' };
  }
}

function isPayload(value: unknown): value is Payload {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Payload>;
  return (
    candidate.v === 1 &&
    typeof candidate.files === 'object' &&
    candidate.files !== null &&
    !Array.isArray(candidate.files)
  );
}

// A ReadableStream rather than Blob.stream(), which jsdom lacks.
function streamOf(bytes: Uint8Array<ArrayBuffer>): ReadableStream<BufferSource> {
  return new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function collect(
  stream: ReadableStream<Uint8Array>,
  limit = Infinity,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new TooLarge();
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function compress(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return collect(streamOf(bytes).pipeThrough<Uint8Array>(new CompressionStream('deflate-raw')));
}

function decompress(
  bytes: Uint8Array<ArrayBuffer>,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  return collect(
    streamOf(bytes).pipeThrough<Uint8Array>(new DecompressionStream('deflate-raw')),
    limit,
  );
}

// Base64url, so the fragment needs no escaping when pasted.
function toBase64Url(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

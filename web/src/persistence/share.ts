/**
 * Sharing a workspace by link, without a server.
 *
 * The whole workspace is compressed into the URL **fragment**. That choice is
 * the privacy promise, not a detail: a fragment is never sent in the HTTP
 * request, so a shared link's contents never reach our server, Cloudflare's
 * logs, or anything in between.
 *
 * It also means a link is the code. Anyone who has it has the Terraform, which
 * is why the interface says so before somebody copies one.
 */

import { normalisePath } from '../workspace/paths';

/** The fragment prefix, so an ordinary anchor is never mistaken for a payload. */
const PREFIX = '#w=';

/**
 * How much workspace a link may carry.
 *
 * Browsers and the things that pass URLs around disagree about how long a URL
 * may be, and the ones that disagree quietly are the problem: a link that is
 * truncated in a chat client looks like a corrupt workspace rather than a link
 * that was too long. Refusing at a size everything handles is kinder.
 */
export const MAX_SHARE_BYTES = 32 * 1024;

export type ShareFailure =
  | { reason: 'too-large'; bytes: number }
  | { reason: 'unsupported' }
  | { reason: 'failed'; message: string };

export type EncodeResult = { ok: true; fragment: string } | ({ ok: false } & ShareFailure);

export type DecodeResult =
  | { ok: true; files: Record<string, string> }
  | { ok: false; reason: 'absent' | 'malformed' | 'too-large' | 'unsupported' };

type Payload = { v: 1; files: Record<string, string> };

/** Whether this browser can compress, which decides whether sharing works. */
export function canShare(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

/** Encodes a workspace into a fragment, or explains why it cannot. */
export async function encodeWorkspace(files: Record<string, string>): Promise<EncodeResult> {
  if (!canShare()) return { ok: false, reason: 'unsupported' };

  try {
    const payload: Payload = { v: 1, files };
    const json = new TextEncoder().encode(JSON.stringify(payload));
    const compressed = await compress(json);

    if (compressed.byteLength > MAX_SHARE_BYTES) {
      return { ok: false, reason: 'too-large', bytes: compressed.byteLength };
    }

    return { ok: true, fragment: PREFIX + toBase64Url(compressed) };
  } catch (error) {
    return { ok: false, reason: 'failed', message: error instanceof Error ? error.message : '' };
  }
}

/**
 * Decodes a fragment into a workspace.
 *
 * This is a deserialization boundary: the payload comes from an arbitrary
 * third party who chose the link somebody clicked. Every step validates rather
 * than assumes, and every failure is the same answer — no workspace — rather
 * than a partially applied one.
 */
export async function decodeFragment(fragment: string): Promise<DecodeResult> {
  if (!fragment.startsWith(PREFIX)) return { ok: false, reason: 'absent' };
  if (!canShare()) return { ok: false, reason: 'unsupported' };

  const encoded = fragment.slice(PREFIX.length);
  if (encoded.length === 0) return { ok: false, reason: 'absent' };

  // Checked before decoding, so an enormous link is refused rather than
  // expanded into memory first.
  if (encoded.length > MAX_SHARE_BYTES * 2) return { ok: false, reason: 'too-large' };

  try {
    const bytes = fromBase64Url(encoded);
    const json = new TextDecoder().decode(await decompress(bytes));
    const parsed: unknown = JSON.parse(json);

    if (!isPayload(parsed)) return { ok: false, reason: 'malformed' };

    const files: Record<string, string> = {};
    for (const [rawPath, content] of Object.entries(parsed.files)) {
      if (typeof content !== 'string') return { ok: false, reason: 'malformed' };
      // Paths from a link go through the same confinement as paths from disk.
      // A link is not more trustworthy for having been clicked.
      files[normalisePath(rawPath)] = content;
    }

    if (Object.keys(files).length === 0) return { ok: false, reason: 'malformed' };
    return { ok: true, files };
  } catch {
    return { ok: false, reason: 'malformed' };
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

// Built from a ReadableStream rather than a Blob: Blob.stream() is missing in
// some environments -- including the one the tests run in -- and going through
// a stream directly needs less of the platform.
// Typed as BufferSource because that is what the DOM declares a compression
// stream accepts. Matching the platform's own types here avoids a cast, and a
// cast around a stream is exactly where a subtle bug would hide.
function streamOf(bytes: Uint8Array<ArrayBuffer>): ReadableStream<BufferSource> {
  return new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function compress(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return collect(streamOf(bytes).pipeThrough<Uint8Array>(new CompressionStream('deflate-raw')));
}

async function decompress(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return collect(streamOf(bytes).pipeThrough<Uint8Array>(new DecompressionStream('deflate-raw')));
}

/**
 * Base64url rather than base64: a fragment carrying + / = would need escaping,
 * and a link that survives being pasted somewhere is the point.
 */
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

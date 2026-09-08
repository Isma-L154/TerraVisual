import { canShare, decodeFragment, encodeWorkspace, MAX_SHARE_BYTES } from './share';

const workspace = {
  'main.tf': 'resource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/16"\n}\n',
  'modules/network/main.tf': 'resource "aws_subnet" "public" {}\n',
};

describe('sharing a workspace', () => {
  it('is available in this environment', () => {
    // If this fails the rest is meaningless rather than wrong, so it is
    // asserted separately.
    expect(canShare()).toBe(true);
  });

  it('round-trips a workspace exactly', async () => {
    const encoded = await encodeWorkspace(workspace);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    const decoded = await decodeFragment(encoded.fragment);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    expect(decoded.files).toEqual(workspace);
  });

  // The fragment is the privacy promise, not a detail: it is never sent in the
  // HTTP request, so a shared link's contents never reach a server.
  it('produces a fragment, not a query string', async () => {
    const encoded = await encodeWorkspace(workspace);
    if (!encoded.ok) throw new Error('encoding failed');

    expect(encoded.fragment.startsWith('#')).toBe(true);
    expect(encoded.fragment).not.toContain('?');
  });

  // A link that a chat client truncates looks like a corrupt workspace rather
  // than a link that was too long. Refusing up front is kinder.
  it('refuses a workspace too large to survive being pasted', async () => {
    const huge = { 'main.tf': randomish(MAX_SHARE_BYTES * 4) };
    const encoded = await encodeWorkspace(huge);

    expect(encoded.ok).toBe(false);
    if (encoded.ok) return;
    expect(encoded.reason).toBe('too-large');
  });

  it('compresses, so repetitive Terraform shares easily', async () => {
    const repetitive = { 'main.tf': 'resource "aws_vpc" "main" {}\n'.repeat(400) };
    const encoded = await encodeWorkspace(repetitive);

    expect(encoded.ok).toBe(true);
  });
});

// A payload comes from an arbitrary third party who chose the link somebody
// clicked. Every failure is the same answer -- no workspace -- rather than a
// partially applied one.
describe('decoding untrusted links', () => {
  it.each([
    ['no fragment at all', ''],
    ['an ordinary anchor', '#section'],
    ['an empty payload', '#w='],
    ['not base64', '#w=@@@@@@'],
    ['not compressed data', '#w=aGVsbG8'],
  ])('refuses %s', async (_name, fragment) => {
    const decoded = await decodeFragment(fragment);
    expect(decoded.ok).toBe(false);
  });

  it('refuses a payload that is not the shape it claims', async () => {
    const notAWorkspace = await encodeWorkspaceRaw({ v: 2, files: { 'main.tf': 'x' } });
    expect((await decodeFragment(notAWorkspace)).ok).toBe(false);

    const filesNotStrings = await encodeWorkspaceRaw({ v: 1, files: { 'main.tf': 42 } });
    expect((await decodeFragment(filesNotStrings)).ok).toBe(false);

    const emptyFiles = await encodeWorkspaceRaw({ v: 1, files: {} });
    expect((await decodeFragment(emptyFiles)).ok).toBe(false);
  });

  // A link is not more trustworthy for having been clicked. Paths from one go
  // through the same confinement as paths from disk.
  it('refuses a path that escapes the workspace', async () => {
    const escaping = await encodeWorkspaceRaw({
      v: 1,
      files: { '../../../etc/passwd': 'malicious' },
    });

    expect((await decodeFragment(escaping)).ok).toBe(false);
  });

  it('refuses an absurdly long fragment before decoding it', async () => {
    const decoded = await decodeFragment('#w=' + 'A'.repeat(MAX_SHARE_BYTES * 4));

    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.reason).toBe('too-large');
  });
});

/** Encodes an arbitrary object the way the real encoder does, for the bad cases. */
async function encodeWorkspaceRaw(payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

  const reader = source.pipeThrough<Uint8Array>(new CompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const compressed = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    compressed.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let binary = '';
  for (const byte of compressed) binary += String.fromCharCode(byte);
  return '#w=' + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Text that does not compress away, so a size limit can actually be reached. */
function randomish(length: number): string {
  let out = '';
  let seed = 1;
  while (out.length < length) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    out += seed.toString(36);
  }
  return out.slice(0, length);
}

import { act, renderHook, waitFor } from '@testing-library/react';
import { encodeWorkspace } from '../persistence/share';
import { useSession } from './useSession';

// jsdom has no IndexedDB, so storage is an in-memory stand-in with the same
// contract: what was saved is what loads.
const stored = vi.hoisted(() => ({ files: null as Record<string, string> | null }));

vi.mock('../persistence/storage', () => ({
  load: async () => (stored.files ? { files: stored.files, savedAt: 0 } : null),
  save: async (files: Record<string, string>) => {
    stored.files = files;
    return true;
  },
  clear: async () => {
    stored.files = null;
  },
}));

/** Longer than the save debounce, so a pending save has happened by now. */
const afterDebounce = () => new Promise((resolve) => setTimeout(resolve, 1000));

async function openSharedLink(files: Record<string, string>) {
  const encoded = await encodeWorkspace(files);
  if (!encoded.ok) throw new Error('could not build the link');
  window.location.hash = encoded.fragment;

  const session = renderHook(() => useSession());
  await waitFor(() => expect(session.result.current.loading).toBe(false));
  return session;
}

describe('useSession with a shared link', () => {
  const ownWork = { 'mine.tf': 'resource "aws_vpc" "mine" {}' };
  const linked = { 'theirs.tf': 'resource "aws_vpc" "theirs" {}' };

  beforeEach(() => {
    stored.files = { ...ownWork };
  });

  afterEach(() => {
    window.location.hash = '';
  });

  // A link is chosen by whoever sent it. Opening one must not cost the
  // visitor the work they had saved.
  it('leaves the stored workspace untouched when the link opens', async () => {
    const session = await openSharedLink(linked);

    expect(session.result.current.origin).toBe('shared');
    await afterDebounce();
    expect(stored.files).toEqual(ownWork);
  });

  it('saves the shared workspace once the visitor edits it', async () => {
    const session = await openSharedLink(linked);

    act(() =>
      session.result.current.workspace.write('theirs.tf', 'resource "aws_vpc" "edited" {}'),
    );
    await afterDebounce();

    expect(stored.files).toEqual({ 'theirs.tf': 'resource "aws_vpc" "edited" {}' });
  });
});

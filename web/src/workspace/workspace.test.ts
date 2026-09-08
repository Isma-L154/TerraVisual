import { InvalidPathError } from './paths';
import {
  createWorkspace,
  isAnalysable,
  LIMITS,
  Workspace,
  WorkspaceLimitError,
  type WorkspaceChange,
} from './workspace';

describe('workspace basics', () => {
  it('holds files and reads them back', () => {
    const workspace = new Workspace();
    workspace.write('main.tf', 'resource "aws_vpc" "main" {}');

    expect(workspace.read('main.tf')).toBe('resource "aws_vpc" "main" {}');
    expect(workspace.has('main.tf')).toBe(true);
    expect(workspace.size).toBe(1);
  });

  it('normalises paths on the way in, so one file is one file', () => {
    const workspace = new Workspace();
    workspace.write('./modules/../main.tf', 'a');
    workspace.write('main.tf', 'b');

    expect(workspace.size).toBe(1);
    expect(workspace.read('main.tf')).toBe('b');
  });

  it('removes files and forgets their size', () => {
    const workspace = new Workspace();
    workspace.write('main.tf', 'x'.repeat(100));
    expect(workspace.totalBytes).toBe(100);

    expect(workspace.remove('main.tf')).toBe(true);
    expect(workspace.totalBytes).toBe(0);
    expect(workspace.remove('main.tf')).toBe(false);
  });

  // Sorted rather than insertion-ordered, so a workspace typed file by file
  // and the same one dropped in at once produce identical input to the
  // analyzer — and therefore an identical diagram.
  it('lists paths in a stable order regardless of how they arrived', () => {
    const first = new Workspace();
    for (const path of ['z.tf', 'a.tf', 'm.tf']) first.write(path, '');

    const second = new Workspace();
    for (const path of ['m.tf', 'z.tf', 'a.tf']) second.write(path, '');

    expect(first.list()).toEqual(['a.tf', 'm.tf', 'z.tf']);
    expect(first.list()).toEqual(second.list());
    expect(Object.keys(first.snapshot())).toEqual(Object.keys(second.snapshot()));
  });
});

describe('confinement', () => {
  it('refuses a path that escapes the workspace', () => {
    const workspace = new Workspace();
    expect(() => workspace.write('../outside.tf', 'x')).toThrow(InvalidPathError);
    expect(workspace.size).toBe(0);
  });

  // Asking is not the same as writing. A query about an unusable path means
  // "no", because the caller is asking a question, not making a mistake.
  it('answers questions about unusable paths instead of throwing', () => {
    const workspace = new Workspace();
    workspace.write('main.tf', 'x');

    for (const path of ['', '../escape.tf', '/absolute.tf']) {
      expect(workspace.has(path)).toBe(false);
      expect(workspace.read(path)).toBeUndefined();
      expect(workspace.remove(path)).toBe(false);
    }
    expect(workspace.size).toBe(1);
  });
});

// Limits produce errors rather than silent truncation. A workspace that
// quietly dropped half a project would present a partial analysis as a
// complete one.
describe('limits', () => {
  it('refuses a file over the per-file limit', () => {
    const workspace = new Workspace();
    const tooBig = 'x'.repeat(LIMITS.maxFileBytes + 1);

    expect(() => workspace.write('big.tf', tooBig)).toThrow(WorkspaceLimitError);
    expect(workspace.size).toBe(0);
  });

  it('refuses a write that would exceed the total limit', () => {
    const workspace = new Workspace();
    const chunk = 'x'.repeat(LIMITS.maxFileBytes);
    for (let i = 0; i < 4; i++) workspace.write(`f${i}.tf`, chunk);

    expect(() => workspace.write('one-too-many.tf', chunk)).toThrow(WorkspaceLimitError);
  });

  it('lets an existing file be replaced without double counting its size', () => {
    const workspace = new Workspace();
    const chunk = 'x'.repeat(LIMITS.maxFileBytes);
    for (let i = 0; i < 4; i++) workspace.write(`f${i}.tf`, chunk);

    // Rewriting a file at the limit must work: otherwise editing the last file
    // in a large project would start failing for no reason the user can see.
    expect(() => workspace.write('f0.tf', chunk)).not.toThrow();
  });

  it('refuses a new file past the count limit', () => {
    const workspace = new Workspace();
    for (let i = 0; i < LIMITS.maxFiles; i++) workspace.write(`f${i}.tf`, '');

    expect(() => workspace.write('one-more.tf', '')).toThrow(WorkspaceLimitError);
  });

  // string.length counts UTF-16 code units, which would undercount every
  // non-ASCII character and let a workspace sail past a limit it had exceeded.
  it('measures size in bytes, not characters', () => {
    const workspace = new Workspace();
    workspace.write('comments.tf', '# 日本語');

    expect(workspace.totalBytes).toBeGreaterThan('# 日本語'.length);
  });
});

describe('change notification', () => {
  it('reports writes, removals and clears', () => {
    const workspace = new Workspace();
    const seen: WorkspaceChange[] = [];
    workspace.subscribe((change) => seen.push(change));

    workspace.write('main.tf', 'a');
    workspace.remove('main.tf');
    workspace.write('other.tf', 'b');
    workspace.clear();

    expect(seen).toEqual([
      { type: 'written', path: 'main.tf' },
      { type: 'removed', path: 'main.tf' },
      { type: 'written', path: 'other.tf' },
      { type: 'cleared' },
    ]);
  });

  it('stops notifying after unsubscribe', () => {
    const workspace = new Workspace();
    let count = 0;
    const unsubscribe = workspace.subscribe(() => count++);

    workspace.write('a.tf', '');
    unsubscribe();
    workspace.write('b.tf', '');

    expect(count).toBe(1);
  });

  // The editor and the analyzer both follow the workspace. One of them
  // throwing must not stop the other from hearing about the change.
  it('keeps notifying when a listener throws', () => {
    const workspace = new Workspace();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let reached = false;

    workspace.subscribe(() => {
      throw new Error('subscriber is broken');
    });
    workspace.subscribe(() => {
      reached = true;
    });

    workspace.write('main.tf', '');

    expect(reached).toBe(true);
    errors.mockRestore();
  });

  it('says nothing when clearing an empty workspace', () => {
    const workspace = new Workspace();
    let count = 0;
    workspace.subscribe(() => count++);

    workspace.clear();
    expect(count).toBe(0);
  });
});

// Import loads what it can and reports the rest: a project with one bad file
// should still produce a diagram for everything else.
describe('bulk creation', () => {
  it('collects failures instead of stopping at the first', () => {
    const { workspace, rejected } = createWorkspace({
      'main.tf': 'resource "aws_vpc" "main" {}',
      '../escape.tf': 'malicious',
      'big.tf': 'x'.repeat(LIMITS.maxFileBytes + 1),
      'modules/network/main.tf': 'resource "aws_subnet" "a" {}',
    });

    expect(workspace.list()).toEqual(['main.tf', 'modules/network/main.tf']);
    expect(rejected.map((r) => r.reason).sort()).toEqual(['escapes-root', 'file-too-large']);
    for (const rejection of rejected) {
      expect(rejection.message).toBeTruthy();
    }
  });
});

describe('analysable files', () => {
  it('recognises Terraform files and nothing else', () => {
    expect(isAnalysable('main.tf')).toBe(true);
    expect(isAnalysable('terraform.tfvars')).toBe(true);
    expect(isAnalysable('README.md')).toBe(false);
    expect(isAnalysable('terraform.tfstate')).toBe(false);
  });
});

import { InvalidPathError } from './paths';
import { isAnalysable, LIMITS, Workspace, WorkspaceLimitError } from './workspace';

describe('workspace basics', () => {
  it('holds files and reads them back', () => {
    const workspace = new Workspace();
    workspace.write('main.tf', 'resource "aws_vpc" "main" {}');

    expect(workspace.read('main.tf')).toBe('resource "aws_vpc" "main" {}');
    expect(workspace.has('main.tf')).toBe(true);
    expect(workspace.list()).toEqual(['main.tf']);
  });

  it('normalises paths on the way in, so one file is one file', () => {
    const workspace = new Workspace();
    workspace.write('./modules/../main.tf', 'a');
    workspace.write('main.tf', 'b');

    expect(workspace.list()).toEqual(['main.tf']);
    expect(workspace.read('main.tf')).toBe('b');
  });

  // Sorted rather than insertion-ordered, so a workspace typed file by file and
  // the same one dropped in at once give the analyzer identical input.
  it('lists paths in a stable order regardless of how they arrived', () => {
    const first = new Workspace();
    for (const path of ['z.tf', 'a.tf', 'm.tf']) first.write(path, '');

    const second = new Workspace();
    for (const path of ['m.tf', 'z.tf', 'a.tf']) second.write(path, '');

    expect(first.list()).toEqual(['a.tf', 'm.tf', 'z.tf']);
    expect(Object.keys(first.snapshot())).toEqual(Object.keys(second.snapshot()));
  });

  it('empties on clear', () => {
    const workspace = new Workspace();
    workspace.write('main.tf', 'x');
    workspace.clear();

    expect(workspace.list()).toEqual([]);
  });
});

describe('confinement', () => {
  it('refuses a path that escapes the workspace', () => {
    const workspace = new Workspace();

    expect(() => workspace.write('../outside.tf', 'x')).toThrow(InvalidPathError);
    expect(workspace.list()).toEqual([]);
  });

  // Asking is not the same as writing: a query about an unusable path means
  // "no", because the caller is asking a question, not making a mistake.
  it('answers questions about unusable paths instead of throwing', () => {
    const workspace = new Workspace();
    workspace.write('main.tf', 'x');

    for (const path of ['', '../escape.tf', '/absolute.tf']) {
      expect(workspace.has(path)).toBe(false);
      expect(workspace.read(path)).toBeUndefined();
    }
    expect(workspace.list()).toEqual(['main.tf']);
  });
});

describe('limits', () => {
  it('refuses a file over the per-file limit', () => {
    const workspace = new Workspace();

    expect(() => workspace.write('big.tf', 'x'.repeat(LIMITS.maxFileBytes + 1))).toThrow(
      WorkspaceLimitError,
    );
    expect(workspace.list()).toEqual([]);
  });

  it('refuses a write that would exceed the total limit', () => {
    const workspace = new Workspace();
    const chunk = 'x'.repeat(LIMITS.maxFileBytes);
    for (let i = 0; i < 4; i++) workspace.write(`f${i}.tf`, chunk);

    expect(() => workspace.write('one-too-many.tf', chunk)).toThrow(WorkspaceLimitError);
  });

  // Otherwise editing the last file in a large project would start failing for
  // no reason the user can see.
  it('lets an existing file be replaced without double counting its size', () => {
    const workspace = new Workspace();
    const chunk = 'x'.repeat(LIMITS.maxFileBytes);
    for (let i = 0; i < 4; i++) workspace.write(`f${i}.tf`, chunk);

    expect(() => workspace.write('f0.tf', chunk)).not.toThrow();
  });

  it('refuses a new file past the count limit', () => {
    const workspace = new Workspace();
    for (let i = 0; i < LIMITS.maxFiles; i++) workspace.write(`f${i}.tf`, '');

    expect(() => workspace.write('one-more.tf', '')).toThrow(WorkspaceLimitError);
  });

  // Half the limit in characters, one and a half times it in bytes: counting
  // characters would let this through.
  it('measures size in bytes, not characters', () => {
    const workspace = new Workspace();
    const japanese = '日'.repeat(LIMITS.maxFileBytes / 2);

    expect(japanese.length).toBeLessThan(LIMITS.maxFileBytes);
    expect(() => workspace.write('comments.tf', japanese)).toThrow(WorkspaceLimitError);
  });
});

describe('change notification', () => {
  it('reports writes and clears', () => {
    const workspace = new Workspace();
    const seen: unknown[] = [];
    workspace.subscribe((change) => seen.push(change));

    workspace.write('main.tf', 'a');
    workspace.write('other.tf', 'b');
    workspace.clear();

    expect(seen).toEqual([
      { type: 'written', path: 'main.tf' },
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

  // The editor and the analyzer both follow the workspace; one of them throwing
  // must not stop the other hearing about the change.
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

describe('analysable files', () => {
  it('recognises Terraform files and nothing else', () => {
    expect(isAnalysable('main.tf')).toBe(true);
    expect(isAnalysable('terraform.tfvars')).toBe(true);
    expect(isAnalysable('README.md')).toBe(false);
    expect(isAnalysable('terraform.tfstate')).toBe(false);
  });
});

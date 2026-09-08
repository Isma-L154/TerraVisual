import { describeSkipped, entriesFromInput, importFiles, shouldIgnore } from './import';
import { LIMITS } from './workspace';

function fileEntry(
  path: string,
  content = 'resource "aws_vpc" "main" {}',
): {
  path: string;
  file: File;
} {
  return { path, file: new File([content], path.split('/').pop() ?? path) };
}

describe('what never gets read', () => {
  // .terraform holds downloaded providers: hundreds of megabytes with nothing
  // to draw. State files matter more — they routinely contain secrets, and
  // this tool has no business reading them even locally.
  it.each([
    '.terraform/providers/registry/aws/main.tf',
    'modules/.terraform/plugin.tf',
    'terraform.tfstate',
    'terraform.tfstate.backup',
    '.terraform.lock.hcl',
    '.git/config',
    'node_modules/pkg/main.tf',
  ])('skips %s', (path) => {
    expect(shouldIgnore(path)).toBe('generated-directory');
  });

  it('reads ordinary Terraform', () => {
    expect(shouldIgnore('main.tf')).toBeNull();
    expect(shouldIgnore('modules/network/main.tf')).toBeNull();
  });
});

describe('importing', () => {
  it('keeps Terraform files and their directory structure', async () => {
    const result = await importFiles([
      fileEntry('main.tf'),
      fileEntry('modules/network/main.tf'),
      fileEntry('modules/network/variables.tf'),
    ]);

    // Flattening would break every relative module source in the project.
    expect(Object.keys(result.files).sort()).toEqual([
      'main.tf',
      'modules/network/main.tf',
      'modules/network/variables.tf',
    ]);
  });

  it('skips what is not Terraform and says how much', async () => {
    const result = await importFiles([
      fileEntry('main.tf'),
      fileEntry('README.md', '# docs'),
      fileEntry('diagram.png', 'binary'),
    ]);

    expect(Object.keys(result.files)).toEqual(['main.tf']);
    expect(result.skipped).toHaveLength(2);
    expect(describeSkipped(result.skipped)[0]).toMatch(/2 files skipped: not Terraform/);
  });

  it('mentions state files by name in what it skipped', async () => {
    const result = await importFiles([fileEntry('main.tf'), fileEntry('terraform.tfstate', '{}')]);

    expect(describeSkipped(result.skipped).join(' ')).toMatch(/can contain secrets/);
  });

  // A project with one enormous file should still produce a diagram for
  // everything else.
  it('skips an oversized file and keeps the rest', async () => {
    const huge = 'x'.repeat(LIMITS.maxFileBytes + 1);
    const result = await importFiles([fileEntry('main.tf'), fileEntry('huge.tf', huge)]);

    expect(Object.keys(result.files)).toEqual(['main.tf']);
    expect(result.skipped[0]!.reason).toBe('too-large');
  });

  it('stops at the file limit rather than silently dropping the tail', async () => {
    const entries = Array.from({ length: LIMITS.maxFiles + 5 }, (_, i) => fileEntry(`f${i}.tf`));
    const result = await importFiles(entries);

    expect(Object.keys(result.files)).toHaveLength(LIMITS.maxFiles);
    expect(describeSkipped(result.skipped).join(' ')).toMatch(/file limit/);
  });

  // Which files land inside the limits must not depend on the order the
  // browser happened to hand them over.
  it('is deterministic regardless of input order', async () => {
    const entries = [fileEntry('c.tf'), fileEntry('a.tf'), fileEntry('b.tf')];

    const forward = await importFiles(entries);
    const reversed = await importFiles([...entries].reverse());

    expect(Object.keys(forward.files)).toEqual(Object.keys(reversed.files));
  });

  it('reports progress as it goes', async () => {
    const seen: number[] = [];
    await importFiles([fileEntry('a.tf'), fileEntry('b.tf')], (read) => seen.push(read));

    expect(seen[0]).toBe(0);
    expect(seen[seen.length - 1]).toBe(2);
  });

  it('imports nothing from an empty drop without failing', async () => {
    const result = await importFiles([]);

    expect(result.files).toEqual({});
    expect(result.skipped).toEqual([]);
  });
});

describe('reading a file input', () => {
  it('uses the relative path a directory picker provides', () => {
    const file = new File(['x'], 'main.tf');
    Object.defineProperty(file, 'webkitRelativePath', { value: 'project/modules/main.tf' });

    const list = { 0: file, length: 1, item: () => file } as unknown as FileList;

    expect(entriesFromInput(list)[0]!.path).toBe('project/modules/main.tf');
  });

  it('falls back to the file name when there is no relative path', () => {
    const file = new File(['x'], 'main.tf');
    const list = { 0: file, length: 1, item: () => file } as unknown as FileList;

    expect(entriesFromInput(list)[0]!.path).toBe('main.tf');
  });
});

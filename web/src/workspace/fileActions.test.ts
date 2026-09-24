import { fileActions } from './fileActions';
import { LIMITS, Workspace } from './workspace';

function setup(paths: string[], active = paths[0] ?? '') {
  const workspace = new Workspace();
  for (const path of paths) workspace.write(path, `# ${path}`);
  const open = vi.fn();
  return { workspace, open, actions: fileActions(workspace, active, open) };
}

describe('file actions', () => {
  it('creates an empty file and opens it', () => {
    const { workspace, open, actions } = setup(['main.tf']);

    expect(actions.create('variables.tf')).toBeNull();
    expect(workspace.read('variables.tf')).toBe('');
    expect(open).toHaveBeenCalledWith('variables.tf');
  });

  it('says why a path is refused and changes nothing', () => {
    const { workspace, open, actions } = setup(['main.tf']);

    expect(actions.create('main.tf')).toMatch(/already exists/);
    expect(actions.create('../x.tf')).toMatch(/inside the workspace/);
    expect(workspace.list()).toEqual(['main.tf']);
    expect(open).not.toHaveBeenCalled();
  });

  it('turns a limit into a sentence rather than an exception', () => {
    const { actions } = setup(Array.from({ length: LIMITS.maxFiles }, (_, i) => `f${i}.tf`));

    expect(actions.create('one-more.tf')).toMatch(/limit/);
  });

  it('renames the open file, and renaming it to itself is not a clash', () => {
    const { workspace, open, actions } = setup(['main.tf', 'other.tf'], 'main.tf');

    expect(actions.rename('main.tf')).toBeNull();
    expect(actions.rename('network/main.tf')).toBeNull();
    expect(workspace.list()).toEqual(['network/main.tf', 'other.tf']);
    expect(open).toHaveBeenLastCalledWith('network/main.tf');
    expect(actions.rename('other.tf')).toMatch(/already exists/);
  });

  it('removes the open file and opens what is left', () => {
    const { workspace, open, actions } = setup(['a.tf', 'b.tf'], 'b.tf');

    actions.remove();

    expect(workspace.list()).toEqual(['a.tf']);
    expect(open).toHaveBeenCalledWith('a.tf');
  });
});

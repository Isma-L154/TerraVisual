import { checkNewPath } from './newPath';

const taken = (path: string) => path === 'main.tf';

describe('checking a path somebody typed', () => {
  it('accepts a Terraform file, normalised', () => {
    expect(checkNewPath(' ./modules/network/main.tf ', taken)).toEqual({
      ok: true,
      path: 'modules/network/main.tf',
    });
    expect(checkNewPath('prod.tfvars', taken)).toEqual({ ok: true, path: 'prod.tfvars' });
  });

  it.each([
    ['', /Enter a file name/],
    ['../outside.tf', /stays inside the workspace/],
    ['/etc/main.tf', /stays inside the workspace/],
    ['notes.md', /Only .tf and .tfvars/],
    ['main.tf', /main.tf already exists/],
  ])('refuses %j and says why', (input, message) => {
    const result = checkNewPath(input, taken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(message);
  });
});

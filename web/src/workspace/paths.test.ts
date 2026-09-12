import { InvalidPathError, extname, normalisePath } from './paths';

describe('path normalisation', () => {
  it('leaves ordinary paths alone', () => {
    expect(normalisePath('main.tf')).toBe('main.tf');
    expect(normalisePath('modules/network/main.tf')).toBe('modules/network/main.tf');
  });

  it('treats a Windows drop like any other', () => {
    expect(normalisePath('modules\\network\\main.tf')).toBe('modules/network/main.tf');
  });

  it('resolves redundant segments', () => {
    expect(normalisePath('./main.tf')).toBe('main.tf');
    expect(normalisePath('modules//network/./main.tf')).toBe('modules/network/main.tf');
    expect(normalisePath('modules/network/../main.tf')).toBe('modules/main.tf');
  });
});

describe('workspace confinement', () => {
  const escapes = [
    '../secrets.tf',
    '../../etc/passwd',
    'modules/../../outside.tf',
    'modules/network/../../../outside.tf',
    './../outside.tf',
    '..\\..\\windows\\system32\\config',
  ];

  it.each(escapes)('refuses %s', (path) => {
    expect(() => normalisePath(path)).toThrow(InvalidPathError);
  });

  it('refuses absolute paths', () => {
    expect(() => normalisePath('/etc/passwd')).toThrow(InvalidPathError);
    expect(() => normalisePath('C:/Windows/system.ini')).toThrow(InvalidPathError);
  });

  it('refuses rather than clamping', () => {
    let rejection: string | undefined;
    try {
      normalisePath('../outside.tf');
    } catch (error) {
      rejection = (error as InvalidPathError).rejection;
    }
    expect(rejection).toBe('escapes-root');
  });

  it('refuses control characters, which can disguise a path', () => {
    expect(() => normalisePath('main\u0000.tf')).toThrow(InvalidPathError);
    expect(() => normalisePath('main\n.tf')).toThrow(InvalidPathError);
    expect(() => normalisePath('main\u007f.tf')).toThrow(InvalidPathError);
  });

  it('refuses paths that are too long or too deep', () => {
    expect(() => normalisePath('a'.repeat(2000))).toThrow(InvalidPathError);
    expect(() => normalisePath(Array(40).fill('deep').join('/') + '/main.tf')).toThrow(
      InvalidPathError,
    );
  });

  it('refuses paths that normalise to nothing', () => {
    expect(() => normalisePath('.')).toThrow(InvalidPathError);
    expect(() => normalisePath('')).toThrow(InvalidPathError);
  });
});

describe('extensions', () => {
  it('reads the extension in lower case', () => {
    expect(extname('main.TF')).toBe('.tf');
    expect(extname('terraform.tfvars')).toBe('.tfvars');
    expect(extname('modules/network/main.tf')).toBe('.tf');
  });

  it('treats a dotfile as having no extension', () => {
    expect(extname('.gitignore')).toBe('');
    expect(extname('README')).toBe('');
  });
});

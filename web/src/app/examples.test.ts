import { EXAMPLES, STARTER_WORKSPACE } from './examples';
import { isAnalysable } from '../workspace/workspace';
import { normalisePath } from '../workspace/paths';

describe('the examples', () => {
  it('start with the workspace a first visit lands in', () => {
    expect(EXAMPLES[0]!.files).toBe(STARTER_WORKSPACE);
  });

  it.each(EXAMPLES.map((example) => [example.title, example] as const))(
    '%s has usable Terraform paths and a root module',
    (_, example) => {
      const paths = Object.keys(example.files);
      for (const path of paths) {
        expect(normalisePath(path)).toBe(path);
        expect(isAnalysable(path)).toBe(true);
      }
      // The analyzer draws from the root module; an example without one is blank.
      expect(paths.some((path) => !path.includes('/'))).toBe(true);
    },
  );

  it('have unique ids', () => {
    expect(new Set(EXAMPLES.map((example) => example.id)).size).toBe(EXAMPLES.length);
  });
});

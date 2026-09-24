import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';

import { resourceTypeCompletion } from './completion';

const source = resourceTypeCompletion([
  { type: 'aws_s3_bucket', displayName: 'S3 Bucket', provider: 'aws' },
  { type: 'aws_vpc', displayName: 'VPC', provider: 'aws' },
]);

/** Completion at the `|` in the given text. */
function complete(text: string) {
  const pos = text.indexOf('|');
  const state = EditorState.create({ doc: text.replace('|', '') });
  return source(new CompletionContext(state, pos, false));
}

describe('resource type completion', () => {
  it('offers catalogued types as the first label of a resource', () => {
    const result = complete('resource "aws_|"');

    expect(result?.from).toBe('resource "'.length);
    expect(result?.options.map((option) => option.label)).toEqual(['aws_s3_bucket', 'aws_vpc']);
    expect(result?.options[0]?.detail).toBe('S3 Bucket');
  });

  it('offers them before anything is typed, and when indented', () => {
    expect(complete('  resource "|')?.options).toHaveLength(2);
  });

  it('stays out of the way everywhere else', () => {
    expect(complete('resource "aws_vpc" "ma|"')).toBeNull();
    expect(complete('  cidr_block = "10.|"')).toBeNull();
    expect(complete('data "aws_|"')).toBeNull();
  });
});

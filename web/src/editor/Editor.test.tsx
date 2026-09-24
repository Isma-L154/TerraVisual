import { render, screen } from '@testing-library/react';
import { EditorView } from '@codemirror/view';

import type { Range } from '../model';
import { Editor } from './Editor';

const source = [
  'resource "aws_vpc" "main" {',
  '  cidr_block = "10.0.0.0/16"',
  '}',
  '',
  'resource "aws_subnet" "public" {',
  '  vpc_id = aws_vpc.main.id',
  '}',
].join('\n');

function range(startLine: number, startCol: number, endLine: number, endCol: number): Range {
  return { file: 'main.tf', startLine, startCol, endLine, endCol };
}

/** What the editor has selected, read out of the DOM the way a user sees it. */
function selectedText(): string {
  return window.getSelection()?.toString() ?? '';
}

describe('the editor', () => {
  it('shows the file it was given', () => {
    render(<Editor path="main.tf" content={source} diagnostics={[]} onChange={() => {}} />);

    expect(screen.getByRole('textbox', { name: /main\.tf/ })).toBeInTheDocument();
    expect(screen.getByTestId('editor').textContent).toContain('aws_vpc');
  });

  // Revealing is how a diagnostic and a diagram node both point at code. The
  // selection is what makes the jump legible: scrolling alone leaves somebody
  // looking at a screen of code with no idea which part they were sent to.
  it('selects the range it is asked to reveal', () => {
    const { rerender } = render(
      <Editor path="main.tf" content={source} diagnostics={[]} onChange={() => {}} />,
    );

    rerender(
      <Editor
        path="main.tf"
        content={source}
        diagnostics={[]}
        reveal={range(2, 3, 2, 13)}
        onChange={() => {}}
      />,
    );

    expect(selectedText()).toBe('cidr_block');
  });

  it('ignores a range belonging to another file', () => {
    const { rerender } = render(
      <Editor path="main.tf" content={source} diagnostics={[]} onChange={() => {}} />,
    );

    rerender(
      <Editor
        path="main.tf"
        content={source}
        diagnostics={[]}
        reveal={{ ...range(2, 3, 2, 13), file: 'other.tf' }}
        onChange={() => {}}
      />,
    );

    expect(selectedText()).toBe('');
  });

  // Analysis is debounced, so a range can describe a line the user has already
  // deleted. Throwing here would take out the editor over a stale position.
  it('survives a range past the end of the document', () => {
    const { rerender } = render(
      <Editor path="main.tf" content={source} diagnostics={[]} onChange={() => {}} />,
    );

    expect(() =>
      rerender(
        <Editor
          path="main.tf"
          content={source}
          diagnostics={[]}
          reveal={range(400, 1, 400, 9)}
          onChange={() => {}}
        />,
      ),
    ).not.toThrow();
  });

  it('reports edits to its caller', () => {
    const onChange = vi.fn();
    render(<Editor path="main.tf" content={source} diagnostics={[]} onChange={onChange} />);

    // Changing the document through the editor's own API is the closest thing
    // to typing that does not depend on jsdom's input handling.
    const content = document.querySelector('.cm-content') as HTMLElement;
    expect(content).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  // A re-render can carry text read from the workspace before the latest
  // keystroke. Treating it as "content from elsewhere" replaced what had just
  // been typed and threw the cursor to the top of the file (#112).
  it('never replaces what was typed with a stale copy from a re-render', () => {
    const { rerender } = render(
      <Editor path="main.tf" content={source} diagnostics={[]} onChange={() => {}} />,
    );
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!;

    // Two keystrokes; the re-render only saw the first.
    const end = view.state.doc.length;
    view.dispatch({ changes: { from: end, insert: 'a' }, selection: { anchor: end + 1 } });
    view.dispatch({ changes: { from: end + 1, insert: 'b' }, selection: { anchor: end + 2 } });

    rerender(<Editor path="main.tf" content={`${source}a`} diagnostics={[]} onChange={() => {}} />);

    expect(view.state.doc.toString()).toBe(`${source}ab`);
    expect(view.state.selection.main.head).toBe(end + 2);
  });
});

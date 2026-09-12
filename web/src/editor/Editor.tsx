import { useEffect, useId, useRef } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { lintGutter, setDiagnostics } from '@codemirror/lint';
import { hcl } from 'codemirror-lang-hcl';

import type { Diagnostic, Range } from '../model';
import { toLintDiagnostics, toOffsets } from './diagnostics';
import { cspNonce } from './nonce';
import { editorTheme, highlightStyle } from './theme';

type EditorProps = {
  /** Which workspace file is open. Changing it starts a new document. */
  path: string;
  content: string;
  diagnostics: Diagnostic[];
  /** A range to select and scroll to; pass a fresh object to jump again. */
  reveal?: Range | null;
  onChange: (content: string) => void;
  onCursorLine?: (line: number) => void;
};

/**
 * The code editor (CodeMirror, ADR-0005). The view is created once and driven
 * by effects: rebuilding it would throw away the cursor, the selection and the
 * undo history.
 */
export function Editor({
  path,
  content,
  diagnostics,
  reveal,
  onChange,
  onCursorLine,
}: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const hintId = useId();

  // In refs so a new callback identity does not rebuild the view. Synced in an
  // effect, because a ref written during render is a side effect.
  const changeHandler = useRef(onChange);
  const cursorHandler = useRef(onCursorLine);

  useEffect(() => {
    changeHandler.current = onChange;
    cursorHandler.current = onCursorLine;
  });

  useEffect(() => {
    const container = host.current;
    if (!container) return;

    const extensions: Extension[] = [
      lineNumbers(),
      lintGutter(),
      highlightActiveLine(),
      history(),
      bracketMatching(),
      indentOnInput(),
      syntaxHighlighting(highlightStyle),
      // Without the nonce the Content Security Policy refuses CodeMirror's own
      // stylesheet and the editor renders unstyled.
      EditorView.cspNonce.of(cspNonce()),
      hcl(),
      editorTheme,
      EditorView.lineWrapping,
      // Tab indents, so Tab no longer moves focus. WCAG 2.1.2 then requires the
      // way out to be advertised: the hint below says Escape, then Tab.
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) changeHandler.current(update.state.doc.toString());
        if (update.selectionSet && cursorHandler.current) {
          const position = update.state.selection.main.head;
          cursorHandler.current(update.state.doc.lineAt(position).number);
        }
      }),
      EditorView.contentAttributes.of({
        'aria-label': `Terraform source, ${path}`,
        'aria-describedby': hintId,
      }),
    ];

    const instance = new EditorView({
      state: EditorState.create({ doc: content, extensions }),
      parent: container,
    });
    view.current = instance;

    return () => {
      instance.destroy();
      view.current = null;
    };
    // Keyed on the file alone: a different file is a different document, and
    // its undo history should not continue the previous one's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, hintId]);

  // Content from elsewhere — an import, a shared link, a reset.
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;

    const current = instance.state.doc.toString();
    if (current === content) return;

    instance.dispatch({ changes: { from: 0, to: current.length, insert: content } });
  }, [content]);

  // Pushed in when analysis finishes rather than pulled by CodeMirror's
  // linter: these are analysis results, and they arrive from a worker.
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;

    instance.dispatch(
      setDiagnostics(instance.state, toLintDiagnostics(instance.state.doc, diagnostics, path)),
    );
  }, [diagnostics, path]);

  // Selecting the range, not just scrolling to it, is what makes a jump legible.
  useEffect(() => {
    const instance = view.current;
    if (!instance || !reveal || reveal.file !== path) return;

    const range = toOffsets(instance.state.doc, reveal);
    if (!range) return;

    instance.dispatch({
      selection: { anchor: range.from, head: range.to },
      effects: EditorView.scrollIntoView(range.from, { y: 'center' }),
    });
    instance.focus();
  }, [reveal, path]);

  return (
    <>
      <div className="editor" ref={host} data-testid="editor" />
      <p className="editor-hint" id={hintId}>
        Tab indents. To leave the editor, press Escape and then Tab.
      </p>
    </>
  );
}

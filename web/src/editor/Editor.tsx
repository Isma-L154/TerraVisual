import { useEffect, useRef } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { lintGutter, setDiagnostics } from '@codemirror/lint';
import { hcl } from 'codemirror-lang-hcl';

import type { Diagnostic, Range } from '../model';
import { toLintDiagnostics, toOffsets } from './diagnostics';
import { editorTheme, highlightStyle } from './theme';

export type EditorProps = {
  /** Which workspace file is open. Changing it starts a new document. */
  path: string;
  content: string;
  diagnostics: Diagnostic[];
  /**
   * A range to scroll to and select. Changing it moves the cursor; setting it
   * to the same value again does nothing, which is why callers pass a fresh
   * object when they want to jump to somewhere the cursor already is.
   */
  reveal?: Range | null;
  onChange: (content: string) => void;
  onCursorLine?: (line: number) => void;
};

/**
 * The code editor.
 *
 * CodeMirror rather than Monaco (ADR-0005): on a payload budget already
 * committed to a 1.9 MB analyzer, the difference between ~300 kB and 2-5 MB is
 * the editor appearing immediately versus the user watching an empty pane.
 *
 * The view is created once and driven by effects afterwards. Rebuilding it on
 * every render would throw away the cursor, the selection and the undo history
 * — the things somebody is relying on while they type.
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

  // Held in refs so the extensions can read current values without the view
  // being rebuilt every time a callback identity changes. Synced in an effect
  // rather than during render: a ref written while rendering is a side effect,
  // and React is entitled to render twice.
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
      hcl(),
      editorTheme,
      EditorView.lineWrapping,
      // Tab indents inside the editor. That is a real accessibility trade-off,
      // and the mitigation is that Escape then Tab still moves focus out,
      // which keyboard-only users need in order to leave.
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          changeHandler.current(update.state.doc.toString());
        }
        if (update.selectionSet && cursorHandler.current) {
          const position = update.state.selection.main.head;
          cursorHandler.current(update.state.doc.lineAt(position).number);
        }
      }),
      EditorView.contentAttributes.of({ 'aria-label': `Terraform source, ${path}` }),
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
    // Deliberately keyed on the file alone: a different file is a different
    // document, and its undo history should not continue the previous one's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Content arriving from elsewhere — an import, a shared link, an example —
  // is applied without disturbing what the user is doing locally.
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;

    const current = instance.state.doc.toString();
    if (current === content) return;

    instance.dispatch({ changes: { from: 0, to: current.length, insert: content } });
  }, [content]);

  // Markers are pushed in when analysis finishes, rather than pulled by
  // CodeMirror's linter.
  //
  // `linter()` exists for checks the editor runs itself, and schedules them
  // around document changes. Ours arrive from a worker some time after the
  // last keystroke, so pushing them is both simpler and more honest: these are
  // not lint results, they are analysis results.
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;

    instance.dispatch(
      setDiagnostics(instance.state, toLintDiagnostics(instance.state.doc, diagnostics, path)),
    );
  }, [diagnostics, path]);

  // Reveal a range: select it and scroll it into view.
  //
  // The selection is what makes the jump legible. Scrolling alone leaves the
  // user looking at a screen of code with no indication of which part they
  // were sent to.
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

  return <div className="editor" ref={host} data-testid="editor" />;
}

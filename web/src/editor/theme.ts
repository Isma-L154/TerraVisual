import { EditorView } from '@codemirror/view';
import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/**
 * Editor appearance.
 *
 * Colours come from the same CSS custom properties as the rest of the
 * interface, so the editor follows the viewer's light or dark preference
 * without a second theme to keep in sync. Contrast is checked once, on the
 * tokens, rather than per component.
 */
export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13px',
    backgroundColor: 'var(--surface)',
    color: 'var(--text)',
  },
  '.cm-content': {
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    padding: '8px 0',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--surface)',
    color: 'var(--muted)',
    border: 'none',
  },
  '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--active-line)' },
  '.cm-cursor': { borderLeftColor: 'var(--text)' },
  '&.cm-focused': { outline: '2px solid var(--accent)', outlineOffset: '-2px' },
  '.cm-selectionBackground, ::selection': { backgroundColor: 'var(--selection)' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--selection)' },
  '.cm-scroller': { overflow: 'auto' },
});

export const highlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: tags.string, color: 'var(--syntax-string)' },
  { tag: tags.number, color: 'var(--syntax-number)' },
  { tag: tags.bool, color: 'var(--syntax-number)' },
  { tag: tags.keyword, color: 'var(--syntax-keyword)' },
  { tag: tags.propertyName, color: 'var(--syntax-property)' },
  { tag: tags.typeName, color: 'var(--syntax-type)' },
  { tag: tags.function(tags.variableName), color: 'var(--syntax-function)' },
  { tag: tags.variableName, color: 'var(--text)' },
  { tag: tags.operator, color: 'var(--muted)' },
  { tag: tags.bracket, color: 'var(--muted)' },
]);

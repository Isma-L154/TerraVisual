import { EditorView } from '@codemirror/view';
import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/**
 * Editor appearance, drawn from the same CSS custom properties as the rest of
 * the interface: one set of tokens to check for contrast, and light or dark
 * follows the viewer without a second theme to keep in sync.
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

  // Search panel and completion list, drawn from the page's tokens so they
  // follow dark mode and pass the same contrast checks.
  '.cm-panels': {
    backgroundColor: 'var(--surface)',
    color: 'var(--text)',
    borderColor: 'var(--border)',
  },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panel.cm-search': { padding: '6px 8px', fontSize: '12px' },
  '.cm-textfield': {
    backgroundColor: 'var(--bg)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--surface)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
  },
  '.cm-searchMatch': { backgroundColor: 'var(--active-line)', outline: '1px solid var(--accent)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--selection)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--surface)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--selection)',
    color: 'var(--text)',
  },
  '.cm-completionDetail': { color: 'var(--muted)', fontStyle: 'normal', marginLeft: '8px' },
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

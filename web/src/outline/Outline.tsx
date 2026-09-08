import { useCallback, useMemo, useRef, useState } from 'react';

import type { InfraModel } from '../model';
import { CategoryIcon } from '../diagram/CategoryIcon';
import { displayType } from '../diagram/catalog';
import { buildTree, connectionsByNode, describe, visibleItems, type OutlineItem } from './tree';

export type OutlineProps = {
  model: InfraModel | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

/**
 * The infrastructure as a tree.
 *
 * Not a fallback for the diagram — a peer view of the same model. The brief is
 * unambiguous that a visual diagram cannot be the only way important
 * information is communicated, and a spatial canvas is a poor way to read a
 * hierarchy however accessible its individual nodes are.
 *
 * It follows the ARIA tree pattern: one tab stop for the whole tree, arrows to
 * move within it. Making every item tabbable would be easier to write and far
 * worse to use — a hundred-resource project would become a hundred tab stops
 * between the editor and whatever comes next.
 */
export function Outline({ model, selectedId, onSelect }: OutlineProps) {
  const tree = useMemo(() => (model ? buildTree(model) : []), [model]);
  const connections = useMemo(
    () => (model ? connectionsByNode(model) : new Map<string, string[]>()),
    [model],
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const visible = useMemo(() => visibleItems(tree, collapsed), [tree, collapsed]);
  const container = useRef<HTMLUListElement>(null);

  // The roving tab stop is derived rather than stored, so it cannot point at
  // something that no longer exists. Analysis runs on every keystroke, and the
  // item that had focus may be gone a moment later; syncing that through state
  // would mean a render pass whose only job is to correct the previous one.
  const focusable =
    focusedId && visible.some((item) => item.node.id === focusedId)
      ? focusedId
      : selectedId && visible.some((item) => item.node.id === selectedId)
        ? selectedId
        : (visible[0]?.node.id ?? null);

  const focusItem = useCallback((id: string) => {
    setFocusedId(id);
    container.current?.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(id)}"]`)?.focus();
  }, []);

  const toggle = useCallback((id: string, expand: boolean) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (expand) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent, item: OutlineItem, index: number) => {
      const { node, children } = item;
      const expanded = children.length > 0 && !collapsed.has(node.id);

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          if (index + 1 < visible.length) focusItem(visible[index + 1]!.node.id);
          break;
        case 'ArrowUp':
          event.preventDefault();
          if (index > 0) focusItem(visible[index - 1]!.node.id);
          break;
        case 'ArrowRight':
          event.preventDefault();
          if (children.length === 0) break;
          if (!expanded) toggle(node.id, true);
          else focusItem(children[0]!.node.id);
          break;
        case 'ArrowLeft': {
          event.preventDefault();
          if (expanded) {
            toggle(node.id, false);
            break;
          }
          // Collapsed or a leaf: move to the parent, which is the nearest
          // preceding item at a shallower level.
          for (let i = index - 1; i >= 0; i--) {
            if (visible[i]!.level < item.level) {
              focusItem(visible[i]!.node.id);
              break;
            }
          }
          break;
        }
        case 'Home':
          event.preventDefault();
          if (visible.length > 0) focusItem(visible[0]!.node.id);
          break;
        case 'End':
          event.preventDefault();
          if (visible.length > 0) focusItem(visible[visible.length - 1]!.node.id);
          break;
        case 'Enter':
        case ' ':
          event.preventDefault();
          onSelect(node.id);
          break;
        default:
          break;
      }
    },
    [collapsed, focusItem, onSelect, toggle, visible],
  );

  if (!model) {
    return (
      <p className="placeholder" data-testid="outline-waiting">
        Waiting for the first analysis…
      </p>
    );
  }
  if (tree.length === 0) {
    return (
      <p className="placeholder" data-testid="outline-empty">
        No infrastructure yet. Declare a resource and it will appear here.
      </p>
    );
  }

  const rendered = visible.map((item, index) => {
    const { node, level, children } = item;
    const hasChildren = children.length > 0;
    const expanded = hasChildren && !collapsed.has(node.id);
    const parent = model.nodes.find((candidate) => candidate.id === node.parentId);
    const siblings = visible.filter((other) => other.level === level);

    return (
      <li
        key={node.id}
        role="treeitem"
        data-item-id={node.id}
        aria-level={level}
        aria-selected={node.id === selectedId}
        {...(hasChildren ? { 'aria-expanded': expanded } : {})}
        aria-setsize={siblings.length}
        aria-posinset={siblings.indexOf(item) + 1}
        aria-label={describe(item, parent, connections.get(node.id))}
        tabIndex={node.id === focusable ? 0 : -1}
        className={`outline-item${node.id === selectedId ? ' is-selected' : ''}`}
        style={{ paddingInlineStart: `${(level - 1) * 16 + 8}px` }}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(node.id);
          setFocusedId(node.id);
        }}
        onKeyDown={(event) => onKeyDown(event, item, index)}
      >
        {/* Everything inside is hidden from assistive technology: the item's
            own aria-label is the description, and reading the pieces again
            afterwards would double every announcement. */}
        <span className="outline-row" aria-hidden="true">
          <span className="outline-twisty">{hasChildren ? (expanded ? '▾' : '▸') : ''}</span>
          <CategoryIcon category={node.category} size={13} />
          <span className="outline-label">{node.label}</span>
          <span className="outline-type">{displayType(node.type)}</span>
          {!node.catalogued ? <span className="outline-flag">uncatalogued</span> : null}
        </span>
      </li>
    );
  });

  return (
    <ul
      // A flat list with aria-level, rather than nested groups: the visible
      // items already change as branches collapse, and one flat structure keeps
      // the keyboard model and the DOM saying the same thing.
      role="tree"
      aria-label="Infrastructure outline"
      className="outline"
      data-testid="outline"
      ref={container}
    >
      {rendered}
    </ul>
  );
}

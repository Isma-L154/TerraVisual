import { useCallback, useMemo, useRef, useState } from 'react';

import type { InfraModel } from '../model';
import { CategoryIcon } from '../diagram/CategoryIcon';
import { connectionsByNode, displayType } from '../diagram/catalog';
import { buildTree, describe, visibleItems, type OutlineItem } from './tree';

type OutlineProps = {
  model: InfraModel | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

/**
 * The infrastructure as a tree: a peer of the diagram, not a fallback for it.
 *
 * The ARIA tree pattern, so the whole tree is one tab stop and arrows move
 * within it. A hundred resources would otherwise be a hundred tab stops
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

  // Derived rather than stored, so it cannot point at an item that analysis has
  // since removed.
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
          // Collapsed or a leaf: move to the parent, the nearest preceding item
          // at a shallower level.
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
    // Items sharing a parent, not every item at the same depth: "2 of 14" where
    // 14 was the whole level tells somebody navigating by ear nothing.
    const siblings = visible.filter(
      (other) => other.level === level && other.node.parentId === node.parentId,
    );

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
        {/* Hidden from assistive technology: the item's own label is the
            description, and reading the pieces again would double it. */}
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
    // Flat with aria-level rather than nested groups, so the keyboard model and
    // the DOM say the same thing as branches collapse.
    <ul
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

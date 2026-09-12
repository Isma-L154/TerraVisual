import { useState } from 'react';

import type { InfraModel, Range } from '../model';
import type { Workspace } from '../workspace/workspace';
import { hasSource, nodeAtLine } from './locate';

/**
 * What ties the code to the diagram: the open file, the selected node, and
 * where the editor was last asked to jump.
 */
export function useSourceNavigation(workspace: Workspace, model: InfraModel | null) {
  const [chosenPath, setChosenPath] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reveal, setReveal] = useState<Range | null>(null);

  // After an import or a reset the chosen file may be gone; fall back to the first.
  const paths = workspace.list();
  const activePath = chosenPath && workspace.has(chosenPath) ? chosenPath : (paths[0] ?? '');

  /** A fresh object each time, so jumping to the same place twice still scrolls. */
  const revealSource = (source: Range) => {
    if (!source.file || source.startLine < 1) return;
    if (source.file !== activePath && workspace.has(source.file)) setChosenPath(source.file);
    setReveal({ ...source });
  };

  /**
   * Selecting also reveals the code. Re-selecting does not jump again, so the
   * cursor is not pulled back while somebody types inside the same resource.
   */
  const selectNode = (id: string | null) => {
    if (id === selectedId) return;
    setSelectedId(id);

    const target = id ? model?.nodes.find((node) => node.id === id) : undefined;
    if (target && hasSource(target)) revealSource(target.source);
  };

  /** The cursor highlights the node it is in, without jumping anywhere. */
  const followCursor = (line: number) => {
    const id = nodeAtLine(model, activePath, line);
    if (id) setSelectedId(id);
  };

  const forget = () => {
    setChosenPath(null);
    setSelectedId(null);
  };

  return {
    paths,
    activePath,
    openFile: (path: string) => setChosenPath(path),
    selectedId,
    selected: model?.nodes.find((node) => node.id === selectedId) ?? null,
    selectNode,
    reveal,
    revealSource,
    followCursor,
    forget,
  };
}

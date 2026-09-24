import { useEffect, useRef, useState } from 'react';

/**
 * Files dropped anywhere on the page. Without this, a file that misses the
 * import panel is opened by the browser, or inserted as text by the editor.
 *
 * Listens in the capture phase so it runs before CodeMirror's own drop
 * handler, and ignores drags that carry no files, such as moving a selection
 * inside the editor.
 */
export function useFileDrop(onDrop: (transfer: DataTransfer) => void): boolean {
  const [dragging, setDragging] = useState(false);
  const handler = useRef(onDrop);

  useEffect(() => {
    handler.current = onDrop;
  });

  useEffect(() => {
    // dragenter and dragleave fire for every element crossed, so a counter is
    // the only reliable way to know the drag has left the window.
    let depth = 0;
    const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;

    const enter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth++;
      setDragging(true);
    };
    const leave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const over = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer!.dropEffect = 'copy';
    };
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      depth = 0;
      setDragging(false);
      handler.current(event.dataTransfer!);
    };

    const listeners = { dragenter: enter, dragleave: leave, dragover: over, drop } as const;
    for (const [type, listener] of Object.entries(listeners)) {
      window.addEventListener(type, listener as EventListener, true);
    }
    return () => {
      for (const [type, listener] of Object.entries(listeners)) {
        window.removeEventListener(type, listener as EventListener, true);
      }
    };
  }, []);

  return dragging;
}

import { clampSplit, SPLIT, splitAfterKey } from './split';

type SplitterProps = {
  value: number;
  onChange: (percent: number) => void;
};

/**
 * The line between the code and the infrastructure, following the WAI-ARIA
 * window splitter pattern: focusable, named, with a value, and moved by the
 * arrow keys as well as by dragging.
 */
export function Splitter({ value, onChange }: SplitterProps) {
  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the code and the infrastructure"
      aria-valuemin={SPLIT.min}
      aria-valuemax={SPLIT.max}
      aria-valuenow={value}
      aria-controls="workspace"
      tabIndex={0}
      onKeyDown={(event) => {
        const next = splitAfterKey(value, event.key);
        if (next === null) return;
        event.preventDefault();
        onChange(next);
      }}
      onPointerDown={(event) => {
        const grid = event.currentTarget.parentElement;
        if (!grid) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const box = grid.getBoundingClientRect();

        const move = (moved: PointerEvent) =>
          onChange(clampSplit(((moved.clientX - box.left) / box.width) * 100));
        const stop = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', stop);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop);
      }}
    />
  );
}

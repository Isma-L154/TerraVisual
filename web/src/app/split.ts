/** The share of the width the code column gets, in percent. */
export const SPLIT = { min: 25, max: 75, initial: 50, step: 5 } as const;

export function clampSplit(percent: number): number {
  return Math.min(SPLIT.max, Math.max(SPLIT.min, Math.round(percent)));
}

/** Keyboard handling for the window splitter pattern; null for keys it ignores. */
export function splitAfterKey(current: number, key: string): number | null {
  switch (key) {
    case 'ArrowLeft':
      return clampSplit(current - SPLIT.step);
    case 'ArrowRight':
      return clampSplit(current + SPLIT.step);
    case 'Home':
      return SPLIT.min;
    case 'End':
      return SPLIT.max;
    default:
      return null;
  }
}

import { clampSplit, SPLIT, splitAfterKey } from './split';

describe('the code and infrastructure split', () => {
  it('stays where both sides remain usable', () => {
    expect(clampSplit(5)).toBe(SPLIT.min);
    expect(clampSplit(95)).toBe(SPLIT.max);
    expect(clampSplit(42.4)).toBe(42);
  });

  it('moves by a step with the arrows and to the limits with Home and End', () => {
    expect(splitAfterKey(50, 'ArrowLeft')).toBe(45);
    expect(splitAfterKey(50, 'ArrowRight')).toBe(55);
    expect(splitAfterKey(74, 'ArrowRight')).toBe(SPLIT.max);
    expect(splitAfterKey(50, 'Home')).toBe(SPLIT.min);
    expect(splitAfterKey(50, 'End')).toBe(SPLIT.max);
    expect(splitAfterKey(50, 'Enter')).toBeNull();
  });
});

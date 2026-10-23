import { describe, it, expect } from 'vitest';
import { countValue } from './motion.js';

describe('countValue', () => {
  it('cuenta de 0 a to con ease-out', () => {
    expect(countValue(42, 0)).toBe(0);
    expect(countValue(42, 1100)).toBe(42);
    expect(countValue(42, 5000)).toBe(42);
    expect(countValue(42, 550)).toBeGreaterThan(21);
    expect(countValue(0, 500)).toBe(0);
  });
});

import { shouldStartEntry, ENTRY_WINDOW_MS } from './motion';
describe('shouldStartEntry', () => {
  it('starts once on loading -> loaded', () => {
    expect(shouldStartEntry(true, false, false, false)).toBe(true);
    expect(shouldStartEntry(true, false, true, false)).toBe(false);
    expect(shouldStartEntry(false, false, false, false)).toBe(false);
    expect(shouldStartEntry(true, true, false, false)).toBe(false);
  });
  it('never under reduced motion', () => {
    expect(shouldStartEntry(true, false, false, true)).toBe(false);
  });
  it('window covers the longest animation', () => {
    expect(ENTRY_WINDOW_MS).toBeGreaterThanOrEqual(2340 + 200);
  });
});

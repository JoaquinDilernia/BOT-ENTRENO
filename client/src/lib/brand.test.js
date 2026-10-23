import { describe, it, expect } from 'vitest';
import { normalizeHex, brandVars } from './brand.js';

describe('brand', () => {
  it('normalizeHex', () => {
    expect(normalizeHex('#343535')).toBe('#343535');
    expect(normalizeHex('#abc')).toBe('#aabbcc');
    expect(normalizeHex('verde')).toBe('#343535');
    expect(normalizeHex('')).toBe('#343535');
    expect(normalizeHex(null)).toBe('#343535');
  });
  it('brandVars', () => {
    expect(brandVars('#343535')['--brand']).toBe('#343535');
    expect(brandVars('#000000')['--brand-soft']).toMatch(/^#[0-9a-f]{6}$/);
    expect(brandVars('#000000')['--brand-ink']).toMatch(/^#[0-9a-f]{6}$/);
  });
});

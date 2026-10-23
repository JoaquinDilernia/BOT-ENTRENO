export const DEFAULT_BRAND = '#343535';

export function normalizeHex(value, fallback = DEFAULT_BRAND) {
  if (typeof value !== 'string') return fallback;
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  const m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`;
  return fallback;
}

function mix(hex, target, amount) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return '#' + ch
    .map((c) => Math.round(c + (target - c) * amount).toString(16).padStart(2, '0'))
    .join('');
}

export function brandVars(hex) {
  const h = normalizeHex(hex);
  return {
    '--brand': h,
    '--brand-soft': mix(h, 255, 0.88),
    '--brand-ink': mix(h, 0, 0.35),
  };
}

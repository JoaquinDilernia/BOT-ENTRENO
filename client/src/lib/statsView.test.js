import { describe, it, expect } from 'vitest';
import { delta, stackedDays } from './statsView';

describe('delta', () => {
  it('porcentaje', () => {
    expect(delta(286, 255, { kind: 'pct', goodWhen: 'up' })).toEqual({ text: '+12%', good: true });
    expect(delta(200, 255, { kind: 'pct', goodWhen: 'up' })).toEqual({ text: '-22%', good: false });
  });
  it('null cuando no hay base de comparación', () => {
    expect(delta(74, 0, { kind: 'pct', goodWhen: 'up' })).toBeNull();
    expect(delta(5, null, { kind: 'pct', goodWhen: 'up' })).toBeNull();
    expect(delta(5, undefined, { kind: 'pct', goodWhen: 'up' })).toBeNull();
    expect(delta(null, 5, { kind: 'pct', goodWhen: 'up' })).toBeNull();
  });
  it('absoluto (puntos)', () => {
    expect(delta(26, 31, { kind: 'abs', goodWhen: 'down' })).toEqual({ text: '-5', good: true });
    expect(delta(36, 31, { kind: 'abs', goodWhen: 'down' })).toEqual({ text: '+5', good: false });
  });
  it('minutos con formato', () => {
    expect(delta(8 / 60, 10 / 60, { kind: 'min', goodWhen: 'down' })).toEqual({ text: '-2s', good: true });
    expect(delta(12, 14, { kind: 'min', goodWhen: 'down' })).toEqual({ text: '-2m', good: true });
    expect(delta(10.5, 10, { kind: 'min', goodWhen: 'down' })).toEqual({ text: '+30s', good: false });
  });
  it('sin cambio', () => {
    expect(delta(10, 10, { kind: 'pct', goodWhen: 'up' })).toEqual({ text: '=', good: true });
  });
});

describe('stackedDays', () => {
  it('team = started - resolvedByBot, mínimo 0', () => {
    expect(stackedDays([{ date: '2026-10-20', started: 10, resolvedByBot: 12 }])[0].team).toBe(0);
    expect(stackedDays([{ date: '2026-10-20', started: 10, resolvedByBot: 4 }])[0]).toMatchObject({ bot: 4, team: 6 });
  });
  it('etiquetas en español y "Hoy"', () => {
    const out = stackedDays(
      [{ date: '2026-10-19', started: 1, resolvedByBot: 1 }, { date: '2026-10-20', started: 1, resolvedByBot: 0 }],
      { today: '2026-10-20' },
    );
    expect(out.map(d => d.label)).toEqual(['Lun', 'Hoy']);
    expect(stackedDays([{ date: '2026-10-21', started: 0, resolvedByBot: 0 }], { today: '2026-10-20' })[0].label).toBe('Mié');
  });
  it('tolera valores faltantes', () => {
    expect(stackedDays([{ date: '2026-10-18' }], { today: '2026-10-20' })[0]).toEqual({ label: 'Dom', bot: 0, team: 0 });
  });
});

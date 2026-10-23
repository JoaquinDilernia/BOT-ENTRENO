import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWithinBusinessHoursAt, isWithinConfiguredHoursAt } from './businessHours.js';

test('martes 10:00 AR está dentro', () => assert.equal(isWithinBusinessHoursAt(new Date('2026-10-20T13:00:00Z')), true));
test('martes 18:00 AR está fuera (fin exclusivo)', () => assert.equal(isWithinBusinessHoursAt(new Date('2026-10-20T21:00:00Z')), false));
test('martes 08:59 AR está fuera', () => assert.equal(isWithinBusinessHoursAt(new Date('2026-10-20T11:59:00Z')), false));
test('sábado 11:00 AR está fuera con config por defecto', () => assert.equal(isWithinBusinessHoursAt(new Date('2026-10-24T14:00:00Z')), false));
test('sábado 11:00 AR está dentro si businessDays incluye 6', () => assert.equal(isWithinBusinessHoursAt(new Date('2026-10-24T14:00:00Z'), { businessDays: [1, 2, 3, 4, 5, 6] }), true));


const SAT_11_AR = new Date('2026-10-24T14:00:00Z'); // sábado 11:00 AR
const week = (overrides = {}) => ({
  monday: { open: '09:00', close: '18:00', active: true },
  tuesday: { open: '09:00', close: '18:00', active: true },
  wednesday: { open: '09:00', close: '18:00', active: true },
  thursday: { open: '09:00', close: '18:00', active: true },
  friday: { open: '09:00', close: '18:00', active: true },
  saturday: { open: '10:00', close: '14:00', active: true },
  sunday: { open: null, close: null, active: false },
  ...overrides,
});

test('stats: sábado 10-14 configurado → sábado 11:00 AR está dentro', () =>
  assert.equal(isWithinConfiguredHoursAt(SAT_11_AR, { businessHours: { schedule: week() } }), true));
test('stats: sábado 14:00 AR está fuera (cierre exclusivo)', () =>
  assert.equal(isWithinConfiguredHoursAt(new Date('2026-10-24T17:00:00Z'), { businessHours: { schedule: week() } }), false));
test('stats: día desactivado → fuera', () =>
  assert.equal(isWithinConfiguredHoursAt(SAT_11_AR, { businessHours: { schedule: week({ saturday: { open: '10:00', close: '14:00', active: false } }) } }), false));
test('stats: domingo sin horario → fuera', () =>
  assert.equal(isWithinConfiguredHoursAt(new Date('2026-10-25T14:00:00Z'), { businessHours: { schedule: week() } }), false));
test('stats: martes 17:30 AR dentro con schedule', () =>
  assert.equal(isWithinConfiguredHoursAt(new Date('2026-10-20T20:30:00Z'), { businessHours: { schedule: week() } }), true));
test('stats: sin schedule cae al horario plano (sábado fuera, martes 10 dentro)', () => {
  assert.equal(isWithinConfiguredHoursAt(SAT_11_AR, {}), false);
  assert.equal(isWithinConfiguredHoursAt(new Date('2026-10-20T13:00:00Z'), {}), true);
  assert.equal(isWithinConfiguredHoursAt(SAT_11_AR, { businessDays: [6] }), true);
});
test('bot: isWithinBusinessHoursAt ignora el schedule (sábado sigue fuera)', () =>
  assert.equal(isWithinBusinessHoursAt(SAT_11_AR, { businessHours: { schedule: week() } }), false));

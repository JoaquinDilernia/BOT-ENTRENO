import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateConversations, hadActivityInRange } from './statsAggregate.js';

const DAY = 86400000;
// Rango: lun 19/10 00:00 AR a mié 21/10 23:59:59.999 AR (3 días)
const startMs = Date.parse('2026-10-19T03:00:00Z');
const endMs = startMs + 3 * DAY - 1;
const opts = { startMs, endMs, agents: [], areas: [], botConfig: {} };

const at = (iso) => new Date(iso);

test('byBusinessHours separa por createdAt dentro del rango', () => {
  const convs = [
    { id: 'a', createdAt: at('2026-10-20T13:00:00Z') }, // mar 10:00 AR dentro
    { id: 'b', createdAt: at('2026-10-20T15:00:00Z') }, // mar 12:00 AR dentro
    { id: 'c', createdAt: at('2026-10-20T23:00:00Z') }, // mar 20:00 AR fuera
  ];
  assert.deepEqual(aggregateConversations(convs, opts).byBusinessHours, { inside: 2, outside: 1 });
});

test('conversación creada fuera del rango no cuenta en byBusinessHours', () => {
  const convs = [
    { id: 'a', createdAt: at('2026-10-10T13:00:00Z') },
    { id: 'b', createdAt: at('2026-10-20T13:00:00Z') },
  ];
  const r = aggregateConversations(convs, opts);
  assert.deepEqual(r.byBusinessHours, { inside: 1, outside: 0 });
  // 'a' solo se creó antes y no tuvo movimiento en el rango: no suma al total.
  assert.equal(r.total, 1);
  assert.equal(r.conversationsStarted, 1);
});

test('sin conversaciones devuelve ceros y botResolutionRate 0, sin NaN', () => {
  const r = aggregateConversations([], opts);
  assert.equal(r.total, 0);
  assert.equal(r.botResolutionRate, 0);
  assert.equal(r.escalationRate, 0);
  assert.equal(r.avgFirstResponseMin, null);
  assert.deepEqual(r.byBusinessHours, { inside: 0, outside: 0 });
  assert.equal(r.dailyTrend.length, 3);
});

test('resolvedByBot y resolvedByAgent coinciden con la lógica actual', () => {
  // La lógica actual separa por escalatedAt (no por mensajes admin).
  const convs = [
    { id: 'bot', status: 'resolved', createdAt: at('2026-10-20T13:00:00Z'), resolvedAt: at('2026-10-20T13:30:00Z') },
    {
      id: 'ag', status: 'resolved', createdAt: at('2026-10-20T14:00:00Z'),
      escalatedAt: at('2026-10-20T14:10:00Z'), firstAgentResponseAt: at('2026-10-20T14:20:00Z'),
      resolvedAt: at('2026-10-20T15:00:00Z'),
    },
  ];
  const r = aggregateConversations(convs, opts);
  assert.equal(r.resolvedByBot, 1);
  assert.equal(r.resolvedByAgent, 1);
  assert.equal(r.resolved, 2);
  assert.equal(r.botResolutionRate, 50);
  assert.equal(r.escalatedCount, 1);
  assert.equal(r.escalationRate, 50);
  assert.equal(r.avgFirstResponseMin, 10);
  assert.equal(r.avgResolutionMin, 45); // (30 + 60) / 2
  assert.equal(r.byStatus.resolved, 2);
  assert.deepEqual(r.dailyTrend[1], { date: '2026-10-20', started: 2, resolvedByBot: 1, escalated: 1, resolvedByAgent: 1 });
});

test('Firestore Timestamps (toDate) y atribución por agente/área', () => {
  const ts = (iso) => ({ toDate: () => new Date(iso) });
  const convs = [{
    id: 'x', channel: 'instagram', status: 'urgent', labels: ['vip'], createdAt: ts('2026-10-20T13:00:00Z'),
    messages: [
      { role: 'assistant', timestamp: ts('2026-10-20T13:01:00Z') },
      { role: 'admin', sentBy: 'a@x.com', content: 'hola', timestamp: ts('2026-10-20T13:05:00Z') },
      { role: 'admin', sentBy: 'a@x.com', content: '[Difusión] x', timestamp: ts('2026-10-20T13:06:00Z') },
    ],
  }];
  const r = aggregateConversations(convs, { ...opts, agents: [{ id: 'g1', email: 'a@x.com', name: 'Ana' }], areas: [] });
  assert.equal(r.byStatus.bot, 1); // 'urgent' legado cuenta como bot
  assert.equal(r.byChannel.instagram, 1);
  assert.deepEqual(r.labelCounts, [{ name: 'vip', count: 1 }]);
  assert.deepEqual(r.byAgent.map(a => [a.id, a.handled, a.messages]), [['bot', 1, 1], ['g1', 1, 1]]);
});

test('previousRange: "Hoy" a las 10:00 se compara con ayer 00:00–10:00', async () => {
  const { previousRange } = await import('./statsAggregate.js');
  const start = Date.parse('2026-10-21T03:00:00Z'); // 21/10 00:00 AR
  const end = Date.parse('2026-10-21T13:00:00Z');   // 21/10 10:00 AR
  const r = previousRange(start, end);
  assert.equal(r.nDays, 1);
  assert.equal(r.prevStartMs, Date.parse('2026-10-20T03:00:00Z'));
  assert.equal(r.prevEndMs, Date.parse('2026-10-20T13:00:00Z'));
});

test('previousRange: semana (6 días + hoy parcial) corre 7 días', async () => {
  const { previousRange } = await import('./statsAggregate.js');
  const start = Date.parse('2026-10-15T03:00:00Z');
  const end = Date.parse('2026-10-21T13:00:00Z');
  const r = previousRange(start, end);
  assert.equal(r.nDays, 7);
  assert.equal(r.prevStartMs, start - 7 * DAY);
  assert.equal(r.prevEndMs, end - 7 * DAY);
});

test('previousRange: rango custom de días completos y rango vacío', async () => {
  const { previousRange } = await import('./statsAggregate.js');
  const start = Date.parse('2026-10-01T03:00:00Z');
  const end = start + 10 * DAY - 1; // 10 días completos
  assert.equal(previousRange(start, end).nDays, 10);
  assert.equal(previousRange(start, start).nDays, 1);
});

test('el período cuenta lo que pasó en él aunque la charla se haya movido después', () => {
  // Resuelta por el bot dentro del rango; el cliente volvió a escribir después
  // (updatedAt fuera del rango). Antes, filtrando por updatedAt, desaparecía.
  const conv = {
    id: 'r', status: 'bot',
    createdAt: at('2026-10-19T15:00:00Z'), resolvedAt: at('2026-10-19T16:00:00Z'), updatedAt: at('2026-10-25T12:00:00Z'),
    messages: [
      { role: 'user', timestamp: at('2026-10-19T15:00:00Z') },
      { role: 'assistant', timestamp: at('2026-10-19T15:01:00Z') },
      { role: 'user', timestamp: at('2026-10-25T12:00:00Z') },
    ],
  };
  const r = aggregateConversations([conv], opts);
  assert.equal(r.total, 1);
  assert.equal(r.resolvedByBot, 1);
});

test('hadActivityInRange: un mensaje o un cambio de estado en el rango cuenta; nada en el rango, no', () => {
  assert.equal(hadActivityInRange({ messages: [{ timestamp: at('2026-10-20T15:00:00Z') }] }, startMs, endMs), true);
  assert.equal(hadActivityInRange({ escalatedAt: at('2026-10-20T15:00:00Z') }, startMs, endMs), true);
  assert.equal(hadActivityInRange({ createdAt: at('2026-10-10T15:00:00Z'), updatedAt: at('2026-10-20T15:00:00Z') }, startMs, endMs), false);
});

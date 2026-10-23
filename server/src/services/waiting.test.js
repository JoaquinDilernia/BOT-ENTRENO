import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWaiting, agentKeySet, waitingSummary } from './waiting.js';

const agents = [{ id: 'ag1', email: 'ana@techdi.com' }];
const keys = agentKeySet(agents);

test('escalada sin asignar y sin respuesta: espera', () => {
  assert.equal(isWaiting({ status: 'escalated', humanMode: true, assignedTo: null }, keys), true);
});

test('derivada a un área (id que no es agente): espera', () => {
  assert.equal(isWaiting({ status: 'escalated', humanMode: true, assignedTo: 'area-ventas' }, keys), true);
});

test('asignada a un agente por id o por email: no espera', () => {
  assert.equal(isWaiting({ status: 'escalated', humanMode: true, assignedTo: 'ag1' }, keys), false);
  assert.equal(isWaiting({ status: 'escalated', humanMode: true, assignedTo: 'ana@techdi.com' }, keys), false);
});

test('derivada a área pero ya respondió alguien del equipo: no espera', () => {
  const conv = { status: 'escalated', humanMode: true, assignedTo: 'area-ventas', firstAgentResponseAt: new Date() };
  assert.equal(isWaiting(conv, keys), false);
});

test('legado: status bot + humanMode cuenta como escalada', () => {
  assert.equal(isWaiting({ status: 'bot', humanMode: true }, keys), true);
  assert.equal(isWaiting({ status: 'bot', humanMode: false }, keys), false);
  assert.equal(isWaiting({ humanMode: false }, keys), false);
});

test('cerradas nunca esperan', () => {
  assert.equal(isWaiting({ status: 'resolved', humanMode: true }, keys), false);
  assert.equal(isWaiting({ status: 'bot_archived', humanMode: true }, keys), false);
});

test('waitingSummary usa waitingSince ?? escalatedAt y minutos enteros', () => {
  const now = new Date('2026-10-21T13:00:00Z');
  const convs = [
    { status: 'escalated', escalatedAt: new Date('2026-10-21T12:30:00Z') }, // 30 min
    { status: 'escalated', escalatedAt: new Date('2026-10-21T11:00:00Z'), waitingSince: new Date('2026-10-21T12:49:30Z') }, // 10 min
    { status: 'escalated', assignedTo: 'ag1', escalatedAt: new Date('2026-10-21T08:00:00Z') }, // tomada: no cuenta
    { status: 'escalated', escalatedAt: { toDate: () => new Date('2026-10-21T12:00:00Z') }, firstAgentResponseAt: new Date() }, // respondida
  ];
  assert.deepEqual(waitingSummary(convs, agents, now), { count: 2, oldestMin: 30 });
});

test('waitingSummary sin esperas devuelve 0 y null', () => {
  assert.deepEqual(waitingSummary([], agents), { count: 0, oldestMin: null });
});

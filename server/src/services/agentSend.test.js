import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentSendPatch } from './agentSend.js';

const AGENT = 'franco@entreno.com.ar';

test('chat en modo bot: el agente que escribe lo toma y el bot se pausa', () => {
  assert.deepEqual(agentSendPatch({ status: 'bot', humanMode: false }, AGENT), {
    status: 'escalated', humanMode: true, assignedTo: AGENT, escalationReason: 'equipo_toma',
  });
});

test('chat archivado o resuelto: se reabre a nombre del agente', () => {
  for (const status of ['resolved', 'bot_archived']) {
    assert.deepEqual(agentSendPatch({ status, humanMode: false }, AGENT), {
      status: 'escalated', humanMode: true, assignedTo: AGENT, escalationReason: 'equipo_inicio',
    });
  }
});

test('chat ya en manos de un humano: no se toca (no pisa la asignación)', () => {
  assert.equal(agentSendPatch({ status: 'escalated', humanMode: true, assignedTo: 'otra@entreno.com.ar' }, AGENT), null);
});

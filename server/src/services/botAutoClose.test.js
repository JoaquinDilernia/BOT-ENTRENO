import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoCloseAt, BOT_IDLE_CLOSE_MS } from './botAutoClose.js';

const NOW = Date.parse('2026-10-26T20:00:00Z');
const old = new Date(NOW - BOT_IDLE_CLOSE_MS - 1000);
const fresh = new Date(NOW - 60 * 1000);

test('cierra la charla del bot inactiva y usa el último mensaje como resolvedAt', () => {
  const conv = { status: 'bot', messages: [{ role: 'user', timestamp: old }, { role: 'assistant', timestamp: old }] };
  assert.deepEqual(autoCloseAt(conv, NOW), old);
});

test('no cierra si todavía está activa', () => {
  const conv = { status: 'bot', messages: [{ role: 'user', timestamp: fresh }, { role: 'assistant', timestamp: fresh }] };
  assert.equal(autoCloseAt(conv, NOW), null);
});

test('no cierra si el último mensaje es del cliente (quedó sin respuesta)', () => {
  const conv = { status: 'bot', messages: [{ role: 'assistant', timestamp: old }, { role: 'user', timestamp: old }] };
  assert.equal(autoCloseAt(conv, NOW), null);
});

test('no toca derivadas, humanMode ni ya cerradas', () => {
  const msgs = [{ role: 'user', timestamp: old }, { role: 'assistant', timestamp: old }];
  assert.equal(autoCloseAt({ status: 'escalated', messages: msgs }, NOW), null);
  assert.equal(autoCloseAt({ status: 'bot', humanMode: true, messages: msgs }, NOW), null);
  assert.equal(autoCloseAt({ status: 'bot_archived', messages: msgs }, NOW), null);
});

test('no cierra si el bot nunca respondió', () => {
  const conv = { status: 'bot', messages: [{ role: 'user', timestamp: old }, { role: 'admin', timestamp: old }] };
  assert.equal(autoCloseAt(conv, NOW), null);
});

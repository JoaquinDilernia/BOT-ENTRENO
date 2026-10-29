import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyToMessages } from './historyMessages.js';

test('el mensaje de un agente se marca como del equipo, no del bot', () => {
  const out = historyToMessages([
    { role: 'user', content: 'está mal el domicilio' },
    { role: 'assistant', content: 'Le paso tu consulta al equipo' },
    { role: 'admin', content: 'Buenas! Ya te hicimos el cambio', sentBy: 'franco@entreno.com.ar' },
  ]);
  assert.deepEqual(out[2], {
    role: 'assistant',
    content: '[Mensaje de una persona del equipo de Entreno, no tuyo] Buenas! Ya te hicimos el cambio',
  });
});

test('usuario, bot y audio transcripto quedan como antes', () => {
  const out = historyToMessages([
    { role: 'user', content: '[Audio recibido]', transcript: 'hola' },
    { role: 'assistant', content: 'Hola!' },
  ]);
  assert.deepEqual(out, [
    { role: 'user', content: '[Audio transcripto] hola' },
    { role: 'assistant', content: 'Hola!' },
  ]);
});

test('solo toma los últimos 10', () => {
  const hist = Array.from({ length: 15 }, (_, i) => ({ role: 'user', content: String(i) }));
  const out = historyToMessages(hist);
  assert.equal(out.length, 10);
  assert.equal(out[0].content, '5');
});

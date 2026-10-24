import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReasonMarker } from './escalationReasons.js';

test('lee categoría y detalle y saca la línea del marcador', () => {
  const r = parseReasonMarker('Te paso con el equipo para ver tu envío.\n[ESCALAR]\n[MOTIVO:pedido_envio|pedido 1234 no llegó]');
  assert.equal(r.reason, 'pedido_envio');
  assert.equal(r.detail, 'pedido 1234 no llegó');
  assert.equal(r.cleanText, 'Te paso con el equipo para ver tu envío.\n[ESCALAR]');
});

test('sin detalle, mayúsculas y categoría desconocida', () => {
  assert.equal(parseReasonMarker('[MOTIVO:RECLAMO]').reason, 'reclamo');
  assert.equal(parseReasonMarker('[MOTIVO:reclamo]').detail, null);
  assert.equal(parseReasonMarker('Hola [MOTIVO:cualquiera|x]').reason, 'otro');
  assert.equal(parseReasonMarker('Hola [MOTIVO:cualquiera|x]').cleanText, 'Hola');
});

test('sin marcador no toca el texto', () => {
  assert.deepEqual(parseReasonMarker('Te paso con alguien.'), { reason: null, detail: null, cleanText: 'Te paso con alguien.' });
});

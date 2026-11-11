import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrderRecipients } from './campaign.service.js';

test('agrupa pedidos del mismo teléfono escrito de formas distintas', () => {
  const { recipients, skipped } = buildOrderRecipients([
    { number: 24382, phone: '+541124822006', name: 'Ana' },
    { number: '#24381', phone: '5491124822006', name: null },
    { number: 24366, phone: '+543435210241', name: 'Beto' },
  ]);
  assert.equal(recipients.length, 2);
  assert.deepEqual(recipients[0], { contactId: '5491124822006', contactName: 'Ana', orderNumbers: ['24382', '24381'], channel: 'whatsapp' });
  assert.equal(recipients[1].contactId, '5493435210241');
  assert.deepEqual(skipped, []);
});

test('descarta pedidos sin teléfono válido y los informa', () => {
  const { recipients, skipped } = buildOrderRecipients([
    { number: 1, phone: null },
    { number: 2, phone: '123' },
    { number: 3, phone: '1131370982', name: 'Caro' },
  ]);
  assert.deepEqual(recipients.map(r => r.contactId), ['5491131370982']);
  assert.deepEqual(skipped, ['1', '2']);
});

test('no repite el mismo número de pedido', () => {
  const { recipients } = buildOrderRecipients([
    { number: 5, phone: '1131370982' },
    { number: 5, phone: '1131370982' },
  ]);
  assert.deepEqual(recipients[0].orderNumbers, ['5']);
});

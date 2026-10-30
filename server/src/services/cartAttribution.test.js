import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCartOrder, assignCartOrders, isCartExpired, buildOwnerNote, withCartUtm, OWNER_NOTE_MARK } from './cartAttribution.js';

const cart = {
  contactId: '5491164212370',
  createdAt: new Date('2026-10-23T12:00:00Z'),
  items: [{ variantId: 101, quantity: 1 }, { variantId: 202, quantity: 2 }],
};
const order = (over = {}) => ({
  id: 1, number: 500, payment_status: 'paid', created_at: '2026-10-23T15:00:00+0000',
  customer: { phone: '1164212370' }, products: [{ variant_id: 202 }], ...over,
});

test('matchea pedido pagado, mismo teléfono (otro formato) y al menos una variante', () => {
  assert.equal(findCartOrder(cart, [order()])?.number, 500);
});

test('el teléfono puede venir en contacto, facturación o envío', () => {
  const o = order({ customer: {}, shipping_address: { phone: '+54 9 11 6421-2370' } });
  assert.equal(findCartOrder(cart, [o])?.number, 500);
});

test('no matchea: no pagado, otro teléfono, sin variantes en común, antes o fuera de ventana', () => {
  assert.equal(findCartOrder(cart, [order({ payment_status: 'pending' })]), null);
  assert.equal(findCartOrder(cart, [order({ customer: { phone: '1133334444' } })]), null);
  assert.equal(findCartOrder(cart, [order({ products: [{ variant_id: 999 }] })]), null);
  assert.equal(findCartOrder(cart, [order({ created_at: '2026-10-22T15:00:00+0000' })]), null);
  assert.equal(findCartOrder(cart, [order({ created_at: '2026-10-31T15:00:00+0000' })]), null);
});

test('si hay varios pedidos que matchean, toma el primero después del carrito', () => {
  const later = order({ number: 502, created_at: '2026-10-25T10:00:00+0000' });
  const first = order({ number: 501, created_at: '2026-10-24T10:00:00+0000' });
  assert.equal(findCartOrder(cart, [later, first])?.number, 501);
});

test('varios carritos y una sola compra: el pedido va a un solo carrito (el último antes de comprar)', () => {
  const carts = ['c1', 'c2', 'c3', 'c4'].map((id, i) => ({ ...cart, id, createdAt: new Date(Date.parse('2026-10-23T08:00:00Z') + i * 3600000) }));
  const assigned = assignCartOrders(carts, [order({ created_at: '2026-10-23T15:00:00+0000' })]);
  assert.deepEqual([...assigned.keys()], ['c4']);
});

test('dos compras: cada una a un carrito distinto, y no reusa pedidos ya atribuidos', () => {
  const c1 = { ...cart, id: 'c1', createdAt: new Date('2026-10-23T08:00:00Z') };
  const c2 = { ...cart, id: 'c2', createdAt: new Date('2026-10-24T08:00:00Z') };
  const o1 = order({ id: 1, number: 501, created_at: '2026-10-23T15:00:00+0000' });
  const o2 = order({ id: 2, number: 502, created_at: '2026-10-24T15:00:00+0000' });
  const assigned = assignCartOrders([c1, c2], [o1, o2]);
  assert.equal(assigned.get('c1')?.number, 501);
  assert.equal(assigned.get('c2')?.number, 502);
  assert.equal(assignCartOrders([c1], [o1], new Set(['1'])).size, 0);
});

test('acepta Timestamp de Firestore en createdAt', () => {
  const c = { ...cart, createdAt: { _seconds: Date.parse('2026-10-23T12:00:00Z') / 1000 } };
  assert.equal(findCartOrder(c, [order()])?.number, 500);
});

test('vence a los 7 días', () => {
  assert.equal(isCartExpired(cart, new Date('2026-10-29T12:00:00Z')), false);
  assert.equal(isCartExpired(cart, new Date('2026-10-30T12:00:01Z')), true);
});

test('nota del pedido: agrega sin pisar y no duplica', () => {
  const nueva = buildOwnerNote('', cart);
  assert.ok(nueva.startsWith(OWNER_NOTE_MARK));
  assert.match(nueva, /23\/10\/2026/);
  assert.equal(buildOwnerNote('Cliente mayorista', cart).split('\n')[0], 'Cliente mayorista');
  assert.equal(buildOwnerNote(nueva, cart), null);
});

test('UTM del bot en el link del carrito', () => {
  assert.equal(
    withCartUtm('https://altorancho.com/cart-link/1-1,2-3'),
    'https://altorancho.com/cart-link/1-1,2-3?utm_source=whatsapp&utm_medium=bot&utm_campaign=carrito_bot',
  );
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCartLink, createCartLink } from './cart.js';

const PRODUCTS = {
  10: {
    id: 10, name: { es: 'ENA Colageno Sport 407 GRS' }, published: true,
    canonical_url: 'https://www.entreno.com.ar/productos/ena-colageno-sport/',
    variants: [
      { id: 101, values: [{ es: 'Naranja' }], stock_management: true, stock: 5 },
      { id: 102, values: [{ es: 'Fruit Punch' }], stock_management: true, stock: 0 },
    ],
  },
  20: {
    id: 20, name: { es: 'STAR NUTRITION WHEY PROTEIN 2LB' }, published: true,
    canonical_url: 'https://www.entreno.com.ar/productos/star-whey/',
    variants: [{ id: 201, values: [{ es: 'Vainilla' }], stock_management: false, stock: null }],
  },
  30: { id: 30, name: 'Oculto', published: false, canonical_url: 'https://www.entreno.com.ar/productos/oculto/', variants: [{ id: 301, stock: 3 }] },
};
const getProduct = async id => PRODUCTS[id] ?? null;

test('buildCartLink arma el formato cart-link de TiendaNube', () => {
  assert.equal(
    buildCartLink('https://www.entreno.com.ar/', [{ variantId: 1, quantity: 1 }, { variantId: 2, quantity: 3 }]),
    'https://www.entreno.com.ar/cart-link/1-1,2-3',
  );
});

test('arma el link con varios productos y toma la tienda de canonical_url', async () => {
  const r = await createCartLink([
    { producto_id: 20, variante_id: 201, cantidad: 1 },
    { producto_id: 10, variante_id: 101, cantidad: 2 },
  ], getProduct);
  assert.equal(r.link, 'https://www.entreno.com.ar/cart-link/201-1,101-2');
  assert.deepEqual(r.detalle, ['1 x STAR NUTRITION WHEY PROTEIN 2LB (Vainilla)', '2 x ENA Colageno Sport 407 GRS (Naranja)']);
});

test('suma cantidades si la misma variante viene dos veces', async () => {
  const r = await createCartLink([
    { producto_id: 10, variante_id: 101, cantidad: 1 },
    { producto_id: 10, variante_id: 101, cantidad: 1 },
  ], getProduct);
  assert.equal(r.link, 'https://www.entreno.com.ar/cart-link/101-2');
});

test('no arma carrito si una variante está sin stock', async () => {
  const r = await createCartLink([
    { producto_id: 20, variante_id: 201, cantidad: 1 },
    { producto_id: 10, variante_id: 102, cantidad: 1 },
  ], getProduct);
  assert.match(r.error, /Fruit Punch\): sin stock/);
  assert.equal(r.link, undefined);
});

test('no arma carrito si pide más unidades que el stock', async () => {
  const r = await createCartLink([{ producto_id: 10, variante_id: 101, cantidad: 6 }], getProduct);
  assert.match(r.error, /no hay stock para 6/);
});

test('rechaza variante ajena, producto inexistente u oculto', async () => {
  assert.match((await createCartLink([{ producto_id: 10, variante_id: 201, cantidad: 1 }], getProduct)).error, /no pertenece/);
  assert.match((await createCartLink([{ producto_id: 99, variante_id: 1, cantidad: 1 }], getProduct)).error, /no existe/);
  assert.match((await createCartLink([{ producto_id: 30, variante_id: 301, cantidad: 1 }], getProduct)).error, /no está publicado/);
});

test('rechaza entrada vacía, ids no numéricos y cantidades inválidas', async () => {
  assert.ok((await createCartLink([], getProduct)).error);
  assert.ok((await createCartLink([{ producto_id: 'abc', variante_id: 101 }], getProduct)).error);
  assert.ok((await createCartLink([{ producto_id: 10, variante_id: 101, cantidad: 0 }], getProduct)).error);
  assert.match((await createCartLink([{ producto_id: 20, variante_id: 201, cantidad: 50 }], getProduct)).error, /máximo/);
});

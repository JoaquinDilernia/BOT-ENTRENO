import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toWaContactId } from './phone.js';

const CANON = '5491149790026'; // forma canónica del número 11 4979-0026

test('deja intacto el formato canónico (idempotente)', () => {
  assert.equal(toWaContactId(CANON), CANON);
  assert.equal(toWaContactId(toWaContactId(CANON)), CANON);
});

test('Meta sin el 9 de celular -> agrega el 9', () => {
  // El bug reportado: Meta manda el "from" sin el 9 y se crea un chat nuevo.
  assert.equal(toWaContactId('541149790026'), CANON);
});

test('Meta con el 9 de celular -> sin cambios', () => {
  assert.equal(toWaContactId('5491149790026'), CANON);
});

test('número local de 10 dígitos (área + abonado)', () => {
  assert.equal(toWaContactId('1149790026'), CANON);
});

test('con 0 troncal', () => {
  assert.equal(toWaContactId('01149790026'), CANON);
  assert.equal(toWaContactId('091149790026'), CANON);
});

test('con +, espacios y guiones', () => {
  assert.equal(toWaContactId('+54 9 11 4979-0026'), CANON);
  assert.equal(toWaContactId('+54 11 4979 0026'), CANON);
  assert.equal(toWaContactId(' 11-4979-0026 '), CANON);
});

test('con prefijo internacional 00', () => {
  assert.equal(toWaContactId('005491149790026'), CANON);
  assert.equal(toWaContactId('00541149790026'), CANON);
});

test('con 0 troncal y 15 de celular entre área y abonado', () => {
  assert.equal(toWaContactId('011 15 4979-0026'), CANON);
  assert.equal(toWaContactId('0111549790026'), CANON);
});

test('con 15 al principio (sin área) -> asume Bs. As. (11)', () => {
  assert.equal(toWaContactId('1549790026'), CANON);
});

test('NO manglea el "15" que es parte del número real (bug de Córdoba/Tucumán)', () => {
  // 351 = área de Córdoba, abonado 5163920 arranca con 5 -> el "351 5" NO es
  // un "15" de celular. Antes esto se rompía a 54935163920 (número inválido).
  assert.equal(toWaContactId('5493515163920'), '5493515163920');
  assert.equal(toWaContactId('543515163920'),  '5493515163920');
  assert.equal(toWaContactId('03515163920'),   '5493515163920');
  // 381 = Tucumán
  assert.equal(toWaContactId('5493815141631'), '5493815141631');
  assert.equal(toWaContactId('543815141631'),  '5493815141631');
  // Bs. As. con abonado que arranca con 15
  assert.equal(toWaContactId('541115234567'),  '5491115234567');
  assert.equal(toWaContactId('5491115234567'), '5491115234567');
});

test('SÍ saca el "15" de celular en discado local <área>15<abonado> (total 12)', () => {
  // 0351 15 5163920 -> Córdoba, abonado 5163920
  assert.equal(toWaContactId('0351155163920'), '5493515163920');
  // +54 351 15 5163920
  assert.equal(toWaContactId('54351155163920'), '5493515163920');
  // Bs. As.: 011 15 4979-0026
  assert.equal(toWaContactId('01115' + '49790026'), CANON);
});

test('el ejemplo del ticket: ambos documentos colapsan al mismo id', () => {
  const docPlantilla = '549114979026'; // creado por el aviso de retiro
  const docRespuesta = '54114979026';  // creado por el webhook entrante
  assert.equal(toWaContactId(docPlantilla), toWaContactId(docRespuesta));
});

test('números del exterior se devuelven sin tocar', () => {
  assert.equal(toWaContactId('598991234567'), '598991234567');   // Uruguay
  assert.equal(toWaContactId('14155551234'), '14155551234');     // EE.UU.
  assert.equal(toWaContactId('+1 415 555 1234'), '14155551234');
});

test('entradas inválidas -> null', () => {
  assert.equal(toWaContactId(null), null);
  assert.equal(toWaContactId(undefined), null);
  assert.equal(toWaContactId(''), null);
  assert.equal(toWaContactId('   '), null);
  assert.equal(toWaContactId('abc'), null);
});

test('acepta number además de string', () => {
  assert.equal(toWaContactId(1149790026), CANON);
});

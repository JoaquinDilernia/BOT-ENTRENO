import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endsWithQuestion } from './closeGuard.js';

test('detecta pregunta al final, con emojis o formato atrás', () => {
  assert.equal(endsWithQuestion('Listo. ¿Te ayudo con algo más?'), true);
  assert.equal(endsWithQuestion('¿Te copo alguna de estas o buscás algo específico? 💪'), true);
  assert.equal(endsWithQuestion('¿Querés que te pase el *link*?*  '), true);
  assert.equal(endsWithQuestion('¿Algo más? 👍🏻\n'), true);
});

test('no es pregunta si termina en otra cosa', () => {
  assert.equal(endsWithQuestion('¡Con mucho gusto! Si necesitás algo más, escribinos cuando quieras.'), false);
  assert.equal(endsWithQuestion('¿Viste la web? Ahí está todo. ¡Saludos! 💪'), false);
  assert.equal(endsWithQuestion(''), false);
});

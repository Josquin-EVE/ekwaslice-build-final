const { test } = require('node:test');
const assert = require('node:assert');
const { parsePrismicDocId } = require('../lib/prismic-slice.js');

test('parsePrismicDocId: URL builder avec query', () => {
  assert.strictEqual(
    parsePrismicDocId('https://ekwateur-edito.prismic.io/builder/pages/aamJGhAAACQALA7F?s=unclassified'),
    'aamJGhAAACQALA7F'
  );
});
test('parsePrismicDocId: id brut', () => {
  assert.strictEqual(parsePrismicDocId('aamJGhAAACQALA7F'), 'aamJGhAAACQALA7F');
});
test('parsePrismicDocId: vide/invalide', () => {
  assert.strictEqual(parsePrismicDocId(''), null);
  assert.strictEqual(parsePrismicDocId('   '), null);
  assert.strictEqual(parsePrismicDocId('pas un id'), null);
});

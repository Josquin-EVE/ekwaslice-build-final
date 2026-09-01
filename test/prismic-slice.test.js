const { test } = require('node:test');
const assert = require('node:assert');
const { parsePrismicDocId, buildVerbatimSliceHTML, extractTrioFromClaudeResult } = require('../lib/prismic-slice.js');

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

test('buildVerbatimSliceHTML: champs séparés', () => {
  const out = buildVerbatimSliceHTML({ html_only: '<p>Bonjour</p>', css: '.x{color:red}', js: 'console.log(1)' });
  assert.match(out, /^<div>/);
  assert.match(out, /<style>\.x\{color:red\}<\/style>/);
  assert.match(out, /<p>Bonjour<\/p>/);
  assert.match(out, /<script type="text\/ekw-js">console\.log\(1\)<\/script>/);
});
test('buildVerbatimSliceHTML: tout dans html avec script → neutralisé', () => {
  const out = buildVerbatimSliceHTML({ html: '<div id="r"></div><script>init()<\/script>' });
  assert.match(out, /<script type="text\/ekw-js">init\(\)<\/script>/);
  assert.doesNotMatch(out, /<script>/); // plus aucun script brut
});
test('buildVerbatimSliceHTML: vide', () => {
  assert.strictEqual(buildVerbatimSliceHTML({}), '<div></div>');
});
test('buildVerbatimSliceHTML: script déjà typé non doublé', () => {
  const out = buildVerbatimSliceHTML({ html: '<script type="application/json">{}<\/script>' });
  assert.match(out, /<script type="application\/json">/);
});

test('extractTrio: bloc json fencé', () => {
  const txt = 'Voici le doc :\n```json\n{"title":"T","documentId":"d1","baseVersionId":"v1","html_only":"<p>x</p>","css":"","js":""}\n```\nfini';
  const o = extractTrioFromClaudeResult(txt);
  assert.strictEqual(o.documentId, 'd1');
  assert.strictEqual(o.baseVersionId, 'v1');
  assert.strictEqual(o.html_only, '<p>x</p>');
});
test('extractTrio: json brut', () => {
  const o = extractTrioFromClaudeResult('{"html":"<div></div>","css":"a{}"}');
  assert.strictEqual(o.css, 'a{}');
});
test('extractTrio: pas de trio → null', () => {
  assert.strictEqual(extractTrioFromClaudeResult('aucun json ici'), null);
  assert.strictEqual(extractTrioFromClaudeResult('{"foo":1}'), null);
});

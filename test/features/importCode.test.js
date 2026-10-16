import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDom } from '../helpers/dom.js';
import { SliceStore } from '../../src/core/store.js';
import { serializeSlice } from '../../src/core/slice.js';
import { flattenCssToInline, buildImportHtml, initImportCode } from '../../src/features/importCode.js';

const PAGE = '<!doctype html><html><head></head><body><div id="canvas"></div>'
  + '<div id="importModal"></div><textarea id="imp-html"></textarea><textarea id="imp-css"></textarea><textarea id="imp-js"></textarea></body></html>';

test('flattenCssToInline : règle simple -> inline ; pseudo/@media -> résiduel scopé !important ; style inline d\'origine gagne', () => {
  const env = withDom(PAGE);
  try {
    const root = env.document.createElement('div');
    root.innerHTML = '<p class="a" style="color:red">x</p><p class="b">y</p>';
    const css = '.a{color:blue;margin:0} .b{font-weight:700} .b:hover{color:green} @media (max-width:600px){.b{display:none}}';
    const residual = flattenCssToInline(css, root, 'sc', env.document);
    const [a, b] = root.querySelectorAll('p');
    assert.equal(a.style.color, 'red');                 // inline d'origine préservé
    assert.equal(a.style.margin, '0px');                // règle aplatie
    assert.equal(b.style.fontWeight, '700');
    assert.match(residual, /\.sc \.b:hover\{color:green !important;\}/);
    assert.match(residual, /@media[^{]*max-width: ?600px[^{]*\{\.sc \.b\{display:none !important;\}\}/);
    assert.equal(env.document.head.querySelectorAll('style').length, 0); // <style> temporaire retiré
  } finally { env.cleanup(); }
});

test('flattenCssToInline : css vide -> chaîne vide, root intact', () => {
  const env = withDom(PAGE);
  try {
    const root = env.document.createElement('div');
    root.innerHTML = '<p>x</p>';
    assert.equal(flattenCssToInline('  ', root, 'sc', env.document), '');
    assert.equal(root.innerHTML, '<p>x</p>');
  } finally { env.cleanup(); }
});

test('buildImportHtml : <style>/<script> collés répartis ; enveloppe scopée ; script ekw-js', () => {
  const env = withDom(PAGE);
  try {
    const r = buildImportHtml({
      html: '<style>.t{color:blue} .t:hover{color:red}</style><h2 class="t">Hi</h2><script>window.x=1</script>',
      css: '', js: '',
    }, env.document, 'eks-imp-test');
    assert.equal(r.error, undefined);
    const w = env.document.createElement('div');
    w.innerHTML = r.html;
    const wrap = w.firstElementChild;
    assert.equal(wrap.className, 'eks-imp-test');
    assert.equal(wrap.querySelector('h2').style.color, 'blue');                 // aplati
    assert.match(wrap.querySelector('style').textContent, /\.eks-imp-test \.t:hover/); // résiduel scopé
    const sc = wrap.querySelector('script');
    assert.equal(sc.type, 'text/ekw-js');
    assert.equal(sc.textContent, 'window.x=1');
  } finally { env.cleanup(); }
});

test('buildImportHtml : entrées vides -> erreurs', () => {
  const env = withDom(PAGE);
  try {
    assert.equal(buildImportHtml({ html: ' ', css: '', js: '' }, env.document).error, 'vide');
    assert.equal(buildImportHtml({ html: '<style>.a{color:red}</style>' }, env.document).error, 'html-vide');
  } finally { env.cleanup(); }
});

test("doImport : store.add(html,'code') ; sélection ; champs vidés ; modale fermée ; slice sérialisable", () => {
  const env = withDom(PAGE);
  try {
    const store = new SliceStore(env.document.getElementById('canvas'));
    const toasts = []; const selected = []; let deselected = 0;
    const calls = [];
    const origAdd = store.add.bind(store);
    store.add = (html, origin, meta) => { calls.push({ origin, meta }); return origAdd(html, origin, meta); };
    const imp = initImportCode(store, {
      document: env.document,
      editing: { deselect: () => { deselected += 1; }, selectElement: (el) => selected.push(el) },
      hooks: { toast: (m) => toasts.push(m) },
    });
    env.document.getElementById('imp-html').value = '<h2 class="t">Hello</h2>';
    env.document.getElementById('imp-css').value = '.t{color:blue}';
    const s = imp.doImport();
    assert.ok(s);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].origin, 'code');
    assert.equal(store.list().length, 1);
    assert.equal(s.origin, 'code');
    assert.equal(deselected, 1);
    assert.deepEqual(selected, [s.root]);
    assert.equal(env.document.getElementById('imp-html').value, '');
    assert.equal(env.document.getElementById('imp-css').value, '');
    assert.ok(env.document.getElementById('importModal').classList.contains('hidden'));
    assert.match(serializeSlice(s), /<h2 class="t" style="color: ?blue;?">Hello<\/h2>/);
    assert.equal(toasts.at(-1), 'Composant importé (CSS aplati en inline)');
  } finally { env.cleanup(); }
});

test('doImport : champs vides -> aucune slice, toast', () => {
  const env = withDom(PAGE);
  try {
    const store = new SliceStore(env.document.getElementById('canvas'));
    const toasts = [];
    const imp = initImportCode(store, { document: env.document, hooks: { toast: (m) => toasts.push(m) } });
    assert.equal(imp.doImport(), null);
    assert.equal(store.list().length, 0);
    assert.deepEqual(toasts, ['Colle au moins du HTML.']);
  } finally { env.cleanup(); }
});

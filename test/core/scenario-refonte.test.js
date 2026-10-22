import test from 'node:test';
import assert from 'node:assert/strict';
import { withDom } from '../helpers/dom.js';
import { SliceStore } from '../../src/core/store.js';
import { exportSlice } from '../../src/core/export.js';
import { History } from '../../src/core/history.js';

// Batterie anti-regression inter-modules : rejoue les bugs d'origine de la
// refonte (fantomes apres suppression, selecteur JS par classe casse a
// l'export) de bout en bout a travers le vrai store + export ensemble.

function canvasDom() {
  const d = withDom('<!doctype html><html><body><div id="canvas"></div></body></html>');
  return { d, canvas: d.document.getElementById('canvas') };
}

test('bug origine: import -> remove -> add -> une seule slice, zero coquille/fantome', () => {
  const { d, canvas } = canvasDom();
  try {
    const store = new SliceStore(canvas);
    const imported = '<div class="pricing"><style>.pricing{color:red}</style>'
      + '<script type="text/ekw-js">console.log("old")</script><p>PRIX</p></div>';
    const a = store.add(imported, 'imported', { prismicId: 'DOC1', prismicField: 'html_only' });
    assert.equal(store.list().length, 1);
    store.remove(a.id);
    assert.equal(store.list().length, 0, 'liste vide apres remove');
    assert.equal(canvas.querySelectorAll('[data-comp]').length, 0, 'zero coquille [data-comp]');
    assert.equal(canvas.innerHTML.trim(), '', 'canvas DOM vide (pas de fantome)');
    store.add('<div class="carousel-track"><p>NOUVEAU</p></div>', 'generated');
    assert.equal(store.list().length, 1, 'une seule slice');
    const ser = store.serialize();
    assert.equal(ser.length, 1);
    const allHtml = ser.map(s => s.html).join('\n');
    assert.ok(!/DOC1|data-remote-id|pricing|PRIX|console\.log\("old"\)/.test(allHtml),
      'aucun residu de la slice supprimee');
    assert.ok(/NOUVEAU/.test(allHtml));
    assert.equal((allHtml.match(/text\/ekw-js/g) || []).length, 0, 'pas de script fantome');
  } finally { d.cleanup(); }
});

test('carrousel: selecteur JS par classe survit a l\'export (meme alias HTML+JS)', () => {
  const { d, canvas } = canvasDom();
  try {
    const store = new SliceStore(canvas);
    const html = '<div class="carousel-track"><span class="dot"></span>'
      + '<script type="text/ekw-js">var t=document.querySelector(".carousel-track");</script></div>';
    const s = store.add(html, 'generated');
    const rules = [
      { media: '', selector: '.carousel-track', body: 'display:flex' },
      { media: '', selector: '.dot', body: 'width:8px' },
    ];
    const out = exportSlice(s, { collectCssRules: () => rules });
    const htmlAliases = [...out.html.matchAll(/eks-[a-z0-9]+-\d+/g)].map(x => x[0]);
    const jsAliases = [...out.js.matchAll(/eks-[a-z0-9]+-\d+/g)].map(x => x[0]);
    assert.ok(htmlAliases.length >= 1, 'une classe aliasee dans le HTML');
    const shared = htmlAliases.filter(a => jsAliases.includes(a));
    assert.ok(shared.length >= 1, 'alias partage HTML<->JS : le selecteur JS resout encore');
    assert.ok(!/\.carousel-track/.test(out.js), 'ancien nom de classe absent du JS');
  } finally { d.cleanup(); }
});

test('import edite reste verbatim a l\'export (data-remote-* conserves)', () => {
  const { d, canvas } = canvasDom();
  try {
    const store = new SliceStore(canvas);
    const imported = '<div class="x"><style>.x{color:blue}</style>'
      + '<script type="text/ekw-js">1</script><h2>Titre</h2></div>';
    const s = store.add(imported, 'imported', { prismicId: 'D2', prismicField: 'html_only' });
    s.root.querySelector('h2').textContent = 'Titre edite';
    store.touch(s.id);
    const out = exportSlice(s, { collectCssRules: () => [] });
    assert.ok(/Titre edite/.test(out.html), 'edition prise en compte');
    assert.ok(/color:blue/.test(out.html + out.css), 'style verbatim conserve (pas de compile sur importe)');
    assert.equal(s.meta.prismicId, 'D2');
    assert.equal(s.root.getAttribute('data-remote-id'), 'D2');
  } finally { d.cleanup(); }
});

test('undo apres add/remove : refs vivantes, pas de fantome', () => {
  const { d, canvas } = canvasDom();
  try {
    const store = new SliceStore(canvas);
    const h = new History(store);
    const a = store.add('<div><p>A</p></div>', 'generated');
    h.snapshot();
    const b = store.add('<div><p>B</p></div>', 'generated');
    h.snapshot();
    assert.equal(store.list().length, 2);
    store.remove(a.id);
    h.snapshot();
    assert.equal(store.list().length, 1);
    assert.equal(canvas.querySelectorAll('[data-comp]').length, 1, 'zero coquille apres remove');
    h.undo();
    assert.equal(store.list().length, 2, 'la slice supprimee reapparait');
    assert.equal(store.get(b.id), b, 'ref de slice inchangee preservee (pas de ref morte)');
    h.dispose();
  } finally { d.cleanup(); }
});

test('deux slices memes classes : uid distincts a l\'export (pas de fuite)', () => {
  const { d, canvas } = canvasDom();
  try {
    const store = new SliceStore(canvas);
    const s1 = store.add('<div class="box"><p>1</p></div>', 'generated');
    const s2 = store.add('<div class="box"><p>2</p></div>', 'generated');
    const o1 = exportSlice(s1, { collectCssRules: () => [{ media: '', selector: '.box', body: 'color:red' }] });
    const o2 = exportSlice(s2, { collectCssRules: () => [{ media: '', selector: '.box', body: 'color:green' }] });
    const uid1 = (o1.html.match(/eks-([a-z0-9]+)-\d+/) || [])[1];
    const uid2 = (o2.html.match(/eks-([a-z0-9]+)-\d+/) || [])[1];
    assert.ok(uid1 && uid2 && uid1 !== uid2, 'uid distincts entre les deux slices');
  } finally { d.cleanup(); }
});

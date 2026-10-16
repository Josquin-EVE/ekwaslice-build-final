import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDom } from '../helpers/dom.js';
import { SliceStore } from '../../src/core/store.js';
import { initEditing } from '../../src/features/editing.js';

// Harnais minimal : vrai SliceStore + jsdom, ctx réduit (document + canvas).
// Le module doit tolérer l'absence des éléments de chrome UI (tout est gardé).
function setup() {
  const env = withDom('<!doctype html><html><body><div id="canvas"></div></body></html>');
  const canvas = env.document.getElementById('canvas');
  const store = new SliceStore(canvas);
  const api = initEditing(store, { document: env.document, canvas });
  return { ...env, canvas, store, api };
}

test('delete : sel EST la racine d\'une slice → store.remove(id), slice partie, pas de touch', () => {
  const { cleanup, store, api, canvas } = setup();
  try {
    const s = store.add('<p>a</p>');
    let removedId = null;
    let touchCount = 0;
    const origRemove = store.remove.bind(store);
    store.remove = (id) => { removedId = id; return origRemove(id); };
    store.touch = () => { touchCount += 1; };

    api.selectElement(s.root);
    api.deleteSelection();

    assert.equal(removedId, s.id);                 // routé via store.remove
    assert.equal(store.get(s.id), null);           // slice partie
    assert.equal(canvas.querySelector('[data-comp]'), null); // racine retirée du DOM
    assert.equal(canvas.children.length, 0);
    assert.equal(touchCount, 0);                    // pas de touch sur suppression de racine
  } finally { cleanup(); }
});

test('delete : sel = nœud imbriqué → nœud parti, slice présente, store.touch(id) (zéro coquille)', () => {
  const { cleanup, store, api } = setup();
  try {
    const s = store.add('<div><span id="inner">x</span><b id="keep">keep</b></div>');
    const inner = s.root.querySelector('#inner');
    let removeCalled = false;
    let touchedId = null;
    store.remove = () => { removeCalled = true; };
    const origTouch = store.touch.bind(store);
    store.touch = (id) => { touchedId = id; return origTouch(id); };

    api.selectElement(inner);
    api.deleteSelection();

    assert.equal(removeCalled, false);             // store.remove JAMAIS appelé
    assert.equal(store.get(s.id), s);              // slice toujours là
    assert.equal(s.root.querySelector('#inner'), null); // nœud interne parti
    assert.ok(s.root.querySelector('#keep'));      // reste du contenu intact (racine non vidée)
    assert.equal(touchedId, s.id);                 // touch avec l'id de la slice propriétaire
  } finally { cleanup(); }
});

test('delete : nœud imbriqué unique → racine vit encore (zéro coquille, pas de remove)', () => {
  const { cleanup, store, api } = setup();
  try {
    const s = store.add('<div><span id="only">x</span></div>');
    const only = s.root.querySelector('#only');
    let removeCalled = false;
    store.remove = () => { removeCalled = true; };

    api.selectElement(only);
    api.deleteSelection();

    assert.equal(removeCalled, false);
    assert.equal(store.get(s.id), s);              // la slice n'est jamais supprimée implicitement
    assert.equal(s.root.querySelector('#only'), null);
  } finally { cleanup(); }
});

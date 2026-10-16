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

test('delete : nœud imbriqué unique → nœud retiré, slice conservée (racine jamais supprimée implicitement)', () => {
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

test('element-link : sur une racine de slice → refusé, racine non wrappée, store intact', () => {
  const env = withDom('<!doctype html><html><body><div id="canvas"></div></body></html>');
  const canvas = env.document.getElementById('canvas');
  const store = new SliceStore(canvas);
  const toolbar = env.document.createElement('div');
  env.document.body.appendChild(toolbar);
  let toastMsg = null;
  const api = initEditing(store, { document: env.document, canvas, toolbar, hooks: { toast: (m) => { toastMsg = m; } } });
  try {
    const s = store.add('<p>a</p>');            // slice d'une seule racine ; sel = racine
    let touched = 0;
    store.touch = () => { touched += 1; };
    api.selectElement(s.root);

    // Clic sur le bouton « lien » de la toolbar → openElementLink sur une racine.
    const linkBtn = toolbar.querySelector('[data-act="link"]');
    assert.ok(linkBtn);
    linkBtn.click();

    assert.ok(toastMsg && /lien/i.test(toastMsg));   // refus signalé à l'utilisateur
    assert.equal(canvas.children.length, 1);
    assert.equal(canvas.children[0], s.root);        // racine NON wrappée
    assert.equal(s.root.parentNode, canvas);         // toujours enfant direct du canvas
    assert.equal(canvas.querySelector('a'), null);   // aucun <a> injecté dans le canvas
    assert.equal(store.sliceOf(s.root), s);          // store/DOM cohérents (pas de désync)
    assert.equal(touched, 0);                        // aucune mutation de contenu
  } finally { env.cleanup(); }
});

test('regenStateStyles : re-mint d\'eid (replaceContent) → seul le nouvel eid, aucune règle orpheline', () => {
  const { cleanup, store, api, document } = setup();
  try {
    const stateAttr = '{"hover":{"color":"#17E7D0"}}';
    const s = store.add('<button data-ekw-states=\'' + stateAttr + '\'>x</button>');
    const oldEid = s.root.querySelector('[data-ekw-states]').getAttribute('data-eid'); // minté par createSliceRoot
    assert.ok(oldEid);

    api.regenStateStyles();
    let css = document.getElementById('ekw-live-states').textContent;
    assert.ok(css.includes('data-eid="' + oldEid + '"'));   // règle posée sur l'eid courant

    // replaceContent passe par createSliceRoot → re-mint l'eid du descendant [data-ekw-states].
    store.replaceContent(s.id, '<button data-ekw-states=\'' + stateAttr + '\'>x</button>');
    const newEid = s.root.querySelector('[data-ekw-states]').getAttribute('data-eid');
    assert.notEqual(newEid, oldEid);

    api.regenStateStyles();
    css = document.getElementById('ekw-live-states').textContent;
    assert.ok(css.includes('data-eid="' + newEid + '"'));   // nouvel eid présent
    assert.ok(!css.includes('data-eid="' + oldEid + '"'));  // AUCUNE règle orpheline (ancien eid)
  } finally { cleanup(); }
});

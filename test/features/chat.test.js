import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDom } from '../helpers/dom.js';
import { SliceStore } from '../../src/core/store.js';
import { initChat } from '../../src/features/chat.js';

// Harnais minimal : vrai SliceStore + jsdom, editing réduit à l'accès sélection.
// Le ciblage (effectiveTarget) est la logique testée unitairement ; l'envoi/stream/
// aperçu (IPC + DOM lourds) est vérifié en app aux Tasks 12/13.
function setup(selectionRef = { sel: null }) {
  const env = withDom('<!doctype html><html><body><div id="canvas"></div></body></html>');
  const canvas = env.document.getElementById('canvas');
  const store = new SliceStore(canvas);
  const editing = {
    getSelected: () => selectionRef.sel,
    selectElement: () => {},
    deselect: () => {},
    regenStateStyles: () => {},
    isEditing: () => false,
    stopEditing: () => {},
  };
  const chat = initChat(store, { document: env.document, window: env.window, canvas, editing });
  return { ...env, canvas, store, editing, chat, selectionRef };
}

test('effectiveTarget : une seule slice, aucune sélection → cette slice (pas null, pas de doublon)', () => {
  const { cleanup, store, chat } = setup();
  try {
    const s = store.add('<p>a</p>');
    const t = chat.effectiveTarget();
    assert.equal(t, s.root);          // la slice présente est ciblée → modif en place
    assert.notEqual(t, null);         // surtout PAS null (sinon add() = doublon de widget)
  } finally { cleanup(); }
});

test('effectiveTarget : forceNewEl armé → null (force un nouvel élément)', () => {
  const { cleanup, store, chat } = setup();
  try {
    store.add('<p>a</p>');            // une slice présente…
    chat.setForceNewEl(true);         // …mais on force le mode « nouvel élément »
    assert.equal(chat.effectiveTarget(), null);
  } finally { cleanup(); }
});

test('effectiveTarget : sélection courante prioritaire sur la slice présente', () => {
  const ref = { sel: null };
  const { cleanup, store, chat } = setup(ref);
  try {
    const s = store.add('<div><span id="inner">x</span></div>');
    ref.sel = s.root.querySelector('#inner');
    assert.equal(chat.effectiveTarget(), ref.sel);
  } finally { cleanup(); }
});

test('effectiveTarget : sélection détachée (stale) → repli sur la slice présente', () => {
  const ref = { sel: null };
  const { cleanup, store, chat, document } = setup(ref);
  try {
    const s = store.add('<p>a</p>');
    ref.sel = document.createElement('span'); // nœud jamais attaché au canvas
    assert.equal(chat.effectiveTarget(), s.root); // on ne cible pas un nœud détaché
  } finally { cleanup(); }
});

test('effectiveTarget : plusieurs slices, aucune sélection → null (ajout d\'un nouveau bloc)', () => {
  const { cleanup, store, chat } = setup();
  try {
    store.add('<p>a</p>');
    store.add('<p>b</p>');
    assert.equal(chat.effectiveTarget(), null);
  } finally { cleanup(); }
});

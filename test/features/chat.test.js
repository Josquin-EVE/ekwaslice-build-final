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
  const calls = { regen: 0, selected: [] };
  const editing = {
    getSelected: () => selectionRef.sel,
    selectElement: (el) => { calls.selected.push(el); },
    deselect: () => {},
    regenStateStyles: () => { calls.regen += 1; },
    isEditing: () => false,
    stopEditing: () => {},
  };
  const chat = initChat(store, { document: env.document, window: env.window, canvas, editing });
  return { ...env, canvas, store, editing, chat, selectionRef, calls };
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

// --- Must-fix 1 : édition de racine n'empile pas un wrapper à chaque passe -------------
test('apply racine : refHtmlFor envoie le contenu INTERNE (pas outerHTML) → pas d\'accumulation', () => {
  const { cleanup, store, chat, canvas } = setup();
  try {
    const s = store.add('<p>inner</p>');
    // La référence montrée au modèle = contenu interne, SANS le wrapper [data-comp].
    const ref1 = chat.refHtmlFor(s.root);
    assert.ok(!/data-comp/.test(ref1));            // pas la racine elle-même
    assert.ok(/<p/.test(ref1));

    // Le modèle ré-émet cette référence → on l'applique.
    chat.applyCandidate(s.root, ref1);
    assert.equal(canvas.children.length, 1);
    assert.equal(canvas.children[0], s.root);       // même racine persistante
    assert.equal(s.root.firstElementChild.tagName, 'P'); // root > p (aucun wrapper intermédiaire)
    assert.equal(s.root.children.length, 1);

    // Seconde édition de racine : toujours pas d'empilement.
    const ref2 = chat.refHtmlFor(s.root);
    assert.ok(!/data-comp/.test(ref2));
    chat.applyCandidate(s.root, ref2);
    assert.equal(s.root.firstElementChild.tagName, 'P'); // profondeur constante
    assert.equal(s.root.children.length, 1);
    assert.equal(canvas.children.length, 1);
  } finally { cleanup(); }
});

test('apply racine : data-remote-* restent sur la racine seule, aucune fuite imbriquée', () => {
  const { cleanup, store, chat } = setup();
  try {
    const s = store.add('<p>a</p>', 'imported', { prismicId: 'X', prismicField: 'body', baseVersion: '3' });
    assert.equal(s.root.getAttribute('data-remote-id'), 'X');

    const ref = chat.refHtmlFor(s.root);
    assert.ok(!/data-remote-/.test(ref));           // l'identité n'est pas dans le contenu interne

    chat.applyCandidate(s.root, ref);
    assert.equal(s.root.getAttribute('data-remote-id'), 'X');   // identité conservée sur la racine
    assert.equal(s.root.getAttribute('data-remote-field'), 'body');
    assert.equal(s.root.getAttribute('data-base-version'), '3');
    assert.equal(s.root.querySelector('[data-remote-id]'), null); // aucune fuite sur un descendant
  } finally { cleanup(); }
});

// --- Should-fix 2 : cible obsolète à l'apply → re-résolution (pas de doublon) ----------
test('apply : cible stale + une seule slice présente → édite en place, aucun doublon', () => {
  const { cleanup, store, chat, canvas } = setup();
  try {
    const s1 = store.add('<p>a</p>');
    const staleRef = s1.root;
    // Simule un undo : remove + insertAt(même id) → nouvelle racine, l'ancienne est détachée.
    store.remove(s1.id);
    const s2 = store.insertAt(0, { id: s1.id, html: '<p>a</p>' });
    assert.notEqual(s2.root, staleRef);
    assert.equal(canvas.contains(staleRef), false); // staleRef est bien détaché

    chat.applyCandidate(staleRef, '<p>b</p>');       // Accept sur une cible obsolète
    assert.equal(store.list().length, 1);            // PAS de doublon ajouté
    assert.equal(canvas.children.length, 1);
    assert.equal(canvas.children[0], s2.root);       // la slice vivante a été éditée en place
    assert.ok(/b/.test(s2.root.textContent));
  } finally { cleanup(); }
});

// --- Nit : les 3 routes d'application -------------------------------------------------
test('apply route RACINE → store.replaceContent (même nœud), regenStateStyles appelé', () => {
  const { cleanup, store, chat, canvas, calls } = setup();
  try {
    const s = store.add('<p>a</p>', 'imported', { prismicId: 'X' });
    let replacedId = null;
    const origReplace = store.replaceContent.bind(store);
    store.replaceContent = (id, html) => { replacedId = id; return origReplace(id, html); };
    const regenBefore = calls.regen;

    chat.applyCandidate(s.root, '<p>b</p>');

    assert.equal(replacedId, s.id);                  // routé via store.replaceContent
    assert.equal(canvas.children[0], s.root);        // la racine reste le MÊME nœud
    assert.equal(s.root.getAttribute('data-remote-id'), 'X'); // identité préservée
    assert.ok(/b/.test(s.root.textContent));
    assert.ok(calls.regen > regenBefore);            // regenStateStyles appelé après replaceContent
  } finally { cleanup(); }
});

test('apply route IMBRIQUÉE → nœud remplacé en place + store.touch(id)', () => {
  const { cleanup, store, chat } = setup();
  try {
    const s = store.add('<div><span id="inner">x</span><b id="keep">k</b></div>');
    const inner = s.root.querySelector('#inner');
    let replaceCalled = false, touchedId = null;
    store.replaceContent = () => { replaceCalled = true; };
    const origTouch = store.touch.bind(store);
    store.touch = (id) => { touchedId = id; return origTouch(id); };

    chat.applyCandidate(inner, '<span id="inner">y</span>');

    assert.equal(replaceCalled, false);              // pas une opération de racine
    assert.equal(touchedId, s.id);                   // touch de la slice propriétaire
    assert.equal(s.root.querySelector('#inner').textContent, 'y'); // nœud remplacé
    assert.ok(s.root.querySelector('#keep'));        // frères intacts
    assert.equal(store.list().length, 1);
  } finally { cleanup(); }
});

test('apply route AUCUNE CIBLE → store.add (nouvelle slice)', () => {
  const { cleanup, store, chat } = setup();
  try {
    let added = null;
    const origAdd = store.add.bind(store);
    store.add = (html, origin, meta) => { added = origin; return origAdd(html, origin, meta); };

    chat.applyCandidate(null, '<p>new</p>');         // aucune cible vivante → ajout

    assert.equal(added, 'generated');
    assert.equal(store.list().length, 1);
    assert.ok(/new/.test(store.list()[0].root.textContent));
  } finally { cleanup(); }
});

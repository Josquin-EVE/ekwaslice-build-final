import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { withDom } from '../helpers/dom.js';
import { SliceStore } from '../../src/core/store.js';
import { History } from '../../src/core/history.js';

function setup() {
  const env = withDom('<!doctype html><html><body><div id="canvas"></div></body></html>');
  const canvas = env.document.getElementById('canvas');
  const store = new SliceStore(canvas);
  const history = new History(store);
  return { ...env, canvas, store, history };
}

const ids = (store) => store.list().map((s) => s.id);
const htmls = (store) => store.serialize().map((s) => s.html);

test('état initial : rien à annuler ni refaire', () => {
  const { cleanup, history } = setup();
  try {
    assert.equal(history.canUndo(), false);
    assert.equal(history.canRedo(), false);
    assert.equal(history.undo(), false);
    assert.equal(history.redo(), false);
  } finally { cleanup(); }
});

test('snapshot après add : canUndo ; un snapshot identique est ignoré', () => {
  const { cleanup, store, history } = setup();
  try {
    store.add('<p>a</p>');
    history.snapshot();
    assert.equal(history.canUndo(), true);
    history.snapshot(); // rien n'a changé
    history.undo();
    assert.equal(store.list().length, 0);
    assert.equal(history.canUndo(), false);
  } finally { cleanup(); }
});

test('remove puis undo : la slice réapparaît (même id, meta, origine) à la bonne place', () => {
  const { cleanup, store, canvas, history } = setup();
  try {
    const a = store.add('<p>a</p>');
    const b = store.add('<p>b</p>', 'prismic', { prismicId: 'P1', prismicTitle: 'Titre' });
    const c = store.add('<p>c</p>');
    history.snapshot();
    store.remove(b.id);
    history.snapshot();
    assert.deepEqual(ids(store), [a.id, c.id]);

    assert.equal(history.undo(), true);
    assert.deepEqual(ids(store), [a.id, b.id, c.id]);
    const back = store.get(b.id);
    assert.equal(back.origin, 'prismic');
    assert.deepEqual(back.meta, { prismicId: 'P1', prismicTitle: 'Titre' });
    assert.equal(back.root.getAttribute('data-remote-id'), 'P1');
    assert.equal(back.root.parentNode, canvas);
    // DOM synchrone avec la liste
    assert.deepEqual([...canvas.children], store.list().map((s) => s.root));
    assert.deepEqual(htmls(store), ['<p>a</p>', '<p>b</p>', '<p>c</p>']);

    assert.equal(history.redo(), true);
    assert.deepEqual(ids(store), [a.id, c.id]);
    assert.equal(store.get(b.id), null);
  } finally { cleanup(); }
});

test('edit (replaceContent) : undo → ancien html, redo → nouveau', () => {
  const { cleanup, store, history } = setup();
  try {
    const a = store.add('<p>old</p>');
    history.snapshot();
    store.replaceContent(a.id, '<p>new</p>');
    history.snapshot();

    history.undo();
    assert.deepEqual(htmls(store), ['<p>old</p>']);
    history.redo();
    assert.deepEqual(htmls(store), ['<p>new</p>']);
    assert.equal(history.canRedo(), false);
  } finally { cleanup(); }
});

test('restore ne reconstruit QUE les slices changées : une slice inchangée garde sa référence et sa racine', () => {
  const { cleanup, store, history } = setup();
  try {
    const a = store.add('<p>a</p>');
    const b = store.add('<p>b</p>');
    const c = store.add('<p>c</p>');
    history.snapshot();
    const rootA = a.root;
    const rootC = c.root;
    const childA = a.root.firstChild;

    store.replaceContent(b.id, '<p>b2</p>');
    history.snapshot();

    history.undo();
    assert.equal(store.get(a.id), a, 'même objet Slice A');
    assert.equal(store.get(c.id), c, 'même objet Slice C');
    assert.equal(a.root, rootA);
    assert.equal(c.root, rootC);
    assert.equal(a.root.firstChild, childA, 'les noeuds internes de A ne sont pas touchés');
    assert.deepEqual(htmls(store), ['<p>a</p>', '<p>b</p>', '<p>c</p>']);

    history.redo();
    assert.equal(store.get(a.id), a);
    assert.equal(store.get(c.id), c);
    assert.equal(a.root.firstChild, childA);
    assert.deepEqual(htmls(store), ['<p>a</p>', '<p>b2</p>', '<p>c</p>']);
  } finally { cleanup(); }
});

test('undo d\'un remove : les slices voisines inchangées gardent leur référence', () => {
  const { cleanup, store, history } = setup();
  try {
    const a = store.add('<p>a</p>');
    const b = store.add('<p>b</p>');
    const c = store.add('<p>c</p>');
    history.snapshot();
    store.remove(b.id);
    history.snapshot();
    history.undo();
    assert.equal(store.get(a.id), a);
    assert.equal(store.get(c.id), c);
    assert.notEqual(store.get(b.id), b, 'B est reconstruite (nouvel objet) mais garde son id');
  } finally { cleanup(); }
});

test('slice avec data-ekw-states : les data-eid neufs ne comptent pas comme un changement', () => {
  const { cleanup, store, history } = setup();
  try {
    const a = store.add('<div data-ekw-states data-eid="x">a</div>');
    const eid = a.root.firstChild.getAttribute('data-eid');
    const b = store.add('<p>b</p>');
    history.snapshot();
    store.replaceContent(b.id, '<p>b2</p>');
    history.snapshot();
    history.undo();
    assert.equal(store.get(a.id), a);
    assert.equal(a.root.firstChild.getAttribute('data-eid'), eid, 'eid vivant préservé');
    history.redo();
    assert.equal(store.get(a.id), a);
  } finally { cleanup(); }
});

test('restore : réordonne pour coller à l\'ordre du snapshot, sans reconstruire', () => {
  const { cleanup, store, canvas, history } = setup();
  try {
    const a = store.add('<p>a</p>');
    const b = store.add('<p>b</p>');
    const c = store.add('<p>c</p>');
    history.snapshot();
    store.move(c.id, 'up');
    store.move(c.id, 'up');
    history.snapshot();
    assert.deepEqual(ids(store), [c.id, a.id, b.id]);

    history.undo();
    assert.deepEqual(ids(store), [a.id, b.id, c.id]);
    assert.deepEqual([...canvas.children], [a.root, b.root, c.root]);
    assert.equal(store.get(a.id), a);
    assert.equal(store.get(b.id), b);
    assert.equal(store.get(c.id), c);
  } finally { cleanup(); }
});

test('restore : meta changé → racine reconstruite avec les bons attributs d\'identité', () => {
  const { cleanup, store, history } = setup();
  try {
    const a = store.add('<p>a</p>', 'prismic', { prismicId: 'P1' });
    history.snapshot();
    a.meta.prismicId = 'P2';
    a.root.setAttribute('data-remote-id', 'P2');
    history.snapshot();
    history.undo();
    const back = store.get(a.id);
    assert.deepEqual(back.meta, { prismicId: 'P1' });
    assert.equal(back.root.getAttribute('data-remote-id'), 'P1');
    history.redo();
    assert.equal(store.get(a.id).root.getAttribute('data-remote-id'), 'P2');
  } finally { cleanup(); }
});

test('restore(snap) direct : applique n\'importe quel snapshot, sans toucher la pile', () => {
  const { cleanup, store, history } = setup();
  try {
    const a = store.add('<p>a</p>');
    history.snapshot();
    const snap = store.serialize();
    store.add('<p>b</p>');
    store.replaceContent(a.id, '<p>a2</p>');
    history.restore(snap);
    assert.deepEqual(htmls(store), ['<p>a</p>']);
    assert.equal(store.get(a.id), a, 'A modifiée en html seul : contenu remplacé, objet Slice conservé');
    assert.equal(history.canRedo(), false);
  } finally { cleanup(); }
});

test('un nouveau snapshot après undo vide la pile redo', () => {
  const { cleanup, store, history } = setup();
  try {
    store.add('<p>a</p>');
    history.snapshot();
    store.add('<p>b</p>');
    history.snapshot();
    history.undo();
    assert.equal(history.canRedo(), true);
    store.add('<p>c</p>');
    history.snapshot();
    assert.equal(history.canRedo(), false);
    assert.deepEqual(htmls(store), ['<p>a</p>', '<p>c</p>']);
  } finally { cleanup(); }
});

test('restore n\'enregistre pas de snapshot parasite (undo/redo pur)', () => {
  const { cleanup, store, history } = setup();
  try {
    store.add('<p>a</p>');
    history.snapshot();
    store.add('<p>b</p>');
    history.snapshot();
    history.undo();
    history.snapshot(); // l'état courant égale déjà le haut de pile
    assert.equal(history.canRedo(), true, 'le redo survit à un snapshot sans changement');
    history.undo();
    assert.equal(store.list().length, 0);
  } finally { cleanup(); }
});

test('limite de pile : les plus anciens snapshots sont jetés', () => {
  const env = withDom('<!doctype html><html><body><div id="canvas"></div></body></html>');
  try {
    const store = new SliceStore(env.document.getElementById('canvas'));
    const history = new History(store, { limit: 3 });
    for (let i = 0; i < 5; i++) { store.add(`<p>${i}</p>`); history.snapshot(); }
    let n = 0;
    while (history.undo()) n += 1;
    assert.equal(n, 2);
  } finally { env.cleanup(); }
});

test('change du store : snapshot débouncé ; undo vide le debounce en attente', () => {
  const { cleanup, store, history } = setup();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    store.add('<p>a</p>');
    store.add('<p>b</p>');
    assert.equal(history.canUndo(), true, 'une modification en attente est déjà annulable');
    mock.timers.tick(1000);
    assert.equal(history.canUndo(), true);
    history.undo();
    assert.equal(store.list().length, 0, 'une rafale = un seul pas d\'historique');

    history.redo();
    store.add('<p>c</p>'); // en attente, pas encore débouncé
    history.undo();        // flush d'abord : annule seulement c
    assert.deepEqual(htmls(store), ['<p>a</p>', '<p>b</p>']);
  } finally { mock.timers.reset(); cleanup(); }
});

test('suspend/resume : une rafale d\'édition ne produit qu\'un snapshot', () => {
  const { cleanup, store, history } = setup();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const a = store.add('<p>0</p>');
    mock.timers.tick(1000);
    history.suspend();
    for (let i = 1; i <= 5; i++) store.replaceContent(a.id, `<p>${i}</p>`);
    mock.timers.tick(1000);
    history.resume();
    mock.timers.tick(1000);
    history.undo();
    assert.deepEqual(htmls(store), ['<p>0</p>'], 'un seul pas pour toute la rafale');
    history.undo();
    assert.equal(store.list().length, 0);
  } finally { mock.timers.reset(); cleanup(); }
});

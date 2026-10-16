import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDom } from '../helpers/dom.js';
import { SliceStore } from '../../src/core/store.js';
import { serializeSlice } from '../../src/core/slice.js';

function setup() {
  const env = withDom('<!doctype html><html><body><div id="canvas"></div></body></html>');
  const canvas = env.document.getElementById('canvas');
  return { ...env, canvas, store: new SliceStore(canvas) };
}

test('add : liste, id, racine enfant direct du canvas, change émis', () => {
  const { cleanup, canvas, store } = setup();
  try {
    let changes = 0;
    store.on('change', () => { changes += 1; });
    const s = store.add('<p>a</p>');
    assert.equal(store.list().length, 1);
    assert.ok(s.id);
    assert.equal(s.origin, 'generated');
    assert.deepEqual(s.meta, {});
    assert.equal(s.root.parentNode, canvas);
    assert.equal(canvas.children.length, 1);
    assert.equal(changes, 1);
    assert.equal(store.get(s.id), s);
    assert.equal(store.get('nope'), null);
  } finally { cleanup(); }
});

test('add : origin et meta transmis, identité Prismic posée sur la racine', () => {
  const { cleanup, store } = setup();
  try {
    const s = store.add('<p>a</p>', 'prismic', { prismicId: 'A' });
    assert.equal(s.origin, 'prismic');
    assert.equal(s.root.getAttribute('data-remote-id'), 'A');
  } finally { cleanup(); }
});

test('list retourne une copie ordonnée', () => {
  const { cleanup, store } = setup();
  try {
    const a = store.add('<p>a</p>');
    const b = store.add('<p>b</p>');
    const l = store.list();
    assert.deepEqual(l.map((s) => s.id), [a.id, b.id]);
    l.pop();
    assert.equal(store.list().length, 2);
  } finally { cleanup(); }
});

test('remove : retire la racine entière (zéro coquille), liste vide, change émis', () => {
  const { cleanup, canvas, store } = setup();
  try {
    const s = store.add('<p>a</p>');
    let changes = 0;
    store.on('change', () => { changes += 1; });
    store.remove(s.id);
    assert.equal(canvas.querySelector('[data-comp]'), null);
    assert.equal(canvas.children.length, 0);
    assert.equal(store.list().length, 0);
    assert.equal(store.get(s.id), null);
    assert.equal(changes, 1);
  } finally { cleanup(); }
});

test('remove d\'un id inconnu : sans effet ni événement', () => {
  const { cleanup, store } = setup();
  try {
    store.add('<p>a</p>');
    let changes = 0;
    store.on('change', () => { changes += 1; });
    store.remove('nope');
    assert.equal(store.list().length, 1);
    assert.equal(changes, 0);
  } finally { cleanup(); }
});

test('replaceContent : contenu changé, meta + data-remote-* + attributs racine + id de slice préservés', () => {
  const { cleanup, canvas, store } = setup();
  try {
    const s = store.add('<p>old</p>', 'prismic', { prismicId: 'A', prismicTitle: 'T' });
    s.root.setAttribute('data-eid', 'keep-me');
    let changes = 0;
    store.on('change', () => { changes += 1; });
    const root = s.root;
    const r = store.replaceContent(s.id, '<p>new</p>');
    assert.equal(r.id, s.id);
    assert.equal(store.list().length, 1);
    assert.equal(r.root, root);
    assert.equal(root.parentNode, canvas);
    assert.equal(root.innerHTML, '<p>new</p>');
    assert.equal(root.getAttribute('data-remote-id'), 'A');
    assert.equal(root.getAttribute('data-remote-title'), 'T');
    assert.equal(root.getAttribute('data-eid'), 'keep-me');
    assert.equal(root.getAttribute('data-comp'), '1');
    assert.equal(r.meta.prismicId, 'A');
    assert.equal(r.origin, 'prismic');
    assert.equal(changes, 1);
  } finally { cleanup(); }
});

test('replaceContent : passe par createSliceRoot (artefacts retirés, data-eid neufs)', () => {
  const { cleanup, store } = setup();
  try {
    const s = store.add('<div data-ekw-states data-eid="x1">a</div>');
    const oldEid = s.root.querySelector('[data-ekw-states]').getAttribute('data-eid');
    store.replaceContent(s.id, '<div data-ekw-states data-eid="x1" contenteditable="true" class="ekw-selected">b</div>');
    const el = s.root.querySelector('[data-ekw-states]');
    assert.equal(el.hasAttribute('contenteditable'), false);
    assert.equal(el.classList.contains('ekw-selected'), false);
    assert.notEqual(el.getAttribute('data-eid'), 'x1');
    assert.notEqual(el.getAttribute('data-eid'), oldEid);
  } finally { cleanup(); }
});

test('replaceContent d\'un id inconnu : retourne null', () => {
  const { cleanup, store } = setup();
  try {
    assert.equal(store.replaceContent('nope', '<p>x</p>'), null);
  } finally { cleanup(); }
});

test('sliceOf : noeud imbriqué, racine, noeud hors canvas', () => {
  const { cleanup, document, store } = setup();
  try {
    store.add('<p>x</p>');
    const s = store.add('<div><section><ul><li><b id="deep">y</b></li></ul></section></div>');
    const deep = s.root.querySelector('#deep');
    assert.equal(store.sliceOf(deep), s);
    assert.equal(store.sliceOf(deep.firstChild), s);
    assert.equal(store.sliceOf(s.root), s);
    assert.equal(store.sliceOf(document.body), null);
    assert.equal(store.sliceOf(null), null);
  } finally { cleanup(); }
});

test('sliceOf : un wrapper [data-comp] imbriqué résout vers la slice propriétaire', () => {
  const { cleanup, store } = setup();
  try {
    const s = store.add('<div data-comp="1"><i id="n">z</i></div>');
    assert.equal(store.sliceOf(s.root.querySelector('#n')), s);
  } finally { cleanup(); }
});

test('move : ordre DOM et liste cohérents, bornes sans effet', () => {
  const { cleanup, canvas, store } = setup();
  try {
    const a = store.add('<p>a</p>');
    const b = store.add('<p>b</p>');
    const c = store.add('<p>c</p>');
    const domIds = () => [...canvas.children].map((n) => store.sliceOf(n).id);
    store.move(c.id, 'up');
    assert.deepEqual(store.list().map((s) => s.id), [a.id, c.id, b.id]);
    assert.deepEqual(domIds(), [a.id, c.id, b.id]);
    store.move(a.id, 'down');
    assert.deepEqual(store.list().map((s) => s.id), [c.id, a.id, b.id]);
    assert.deepEqual(domIds(), [c.id, a.id, b.id]);
    let changes = 0;
    store.on('change', () => { changes += 1; });
    store.move(c.id, 'up');
    store.move(b.id, 'down');
    assert.deepEqual(domIds(), [c.id, a.id, b.id]);
    assert.equal(changes, 0);
    assert.equal(canvas.children.length, 3);
  } finally { cleanup(); }
});

test('duplicate : après l\'original, data-eid neufs, meta sans identité Prismic', () => {
  const { cleanup, canvas, store } = setup();
  try {
    const a = store.add('<div data-ekw-states data-eid="q">a</div>', 'prismic', {
      prismicId: 'A', prismicTitle: 'T', prismicField: 'f', baseVersion: 'v', prismicUid: 'u', custom: 'keep',
    });
    const b = store.add('<p>b</p>');
    let changes = 0;
    store.on('change', () => { changes += 1; });
    const d = store.duplicate(a.id);
    assert.equal(changes, 1);
    assert.equal(store.list().length, 3);
    assert.deepEqual(store.list().map((s) => s.id), [a.id, d.id, b.id]);
    assert.equal(canvas.children[1], d.root);
    assert.notEqual(d.id, a.id);
    const eidA = a.root.querySelector('[data-ekw-states]').getAttribute('data-eid');
    const eidD = d.root.querySelector('[data-ekw-states]').getAttribute('data-eid');
    assert.notEqual(eidA, eidD);
    for (const k of ['prismicId', 'prismicTitle', 'prismicField', 'baseVersion', 'prismicUid']) {
      assert.equal(k in d.meta, false, k);
    }
    assert.equal(d.meta.custom, 'keep');
    assert.equal(d.root.hasAttribute('data-remote-id'), false);
    assert.equal(a.meta.prismicId, 'A');
    assert.equal(a.root.getAttribute('data-remote-id'), 'A');
    assert.equal(d.origin, 'prismic');
  } finally { cleanup(); }
});

test('clear : canvas et liste vides, change émis', () => {
  const { cleanup, canvas, store } = setup();
  try {
    store.add('<p>a</p>');
    store.add('<p>b</p>');
    let changes = 0;
    store.on('change', () => { changes += 1; });
    store.clear();
    assert.equal(canvas.children.length, 0);
    assert.equal(store.list().length, 0);
    assert.equal(changes, 1);
  } finally { cleanup(); }
});

test('touch : émet change sans mutation structurelle', () => {
  const { cleanup, canvas, store } = setup();
  try {
    const s = store.add('<p>a</p>');
    const before = canvas.innerHTML;
    let changes = 0;
    store.on('change', () => { changes += 1; });
    store.touch(s.id);
    assert.equal(changes, 1);
    assert.equal(canvas.innerHTML, before);
    assert.equal(store.list().length, 1);
  } finally { cleanup(); }
});

test('on/off : off retire l\'écouteur', () => {
  const { cleanup, store } = setup();
  try {
    let n = 0;
    const cb = () => { n += 1; };
    store.on('change', cb);
    store.add('<p>a</p>');
    store.off('change', cb);
    store.add('<p>b</p>');
    assert.equal(n, 1);
  } finally { cleanup(); }
});

test('serialize : order croissant, html = serializeSlice, id/origin/meta', () => {
  const { cleanup, store } = setup();
  try {
    const a = store.add('<p>a</p>', 'imported', { prismicId: 'A' });
    const b = store.add('<p>b</p>');
    const out = store.serialize();
    assert.equal(out.length, 2);
    assert.deepEqual(out.map((o) => o.order), [0, 1]);
    assert.deepEqual(out.map((o) => o.id), [a.id, b.id]);
    assert.equal(out[0].html, serializeSlice(a));
    assert.equal(out[1].html, serializeSlice(b));
    assert.equal(out[0].origin, 'imported');
    assert.deepEqual(out[0].meta, { prismicId: 'A' });
    store.move(b.id, 'up');
    assert.deepEqual(store.serialize().map((o) => o.id), [b.id, a.id]);
  } finally { cleanup(); }
});

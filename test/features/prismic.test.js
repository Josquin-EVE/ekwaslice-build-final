import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { withDom } from '../helpers/dom.js';
import { SliceStore } from '../../src/core/store.js';
import { initPrismic } from '../../src/features/prismic.js';

const PrismicSlice = createRequire(import.meta.url)('../../lib/prismic-slice.js');

// Store réel + api IPC simulée (enregistre les appels). Pas de réseau.
function setup({ apiOver = {}, name = '[Custom Slice] Test', hooksOver = {} } = {}) {
  const env = withDom('<!doctype html><html><body><div id="canvas"></div><button id="prismic-update-btn" class="hidden"></button></body></html>');
  const canvas = env.document.getElementById('canvas');
  const store = new SliceStore(canvas);
  const calls = { push: [], update: [], pull: [], done: [], toasts: [] };
  const settings = { prismicWriteToken: 'tok' };
  const api = {
    pullPrismic: async (id) => { calls.pull.push(id); return apiOver.pullResult || { ok: true, trio: { html_only: '<h2>Hi</h2>', css: '.a{color:red}', js: 'var x=1;', html: '' }, documentId: 'DOC1', uid: 'u1', baseVersionId: 'v1', title: '[Custom Slice] Imp' }; },
    pushPrismic: async (p) => { calls.push.push(p); return apiOver.pushResult || { ok: true, documentId: 'NEWDOC' }; },
    updatePrismic: async (p) => { calls.update.push(p); return { ok: true, documentId: p.documentId }; },
    settingsSet: async () => {},
  };
  let selected = null;
  const prismic = initPrismic(store, {
    document: env.document,
    window: env.window,
    api,
    prismicSlice: PrismicSlice,
    collectCssRules: () => [],
    getSelected: () => selected,
    hooks: {
      toast: (m) => calls.toasts.push(m),
      askName: async () => name,
      getSettings: () => settings,
      getImportSource: () => 'https://x.prismic.io/builder/pages/DOC1',
      showPrismicDone: (o) => calls.done.push(o),
      ...hooksOver,
    },
  });
  return { ...env, store, prismic, calls, btn: env.document.getElementById('prismic-update-btn'), select: (el) => { selected = el; } };
}

test('import : UNE slice imported, identité en meta ET en data-remote-* sur la racine, verbatim', async () => {
  const t = setup();
  try {
    const slice = await t.prismic.doImport(null);
    assert.equal(t.store.list().length, 1);
    assert.equal(slice.origin, 'imported');
    assert.deepEqual(slice.meta, { prismicId: 'DOC1', prismicTitle: '[Custom Slice] Imp', prismicField: 'html_only', baseVersion: 'v1', prismicUid: 'u1', name: '[Custom Slice] Imp' });
    assert.equal(slice.root.getAttribute('data-remote-id'), 'DOC1');
    assert.equal(slice.root.getAttribute('data-remote-uid'), 'u1');
    assert.equal(slice.root.getAttribute('data-base-version'), 'v1');
    assert.equal(slice.root.getAttribute('data-remote-field'), 'html_only');
    assert.deepEqual(t.calls.pull, ['https://x.prismic.io/builder/pages/DOC1']);
    assert.equal(t.prismic.getPrismicTarget(), slice.root);
  } finally { t.cleanup(); }
});

test('import : échec IPC -> aucune slice, toast', async () => {
  const t = setup({ apiOver: { pullResult: { error: 'boom' } } });
  try {
    assert.equal(await t.prismic.doImport(null), null);
    assert.equal(t.store.list().length, 0);
    assert.ok(t.calls.toasts.some((m) => m.includes('boom')));
  } finally { t.cleanup(); }
});

test('bouton MAJ : visible seulement avec une slice imported / identifiée, suit les changements', async () => {
  const t = setup();
  try {
    assert.ok(t.btn.classList.contains('hidden'));
    t.store.add('<p>gen</p>');
    assert.ok(t.btn.classList.contains('hidden'));
    const imp = await t.prismic.doImport(null);
    assert.ok(!t.btn.classList.contains('hidden'));
    assert.ok(t.btn.classList.contains('flex'));
    t.store.remove(imp.id);
    assert.ok(t.btn.classList.contains('hidden'));
    assert.equal(t.prismic.getPrismicTarget(), null);
  } finally { t.cleanup(); }
});

test('MAJ : cible la slice portant prismicId parmi plusieurs, export VERBATIM, field/uid conservés', async () => {
  const t = setup();
  try {
    t.store.add('<h1>autre</h1>');
    const imp = await t.prismic.doImport(null);
    t.store.add('<h1>encore</h1>');
    await t.prismic.update(null);
    assert.equal(t.calls.update.length, 1);
    const p = t.calls.update[0];
    assert.equal(p.documentId, 'DOC1');
    assert.equal(p.uid, 'u1');
    assert.equal(p.field, 'html_only');
    assert.equal(p.css, '.a{color:red}');
    assert.equal(p.js, 'var x=1;');
    assert.equal(p.html, '<h2>Hi</h2>');
    assert.equal(imp.root.getAttribute('data-remote-id'), 'DOC1'); // identité intacte
    assert.equal(t.calls.done[0].title, 'Mise à jour effectuée');
  } finally { t.cleanup(); }
});

test('MAJ : deux slices Prismic sans cible -> ambigu, aucun appel ; la sélection lève l\'ambiguïté', async () => {
  const t = setup();
  try {
    const a = t.store.add('<p>a</p>', 'imported', { prismicId: 'A', prismicField: 'html_only' });
    const b = t.store.add('<p>b</p>', 'imported', { prismicId: 'B', prismicField: 'html_only' });
    await t.prismic.update(null);
    assert.equal(t.calls.update.length, 0);
    t.select(b.root.firstElementChild || b.root);
    await t.prismic.update(null);
    assert.equal(t.calls.update.length, 1);
    assert.equal(t.calls.update[0].documentId, 'B');
    assert.notEqual(a, b);
  } finally { t.cleanup(); }
});

test('MAJ : noteSelection mémorise la cible (survit au deselect)', async () => {
  const t = setup();
  try {
    t.store.add('<p>a</p>', 'imported', { prismicId: 'A', prismicField: 'html_only' });
    const b = t.store.add('<p>b</p>', 'imported', { prismicId: 'B', prismicField: 'html_only' });
    t.prismic.noteSelection(b.root);
    await t.prismic.update(null); // plus de sélection courante
    assert.equal(t.calls.update[0].documentId, 'B');
  } finally { t.cleanup(); }
});

test('MAJ : aucune slice Prismic -> aucun appel IPC', async () => {
  const t = setup();
  try {
    t.store.add('<p>gen</p>');
    await t.prismic.update(null);
    assert.equal(t.calls.update.length, 0);
  } finally { t.cleanup(); }
});

test('push : slice sans identité adopte le doc créé (meta + data-remote-*), la MAJ suivante vise ce doc', async () => {
  const t = setup();
  try {
    const s = t.store.add('<h2>Titre</h2><p>x</p>');
    await t.prismic.push(null);
    assert.equal(t.calls.push.length, 1);
    assert.equal(t.calls.push[0].title, '[Custom Slice] Test');
    assert.ok(t.calls.push[0].html.includes('Titre'));
    assert.equal(s.meta.prismicId, 'NEWDOC');
    assert.equal(s.meta.prismicField, 'html_only');
    assert.equal(s.root.getAttribute('data-remote-id'), 'NEWDOC'); // racine synchrone avec meta
    assert.equal(s.root.getAttribute('data-remote-title'), '[Custom Slice] Test');
    assert.ok(!t.btn.classList.contains('hidden')); // MAJ apparaît (change émis par setMeta)
    await t.prismic.update(null);
    assert.equal(t.calls.update.length, 1);
    assert.equal(t.calls.update[0].documentId, 'NEWDOC');
    assert.equal(t.calls.update[0].field, 'html_only');
  } finally { t.cleanup(); }
});

test('push : une slice déjà identifiée GARDE son identité (envoi = copie neuve)', async () => {
  const t = setup();
  try {
    const imp = await t.prismic.doImport(null);
    await t.prismic.push(null);
    assert.equal(t.calls.push.length, 1);
    assert.equal(t.calls.push[0].html, '<h2>Hi</h2>'); // verbatim
    assert.equal(imp.meta.prismicId, 'DOC1');
    assert.equal(imp.root.getAttribute('data-remote-id'), 'DOC1');
    await t.prismic.update(null);
    assert.equal(t.calls.update[0].documentId, 'DOC1');
  } finally { t.cleanup(); }
});

test('push : plusieurs slices sans sélection -> pas d\'envoi ; la sélection désigne la slice', async () => {
  const t = setup();
  try {
    t.store.add('<h2>A</h2>');
    const b = t.store.add('<h2>B</h2>');
    await t.prismic.push(null);
    assert.equal(t.calls.push.length, 0);
    t.select(b.root.firstElementChild);
    await t.prismic.push(null);
    assert.equal(t.calls.push.length, 1);
    assert.ok(t.calls.push[0].html.includes('B'));
    assert.equal(b.meta.prismicId, 'NEWDOC');
  } finally { t.cleanup(); }
});

test('push : échec -> pas d\'identité adoptée ; documentId vide -> pas d\'identité', async () => {
  const t = setup({ apiOver: { pushResult: { error: 'HTTP 500' } } });
  try {
    const s = t.store.add('<h2>A</h2>');
    await t.prismic.push(null);
    assert.equal(s.meta.prismicId, undefined);
    assert.equal(s.root.hasAttribute('data-remote-id'), false);
  } finally { t.cleanup(); }
  const t2 = setup({ apiOver: { pushResult: { ok: true, documentId: '' } } });
  try {
    const s = t2.store.add('<h2>A</h2>');
    await t2.prismic.push(null);
    assert.equal(s.meta.prismicId, undefined);
  } finally { t2.cleanup(); }
});

test('push : slice retirée pendant l\'envoi -> pas de crash, pas de cible fantôme', async () => {
  let removeIt = () => {};
  const t = setup({ apiOver: { get pushResult() { removeIt(); return { ok: true, documentId: 'NEWDOC' }; } } });
  try {
    const s = t.store.add('<h2>A</h2>');
    removeIt = () => t.store.remove(s.id);
    await t.prismic.push(null);
    assert.equal(t.store.list().length, 0);
    assert.equal(t.prismic.getPrismicTarget(), null);
    assert.ok(t.btn.classList.contains('hidden'));
  } finally { t.cleanup(); }
});
